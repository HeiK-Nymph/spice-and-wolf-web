/**
 * 2048 的合并逻辑 —— 纯二维，与渲染完全无关。
 *
 * 这个文件里没有 Vue、没有 three.js、不碰 DOM，也不存任何状态：
 * 全是纯函数，输入一个局面、输出一个新局面。3D 那边只负责把「旧局面 → 新局面」
 * 这个过程演出来（见 src/components/CardTable.vue）。
 *
 * 方块带 id 是刻意的：动画需要知道「哪个方块滑到哪、谁被谁吞了」，
 * 光有数值做不到 —— 两个 4 合并成一个 8，得让其中一个滑过去并消失。
 */

/** 默认棋盘边长（普通难度）。难度可以改这个数，所以它只是一份默认值 */
export const BOARD_SIZE = 4

/** 普通难度的目标值；各难度自己的目标见 DIFFICULTY */
export const WIN_VALUE = 2048

export type Direction = 'up' | 'down' | 'left' | 'right'

export type Difficulty = 'easy' | 'normal' | 'hard'

export interface DifficultyConfig {
  /** 棋盘边长。格子数 = size × size */
  size: number
  /** 新生成的方块是 4 的概率（其余是 2） */
  fourChance: number
  /**
   * 合成到这个数值算「抵达」。
   * 必须跟着棋盘大小走 —— n×n 棋盘理论上能合出的最大值是有限的，
   * 3×3 顶天只能到 512，目标还挂 2048 就永远打不到。
   */
  winValue: number
}

/**
 * 三档难度。
 * 棋盘大小是难度里最重的那个旋钮，其次是出 4 的概率，目标值再跟着棋盘走。
 */
export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: { size: 5, fourChance: 0, winValue: 4096 },
  normal: { size: 4, fourChance: 0.1, winValue: 2048 },
  hard: { size: 3, fourChance: 0.1, winValue: 512 },
}

export interface Tile {
  /** 全生命周期唯一：合并时保留其中一个的 id，另一个消失 */
  id: number
  value: number
  row: number
  col: number
}

/** 一次合并：absorbed 滑进 keeper 的位置后被吞掉，keeper 的数值翻倍 */
export interface MergeEvent {
  keeper: number
  absorbed: number
  /** 合并后的数值 */
  value: number
}

export interface GameState {
  tiles: Tile[]
  score: number
  /** 下一个可用 id。放在状态里，保证纯函数也能产出稳定 id */
  nextId: number
  /** 是否已经达成过目标值 */
  won: boolean
  /** 这一局的难度。棋盘大小、出 4 概率、目标值都从它查出来 */
  difficulty: Difficulty
}

export interface MoveOutcome {
  state: GameState
  /** 本次发生的合并（动画：absorbed 滑过去后消失） */
  merges: MergeEvent[]
  /** 本次新生成的方块（动画：弹出来），没动就是 null */
  spawned: Tile | null
  /** 本次得分 */
  gained: number
  /** 局面是否真的变了。没变就不该生成新方块 */
  changed: boolean
  /** 这一次操作刚刚达成目标 */
  justWon: boolean
  /** 移动后是否已经无路可走 */
  over: boolean
}

/** 稳定的格子键 */
function key(row: number, col: number): string {
  return `${row},${col}`
}

/**
 * 把「第 line 条线、滑动方向上第 step 格」映射成真实坐标。
 * left 时 step 0 在最左；right 时 step 0 在最右 —— 于是四个方向共用同一套压紧逻辑。
 */
function cellAt(dir: Direction, line: number, step: number, size: number): { row: number; col: number } {
  switch (dir) {
    case 'left':
      return { row: line, col: step }
    case 'right':
      return { row: line, col: size - 1 - step }
    case 'up':
      return { row: step, col: line }
    case 'down':
      return { row: size - 1 - step, col: line }
  }
}

/** 棋盘上还有没有能合并的相邻对 */
export function hasMoves(tiles: Tile[], size: number = BOARD_SIZE): boolean {
  if (tiles.length < size * size) return true

  const grid = new Map<string, number>()
  for (const tile of tiles) grid.set(key(tile.row, tile.col), tile.value)

  for (const tile of tiles) {
    const right = grid.get(key(tile.row, tile.col + 1))
    if (right !== undefined && right === tile.value) return true
    const down = grid.get(key(tile.row + 1, tile.col))
    if (down !== undefined && down === tile.value) return true
  }
  return false
}

