/**
 * 合并逻辑的单元测试。
 *
 * 跑法：npm test
 * （Node 22 自带类型剥离 + node:test，所以这个项目不需要 vitest 之类的依赖）
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BOARD_SIZE, applyMove, createGame, hasMoves, spawnTile, DIFFICULTY } from './engine.ts'
import type { GameState, Tile } from './engine.ts'

/** 用二维数组搭一个局面（0 表示空格），id 按行优先递增 —— 让断言写得像棋盘 */
function fromGrid(rows: number[][]): GameState {
  const tiles: Tile[] = []
  let id = 1
  for (let row = 0; row < rows.length; row += 1) {
    for (let col = 0; col < rows[row]!.length; col += 1) {
      const value = rows[row]![col]!
      if (value !== 0) tiles.push({ id: id++, value, row, col })
    }
  }
  return { tiles, score: 0, nextId: id, won: false, difficulty: 'normal' }
}

/** 读回二维数组；ignore 用来忽略刚生成的那个方块 */
function toGrid(state: GameState, ignore?: number): number[][] {
  const grid = Array.from({ length: BOARD_SIZE }, () => Array<number>(BOARD_SIZE).fill(0))
  for (const tile of state.tiles) {
    if (tile.id === ignore) continue
    grid[tile.row]![tile.col] = tile.value
  }
  return grid
}

/** 固定序列的伪随机：让「生成哪个格子、生成 2 还是 4」可预测 */
function seq(values: number[]): () => number {
  let index = 0
  return () => values[index++ % values.length]!
}

const still = seq([0, 0])

test('开局：两个方块，数值是 2 或 4，且不重叠', () => {
  const game = createGame(seq([0, 0, 0, 0]))
  assert.equal(game.tiles.length, 2)
  assert.equal(game.score, 0)
  assert.equal(game.won, false)
  for (const tile of game.tiles) assert.ok(tile.value === 2 || tile.value === 4)
  const cells = new Set(game.tiles.map((tile) => `${tile.row},${tile.col}`))
  assert.equal(cells.size, 2)
})

