export type AccountProvider = 'deepseek' | 'opencode'

/** 单项额度的计量方式：amount=货币金额，percent=使用比例 */
export type MeterKind = 'amount' | 'percent'

/**
 * 一条额度计量项。
 * DeepSeek 返回金额（剩余 / 赠送 / 充值），OpenCode Go 返回各时间窗的使用比例，
 * 两者差异用同一结构承载，前端按 kind 分别渲染。
 */
export interface BalanceMeter {
  /** 展示名称，如「剩余余额」「5 小时」「本周」「本月」 */
  label: string
  kind: MeterKind
  /** kind==='amount' 时的数值，单位见 AccountBalance.unit */
  amount: number | null
  /** kind==='percent' 时的使用百分比（0–100） */
  percent: number | null
  /** 该额度窗口的重置时间（ISO 字符串，不确定时为 null） */
  resetAt: string | null
}

export interface AccountBalance {
  /** 金额类计量项的单位（如 CNY / USD）；纯比例供应商为空串 */
  unit: string
  /** 计量项列表 */
  meters: BalanceMeter[]
}

export interface Account {
  id: string
  provider: AccountProvider
  /** 脱敏后的 Key，用于列表展示 */
  keyHint: string
  balance: AccountBalance | null
  status: 'pending' | 'ok' | 'error'
  lastChecked: string | null
  error: string | null
}
