/**
 * 棋盘 → 3D 世界坐标的换算。纯算术，不碰 three.js，所以可以单独测。
 *
 * 坐标约定：
 *   · 台面平铺在 XZ 平面上，Y 朝上；
 *   · 相机在 +Z 一侧看向原点，所以 z 越小越远 —— row 0 在远端（屏幕上方）；
 *   · col 从左到右递增。
 *
 * 【尺寸是变量】：难度会改棋盘边长（简单 5×5 / 普通 4×4 / 困难 3×3），
 * 所以凡是跟边长有关的量都写成「按 size 算的函数」，而不是常量 ——
 * 否则换难度时牌桌还按旧尺寸铺，格子会当场错位。
 *
 * 【三层台面】照例图从下往上 ——
 *   桌子 DESK_*    垫在最底下的大台面，颜色与背景几乎一样，远端渐隐；
 *   牌桌 BOARD_*   黄米色、有厚度的那一块，白底座直接坐在它上面；
 *   底座           每张牌自带的白色小块，跟着牌走。
 *
 * 卡牌是【竖着立起来】的，所以每一排在牌桌上占的进深（ROW_DEPTH）远小于卡高 ——
 * 若照卡高来排，牌桌会深得离谱，相机也压不下整个场面。
 */
import { BOARD_SIZE } from './engine.ts'

/** 卡牌尺寸（世界单位）。2:3 是卡图与生俱来的比例，不裁切 */
export const CARD_W = 1
export const CARD_H = 1.5

/** 卡牌厚度 —— 要「有厚度的 3D 卡牌」，不是一张贴纸 */
export const CARD_DEPTH = 0.08

/**
 * 相邻两格之间的缝（横竖共用）。
 * 调大 : 格子之间更透气，代价是棋盘整体变大、牌桌上每张牌在屏幕上是缩小的；
 * 附带好处是行距变大，后排卡牌被前排挡掉的部分会变少。
 */
export const CARD_GAP = 0.36

/** 每一排在牌桌上占的进深。牌是立着的，所以进深不等于卡高 */
export const ROW_DEPTH = 1

/** 格子中心距：横向按卡宽 + 缝，纵向按排进深 + 缝。与边长无关 */
export const PITCH_X = CARD_W + CARD_GAP
export const PITCH_Z = ROW_DEPTH + CARD_GAP

/**
 * 牌桌留边：白底座之外那一圈黄米色台面。
 * 收得比较紧 —— 留边一大，棋盘就整体变大，牌在屏幕上反而更小。
 * 「格子之间透气」应该靠格距和底座尺寸去调，不该靠放大棋盘。
 */
export const BOARD_PAD = 0.56
export const BOARD_HEIGHT = 0.5

/** 桌子宽度方向只比牌桌多出这一条；近端则给足进深，好让那条边落在画面外 */
export const DESK_PAD_X = 0.75
export const DESK_DEPTH = 30

/** 白底座排布的范围（不含牌桌的留边） */
export function gridWidth(size: number): number {
  return size * CARD_W + (size + 1) * CARD_GAP
}

export function gridDepth(size: number): number {
  return size * ROW_DEPTH + (size + 1) * CARD_GAP
}

/**
 * 牌桌：黄米色、有厚度的那一块。
 * 例图里它的远端「模糊到跟背景融在一起」，左右两侧却看得见边线 ——
 * 见 CardTable 里那张只沿 v 方向渐隐的桌面贴图。
 */
export function boardWidth(size: number): number {
  return gridWidth(size) + BOARD_PAD * 2
}

export function boardDepth(size: number): number {
  return gridDepth(size) + BOARD_PAD * 2
}

/** 桌子：垫在牌桌底下那片会化开的台面（宽度只比牌桌宽一点点） */
export function deskWidth(size: number): number {
  return boardWidth(size) + DESK_PAD_X * 2
}

/** 某一列的世界 x（0 在最左） */
export function slotX(col: number, size: number): number {
  return (col - (size - 1) / 2) * PITCH_X
}

/** 某一行世界 z（0 在最远，size-1 在最近） */
export function slotZ(row: number, size: number): number {
  return (row - (size - 1) / 2) * PITCH_Z
}

/** 默认边长（普通难度） */
export const DEFAULT_SIZE = BOARD_SIZE
