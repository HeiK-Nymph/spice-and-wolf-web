import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchPricing, updateRate } from '@/data/pricing.source'
import type { Meta, PricingData } from '@/types/pricing'

/**
 * 价格数据的唯一入口。
 * 汇率改动后会写回服务端并同步到本地，所有派生数字由 usdToCny 重新计算。
 */
export const usePricingStore = defineStore('pricing', () => {
  const data = ref<PricingData | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const usdToCny = computed(() => data.value?.meta.usdToCny ?? 7)
  const providers = computed(() => data.value?.providers ?? [])
  const plans = computed(() => data.value?.plans ?? [])
  const priceKinds = computed(() => data.value?.priceKinds ?? [])

  async function load(): Promise<void> {
    if (data.value || loading.value) return
    loading.value = true
    error.value = null
    try {
      data.value = await fetchPricing()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  async function setRate(rate: number): Promise<Meta> {
    const meta = await updateRate(rate)
    if (data.value) data.value.meta = meta
    return meta
  }

  return { data, loading, error, usdToCny, providers, plans, priceKinds, load, setRate }
})
