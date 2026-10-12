/**
 * 卡面目录：面值 → 卡图。
 *
 * 卡图在 public/art/cards/<id>.webp，由 scripts/gen-card.mjs 出图、
 * scripts/optimize-art.mjs 压缩（上游只返回 PNG，且 1024x1536 的原图有 2MB+）。
 *
 * 面值阶梯同时也是叙事：货物 → 商人的家伙什 → 契据 → 人。
 */
export interface CardFace {
  value: number
  /** 与 scripts/card-recipes.mjs 里的 id 一致 */
  id: string
  name: string
  /** 只影响卡框配色：人物卡描金，物品卡木质 */
  kind: 'item' | 'character'
}

export const CARD_FACES: CardFace[] = [
  { value: 2, id: 'wheat-2', name: '麦束', kind: 'item' },
  { value: 4, id: 'coins-4', name: '铜币', kind: 'item' },
  { value: 8, id: 'spice-8', name: '香料', kind: 'item' },
  { value: 16, id: 'ale-16', name: '麦酒', kind: 'item' },
  { value: 32, id: 'scales-32', name: '天平', kind: 'item' },
  { value: 64, id: 'cart-64', name: '货车', kind: 'item' },
  { value: 128, id: 'silver-128', name: '银袋', kind: 'item' },
  { value: 256, id: 'contract-256', name: '契约', kind: 'item' },
  { value: 512, id: 'lawrence-512', name: '罗伦斯', kind: 'character' },
  { value: 1024, id: 'holo-1024', name: '赫萝', kind: 'character' },
  { value: 2048, id: 'pair-2048', name: '同行', kind: 'character' },
  { value: 4096, id: 'myuri-4096', name: '缪莉', kind: 'character' },
]

const BY_VALUE = new Map(CARD_FACES.map((face) => [face.value, face]))

/**
 * 面值 → 卡面。
 * 玩到 8192 之类没有专属卡图的面值时返回 null，由卡面绘制那边画一张素卡兜底。
 */
export function faceFor(value: number): CardFace | null {
  return BY_VALUE.get(value) ?? null
}

/** 卡图在 public/ 下的相对路径（取用时过 assetUrl()） */
export function artPath(face: CardFace): string {
  return `art/cards/${face.id}.webp`
}

/** 卡面显示的名字：没有专属卡图时按面值现拼 */
export function faceName(value: number): string {
  return BY_VALUE.get(value)?.name ?? `面值 ${value}`
}
