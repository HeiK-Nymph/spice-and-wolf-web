/** 「1 元能换多少 token」相关的领域类型。 */

export type Currency = 'USD' | 'CNY'

/** 价格档位：对应官方定价页上的输入/输出/缓存命中 */
export type PriceKind = 'input_cache_hit' | 'input_cache_miss' | 'output'

/** 供应商性质：官方按量 API，或第三方聚合平台 */
export type ProviderKind = 'official-api' | 'aggregator'

export interface Meta {
  usdToCny: number
  rateDate: string
  lastUpdated: string
  rateNote: string
  disclaimer: string
}

export interface ModelPrice {
  kind: PriceKind
  /** 每 100 万 token 的单价，单位为 currency */
  amount: number
  currency: Currency
}

export interface ProviderModel {
  id: string
  name: string
  prices: ModelPrice[]
}

export interface Provider {
  id: string
  name: string
  kind: ProviderKind
  tag: string
  /** 聚合平台的加价百分比，例如 OpenRouter 5.5 */
  markupPct?: number
  sourceUrl: string
  lastChecked: string | null
  note?: string
  /** 价格尚未录入，仅占位 */
  pending?: boolean
  /** 是否已与官方来源核对；false 表示来自第三方整理 */
  verified?: boolean
  models: ProviderModel[]
}

export interface PlanLimit {
  model: string
  reqPer5h: number | null
  monthlyUsageUsd: number | null
  free?: boolean
}

export interface PlanPrice {
  amount: number
  currency: Currency
  period: string
}

/** 套餐额度的计量单位：积分 / token / 美元用量 */
export interface PlanQuota {
  amount: number
  unit: 'credits' | 'tokens' | 'usd'
  period: 'week' | 'month'
}

export interface Plan {
  id: string
  vendorName: string
  name: string
  price: PlanPrice | null
  /** 划线原价（有折扣时） */
  listPrice?: number
  /** 额度：可能是积分、token 或美元用量 */
  quota?: PlanQuota
  sourceUrl: string
  lastChecked: string | null
  note?: string
  pending?: boolean
  /** 是否已与官方来源核对 */
  verified?: boolean
  limits: PlanLimit[]
}

export interface PriceKindMeta {
  id: PriceKind
  label: string
  short: string
}

export interface PricingData {
  meta: Meta
  priceKinds: PriceKindMeta[]
  providers: Provider[]
  plans: Plan[]
}

/** 对照台上的一个条目（供应商或套餐归一化后的形状） */
export interface CompareItem {
  id: string
  name: string
  vendor: string
  kindLabel: string
  verified: boolean
  sourceUrl: string
  lastChecked: string | null
  /** key -> 已格式化的展示值；缺省表示该项无此指标 */
  cells: Record<string, string>
}
