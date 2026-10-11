import { readonly, ref } from 'vue'

/**
 * 「商队掉头返程」的共享状态。
 *
 * 返回顶部按钮（BackToTop）在开始返程时置为 true，
 * 页面滚回顶部后置回 false；底部马车（ScrollCaravan）读取它来决定是否水平翻转。
 * 两个组件分处不同分支（App / RouterView 内的页面），所以用模块级单例而非 provide/inject。
 */
const returning = ref(false)

export function useCaravanReturn() {
  return {
    /** 马车是否正处于「掉头返程」状态 */
    returning: readonly(returning),
    start: () => {
      returning.value = true
    },
    finish: () => {
      returning.value = false
    },
  }
}
