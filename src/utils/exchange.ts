import type { Currency, ModelPrice, PriceKind, Plan, Provider } from '@/types/pricing'

/** 官方定价单位：每 100 万 token */
export const PER_UNIT = 1_000_000

/** 把任意币种金额折算成人民币 */
export function toCny(amount: number, currency: Currency, usdToCny: number): number {
  return currency === 'USD' ? amount * usdToCny : amount
}

/** 每 100 万 token 的人民币价（含聚合平台加价） */
export function pricePerMillionCny(price: ModelPrice, usdToCny: number, markupPct = 0): number {
  return toCny(price.amount, price.currency, usdToCny) * (1 + markupPct / 100)
}

/** 核心指标：1 元人民币能买到多少 token */
export function tokensPerCny(price: ModelPrice, usdToCny: number, markupPct = 0): number {
  const perMillion = pricePerMillionCny(price, usdToCny, markupPct)
  if (!Number.isFinite(perMillion) || perMillion <= 0) return 0
  return PER_UNIT / perMillion
}

export function findPrice(prices: ModelPrice[], kind: PriceKind): ModelPrice | undefined {
  return prices.find((p) => p.kind === kind)
}

export interface BestTokens {
  tokens: number
  modelName: string
}

/**
 * 某个价格档位上，该供应商里「1 元能换最多 token」的模型。
 * 这正是页面的主线：永远展示最优的一档。
 */
export function bestTokensForKind(
  provider: Provider,
  kind: PriceKind,
  usdToCny: number,
): BestTokens | null {
  let best: BestTokens | null = null
  for (const model of provider.models) {
    const price = findPrice(model.prices, kind)
    if (!price) continue
    const tokens = tokensPerCny(price, usdToCny, provider.markupPct ?? 0)
    if (tokens > 0 && (best === null || tokens > best.tokens)) {
      best = { tokens, modelName: model.name }
    }
  }
  return best
}

/**
 * 订阅套餐的杠杆倍数 = 每月用量额度 / 月费。
 * 官方不按 token 计价，所以这是「花 1 元换到价值几元的用量」。
 */
export function planLeverage(plan: Plan): number | null {
  if (!plan.price || plan.price.amount <= 0) return null
  const usages = plan.limits
    .map((limit) => limit.monthlyUsageUsd)
    .filter((value): value is number => typeof value === 'number' && value > 0)
  if (usages.length === 0) return null
  return Math.max(...usages) / plan.price.amount
}

/** token 数量级差异极大（几千 ~ 几千万），统一成易读格式 */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`
  if (value >= 1e4) return `${(value / 1e4).toFixed(1)} 万`
  return Math.round(value).toLocaleString('zh-CN')
}

export function formatCny(value: number, digits = 2): string {
  return `¥${value.toFixed(digits)}`
}

export function formatUsd(value: number, digits = 2): string {
  return `$${value.toFixed(digits)}`
}
