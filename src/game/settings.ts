/**
 * 牌局自己的本机设置：最高分与难度。
 *
 * 刻意用自己的一套 localStorage 键，而不是 src/data/local/storage.ts ——
 * 那个模块只属于「单机版」的数据接缝（见 AGENTS.md），引它会把整套 local 实现
 * 拖进主站产物。这两个设置是两个版本都有的功能，不属于接缝。
 *
 * 键都带版本号：以后结构变了，旧键读不出来就当空，不会把页面弄崩。
 */
import type { Difficulty } from './engine'

const BEST_KEY = 'saw.game.2048.best.v1'
const DIFFICULTY_KEY = 'saw.game.2048.difficulty.v1'

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard']

export function readBest(): number {
  try {
    const raw = window.localStorage.getItem(BEST_KEY)
    if (!raw) return 0
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  } catch {
    // 隐私模式：当作没有最高分，不打扰使用
    return 0
  }
}

export function writeBest(score: number): void {
  try {
    window.localStorage.setItem(BEST_KEY, String(Math.floor(score)))
  } catch {
    /* 配额或隐私模式：静默降级，本次会话内仍然记得 */
  }
}

/** 读上次选的难度；值不合法（旧版本 / 手改过）就退回普通 */
export function readDifficulty(): Difficulty {
  try {
    const raw = window.localStorage.getItem(DIFFICULTY_KEY)
    if (raw && (DIFFICULTIES as string[]).includes(raw)) return raw as Difficulty
  } catch {
    /* 同上 */
  }
  return 'normal'
}

export function writeDifficulty(value: Difficulty): void {
  try {
    window.localStorage.setItem(DIFFICULTY_KEY, value)
  } catch {
    /* 同上 */
  }
}
