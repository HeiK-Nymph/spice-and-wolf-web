/**
 * 本地版本的存取小工具。
 *
 * 只用 localStorage 存「元数据」：账本条目、汇率、画坊历史的参数与图片引用。
 * 二进制一律不进来（localStorage 只有 ~5MB，一次生成就能把它塞爆），
 * 需要画面时按参数重算或复用仓库里已有的画片。
 *
 * 所有键都带版本号：以后结构变了，旧键读不出来就当空，不会把页面弄崩。
 */
const PREFIX = 'saw.local.'

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // 隐私模式或配额满了：静默降级为「本次会话有效」，不打扰使用
  }
}

export function clearLocal(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    // 同上
  }
}

/** 让「核对」这类动作有一点真实耗时，但不要真的卡住界面 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** 稳定的字符串散列 —— 用来让「同一组参数」总是得到同一张画片 */
export function hashString(input: string): number {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 按种子生成 0~1 之间的确定值（同一 seed 永远同一个数） */
export function seededUnit(seed: string, salt = ''): number {
  return (hashString(`${seed}|${salt}`) % 100000) / 100000
}

/** 简版 id：不需要密码学强度，只要不撞 */
export function localId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
