import { localId, readLocal, seededUnit, sleep, writeLocal } from './storage'
import type { Account, AccountBalance, AccountProvider, BalanceMeter } from '@/types/accounts'

/**
 * 本地账本。
 *
 * 数据随包带在站点里（示例账目），核对余额是在本机按「供应商 + 条目 + 当前小时」
 * 做一次确定性推演 —— 同一小时内多次核对数字稳定、换了小时会小幅变动，
 * 看着像在核对，但没有任何请求、也不碰任何人的真实 key。
 * 增删改只写在本机 localStorage。
 */
const KEY = 'accounts.v1'

const round2 = (value: number): number => Math.round(value * 100) / 100

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function pct(seed: string, salt: string): number {
  return 1 + Math.floor(seededUnit(seed, salt) * 92)
}

/** DeepSeek 一类的金额账：赠送 + 充值，扣掉一点已用量 */
function amountBalance(seed: string): AccountBalance {
  const gift = round2(seededUnit(seed, 'gift') * 30)
  const paid = round2(10 + seededUnit(seed, 'paid') * 110)
  const spent = round2(seededUnit(seed, 'spent') * paid * 0.18)
  const meter = (label: string, amount: number): BalanceMeter => ({
    label,
    kind: 'amount',
    amount,
    percent: null,
    resetAt: null,
  })
  return {
    unit: 'CNY',
    meters: [
      meter('剩余余额', round2(gift + paid - spent)),
      meter('赠送余额', gift),
      meter('充值余额', paid),
    ],
  }
}

/** OpenCode Go 一类的额度账：只报各时间窗用了多少比例 */
function percentBalance(seed: string): AccountBalance {
  const now = Date.now()
  const meter = (label: string, percent: number, resetAt: string): BalanceMeter => ({
    label,
    kind: 'percent',
    amount: null,
    percent,
    resetAt,
  })
  const weekReset = new Date(now)
  weekReset.setDate(weekReset.getDate() + ((8 - weekReset.getDay()) % 7 || 7))
  weekReset.setHours(0, 0, 0, 0)
  return {
    unit: '%',
    meters: [
      meter('5 小时', pct(seed, 'h5'), iso(now + 5 * 3600 * 1000)),
      meter('每周', pct(seed, 'week'), weekReset.toISOString()),
      meter('每月', pct(seed, 'month'), iso(now + 30 * 86400 * 1000)),
    ],
  }
}

function balanceOf(provider: AccountProvider, seed: string): AccountBalance {
  return provider === 'deepseek' ? amountBalance(seed) : percentBalance(seed)
}

/** 示例账目：6 条往来，深浅不一，够把账页铺满 */
function sampleAccounts(): Account[] {
  const base = `${Date.now()}`.slice(-4)
  const rows: { provider: AccountProvider; hint: string }[] = [
    { provider: 'deepseek', hint: `sk-${base}••••3f2a` },
    { provider: 'deepseek', hint: `sk-${base}••••9c17` },
    { provider: 'deepseek', hint: `sk-${base}••••d84b` },
    { provider: 'opencode', hint: `oc_sk_${base}••••6k2d` },
    { provider: 'opencode', hint: `oc_sk_${base}••••p9wq` },
    { provider: 'opencode', hint: `oc_sk_${base}••••x4mn` },
  ]
  return rows.map((row, index) => {
    const id = `sample-${row.provider}-${index + 1}`
    const seed = `${row.provider}|${id}`
    return {
      id,
      provider: row.provider,
      keyHint: row.hint,
      balance: balanceOf(row.provider, seed),
      status: 'ok' as const,
      lastChecked: new Date().toISOString(),
      error: null,
    }
  })
}

/** 一条往来「核对」之后的样子：数字按小时推演，时间戳更新 */
function checked(account: Account): Account {
  const stamp = new Date().toISOString().slice(0, 13)
  const seed = `${account.provider}|${account.id}|${stamp}`
  return {
    ...account,
    balance: balanceOf(account.provider, seed),
    status: 'ok',
    lastChecked: new Date().toISOString(),
    error: null,
  }
}

function loadAll(): Account[] {
  const saved = readLocal<Account[] | null>(KEY, null)
  if (Array.isArray(saved)) return saved
  const seeded = sampleAccounts()
  writeLocal(KEY, seeded)
  return seeded
}

export async function fetchAccounts(): Promise<Account[]> {
  await sleep(120)
  return loadAll()
}

export async function refreshAllAccounts(): Promise<Account[]> {
  const next = loadAll().map(checked)
  writeLocal(KEY, next)
  await sleep(360)
  return next
}

export async function refreshAccount(id: string): Promise<Account> {
  const list = loadAll()
  const index = list.findIndex((item) => item.id === id)
  if (index < 0) throw new Error('账上找不到这一条。')
  await sleep(320)
  const next = checked(list[index]!)
  list[index] = next
  writeLocal(KEY, list)
  return next
}

function maskKey(raw: string): string {
  const head = raw.slice(0, 7)
  const tail = raw.slice(-4)
  return `${head}••••${tail}`
}

export async function createAccount(provider: AccountProvider, apiKey: string): Promise<Account> {
  await sleep(520)
  const keyHint = maskKey(apiKey)
  const plausible = /^(sk-[A-Za-z0-9_-]{12,}|oc_sk_[A-Za-z0-9_]{12,})$/.test(apiKey)
  const id = localId()
  const account: Account = {
    id,
    provider,
    keyHint,
    balance: null,
    status: 'pending',
    lastChecked: null,
    error: null,
  }

  if (!plausible) {
    account.status = 'error'
    account.error = '这串 key 对不上号。本站只在浏览器里校验格式，不会把它发去任何地方。'
  } else {
    Object.assign(account, checked({ ...account, id }))
  }

  const list = loadAll()
  list.push(account)
  writeLocal(KEY, list)
  return account
}

export async function deleteAccount(id: string): Promise<{ deleted: boolean }> {
  const list = loadAll().filter((item) => item.id !== id)
  writeLocal(KEY, list)
  await sleep(160)
  return { deleted: true }
}

/** 把账页恢复成随包带来的示例账目 */
export async function resetSampleAccounts(): Promise<Account[]> {
  const seeded = sampleAccounts()
  writeLocal(KEY, seeded)
  await sleep(160)
  return seeded
}
