<script setup lang="ts">
/**
 * 商队马车 —— 随页面滚动横向行进的进度指示器。
 *
 * 位置与进度条原本完全由 CSS scroll() 时间轴驱动；现在轨道与马车都
 * 可作为横向拖动滑块：按住拖动 / 点击轨道 → 直接改变页面 scrollTop。
 * 这样既保留原来的动画，也让底部进度条成为可操作的导航控件。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useCaravanReturn } from '@/composables/useCaravanReturn'
import { isPhoneViewport } from '@/utils/viewport'

const { returning } = useCaravanReturn()

const root = ref<HTMLElement | null>(null)
const progress = ref(0)
const scrubbing = ref(false)

let activePointerId: number | null = null
let grabOffset = 0
let previousScrollBehavior = ''

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

function getScrollMax(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
}

function getRail(): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>('.caravan__rail') ?? null
}

function getCart(): HTMLElement | null {
  return root.value?.querySelector<HTMLElement>('.caravan__cart') ?? null
}

/** 把视口 x 坐标映射到马车可移动范围内的进度（0~1） */
function progressFromX(clientX: number, offset = 0): number {
  const rail = getRail()
  const cart = getCart()
  if (!rail || !cart) return progress.value

  const railRect = rail.getBoundingClientRect()
  const cartWidth = cart.getBoundingClientRect().width
  const travel = Math.max(1, railRect.width - cartWidth)
  const cartCenter = clientX - offset
  const start = railRect.left + cartWidth / 2

  return clamp01((cartCenter - start) / travel)
}

function syncProgress(): void {
  const max = getScrollMax()
  progress.value = max > 0 ? clamp01(window.scrollY / max) : 0
}

function scrollToProgress(next: number, behavior: ScrollBehavior = 'auto'): void {
  const value = clamp01(next)
  progress.value = value
  window.scrollTo({ top: value * getScrollMax(), behavior })
}

function removeDragListeners(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
}

function finishScrub(): void {
  if (activePointerId === null) return
  activePointerId = null
  scrubbing.value = false
  document.documentElement.style.scrollBehavior = previousScrollBehavior
  removeDragListeners()
  syncProgress()
}

function onPointerDown(event: PointerEvent): void {
  if (activePointerId !== null) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  // 竖屏手机上这条进度条只当指示器：手指一搭上去就吃掉纵向滚动，
  // 页面反而划不动 —— 实测下来的取舍是「手机上不拖它」。
  if (event.pointerType === 'touch' && isPhoneViewport()) return

  const target = event.target instanceof Element ? event.target : null
  const cart = target?.closest<HTMLElement>('.caravan__cart')

  activePointerId = event.pointerId
  scrubbing.value = true
  previousScrollBehavior = document.documentElement.style.scrollBehavior
  // 拖拽时暂时关掉全局 scroll-behavior:smooth，保证滑块跟手
  document.documentElement.style.scrollBehavior = 'auto'

  if (cart) {
    // 从马车本体起拖时保留鼠标与马车中心的偏移，避免马车瞬间跳到指针下
    const rect = cart.getBoundingClientRect()
    grabOffset = event.clientX - (rect.left + rect.width / 2)
  } else {
    // 点击轨道时先跳到指针所在进度，再继续拖拽
    grabOffset = 0
    scrollToProgress(progressFromX(event.clientX))
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  event.preventDefault()
}

function onPointerMove(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return
  scrollToProgress(progressFromX(event.clientX, grabOffset))
}

function onPointerUp(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return
  finishScrub()
}

function onKeydown(event: KeyboardEvent): void {
  let next = progress.value
  const step = event.shiftKey ? 0.1 : 0.05

  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      next -= step
      break
    case 'ArrowRight':
    case 'ArrowDown':
      next += step
      break
    case 'PageUp':
      next -= 0.2
      break
    case 'PageDown':
      next += 0.2
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = 1
      break
    default:
      return
  }

  event.preventDefault()
  scrollToProgress(next, 'smooth')
}

onMounted(() => {
  syncProgress()
  window.addEventListener('scroll', syncProgress, { passive: true })
  window.addEventListener('resize', syncProgress, { passive: true })
})

onBeforeUnmount(() => {
  finishScrub()
  window.removeEventListener('scroll', syncProgress)
  window.removeEventListener('resize', syncProgress)
})
</script>

<template>
  <div ref="root" class="caravan" :class="{ 'is-scrubbing': scrubbing }">
    <div
      class="caravan__rail"
      role="slider"
      tabindex="0"
      aria-label="页面滚动进度"
      aria-orientation="horizontal"
      :aria-valuemin="0"
      :aria-valuemax="100"
      :aria-valuenow="Math.round(progress * 100)"
      :aria-valuetext="`已浏览 ${Math.round(progress * 100)}%`"
      @pointerdown="onPointerDown"
      @keydown="onKeydown"
    >
      <span class="caravan__fill"></span>
    </div>
    <div class="caravan__cart" @pointerdown="onPointerDown">
      <!-- 翻转层独立于位置层（.caravan__cart）与马蹄起伏层（img），三个 transform 互不打架 -->
      <div class="caravan__flip" :class="{ 'is-returning': returning }">
        <img src="/art/carriage-v2.webp" alt="" draggable="false" />
      </div>
    </div>
    <span class="caravan__hint" aria-hidden="true">拖动马车浏览</span>
  </div>
