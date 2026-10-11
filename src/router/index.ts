import { createRouter, createWebHistory } from 'vue-router'

import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/ledger',
    name: 'ledger',
    component: () => import('@/views/LedgerView.vue'),
    meta: { title: '账本 · API 额度' },
  },
  {
    path: '/',
    name: 'memoir',
    component: () => import('@/views/MemoirView.vue'),
    meta: { title: '旅途回忆录' },
  },
  {
    // 商行 · 牌价板（原首页，整块迁到这里）
    path: '/market',
    name: 'market',
    component: () => import('@/views/ExchangeView.vue'),
    meta: { title: '商行 · 牌价板' },
  },
  {
    path: '/companions',
    name: 'companions',
    component: () => import('@/views/StationView.vue'),
    meta: { title: '旅伴 · 人物图鉴', stationId: 'pasloe' },
  },
  {
    path: '/quotes',
    name: 'quotes',
    component: () => import('@/views/StationView.vue'),
    meta: { title: '语录集 · 旅途回忆', stationId: 'nyohhira' },
  },
  {
    path: '/studio',
    name: 'studio',
    component: () => import('@/views/StudioView.vue'),
    meta: { title: '画坊 · 绘图工作台' },
  }, // 旧站页面已废弃，统一回到旅途回忆录
  { path: '/characters', redirect: '/' },
  { path: '/anime', redirect: '/' },
  { path: '/world', redirect: '/' },
  { path: '/gallery', redirect: '/' },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '未找到页面' },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, top: 90, behavior: 'smooth' }
    // 只有 query 变化（筛选 / 对照写 URL）时保持当前位置，不要滚回顶部
    if (to.path === from.path) return false
    return { top: 0 }
  },
})

const SITE_NAME = '赫萝的货币兑换所 · 狼与香辛料'

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ? `${title} | ${SITE_NAME}` : SITE_NAME
})

export default router
