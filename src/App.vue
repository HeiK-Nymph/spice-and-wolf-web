<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppFooter from '@/components/AppFooter.vue'
import AppHeader from '@/components/AppHeader.vue'
import LedgerOpenTransition from '@/components/LedgerOpenTransition.vue'
import SceneBackground from '@/components/SceneBackground.vue'
import ScrollCaravan from '@/components/ScrollCaravan.vue'
import { useLedgerOpening } from '@/composables/useLedgerOpening'

const currentRoute = useRoute()
const router = useRouter()
/** 首页是一整张地图：背景、马车进度条与页脚都要让位 */
const isMapRoute = computed(() => currentRoute.name === 'memoir')
/** 账本页自带「家中桌案」场景，不再套用全站视差背景 */
const hasOwnScene = computed(() => currentRoute.name === 'ledger')
/** 画坊是一整块工具页：不要页脚、不要滚动马车、页面本身不滚动 */
const isStudioRoute = computed(() => currentRoute.name === 'studio')
const showScene = computed(() => !isMapRoute.value && !hasOwnScene.value)

/* 「翻开账本」过场：挂在 App 上，跳转时不会被打断 */
const { opening, closeLedger } = useLedgerOpening()

/** 演完：推进账本页，并让过场多留一会儿自己淡出 */
function onLedgerOpened(): void {
  if (currentRoute.name !== 'ledger') void router.push('/ledger')
  window.setTimeout(closeLedger, 420)
}
</script>

<template>
  <SceneBackground v-if="showScene" />

  <ScrollCaravan v-if="!isMapRoute && !isStudioRoute" />

  <div
    class="app-shell"
    :class="{ 'app-shell--map': isMapRoute, 'app-shell--studio': isStudioRoute }"
  >
    <a class="skip-link" href="#main">跳到主要内容</a>
    <AppHeader />

    <main id="main" class="app-main">
      <RouterView v-slot="{ Component, route }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>

    <AppFooter v-if="!isMapRoute && !isStudioRoute" />
  </div>

  <LedgerOpenTransition :open="opening" @done="onLedgerOpened" />
</template>

<style scoped>
.app-shell {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  /* 底部给「马车进度条」留出空间，避免盖住页脚文字；
     再加安全区，免得马车被 Home 指示条压住 */
  padding-bottom: calc(72px + var(--safe-bottom));
}

.app-shell--map {
  padding-bottom: 0;
}

/* 画坊：整页工具，撑满视口且禁止页面自身滚动（滚动交给各面板） */
.app-shell--studio {
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  padding-bottom: 0;
  overflow: hidden;
}

/*
 * 关键：把 main 变成确定高度的 flex 列容器并允许收缩。
 * 否则 main 的 height 是 auto，内部 .studio/.shell 的 height:100% 全部退化，
 * 左侧面板就会被内容撑高，反过来顶掉画布与历史栏的高度。
 */
.app-shell--studio .app-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.app-main {
  flex: 1;
}

.skip-link {
  position: absolute;
  left: 50%;
  top: -60px;
  transform: translateX(-50%);
  z-index: 100;
  padding: 0.6rem 1.2rem;
  border-radius: 0 0 10px 10px;
  background: var(--wheat-400);
  color: #1a1206;
  font-weight: 600;
  transition: top 0.2s ease;
}

.skip-link:focus-visible {
  top: 0;
  color: #1a1206;
}

/* 只做淡入淡出：带 transform 的过渡会让 map 页面里 position: fixed 的地图失准 */
.page-enter-active,
.page-leave-active {
  transition: opacity 0.26s ease;
}

.page-enter-from,
.page-leave-to {
  opacity: 0;
}

/* 竖屏手机上画坊只剩一张提示页（工作台渲染被 StudioView 挡掉了）：
   不必再把视口锁死，放开滚动，提示卡才能正常排版 */
@media (max-width: 700px) and (orientation: portrait) {
  .app-shell--studio {
    height: auto;
    min-height: 100dvh;
    overflow: visible;
  }

  .app-shell--studio .app-main {
    overflow: visible;
  }
}
</style>
