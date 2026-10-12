/**
 * 把「卡图 + 卡框 + 数字」合成成一张卡面纹理。
 *
 * 为什么要合成而不是出图时就带上数字：
 *   · 图像模型画的数字/字母必然糊且会崩，AGENTS.md 也明令插画里不许有文字；
 *   · 数字必须一眼能读，字号、配色、位置都得统一 —— 这些是程序该做的事。
 * 所以卡图是纯插画，数字由这里用 canvas 叠加。
 */
import { assetUrl } from '@/utils/asset'

import { artPath, faceFor } from './catalog'

/** 纹理尺寸。2:3，与卡图一致 */
export const FACE_W = 512
export const FACE_H = 768

/** 卡框在两端的配色：人物卡描金，物品卡用木头 */
const FRAME = {
  character: { outer: '#2a1c0d', inner: '#c9a24a', plate: 'rgba(18,12,6,0.78)', text: '#f0cf86' },
  item: { outer: '#2a1c0d', inner: '#8a6a3c', plate: 'rgba(18,12,6,0.78)', text: '#e7d7b8' },
  /** 超过 4096 的面值没有专属卡图，用这张「素卡」兜底 */
  blank: { outer: '#2a1c0d', inner: '#6f5636', plate: 'rgba(18,12,6,0.72)', text: '#e7d7b8' },
} as const

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

/** 把图按 cover 规则铺满目标矩形（不拉伸变形） */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight)
  const dw = image.naturalWidth * scale
  const dh = image.naturalHeight * scale
  ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

/**
 * 画一张卡面。
 * image 为 null 时（卡图还没加载好，或面值超过 4096）画一张只有数字的素卡。
 */
export function drawCardFace(
  ctx: CanvasRenderingContext2D,
  value: number,
  image: HTMLImageElement | null,
): void {
  const face = faceFor(value)
  const palette = FRAME[face?.kind ?? 'blank']

  ctx.clearRect(0, 0, FACE_W, FACE_H)
  ctx.fillStyle = palette.outer
  ctx.fillRect(0, 0, FACE_W, FACE_H)

  // 卡图：四周留一圈卡框
  const frame = 22
  const innerX = frame
  const innerY = frame
  const innerW = FACE_W - frame * 2
  const innerH = FACE_H - frame * 2

  ctx.save()
  roundRect(ctx, innerX, innerY, innerW, innerH, 14)
  ctx.clip()
  if (image) {
    drawCover(ctx, image, innerX, innerY, innerW, innerH)
  } else {
    const fallback = ctx.createLinearGradient(innerX, innerY, innerX, innerY + innerH)
    fallback.addColorStop(0, '#3a2c1a')
    fallback.addColorStop(1, '#1d1409')
    ctx.fillStyle = fallback
    ctx.fillRect(innerX, innerY, innerW, innerH)
  }


  ctx.restore()

  // 卡框：外深内亮两道
  ctx.lineWidth = 6
  ctx.strokeStyle = palette.outer
  roundRect(ctx, frame / 2, frame / 2, FACE_W - frame, FACE_H - frame, 18)
  ctx.stroke()
  ctx.lineWidth = 3
  ctx.strokeStyle = palette.inner
  roundRect(ctx, frame, frame, innerW, innerH, 14)
  ctx.stroke()

  // 【卡面上不写数字】：数值改由 CardTable 的 HTML 浮层钉在白底座前缘 ——
  // 卡是竖着立的、每排只隔 0.92，前排必然挡住后排卡面的下半截，
  // 数字画在卡上就一定看不全。所以这里只留纯插画 + 卡框。
}

/** 卡图的加载地址（供调用方 new Image() 用） */
export function faceArtUrl(value: number): string | null {
  const face = faceFor(value)
  return face ? assetUrl(artPath(face)) : null
}
