import type { Meta, PricingData } from '@/types/pricing'

interface Envelope<T> {
  ok?: boolean
  data?: T
  error?: string
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  let payload: Envelope<T> | null = null
  try {
    payload = (await response.json()) as Envelope<T>
  } catch {
    payload = null
  }
  if (!payload || payload.ok !== true) {
    throw new Error(payload?.error ?? `请求失败（HTTP ${response.status}）`)
  }
  return payload.data as T
}

/** 从本机 Node 服务读牌价 */
export function fetchPricing(): Promise<PricingData> {
  return request<PricingData>('/api/pricing')
}

/** 把汇率写回本机 Node 服务 */
export function updateRate(usdToCny: number): Promise<Meta> {
  return request<Meta>('/api/meta/rate', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usdToCny }),
  })
}
