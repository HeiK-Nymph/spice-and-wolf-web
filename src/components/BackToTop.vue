<script setup lang="ts">
/**
 * 返回页首。
 * 位置固定在右下角、抬到商队进度条之上，避免与底部马车区域打架。
 * 滚过一屏才出现，避免首屏就有个没用的按钮。
 *
 * 点击后进入「返程」：底部马车立即水平翻转（见 useCaravanReturn），页面滚回顶部；
 * 到顶后马车翻正、解除滚动锁。
 *
 * 返程不走浏览器自带的平滑滚动，也不用 overflow:hidden 锁页面：
 * - 自带平滑滚动会被用户输入打断或挂起。一旦被打断，靠 scrollY 判定就永远到不了顶部，
 *   而 overflow:hidden 还挂着，整页就锁死在那儿解不开了；
 * - 给 <html> 挂 overflow:hidden 会让根滚动容器中途失活：滚轮落到一个不可滚动的根上，
 *   浏览器会把这次滚动扣下，直到解锁才补上（实测返程中按 PageDown，页面最终停在半路
 *   1130px 而不是顶部）。观感就是「滚动时整页卡住一下」，解锁瞬间还会被补上的滚动带跑。
 * 所以这里用 rAF 每帧自己写 scrollTop，并用 preventDefault 吞掉滚轮/触摸/翻页键：
 * 动画不会被任何输入打断，锁也一定能解开。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { useCaravanReturn } from '@/composables/useCaravanReturn'

const visible = ref(false)
const returning = ref(false)

const { start, finish } = useCaravanReturn()

/** 到顶判定留一点余量，避免浏览器把终点停在 0.x px 上 */
const TOP_EPSILON = 2
/** 返程时长：随距离增长，420ms ~ 900ms */
const MIN_DURATION = 420
const MAX_DURATION = 900
const DURATION_PER_PX = 0.18
/** 这些键会滚动页面，返程期间一并吞掉 */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

let rafId = 0
let watchdogId = 0

function blockInput(event: Event) {
  event.preventDefault()
}

function blockKey(event: KeyboardEvent) {
  if (SCROLL_KEYS.has(event.key)) event.preventDefault()
}

/** 关掉 rAF、兜底定时器与输入拦截，可重复调用 */
function releaseReturn() {
  if (rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
  if (watchdogId) {
    clearTimeout(watchdogId)
    watchdogId = 0
  }
  window.removeEventListener('wheel', blockInput)
  window.removeEventListener('touchmove', blockInput)
  window.removeEventListener('keydown', blockKey)
}

function finishReturn() {
  if (!returning.value) return
  releaseReturn()
  returning.value = false
  finish()
}

function lockInput() {
  // 必须是非 passive 才能 preventDefault；滚轮/触摸/翻页键在这里被吞掉，
  // 既不会和 rAF 抢滚动位置，也不会把滚动请求排到解锁之后再补上
  window.addEventListener('wheel', blockInput, { passive: false })
  window.addEventListener('touchmove', blockInput, { passive: false })
  window.addEventListener('keydown', blockKey)
}

/** 全局 html{scroll-behavior:smooth} 会把 scrollTo 也变成平滑滚动，必须显式 instant */
function jumpToTop() {
  window.scrollTo({ top: 0, behavior: 'instant' })
}

function onScroll() {
  visible.value = window.scrollY > window.innerHeight * 0.9
}

function toTop() {
  if (returning.value) return

  const startY = window.scrollY
  if (startY <= TOP_EPSILON) return

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  returning.value = true
  start()
  lockInput()

  if (reduce) {
    jumpToTop()
    finishReturn()
    return
  }

  const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, startY * DURATION_PER_PX))
  const t0 = performance.now()

  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / duration)
    // 缓出：起步快、到顶稳，观感接近原生平滑滚动
    const eased = 1 - (1 - t) ** 3
    window.scrollTo({ top: startY * (1 - eased), behavior: 'instant' })
    if (t < 1) {
      rafId = requestAnimationFrame(step)
    } else {
      rafId = 0
      jumpToTop()
      finishReturn()
    }
  }

  rafId = requestAnimationFrame(step)

  // 兜底：后台标签页会把 rAF 冻住，到点也必须收尾，绝不能把页面锁在那儿
  watchdogId = window.setTimeout(() => {
    watchdogId = 0
    jumpToTop()
    finishReturn()
  }, duration + 400)
}

onMounted(() => {
  onScroll()
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  finishReturn()
})
</script>

<template>
  <Transition name="totop">
    <button v-show="visible" class="totop" type="button" aria-label="回到顶部" @click="toTop">
      <span class="totop__ring">
        <svg viewBox="0 0 34 34" aria-hidden="true">
          <g
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <!-- 麦穗 -->
            <path d="M17 27V13" />
            <path d="M17 15c-2.6-2.8-6.2-2.3-6.2-2.3s0 3.8 2.8 5.2c2.6 1.4 3.4.5 3.4.5" />
            <path d="M17 15c2.6-2.8 6.2-2.3 6.2-2.3s0 3.8-2.8 5.2c-2.6 1.4-3.4.5-3.4.5" />
            <!-- 向上箭头 -->
            <path d="M12 9.5 17 5l5 4.5" />
          </g>
        </svg>
      </span>
      <span class="totop__hint">顶部</span>
    </button>
  </Transition>
</template>

<style scoped>
.totop {
  position: fixed;
  right: clamp(1rem, 2.5vw, 2rem);
  /* 贴着商队进度条上沿，尽量往下放 */
  bottom: 104px;
  z-index: 45;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.2rem;
  /* 正方形：显式锁定宽高，避免被内容撑成竖长条 */
  width: 3.5rem;
  height: 3.5rem;
  padding: 0;
  border: 1px solid rgba(224, 169, 68, 0.45);
  border-radius: 14px;
  background: rgba(20, 16, 25, 0.82);
  backdrop-filter: blur(10px) saturate(140%);
  color: var(--wheat-300);
  cursor: pointer;
  box-shadow:
    0 0 0 1px rgba(13, 10, 18, 0.6),
    0 10px 26px -14px rgba(224, 169, 68, 0.5);
  transition:
    transform 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease;
}

.totop:hover {
  transform: translateY(-2px);
  background: rgba(32, 25, 38, 0.92);
  border-color: rgba(233, 185, 92, 0.7);
}

.totop:focus-visible {
  outline: 2px solid var(--wheat-400);
  outline-offset: 3px;
}

.totop__ring {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #e9b95c, #b87d26 62%, #7d4f13);
  color: #1a1206;
  box-shadow: inset 0 1px 2px rgba(255, 235, 190, 0.55);
}

.totop__ring svg {
  width: 22px;
  height: 22px;
}

.totop__hint {
  font-size: 0.74rem;
  letter-spacing: 0.1em;
  line-height: 1;
  white-space: nowrap;
}

/* 出现/消失 */
.totop-enter-active,
.totop-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.totop-enter-from,
.totop-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

@media (max-width: 760px) {
  .totop {
    width: 3.1rem;
    height: 3.1rem;
    padding: 0;
    bottom: calc(84px + var(--safe-bottom));
    /* 毛玻璃在手机上掉帧，换实色底 */
    backdrop-filter: none;
    background: rgba(20, 16, 25, 0.94);
  }
}

@media (max-width: 700px) and (orientation: portrait) {
  .totop {
    /* 触控目标不小于 44px（3.1rem ≈ 49.6px，这里写明意图） */
    min-width: var(--tap);
    min-height: var(--tap);
  }
}
</style>