</template>

<style scoped>
.caravan {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 96px;
  z-index: 30;
  pointer-events: none;
  background: linear-gradient(
    180deg,
    transparent 0%,
    rgba(13, 10, 18, 0.72) 55%,
    rgba(13, 10, 18, 0.95) 100%
  );
}

/* 车轮走过的路 */
.caravan__rail {
  position: absolute;
  left: 5vw;
  right: 5vw;
  bottom: 26px;
  height: 2px;
  border-radius: 999px;
  background: rgba(224, 169, 68, 0.16);
  box-shadow: 0 0 10px rgba(224, 169, 68, 0.12);
  pointer-events: auto;
  touch-action: none;
  cursor: grab;
  transition:
    background 0.2s ease,
    box-shadow 0.2s ease;
}

/* 把只有 2px 高的轨道扩成真正好抓的滑块命中区 */
.caravan__rail::before {
  content: '';
  position: absolute;
  inset: -16px -10px;
  border-radius: 999px;
  pointer-events: auto;
}

.caravan__rail:hover,
.caravan.is-scrubbing .caravan__rail {
  background: rgba(224, 169, 68, 0.3);
  box-shadow: 0 0 16px rgba(224, 169, 68, 0.34);
}

.caravan__fill {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  transform-origin: left center;
  background: linear-gradient(90deg, rgba(224, 169, 68, 0.3), rgba(233, 185, 92, 0.85));
  animation: caravanFill linear both;
  animation-timeline: scroll(root block);
  transition: filter 0.2s ease;
}

.caravan__rail:hover .caravan__fill,
.caravan.is-scrubbing .caravan__fill {
  filter: brightness(1.28);
}

/* 马车就是滑块本体 */
.caravan__cart {
  position: absolute;
  left: 5vw;
  bottom: 22px;
  width: 118px;
  pointer-events: auto;
  touch-action: none;
  cursor: grab;
  animation: caravanDrive linear both;
  animation-timeline: scroll(root block);
}

/* 马车与轨道被抓住时的统一状态 */
.caravan.is-scrubbing .caravan__rail,
.caravan.is-scrubbing .caravan__cart {
  cursor: grabbing;
}

/* 掉头层：单独承载水平翻转，避免覆盖位置/起伏的 transform */
.caravan__flip {
  transform: scaleX(1);
  transform-origin: center center;
  transition: transform 0.6s ease;
}

.caravan__flip.is-returning {
  transform: scaleX(-1);
}

.caravan__cart img {
  display: block;
  width: 100%;
  height: auto;
  cursor: inherit;
  filter: drop-shadow(0 0 14px rgba(233, 185, 92, 0.35));
  transition: filter 0.2s ease;
  /* 马蹄起伏 */
  animation: caravanTrot 1.1s ease-in-out infinite;
}

.caravan__cart:hover img,
.caravan.is-scrubbing .caravan__cart img {
  filter: brightness(1.1) drop-shadow(0 0 18px rgba(233, 185, 92, 0.62));
}

/* 只在鼠标靠近时提示可拖拽，避免长期占住地图边缘 */
.caravan__hint {
  position: absolute;
  right: 5vw;
  bottom: 58px;
  padding: 0.25rem 0.6rem;
  border: 1px solid rgba(224, 169, 68, 0.28);
  border-radius: 999px;
  background: rgba(16, 11, 6, 0.88);
  color: rgba(233, 222, 200, 0.82);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  opacity: 0;
  transform: translateY(4px);
  pointer-events: none;
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.caravan:hover .caravan__hint,
.caravan__rail:focus-visible ~ .caravan__hint {
  opacity: 1;
  transform: translateY(0);
}

@keyframes caravanFill {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

@keyframes caravanDrive {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    transform: translate3d(calc(90vw - 100%), 0, 0);
  }
}

@keyframes caravanTrot {
  0%,
  100% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(0, -2px, 0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .caravan__fill,
  .caravan__cart,
  .caravan__cart img {
    animation: none;
  }

  .caravan__flip {
    transition: none;
  }
}

@media (max-width: 760px) {
  .caravan {
    /* 高度里含安全区：轨道与马车一起抬到 Home 指示条上方 */
    height: calc(72px + var(--safe-bottom));
  }

  .caravan__rail {
    bottom: calc(26px + var(--safe-bottom));
  }

  .caravan__cart {
    width: 84px;
    bottom: calc(22px + var(--safe-bottom));
  }

  /* 触屏没有 hover，这条「可拖拽」提示永远不该出现 */
  .caravan__hint {
    display: none;
  }
}
</style>
