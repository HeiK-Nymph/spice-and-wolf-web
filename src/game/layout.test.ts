/**
 * 棋盘布局的单元测试。
 *
 * 坐标映射看着简单，但行列写反在 3D 里很难用肉眼发现（上下颠倒时看着也「像」对的），
 * 而且现在边长会随难度变（5 / 4 / 3），所以每种边长都要验一遍。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CARD_GAP,
  CARD_W,
  PITCH_X,
  PITCH_Z,
  ROW_DEPTH,
  boardDepth,
  boardWidth,
  gridDepth,
  gridWidth,
  slotX,
  slotZ,
} from './layout.ts'

const SIZES = [3, 4, 5]

test('棋盘尺寸按边长算，且留边公式一致', () => {
  for (const size of SIZES) {
    assert.equal(gridWidth(size), size * CARD_W + (size + 1) * CARD_GAP)
    assert.equal(gridDepth(size), size * ROW_DEPTH + (size + 1) * CARD_GAP)
    assert.ok(boardWidth(size) > gridWidth(size), '牌桌要比牌子区域大')
    assert.ok(boardDepth(size) > gridDepth(size))
  }
})

test('列从左到右递增，且关于 0 对称', () => {
  for (const size of SIZES) {
    for (let col = 1; col < size; col += 1) {
      assert.ok(slotX(col, size) > slotX(col - 1, size), `size=${size} 时 col 必须向右递增`)
    }
    assert.ok(Math.abs(slotX(0, size) + slotX(size - 1, size)) < 1e-9)
  }
})

test('行越靠后 z 越小：row 0 在最远端', () => {
  for (const size of SIZES) {
    for (let row = 1; row < size; row += 1) {
      assert.ok(slotZ(row, size) > slotZ(row - 1, size), `size=${size} 时 row 必须向近端递增`)
    }
    assert.ok(slotZ(0, size) < 0, 'row 0 应该在 z 负半轴（远端）')
    assert.ok(slotZ(size - 1, size) > 0, '最后一行应该在 z 正半轴（近端）')
  }
})

test('相邻格间距等于 PITCH（浮点只能比容差）', () => {
  assert.ok(Math.abs(slotX(1, 4) - slotX(0, 4) - PITCH_X) < 1e-9)
  assert.ok(Math.abs(slotZ(1, 4) - slotZ(0, 4) - PITCH_Z) < 1e-9)
})

test('格子互不重叠，且都被牌子区域包住', () => {
  for (const size of SIZES) {
    const seen = new Set<string>()
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        seen.add(`${slotX(col, size).toFixed(4)},${slotZ(row, size).toFixed(4)}`)
      }
    }
    assert.equal(seen.size, size * size, `size=${size} 时格子数不对`)
    assert.ok(slotX(0, size) - CARD_W / 2 > -gridWidth(size) / 2)
    assert.ok(slotX(size - 1, size) + CARD_W / 2 < gridWidth(size) / 2)
  }
})
