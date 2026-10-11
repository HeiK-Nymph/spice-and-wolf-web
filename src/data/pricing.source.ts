/**
 * 构建期开关：由 vite.config.ts 的 define 注入（true = 单机版）。
 * 它是字面量，所以未选中的那条分支连同它的动态 import 会被静态消除 ——
 * 两个产物里各自只剩一套实现。
 */
const USE_LOCAL = __LOCAL_SOURCE__

import type { Meta, PricingData } from '@/types/pricing'

/**
 * 牌价数据接缝 —— 上层只知道这两个函数，不关心数据是走本机服务还是随包带在站点里。
 * 选中的分支在构建期就被定死，另一条分支（连同它的动态 import）不会进产物。
 */
export async function fetchPricing(): Promise<PricingData> {
  if (USE_LOCAL) {
    const local = await import('./local/pricing')
    return local.fetchPricing()
  }
  const http = await import('@/api/pricing')
  return http.fetchPricing()
}

export async function updateRate(usdToCny: number): Promise<Meta> {
  if (USE_LOCAL) {
    const local = await import('./local/pricing')
    return local.updateRate(usdToCny)
  }
  const http = await import('@/api/pricing')
  return http.updateRate(usdToCny)
}
