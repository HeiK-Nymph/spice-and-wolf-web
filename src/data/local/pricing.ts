import pricingSnapshot from './pricing.json'

import { readLocal, sleep, writeLocal } from './storage'
import type { Meta, PricingData } from '@/types/pricing'

/**
 * 本地牌价。
 *
 * 数据就是一份完整的牌价快照（与 server/data/pricing.json 同源），随包带在站点里；
 * 汇率改动只写在本机 localStorage，刷新后仍然生效。
 * 全程不发起任何请求。
 */
const SNAPSHOT = pricingSnapshot as unknown as PricingData
const RATE_KEY = 'rate.v1'

/** 本机填过的汇率（没填过就返回 null） */
export function savedRate(): number | null {
  const value = readLocal<number | null>(RATE_KEY, null)
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export async function fetchPricing(): Promise<PricingData> {
  await sleep(140)
  const data = structuredClone(SNAPSHOT)
  const rate = savedRate()
  if (rate !== null) data.meta.usdToCny = rate
  return data
}

export async function updateRate(usdToCny: number): Promise<Meta> {
  if (!Number.isFinite(usdToCny) || usdToCny <= 0) {
    throw new Error('汇率要填一个大于 0 的数。')
  }
  writeLocal(RATE_KEY, usdToCny)
  await sleep(60)
  return { ...SNAPSHOT.meta, usdToCny }
}

/** 把汇率恢复成快照里的原始值 */
export function resetRate(): void {
  writeLocal(RATE_KEY, null)
}