test('左移：一行 [2,2,4,4] 合成 [4,8]，得分 12', () => {
  const outcome = applyMove(fromGrid([[2, 2, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left', still)
  assert.deepEqual(toGrid(outcome.state, outcome.spawned?.id)[0], [4, 8, 0, 0])
  assert.equal(outcome.gained, 12)
  assert.equal(outcome.changed, true)
})

test('同一轮不连锁：[2,2,4] 只合成 [4,4]，绝不能变 [8]', () => {
  const outcome = applyMove(fromGrid([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left', still)
  assert.deepEqual(toGrid(outcome.state, outcome.spawned?.id)[0], [4, 4, 0, 0])
  assert.equal(outcome.gained, 4)
})

test('四个相同：[2,2,2,2] 变成 [4,4]，得分 8（不是 16）', () => {
  const outcome = applyMove(fromGrid([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left', still)
  assert.deepEqual(toGrid(outcome.state, outcome.spawned?.id)[0], [4, 4, 0, 0])
  assert.equal(outcome.gained, 8)
})

test('压紧但不合并：[2,0,0,4] 左移只挪位置', () => {
  const outcome = applyMove(fromGrid([[2, 0, 0, 4], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left', still)
  assert.deepEqual(toGrid(outcome.state, outcome.spawned?.id)[0], [2, 4, 0, 0])
  assert.equal(outcome.gained, 0)
  assert.equal(outcome.changed, true)
})

test('局面没变化时：不生成新方块、不得分', () => {
  const outcome = applyMove(fromGrid([[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left', still)
  assert.equal(outcome.changed, false)
  assert.equal(outcome.spawned, null)
  assert.equal(outcome.gained, 0)
  assert.equal(outcome.state.tiles.length, 2)
})

test('右移：贴到右边缘，且由靠近右缘的方块当 keeper', () => {
  const outcome = applyMove(fromGrid([[2, 0, 0, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'right', still)
  assert.deepEqual(toGrid(outcome.state, outcome.spawned?.id)[0], [0, 0, 0, 4])
  // keeper 是原本就在 col 3 的那个（id=2），左侧那个滑过去被吞掉
  assert.equal(outcome.merges[0]!.keeper, 2)
  assert.equal(outcome.merges[0]!.absorbed, 1)
})

test('上移：按列压紧，不跨列串味', () => {
  const outcome = applyMove(
    fromGrid([
      [2, 0, 0, 0],
      [2, 0, 0, 8],
      [0, 0, 0, 8],
      [0, 0, 0, 0],
    ]),
    'up',
    still,
  )
  const grid = toGrid(outcome.state, outcome.spawned?.id)
  assert.equal(grid[0]![0], 4)
  assert.equal(grid[0]![3], 16)
  assert.equal(outcome.gained, 20)
})

test('下移：贴到底部', () => {
  const outcome = applyMove(fromGrid([[2, 0, 0, 0], [2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'down', still)
  const grid = toGrid(outcome.state, outcome.spawned?.id)
  assert.equal(grid[3]![0], 4)
})

test('死局判定：满盘且无相邻相同 → 无路可走', () => {
  const dead = fromGrid([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ])
  assert.equal(hasMoves(dead.tiles), false)
  const outcome = applyMove(dead, 'left', still)
  assert.equal(outcome.over, true)
  assert.equal(outcome.changed, false)
})

test('满盘但存在相邻相同 → 还没死', () => {
  const alive = fromGrid([
    [2, 2, 4, 8],
    [4, 8, 16, 32],
    [2, 4, 8, 16],
    [4, 8, 16, 32],
  ])
  assert.equal(hasMoves(alive.tiles), true)
  assert.equal(applyMove(alive, 'left', still).over, false)
})

test('达成 2048：justWon 只在这一下为 true', () => {
  const outcome = applyMove(
    fromGrid([
      [1024, 1024, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]),
    'left',
    still,
  )
  assert.equal(outcome.justWon, true)
  assert.equal(outcome.state.won, true)
  assert.equal(outcome.gained, 2048)

  // 已经赢过的局面再动一次，不该重复报喜
  const again = applyMove(outcome.state, 'right', seq([0, 1]))
  assert.equal(again.justWon, false)
  assert.equal(again.state.won, true)
})

test('合并后方块不重复、id 唯一', () => {
  const outcome = applyMove(
    fromGrid([
      [2, 2, 2, 2],
      [4, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]),
    'left',
    seq([0, 0]),
  )
  const ids = outcome.state.tiles.map((tile) => tile.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('合并的契约：keeper 的 id 不变、数值翻倍（渲染层靠这一条去换卡面）', () => {
  const outcome = applyMove(
    fromGrid([
      [2, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]),
    'left',
    still,
  )
  const merge = outcome.merges[0]!
  const keeper = outcome.state.tiles.find((tile) => tile.id === merge.keeper)

  assert.ok(keeper, 'keeper 必须留在场上')
  assert.equal(keeper.id, merge.keeper, 'id 不能变 —— 否则渲染层认不出是同一张牌')
  assert.equal(keeper.value, 4, '数值必须翻倍 —— 渲染层要拿它去换卡面')
  assert.equal(merge.value, 4, 'merge.value 就是合并后的新数值')
  // 被吞掉的那张必须真的消失，不能两张都留着
  assert.equal(
    outcome.state.tiles.some((tile) => tile.id === merge.absorbed),
    false,
  )
})
test('难度联动三件事：棋盘大小 / 出 4 概率 / 目标值', () => {
  assert.deepEqual(DIFFICULTY.easy, { size: 5, fourChance: 0, winValue: 4096 })
  assert.deepEqual(DIFFICULTY.normal, { size: 4, fourChance: 0.1, winValue: 2048 })
  assert.deepEqual(DIFFICULTY.hard, { size: 3, fourChance: 0.1, winValue: 512 })
})

test('出 4 的概率由难度决定', () => {
  // spawnTile 的第二次 rng 调用决定数值：小于 fourChance 才出 4
  const easy = DIFFICULTY.easy.fourChance
  const normal = DIFFICULTY.normal.fourChance
  assert.equal(spawnTile([], 1, easy, 4, seq([0, 0])).value, 2, '简单模式永不出 4')
  assert.equal(spawnTile([], 1, easy, 4, seq([0, 0.99])).value, 2)
  assert.equal(spawnTile([], 1, normal, 4, seq([0, 0.05])).value, 4)
  assert.equal(spawnTile([], 1, normal, 4, seq([0, 0.5])).value, 2)
})

test('棋盘大小跟着难度走，方块不会落到棋盘外', () => {
  const easy = createGame(seq([0, 0, 0, 0]), 'easy')
  assert.equal(easy.difficulty, 'easy')
  for (const tile of easy.tiles) {
    assert.ok(tile.row >= 0 && tile.row < 5 && tile.col >= 0 && tile.col < 5, '5×5 之内')
  }

  const hard = createGame(seq([0, 0, 0, 0]), 'hard')
  for (const tile of hard.tiles) {
    assert.ok(tile.row >= 0 && tile.row < 3 && tile.col >= 0 && tile.col < 3, '3×3 之内')
  }

  // 省略难度时是普通
  assert.equal(createGame(seq([0, 0, 0, 0])).difficulty, 'normal')
})

test('3×3 棋盘：合并与压紧都按 3 行 3 列走', () => {
  const state: GameState = {
    tiles: [
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
      { id: 3, value: 8, row: 2, col: 2 },
    ],
    score: 0,
    nextId: 4,
    won: false,
    difficulty: 'hard',
  }
  const out = applyMove(state, 'left', seq([0, 0]))
  const merged = out.state.tiles.find((tile) => tile.id === 1)
  assert.equal(merged?.value, 4)
  assert.equal(merged?.row, 0)
  assert.equal(merged?.col, 0)
  // 新方块必须落在 3×3 之内
  assert.ok(out.spawned!.row < 3 && out.spawned!.col < 3)
})

test('目标值随棋盘大小走（3×3 顶天只能合到 512，目标就不能还挂 2048）', () => {
  assert.ok(DIFFICULTY.hard.winValue < DIFFICULTY.normal.winValue)
  assert.ok(DIFFICULTY.easy.winValue > DIFFICULTY.normal.winValue)
})