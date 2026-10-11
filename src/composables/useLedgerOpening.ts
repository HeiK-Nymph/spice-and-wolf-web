import { ref } from 'vue'

import { assetUrl } from '@/utils/asset'

/**
 * 「翻开账本」过场。
 *
 * 状态放在模块级单例里：过场组件挂在 App 上（跨路由存活），
 * 旅途页只负责把它打开，这样跳转到 /ledger 时动画不会被打断。
 */
const opening = ref(false)

/** 过场要用的三张贴图 */
const PRELOAD = ['art/book-cover.webp', 'art/book-spread.webp', 'art/book-edges.webp'].map(assetUrl)

let warmed = false

/**
 * 预热过场资源。
 * three 是动态 import 的独立分包，贴图也有 600KB 出头；第一次点击才下载会先黑一下。
 * 所以在鼠标悬到账本上（即「准备点它」）时就把分包和贴图都拉下来。
 */
export function warmLedgerTransition(): void {
  if (warmed) return
  warmed = true
  void import('three')
  for (const src of PRELOAD) {
    const img = new Image()
    img.src = src
  }
}

export function useLedgerOpening() {
  return {
    opening,
    openLedger: (): void => {
      opening.value = true
    },
    closeLedger: (): void => {
      opening.value = false
    },
  }
}