/** 随机挑一个空格生成新方块：出 4 的概率由难度给定 */
export function spawnTile(
  tiles: Tile[],
  id: number,
  fourChance: number,
  size: number = BOARD_SIZE,
  rng: () => number = Math.random,
): Tile {
  const taken = new Set<string>()
  for (const tile of tiles) taken.add(key(tile.row, tile.col))

  const empty: Array<{ row: number; col: number }> = []
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!taken.has(key(row, col))) empty.push({ row, col })
    }
  }
  if (empty.length === 0) throw new Error('棋盘已满，生成不出新方块。')

  const spot = empty[Math.floor(rng() * empty.length)]!
  const value = rng() < fourChance ? 4 : 2
  return { id, value, row: spot.row, col: spot.col }
}

/** 开局：空棋盘上放两个方块 */
export function createGame(rng: () => number = Math.random, difficulty: Difficulty = 'normal'): GameState {
  const { size, fourChance } = DIFFICULTY[difficulty]
  const first = spawnTile([], 1, fourChance, size, rng)
  const second = spawnTile([first], 2, fourChance, size, rng)
  return { tiles: [first, second], score: 0, nextId: 3, won: false, difficulty }
}

/**
 * 往一个方向滑一步。这是整个游戏的唯一规则实现。
 *
 * 规则要点（也是 2048 最容易写错的地方）：
 *   · 同一轮里一个方块只能参与一次合并 —— [2,2,2,2] 要变成 [4,4]，不是 [8]
 *   · 合并时由「离目标边缘更近的」那个当 keeper，位置语义才稳定
 *   · 局面没变化时不该生成新方块（否则原地乱按就能刷分）
 */
export function applyMove(
  state: GameState,
  dir: Direction,
  rng: () => number = Math.random,
): MoveOutcome {
  const { size, fourChance, winValue } = DIFFICULTY[state.difficulty]

  const grid = new Map<string, Tile>()
  for (const tile of state.tiles) grid.set(key(tile.row, tile.col), tile)

  const outTiles: Tile[] = []
  const merges: MergeEvent[] = []
  let gained = 0

  for (let line = 0; line < size; line += 1) {
    // 先按「滑动方向」把这条线上的方块排成一队
    const queue: Tile[] = []
    for (let step = 0; step < size; step += 1) {
      const { row, col } = cellAt(dir, line, step, size)
      const tile = grid.get(key(row, col))
      if (tile) queue.push(tile)
    }

    // 再压紧：能合的合成一个，合过的这一轮不再参与
    let slot = 0
    let index = 0
    while (index < queue.length) {
      const head = queue[index]!
      const next = queue[index + 1]
      const { row, col } = cellAt(dir, line, slot, size)

      if (next && next.value === head.value) {
        merges.push({ keeper: head.id, absorbed: next.id, value: head.value * 2 })
        outTiles.push({ id: head.id, value: head.value * 2, row, col })
        gained += head.value * 2
        index += 2
      } else {
        outTiles.push({ id: head.id, value: head.value, row, col })
        index += 1
      }
      slot += 1
    }
  }

  const before = new Map(state.tiles.map((tile) => [tile.id, tile]))
  const changed =
    merges.length > 0 ||
    outTiles.some((tile) => {
      const old = before.get(tile.id)
      return !old || old.row !== tile.row || old.col !== tile.col
    })

  const spawned = changed ? spawnTile(outTiles, state.nextId, fourChance, size, rng) : null
  const tiles = spawned ? [...outTiles, spawned] : outTiles

  const peaked = state.tiles.some((tile) => tile.value >= winValue)
  const reached = tiles.some((tile) => tile.value >= winValue)

  return {
    state: {
      tiles,
      score: state.score + gained,
      nextId: state.nextId + (spawned ? 1 : 0),
      won: state.won || reached,
      difficulty: state.difficulty,
    },
    merges,
    spawned,
    gained,
    changed,
    justWon: reached && !peaked,
    over: !hasMoves(tiles, size),
  }
}
