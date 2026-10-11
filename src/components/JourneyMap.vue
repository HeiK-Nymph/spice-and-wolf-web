<script setup lang="ts">
/**
 * 旅途地图 —— 全站骨架，铺满视口，像一张真正的地图。
 * ---------------------------------------------------------------------------
 * 操作：
 *   · 按住拖拽 → 平移（指针离开不会中断；拖动超过阈值就不触发站点点击）
 *   · 滚轮 → 以指针为中心缩放；触屏双指可捏合
 *   · ＋ / − / 全览 → 缩放与回到整条路线
 * 反馈：
 *   · 悬停 / 键盘聚焦驿站 → 整站发光、光环扩散、信息卡切换
 *   · 已开通的站点金环实心，点得进去；未铺内容的虚线暗环，点了抖动提示
 *   · 指针移动 → 雾层视差
 * 全部自主动画遵守 prefers-reduced-motion。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import ItemViewer from '@/components/ItemViewer.vue'
import { useLedgerOpening, warmLedgerTransition } from '@/composables/useLedgerOpening'
import { stations, type Station } from '@/data/journey'
import { buildSmoothPath, type Point } from '@/utils/journeyPath'
import { assetUrl } from '@/utils/asset'
import { PHONE_QUERY } from '@/utils/viewport'

const router = useRouter()
const { openLedger } = useLedgerOpening()

const VIEW_W = 1000
const VIEW_H = 1500
const MAX_SCALE = 3.5
const DRAG_THRESHOLD = 6

const points: Point[] = stations.map((s) => [s.x, s.y] as const)
const routeD = buildSmoothPath(points)

/** 路线包围盒中心 —— 初始镜头与「全览」都看它 */
const routeBox = (() => {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
})()

const root = ref<HTMLElement | null>(null)

const ready = ref(false)
const viewport = ref({ w: 0, h: 0 })
/** 地图图幅尺寸（世界坐标） */
const mapW = ref(0)
const mapH = ref(0)
/** 地图四周的桌面余量 */
const margin = ref(0)
/** 整张桌子的尺寸 = 地图 + 四周余量 */
const worldW = ref(0)
const worldH = ref(0)
const scale = ref(1)
const tx = ref(0)
const ty = ref(0)
const minScale = ref(0.3)
const smooth = ref(false)
const dragging = ref(false)
const hoverIndex = ref<number | null>(null)
const dirOpen = ref(false)
const interacted = ref(false)
const shakeId = ref<string | null>(null)
const toast = ref('')
const hoveredObjectId = ref<string | null>(null)
/** 竖屏手机：取景与物件摆放换一套（见 computeWorld / deskObjects[].phone） */
const isPhone = ref(false)
/** 手机端信息卡的「细节」是否展开：默认收起，站牌才不会吃掉半屏地图 */
const cardMore = ref(false)
/** 信息卡实测高度 → 决定缩放控件贴在哪，避免两者叠在一起 */
const cardH = ref(0)
const cardEl = ref<HTMLElement | null>(null)

let moved = 0
let suppressClick = false
let lastX = 0
let lastY = 0
let smoothTimer: number | undefined
let toastTimer: number | undefined
let shakeTimer: number | undefined
let rafId = 0
let parallaxOn = true
let phoneMql: MediaQueryList | undefined
let cardRo: ResizeObserver | undefined

const pointers = new Map<number, { x: number; y: number }>()
let pinchStartDist = 0
let pinchStartScale = 1

/** 视口中心最近的驿站 —— 没悬停时信息卡就跟着视野走 */
const centerIndex = computed(() => {
  const cx = viewport.value.w / 2
  const cy = viewport.value.h / 2
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  stations.forEach((s, i) => {
    const dx = tx.value + (margin.value + s.x * unit.value) * scale.value - cx
    const dy = ty.value + (margin.value + s.y * unit.value) * scale.value - cy
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  return best
})

/** 显示中的驿站：悬停优先，否则是视野中心那一个 */
const shownIndex = computed(() => hoverIndex.value ?? centerIndex.value)
const active = computed<Station>(() => stations[shownIndex.value] ?? stations[0])

/* ------------------------------------------------------------------ */
/* 桌面小物件                                                          */
/*   钉在桌上：不随地图平移 / 缩放，地图放大铺满后会被图幅自然盖住。      */
/*   全部物件保留「可点击 + 高光」提示；已规划行为按物件单独接通。          */
/* ------------------------------------------------------------------ */
interface DeskObject {
  id: string
  label: string
  src: string
  /** 有目标路由时，点击物件会进入对应板块 */
  to?: string
  /** 有 to 时，给屏幕阅读器播报的进入说明 */
  toLabel?: string
  /** 相对地图左上角的偏移，按地图宽 / 高的比例记（负数 = 落在地图之外） */
  x: number
  y: number
  /** 宽度 = 地图宽度 × 该比例 —— 用同一个参照，物件之间的大小关系才合理 */
  scale: number
  /** 摆放角度，避免整齐排布 */
  rotate: number
  /**
   * 竖屏手机上的摆放与大小。
   * 桌面是「地图铺在桌上、物件散在四周」，手机上台面余量进不了视口：
   * 按桌面坐标实测，7 件全部落在屏外（x = 415 ~ 824，而视口只有 390 宽），
   * 首屏一件都点不到。这里按实测反推重排 —— 依旧是「搁在地图边上」，
   * 只是换成竖屏里真正看得见的那片台面 / 图幅。
   */
  phone?: { x: number; y: number; scale: number; rotate: number }
  /** 鼠标停留时的简要预览 */
  preview: {
    title: string
    body: string
  }
  /** 角色画片：用「搁在桌上的画页」处理，不走静物的抠像阴影 */
  photo?: boolean
  /** 可检视：点击后弹出 3D 道具检视；这里给画框侧边配色 */
  examine?: { edge: string; metalness: number; texture?: string }
}

/**
 * 桌面物件。
 * 尺寸全部相对「地图宽度」定：一张铺开的商路地图约 70cm 宽，据此推算——
 *   账本 ≈ 24cm（0.34）、香料袋 ≈ 14cm（0.20）、银币一小摊 ≈ 11cm（0.15）、麦穗一把 ≈ 30cm（0.43）
 * 位置刻意错开、带角度，像随手搁在图上边。
 */
const deskObjects: DeskObject[] = [
  {
    id: 'ledger',
    label: '账本',
    src: assetUrl('art/obj-ledger.webp'),
    to: '/ledger',
    toLabel: '前往旅途账本',
    x: 1.1,
    y: 0.24,
    scale: 0.34,
    rotate: -9,
    phone: { x: 0.3284, y: 0.42, scale: 0.168, rotate: -8 },
    preview: {
      title: '旅途账本',
      body: '记着一路上的收支、汇率与商谈；翻开它，能看见各处契约与额度的明细。',
    },
  },
  {
    id: 'spice',
    label: '香料',
    src: assetUrl('art/obj-spice.webp'),
    x: 1.48,
    y: 0.4,
    scale: 0.2,
    rotate: 13,
    phone: { x: 0.3151, y: 0.49, scale: 0.122, rotate: 12 },
    preview: {
      title: '香料袋',
      body: '商路上常见的货色，价格随产地、季节和路途远近起落。',
    },
  },
  {
    id: 'coins',
    label: '银币',
    src: assetUrl('art/obj-coins.webp'),
    x: 1.22,
    y: 0.58,
    scale: 0.15,
    rotate: -5,
    phone: { x: 0.3018, y: 0.5918, scale: 0.1, rotate: -6 },
    to: '/market',
    toLabel: '前往商行牌价板',
    preview: {
      title: '商行 · 牌价板',
      body: '一枚银币，能换多少「词」？这里收着各家大模型 API 与套餐契约的牌价。',
    },
  },
  {
    id: 'wheat',
    label: '麦穗',
    src: assetUrl('art/obj-wheat.webp'),
    x: 1.38,
    y: 0.78,
    scale: 0.38,
    rotate: 62,
    phone: { x: 0.3284, y: 0.666, scale: 0.148, rotate: 58 },
    preview: {
      title: '一束麦穗',
      body: '从沿途田野收来的麦穗，也是赫萝再熟悉不过的丰收气息。',
    },
  },
  {
    id: 'art-travel',
    label: '旅途中的画片',
    src: assetUrl('art/art-travel.webp'),
    x: 1.56,
    y: 0.25,
    scale: 0.34,
    rotate: -3,
    phone: { x: 0.6601, y: 0.6715, scale: 0.158, rotate: -3 },
    preview: {
      title: '旅途中的画片',
      body: '罗伦斯与赫萝在北行路上的画片，装着某段不必写进账本的记忆。',
    },
    photo: true,
    // 深色木框 + 木纹侧面
    examine: { edge: '#3b2418', metalness: 0.08, texture: assetUrl('art/frame-side-wood.webp') },
  },
  {
    id: 'art-family',
    label: '温泉旅馆一家的画片',
    src: assetUrl('art/art-family.webp'),
    x: 1.72,
    y: 0.6,
    scale: 0.28,
    rotate: 2,
    phone: { x: 0.7463, y: 0.2467, scale: 0.132, rotate: 3 },
    preview: {
      title: '温泉旅馆一家的画片',
      body: '纽希拉温泉旅馆里，罗伦斯、赫萝与女儿一家的合影。',
    },
    photo: true,
    // 金框 + 鎏金侧面
    examine: { edge: '#b08a3a', metalness: 0.55, texture: assetUrl('art/frame-side-gold.webp') },
  },
  {
    // 桌面上唯一一件摆在地图左侧的物件 —— 与右侧的账本左右呼应
    id: 'sketchbook',
    label: '旅途速写册',
    src: assetUrl('art/obj-sketchbook.webp'),
    to: '/studio',
    toLabel: '前往画坊',
    // y 刻意压低：开场说明层在左上角，抬高会被它盖住导致首屏点不动
    // 左侧桌面被「开场说明」(底 387) 与「站牌」(顶 524) 夹出一条约 137px 的空档，
    // 尺寸和角度都按这条空档定，避免被固定 UI 盖住
    x: -0.2,
    y: 0.55,
    scale: 0.28,
    rotate: 3,
    phone: { x: 0.5008, y: 0.6847, scale: 0.16, rotate: 5 },
    // 角色速写没有透明底（上游 edits 端点不出 alpha），按「平摊在桌上的画页」处理
    photo: true,
    preview: {
      title: '画坊 · 绘图工作台',
      body: '一路上的见闻，随手都画在这册子上。挑好角色、写下场景，就能把它们变成新的画面。',
    },
  },
]

/** 当前鼠标 / 键盘停留的桌面物件 */
const previewObject = computed<DeskObject | null>(
  () => deskObjects.find((o) => o.id === hoveredObjectId.value) ?? null,
)

function showObjectPreview(id: string): void {
  hoveredObjectId.value = id
  // 悬到账本上就预热过场要用的 three，免得点下去先黑一下
  if (deskObjects.find((o) => o.id === id)?.to === '/ledger') warmLedgerTransition()
}

function hideObjectPreview(id: string): void {
  // 手机上「已选中的物件」要按住预览不放：触摸之后浏览器还会补发
  // mouseleave / blur，那是鼠标语义，会把我们要保留的中转态一并收掉。
  if (isPhone.value && armedObject.value === id) return
  if (hoveredObjectId.value === id) hoveredObjectId.value = null
}

/** 物件在世界坐标里的位置（含旋转与居中） */
function objectStyle(o: DeskObject): Record<string, string> {
  // 手机上换用 phone 摆位；桌面端 o.phone 完全不参与计算
  const phone = isPhone.value ? o.phone : undefined
  const x = phone?.x ?? o.x
  const y = phone?.y ?? o.y
  const size = phone?.scale ?? o.scale
  const rot = phone?.rotate ?? o.rotate
  return {
    left: `${margin.value + x * mapW.value}px`,
    top: `${margin.value + y * mapH.value}px`,
    width: `${mapW.value * size}px`,
    '--rot': `${rot}deg`,
  }
}

/** 预览跟随桌面物件；放在视口坐标系里，避免被地图缩放后字体变形 */
const previewStyle = computed(() => {
  const o = previewObject.value
  if (!o || !mapW.value || !mapH.value) return { display: 'none' }

  const centerX = tx.value + (margin.value + o.x * mapW.value) * scale.value
  const centerY = ty.value + (margin.value + o.y * mapH.value) * scale.value
  const objectW = mapW.value * o.scale * scale.value
  const availableW = Math.max(160, viewport.value.w - 32)
  const previewW = Math.min(304, availableW)
  const previewH = 156
  const gap = Math.max(16, Math.min(42, objectW * 0.32))
  const halfW = previewW / 2
  const leftMin = halfW + 12
  const leftMax = Math.max(leftMin, viewport.value.w - halfW - 12)
  const left = Math.min(Math.max(centerX, leftMin), leftMax)
  const above = centerY - objectW * 0.46 - gap - previewH
  const below = centerY + objectW * 0.46 + gap
  const top = above > 12 ? above : Math.min(below, Math.max(12, viewport.value.h - previewH - 12))

  return { left: `${left}px`, top: `${top}px` }
})

/** 待检视的桌面物件：非空时弹出 3D 道具检视 */
const examineTarget = ref<DeskObject | null>(null)

/**
 * 手机端「选中」：第一次点＝桌面端的悬停态（高亮 + 站牌 / 物件预览），
 * 第二次点同一处才真的进去 —— 触屏没有 hover，一次点进去太容易误触。
 * 桌面端这两个值恒为 null，老交互一行不变。
 */
const armedStation = ref<string | null>(null)
const armedObject = ref<string | null>(null)

/** 桌面物件的点击入口：银币 → 牌价板、账本 → 账本页、画片 → 3D 检视 */
function openObject(o: DeskObject): void {
  if (suppressClick) return
  if (o.examine) {
    examineTarget.value = o
    return
  }
  // 去账本页不走生硬跳转，先演一段「翻开账本」
  if (o.to === '/ledger') {
    openLedger()
    return
  }
  if (!o.to) return
  router.push(o.to)
}

/** 驿站点击：桌面一次点进去；手机第一次点先「悬停」，第二次点才进 */
function onStationTap(s: Station, index: number): void {
  if (suppressClick) return
  if (!isPhone.value) {
    activate(s)
    return
  }
  if (armedStation.value === s.id) {
    armedStation.value = null
    activate(s)
    return
  }
  armedStation.value = s.id
  armedObject.value = null
  hoveredObjectId.value = null
  hoverIndex.value = index
}

/** 桌面物件点击：手机上同样要点两次（第一次＝悬停预览，第二次 = 打开） */
function onObjectTap(o: DeskObject): void {
  if (suppressClick) return
  if (!isPhone.value) {
    openObject(o)
    return
  }
  if (armedObject.value === o.id) {
    armedObject.value = null
    openObject(o)
    return
  }
  armedObject.value = o.id
  armedStation.value = null
  showObjectPreview(o.id)
}

/** 手机上没有 hover：站牌只跟随视野中心，高亮交给「点击选中」 */
function onNodeEnter(index: number): void {
  if (isPhone.value) return
  hoverIndex.value = index
}

/** 驿站目录里选一站：手机上顺带设成「已选中」，与在地图上点一下等价 */
function onDirPick(index: number): void {
  if (isPhone.value) {
    armedStation.value = stations[index]?.id ?? null
    armedObject.value = null
    hoveredObjectId.value = null
  }
  flyTo(index)
}

/** 点在空白地图上：取消选中，回到「站牌跟视野中心走」（等同鼠标移开） */
function onSurfaceClick(e: MouseEvent): void {
  if (!isPhone.value || suppressClick) return
  const el = e.target instanceof Element ? e.target : null
  if (
    el?.closest('.jmap__node, .jmap__obj, .jmap__card, .jmap__dir, .jmap__zoom, .jmap__obj-preview')
  )
    return
  armedStation.value = null
  armedObject.value = null
  hoverIndex.value = null
  hoveredObjectId.value = null
}

/** 木纹平铺尺寸：铺大一点，减少肉眼可见的重复 */
const deskTile = computed(() => {
  const t = Math.round(mapW.value * 1.5)
  return `${t}px ${t}px`
})

/** 每 1 个 viewBox 单位对应的世界像素（x / y 同比，因为两边都是 2:3） */
const unit = computed(() => (mapW.value || 1) / VIEW_W)

/* ------------------------------------------------------------------ */
/* 视图                                                                */
/* ------------------------------------------------------------------ */
function computeWorld(): void {
  const vw = window.innerWidth
  const vh = window.innerHeight
  viewport.value = { w: vw, h: vh }

  if (isPhone.value) {
    // 竖屏手机：图幅按「视口宽的 1.6 倍」生成。
    // 桌面端拿 max(vw, vh) 当图宽，在 iPhone 上等于拿屏高（844）当地图宽，
    // 再配 1.05 倍图宽的桌面余量 —— 整张桌子 2516×2922，缩到最小也只有约
    // 226px 宽，物件全被挤到屏外。手机上余量收到 0.45，并把「缩到最小」
    // 定义成「地图幅面正好铺满视口宽度」，全览才有意义。
    const mw = Math.round(vw * 1.6)
    mapW.value = mw
    mapH.value = mw * (VIEW_H / VIEW_W)
    margin.value = Math.round(mw * 0.45)
    worldW.value = mapW.value + margin.value * 2
    worldH.value = mapH.value + margin.value * 2
    minScale.value = Math.max(vw / worldW.value, vw / mapW.value)
    clampView()
    return
  }

  // 地图图幅
  const mw = Math.max(vw, vh)
  mapW.value = mw
  mapH.value = mw * (VIEW_H / VIEW_W)

  // 桌面：地图四周留出足够摆物件的余量
  margin.value = mw * 1.05
  worldW.value = mapW.value + margin.value * 2
  worldH.value = mapH.value + margin.value * 2

  // 缩到最小 = 整张桌子刚好铺满视口，永远不会露出桌外的虚空
  minScale.value = Math.max(vw / worldW.value, vh / worldH.value)
  clampView()
}

function clampView(): void {
  const vw = viewport.value.w
  const vh = viewport.value.h
  const sw = worldW.value * scale.value
  const sh = worldH.value * scale.value
  tx.value = sw <= vw ? (vw - sw) / 2 : Math.min(0, Math.max(vw - sw, tx.value))
  ty.value = sh <= vh ? (vh - sh) / 2 : Math.min(0, Math.max(vh - sh, ty.value))
}

/** 让 (vx, vy) 这个 viewBox 坐标点落在屏幕 (sx, sy) 上 */
function placeAt(vx: number, vy: number, sx: number, sy: number, s = scale.value): void {
  scale.value = s
  // 地图原点在世界坐标里位于 (margin, margin)，别忘了加上
  tx.value = sx - (margin.value + vx * unit.value) * s
  ty.value = sy - (margin.value + vy * unit.value) * s
  clampView()
}

function zoomAt(cx: number, cy: number, factor: number): void {
  const next = Math.min(MAX_SCALE, Math.max(minScale.value, scale.value * factor))
  const k = next / scale.value
  scale.value = next
  tx.value = cx - k * (cx - tx.value)
  ty.value = cy - k * (cy - ty.value)
  clampView()
}

function zoomBy(factor: number): void {
  markInteracted()
  withSmooth(() => zoomAt(viewport.value.w / 2, viewport.value.h / 2, factor))
}

/** 全览：让整条商路落进视口（含留白，保证首尾驿站都不贴边） */
function fitRoute(): void {
  const pad = 130
  const bw = routeBox.maxX - routeBox.minX + pad * 2
  const bh = routeBox.maxY - routeBox.minY + pad * 2
  const s = Math.min(
    MAX_SCALE,
    Math.max(
      minScale.value,
      Math.min(viewport.value.w / (bw * unit.value), viewport.value.h / (bh * unit.value)),
    ),
  )
  withSmooth(() => placeAt(routeBox.cx, routeBox.cy, viewport.value.w / 2, viewport.value.h / 2, s))
}

/** 把某站带到视口中央 */
function flyTo(i: number): void {
  const s = stations[i]
  const target = Math.max(scale.value, 1.5)
  withSmooth(() => {
    placeAt(s.x, s.y, viewport.value.w / 2, viewport.value.h / 2, target)
    hoverIndex.value = i
  })
}

function withSmooth(fn: () => void): void {
  smooth.value = true
  fn()
  if (smoothTimer !== undefined) window.clearTimeout(smoothTimer)
  smoothTimer = window.setTimeout(() => {
    smooth.value = false
  }, 520)
}

function markInteracted(): void {
  interacted.value = true
}

/** 点「全览」才算一次交互（开场自动取景不该把说明藏掉） */
function onFit(): void {
  markInteracted()
  fitRoute()
}

/* ------------------------------------------------------------------ */
/* 指针：拖拽 / 捏合                                                   */
/* ------------------------------------------------------------------ */
function onPointerDown(e: PointerEvent): void {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  // 手机上「选中的物件」要保持预览卡，否则第二次点进的中转态看不见
  if (!(isPhone.value && armedObject.value)) hoveredObjectId.value = null
  markInteracted()
  // 浮层里的按下/拖动不归地图管（否则在目录里拖会平移地图）
  if (e.target instanceof Element && e.target.closest('.jmap__dir')) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (pointers.size === 1) {
    dragging.value = true
    moved = 0
    lastX = e.clientX
    lastY = e.clientY
    smooth.value = false
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()]
    pinchStartDist = Math.hypot(a.x - b.x, a.y - b.y)
    pinchStartScale = scale.value
  }

  window.addEventListener('pointermove', onPointerMoveWin)
  window.addEventListener('pointerup', onPointerUpWin)
  window.addEventListener('pointercancel', onPointerUpWin)
}

function onPointerMoveWin(e: PointerEvent): void {
  const prev = pointers.get(e.pointerId)
  if (!prev) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinchStartDist > 0) {
      const target = pinchStartScale * (dist / pinchStartDist)
      const factor = target / scale.value
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, factor)
    }
    moved = DRAG_THRESHOLD + 1
    return
  }

  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  moved += Math.abs(dx) + Math.abs(dy)
  tx.value += dx
  ty.value += dy
  clampView()
  parallaxOn = false
}

function onPointerUpWin(e: PointerEvent): void {
  pointers.delete(e.pointerId)
  if (pointers.size === 0) {
    dragging.value = false
    parallaxOn = true
    suppressClick = moved > DRAG_THRESHOLD
    if (suppressClick) window.setTimeout(() => (suppressClick = false), 0)
    window.removeEventListener('pointermove', onPointerMoveWin)
    window.removeEventListener('pointerup', onPointerUpWin)
    window.removeEventListener('pointercancel', onPointerUpWin)
  } else if (pointers.size === 1) {
    const [only] = [...pointers.values()]
    lastX = only.x
    lastY = only.y
    pinchStartDist = 0
  }
}

function onWheel(e: WheelEvent): void {
  markInteracted()
  /*
   * 「驿站目录」这类浮层要自己滚动，不能拿去缩放地图。
   * 注意这里不能靠模板上的 .prevent：那会无条件阻止默认行为，
   * 目录列表就再也滚不动了。所以改成只在地图上缩放时才 preventDefault。
   */
  if (e.target instanceof Element && e.target.closest('.jmap__dir')) return
  e.preventDefault()
  smooth.value = false
  const factor = Math.exp(-e.deltaY * 0.0015)
  zoomAt(e.clientX, e.clientY, factor)
}

/* 视差：只在没拖拽时跟随指针 */
function onParallax(e: PointerEvent): void {
  if (!parallaxOn || dragging.value) return
  const el = root.value
  if (!el) return
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return
  const nx = (e.clientX - r.left) / r.width - 0.5
  const ny = (e.clientY - r.top) / r.height - 0.5
  if (rafId) return
  rafId = window.requestAnimationFrame(() => {
    rafId = 0
    el.style.setProperty('--px', nx.toFixed(4))
    el.style.setProperty('--py', ny.toFixed(4))
  })
}

/* ------------------------------------------------------------------ */
/* 站点                                                                */
/* ------------------------------------------------------------------ */
function activate(s: Station): void {
  if (suppressClick) return
  if (s.to) {
    router.push(s.to)
    return
  }
  shakeId.value = s.id
  toast.value = `${s.city} · 尚未抵达`
  if (shakeTimer !== undefined) window.clearTimeout(shakeTimer)
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  shakeTimer = window.setTimeout(() => {
    shakeId.value = null
  }, 520)
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 1800)
}

function onResize(): void {
  const prevMin = minScale.value
  computeWorld()
  if (scale.value <= prevMin) fitRoute()
}

/** 跨过手机断点（旋屏 / 拖窗口 / 调试器切设备）时重新取景 */
function onPhoneChange(): void {
  isPhone.value = phoneMql?.matches ?? false
  cardMore.value = false
  armedStation.value = null
  armedObject.value = null
  computeWorld()
  fitRoute()
}

onMounted(async () => {
  await nextTick()
  phoneMql = window.matchMedia(PHONE_QUERY)
  isPhone.value = phoneMql.matches
  phoneMql.addEventListener('change', onPhoneChange)
  if (cardEl.value) {
    cardRo = new ResizeObserver(() => {
      if (cardEl.value) cardH.value = Math.round(cardEl.value.getBoundingClientRect().height)
    })
    cardRo.observe(cardEl.value)
  }
  computeWorld()
  // 开场：整条商路先给个全览，再稍微推近一点
  fitRoute()
  smooth.value = false
  requestAnimationFrame(() => {
    smooth.value = true
    const s = Math.max(minScale.value, Math.min(1.15, scale.value * 1.0))
    placeAt(routeBox.cx, routeBox.cy, viewport.value.w / 2, viewport.value.h * 0.52, s)
    window.setTimeout(() => {
      smooth.value = false
      ready.value = true
    }, 560)
  })
  window.addEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  phoneMql?.removeEventListener('change', onPhoneChange)
  cardRo?.disconnect()
  window.removeEventListener('resize', onResize)
  window.removeEventListener('pointermove', onPointerMoveWin)
  window.removeEventListener('pointerup', onPointerUpWin)
  window.removeEventListener('pointercancel', onPointerUpWin)
  if (rafId) window.cancelAnimationFrame(rafId)
  if (smoothTimer !== undefined) window.clearTimeout(smoothTimer)
  if (toastTimer !== undefined) window.clearTimeout(toastTimer)
  if (shakeTimer !== undefined) window.clearTimeout(shakeTimer)
})
</script>

<template>
  <div
    ref="root"
    class="jmap"
    :class="{ 'is-ready': ready, 'is-dragging': dragging }"
    :style="{ '--card-h': `${cardH}px` }"
    @pointerdown="onPointerDown"
    @pointermove="onParallax"
    @wheel="onWheel"
    @click="onSurfaceClick"
  >
    <!-- 世界层：桌子 + 地图 + 桌面物件同属一个坐标系 —— 拖拽 / 缩放时一起动 -->
    <div
      class="jmap__world"
      :class="{ 'is-smooth': smooth }"
      :style="{
        width: `${worldW}px`,
        height: `${worldH}px`,
        backgroundSize: deskTile,
        transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
      }"
    >
      <!-- 地图图幅：铺在桌上 -->
      <div
        class="jmap__map"
        :style="{
          left: `${margin}px`,
          top: `${margin}px`,
          width: `${mapW}px`,
          height: `${mapH}px`,
        }"
      >
        <img
          class="jmap__base"
          src="/art/map-world.webp"
          alt=""
          draggable="false"
          aria-hidden="true"
        />
        <div class="jmap__mist" aria-hidden="true"></div>
        <div class="jmap__grain" aria-hidden="true"></div>

        <svg
          class="jmap__svg"
          :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
          preserveAspectRatio="xMidYMid meet"
          role="group"
          aria-label="旅途地图：自南向北的驿站，可点击已开通的站点"
        >
          <path class="jmap__route-base" :d="routeD" />
          <path class="jmap__route-line" :d="routeD" />
          <path class="jmap__route-flow" :d="routeD" />

          <g
            v-for="(s, i) in stations"
            :key="s.id"
            class="jmap__node"
            :class="[
              s.to ? 'is-board' : 'is-ahead',
              i === shownIndex ? 'is-active' : '',
              armedStation === s.id ? 'is-armed' : '',
              shakeId === s.id ? 'is-shake' : '',
              s.id === 'yoitsu' ? 'is-goal' : '',
            ]"
            :transform="`translate(${s.x} ${s.y})`"
            role="button"
            tabindex="0"
            :aria-label="
              s.to
                ? `第 ${i + 1} 站 ${s.city}，进入${s.board}`
                : `第 ${i + 1} 站 ${s.city}，尚未抵达`
            "
            @pointerenter="onNodeEnter(i)"
            @focus="onNodeEnter(i)"
            @click="onStationTap(s, i)"
            @keydown.enter.prevent="activate(s)"
            @keydown.space.prevent="activate(s)"
          >
            <!-- 内层专门承载「抖动」等 CSS 变换：
               节点的 translate 是 SVG transform 属性，若直接对它做 CSS transform 会把它顶掉 -->
            <g class="jmap__node-inner">
              <circle class="jmap__halo" r="44" />
              <circle class="jmap__ring" r="11" />
              <circle class="jmap__core" r="4.5" />
              <text
                class="jmap__label"
                :x="s.x > 760 ? -20 : 20"
                :y="6"
                :text-anchor="s.x > 760 ? 'end' : 'start'"
              >
                {{ s.city }}
              </text>
            </g>
          </g>
        </svg>
      </div>

      <!-- 桌面物件：钉在桌上，随整张桌子一起平移 / 缩放 -->
      <button
        v-for="o in deskObjects"
        :key="o.id"
        class="jmap__obj"
        :class="{ 'jmap__obj--photo': o.photo, 'is-armed': armedObject === o.id }"
        type="button"
        :aria-label="
          o.to
            ? `${o.label}，${o.toLabel ?? `前往${o.preview.title}`}`
            : o.examine
              ? `${o.label}，检视`
              : o.label
        "
        :style="objectStyle(o)"
        @mouseenter="showObjectPreview(o.id)"
        @mouseleave="hideObjectPreview(o.id)"
        @focus="showObjectPreview(o.id)"
        @blur="hideObjectPreview(o.id)"
        @click="onObjectTap(o)"
      >
        <span class="jmap__obj-glow" aria-hidden="true"></span>
        <img :src="o.src" alt="" draggable="false" />
      </button>
    </div>

    <!-- 视口边缘渐隐，让图幅边界不突兀 -->
    <div class="jmap__scrim" aria-hidden="true"></div>

    <!-- 开场说明，一动就淡出 -->
    <div class="jmap__intro" :class="{ 'is-hidden': interacted }">
      <p class="jmap__eyebrow display">旅途回忆录</p>
      <h1 class="jmap__title">从帕斯罗，一路向北</h1>
      <p class="jmap__lede">
        一张按行商路线画的地图。由南方的帕斯罗村出发，沿商路北上，直到北方森林里的约伊兹。
      </p>
    </div>

    <!-- 信息卡 -->
    <aside ref="cardEl" class="jmap__card" :class="{ 'is-expanded': cardMore }" aria-live="polite">
      <p class="jmap__card-order">
        第 <b>{{ shownIndex + 1 }}</b> 站 · 共 {{ stations.length }} 站
      </p>
      <h3 class="jmap__card-city">
        {{ active.city }}
        <span class="jmap__card-en">{{ active.cityEn }}</span>
      </h3>
      <!-- 手机端默认收起（站牌一展开就吃掉半屏地图）；
           桌面端这层是 display: contents，等于不存在 -->
      <div class="jmap__card-more">
        <p class="jmap__card-region">{{ active.region }}</p>
        <p class="jmap__card-scene">{{ active.scene }}</p>
        <p class="jmap__card-lore">{{ active.lore }}</p>
      </div>
      <button
        v-if="isPhone"
        class="jmap__card-toggle"
        type="button"
        :aria-expanded="cardMore"
        @click="cardMore = !cardMore"
      >
        {{ cardMore ? '收起细节' : '看到站细节' }}
        <span aria-hidden="true">{{ cardMore ? '▾' : '▸' }}</span>
      </button>
      <RouterLink v-if="active.to" class="jmap__card-cta" :to="active.to">
        进入 {{ active.board }}
        <span aria-hidden="true">→</span>
      </RouterLink>
      <p v-else class="jmap__card-locked">
        <span aria-hidden="true">✦</span>
        尚未抵达 —— 这处驿站还没有铺内容
      </p>
    </aside>

    <!-- 缩放控件 -->
    <div class="jmap__zoom">
      <button type="button" aria-label="放大" @click="zoomBy(1.35)">＋</button>
      <button type="button" aria-label="缩小" @click="zoomBy(1 / 1.35)">−</button>
      <button type="button" class="jmap__zoom-fit" @click="onFit">全览</button>
    </div>

    <!-- 驿站目录 -->
    <div class="jmap__dir">
      <button
        type="button"
        class="jmap__dir-toggle"
        :aria-expanded="dirOpen"
        @click="dirOpen = !dirOpen"
      >
        驿站目录
        <span aria-hidden="true">{{ dirOpen ? '▾' : '▸' }}</span>
      </button>
      <Transition name="jmap-dir">
        <nav v-if="dirOpen" class="jmap__dir-list" aria-label="驿站目录">
          <button
            v-for="(s, i) in stations"
            :key="s.id"
            type="button"
            class="jmap__dir-item"
            :class="{ 'is-board': s.to }"
            @click="onDirPick(i)"
          >
            <span class="jmap__dir-order">{{ i + 1 }}</span>
            <span class="jmap__dir-city">{{ s.city }}</span>
            <span class="jmap__dir-mark">{{ s.to ? '可进入' : '未抵达' }}</span>
          </button>
        </nav>
      </Transition>
    </div>

    <!-- 桌面物件悬浮预览 -->
    <Transition name="jmap-preview">
      <aside v-if="previewObject" class="jmap__obj-preview" :style="previewStyle" role="tooltip">
        <p class="jmap__obj-preview-kicker">
          {{
            previewObject.to ? '可进入板块' : previewObject.examine ? '可以拿起来看' : '桌上的旧物'
          }}
        </p>
        <h4 class="jmap__obj-preview-title">{{ previewObject.preview.title }}</h4>
        <p class="jmap__obj-preview-body">{{ previewObject.preview.body }}</p>
        <span v-if="previewObject.to" class="jmap__obj-preview-action">
          点击进入
          <span aria-hidden="true">→</span>
        </span>
        <span v-else-if="previewObject.examine" class="jmap__obj-preview-action">
          点击检视
          <span aria-hidden="true">↻</span>
        </span>
      </aside>
    </Transition>

    <ItemViewer
      :open="examineTarget !== null"
      :src="examineTarget?.src ?? ''"
      :title="examineTarget?.preview.title ?? ''"
      :body="examineTarget?.preview.body ?? ''"
      :edge="examineTarget?.examine?.edge"
      :edge-metalness="examineTarget?.examine?.metalness"
      :edge-texture="examineTarget?.examine?.texture"
      @close="examineTarget = null"
    />

    <p class="jmap__hint" :class="{ 'is-hidden': interacted }">
      {{ isPhone ? '拖动平移 · 双指缩放 · 点两下进入' : '拖动平移 · 滚轮缩放' }}
    </p>

    <Transition name="jmap-toast">
      <p v-if="toast" class="jmap__toast">{{ toast }}</p>
    </Transition>
  </div>
</template>

<style scoped>
.jmap {
  --px: 0;
  --py: 0;
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  touch-action: none;
  /* 桌面图会铺满，这里只做加载前的兜底色 */
  background: #150f08;
  user-select: none;
}

/* 平时是普通指针；只有真的在拖拽时才变成抓取样式。
   驿站自身的 cursor:pointer 会盖住根元素，所以拖拽态要一并对驿站生效。 */
.jmap.is-dragging,
.jmap.is-dragging .jmap__node {
  cursor: grabbing;
}

/* ---- 世界层：整张桌子（木纹平铺） ---- */
.jmap__world {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  will-change: transform;
  background-image: url('/art/desk-tile.webp');
  background-repeat: repeat;
  background-position: center;
  /* 桌面整体压暗一点，让地图与浮层读得清 */
  box-shadow: inset 0 0 0 9999px rgba(8, 5, 2, 0.34);
}

.jmap__world.is-smooth {
  transition: transform 0.5s cubic-bezier(0.22, 0.61, 0.36, 1);
}

/* 地图图幅：铺在桌上的一张图 */
.jmap__map {
  position: absolute;
  box-shadow:
    0 18px 46px -18px rgba(0, 0, 0, 0.85),
    0 3px 10px rgba(0, 0, 0, 0.5);
}

/* 单件物件：按中心定位 + 摆放角度；悬停抬起 + 暖光高光 + 可点击指针 */
.jmap__obj {
  position: absolute;
  padding: 0;
  border: 0;
  background: none;
  pointer-events: auto;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transform: translate(-50%, -50%) rotate(var(--rot, 0deg));
}

.jmap__obj img {
  display: block;
  width: 100%;
  height: auto;
  filter: sepia(0.14) saturate(1.06) brightness(0.95) drop-shadow(0 12px 16px rgba(0, 0, 0, 0.6));
  transition:
    transform 0.4s cubic-bezier(0.34, 1.4, 0.5, 1),
    filter 0.4s ease;
}

.jmap__obj-glow {
  position: absolute;
  inset: -42%;
  border-radius: 50%;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    closest-side,
    rgba(255, 206, 120, 0.72),
    rgba(255, 176, 64, 0.2) 56%,
    transparent 78%
  );
  mix-blend-mode: screen;
  transition: opacity 0.4s ease;
}

.jmap__obj:hover img,
.jmap__obj:focus-visible img {
  transform: translateY(-6px) scale(1.06);
  /* 除阴影外再加一圈暖色轮廓光，让「能点」一眼可见 */
  filter: sepia(0.1) saturate(1.14) brightness(1.06) drop-shadow(0 0 16px rgba(255, 198, 96, 0.62))
    drop-shadow(0 20px 22px rgba(0, 0, 0, 0.65));
}

.jmap__obj:hover .jmap__obj-glow,
.jmap__obj:focus-visible .jmap__obj-glow {
  opacity: 1;
}

.jmap__obj:focus-visible {
  outline: none;
}

/* 按下给一点手感（不是行为，只是反馈） */
.jmap__obj:active img {
  transform: translateY(-2px) scale(1.01);
}

/* 角色画片：像一张搁在桌上的画页 —— 轻微做旧 + 柔和投影，不用任何相框 */
.jmap__obj--photo img {
  border-radius: 2px;
  filter: sepia(0.1) saturate(1.02) brightness(0.97) contrast(0.98)
    drop-shadow(0 14px 18px rgba(0, 0, 0, 0.62)) drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
}

.jmap__obj--photo::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: 2px;
  background:
    radial-gradient(115% 115% at 50% 45%, transparent 58%, rgba(74, 44, 14, 0.34) 100%),
    linear-gradient(180deg, rgba(255, 206, 130, 0.07), rgba(90, 60, 24, 0.1));
  mix-blend-mode: multiply;
}

.jmap__obj--photo:hover img,
.jmap__obj--photo:focus-visible img {
  filter: sepia(0.06) saturate(1.08) brightness(1.06) contrast(0.99)
    drop-shadow(0 0 18px rgba(255, 198, 96, 0.6)) drop-shadow(0 22px 26px rgba(0, 0, 0, 0.66));
}

/* 桌面物件预览：用羊皮纸 / 旧木牌的感觉，不打断地图本身 */
.jmap__obj-preview {
  position: absolute;
  z-index: 8;
  box-sizing: border-box;
  width: min(19rem, calc(100vw - 2rem));
  padding: 0.85rem 0.95rem 0.9rem;
  border: 1px solid rgba(224, 169, 68, 0.46);
  border-radius: 12px;
  background:
    radial-gradient(circle at 18% 0%, rgba(233, 185, 92, 0.16), transparent 54%),
    linear-gradient(180deg, rgba(57, 39, 20, 0.97), rgba(24, 15, 8, 0.98));
  box-shadow:
    0 16px 34px -16px rgba(0, 0, 0, 0.92),
    0 0 0 1px rgba(0, 0, 0, 0.45),
    inset 0 1px 0 rgba(255, 226, 165, 0.1);
  color: var(--text-muted, #cbbfa8);
  pointer-events: none;
  transform: translateX(-50%);
  backdrop-filter: blur(8px);
}

.jmap__obj-preview::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(145deg, rgba(255, 226, 165, 0.08), transparent 35%);
}

.jmap__obj-preview-kicker {
  margin: 0 0 0.25rem;
  color: var(--wheat-500, #c99a49);
  font-size: 0.64rem;
  letter-spacing: 0.16em;
}

.jmap__obj-preview-title {
  position: relative;
  margin: 0;
  color: var(--wheat-100, #f7e3b8);
  font-family: var(--font-heading, serif);
  font-size: 0.98rem;
  letter-spacing: 0.05em;
}

.jmap__obj-preview-body {
  position: relative;
  margin: 0.42rem 0 0;
  font-size: 0.78rem;
  line-height: 1.7;
}

.jmap__obj-preview-action {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.65rem;
  color: var(--wheat-300, #e9b95c);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
}

.jmap-preview-enter-active,
.jmap-preview-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.22s ease;
}

.jmap-preview-enter-from,
.jmap-preview-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(5px) scale(0.98);
}

.jmap__base {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}

.jmap__mist {
  position: absolute;
  inset: -6%;
  pointer-events: none;
  background:
    radial-gradient(40% 18% at 26% 30%, rgba(255, 244, 214, 0.4), transparent 70%),
    radial-gradient(36% 15% at 74% 58%, rgba(255, 238, 200, 0.3), transparent 72%),
    radial-gradient(28% 12% at 46% 80%, rgba(226, 236, 255, 0.18), transparent 74%);
  transform: translate3d(calc(var(--px) * 26px), calc(var(--py) * 26px), 0);
  transition: transform 0.9s cubic-bezier(0.22, 0.61, 0.36, 1);
  animation: mistDrift 24s ease-in-out infinite alternate;
}

@keyframes mistDrift {
  from {
    opacity: 0.6;
  }
  to {
    opacity: 0.95;
  }
}

.jmap__grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.24;
  mix-blend-mode: multiply;
  background-image:
    radial-gradient(rgba(90, 62, 28, 0.18) 1px, transparent 1px),
    radial-gradient(rgba(90, 62, 28, 0.12) 1px, transparent 1px);
  background-size:
    6px 6px,
    11px 11px;
  background-position:
    0 0,
    3px 4px;
}

.jmap__svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* ---- 路线 ---- */
.jmap__route-base,
.jmap__route-line,
.jmap__route-flow {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.jmap__route-base {
  stroke: rgba(74, 48, 20, 0.42);
  stroke-width: 4;
  stroke-dasharray: 2 13;
}

.jmap__route-line {
  stroke: rgba(206, 138, 34, 0.9);
  stroke-width: 4;
  opacity: 0;
}

.jmap.is-ready .jmap__route-line {
  opacity: 1;
  transition: opacity 0.9s ease 0.3s;
}

/* 沿路流动的高光，暗示这是一条「路」 */
.jmap__route-flow {
  stroke: rgba(255, 226, 150, 0.95);
  stroke-width: 5;
  stroke-dasharray: 8 220;
  filter: drop-shadow(0 0 5px rgba(255, 200, 100, 0.9));
  animation: routeFlow 9s linear infinite;
  opacity: 0;
}

.jmap.is-ready .jmap__route-flow {
  opacity: 0.9;
}

@keyframes routeFlow {
  from {
    stroke-dashoffset: 228;
  }
  to {
    stroke-dashoffset: -228;
  }
}

/* ---- 驿站 ---- */
.jmap__node {
  cursor: pointer;
  outline: none;
}

.jmap__node .jmap__ring,
.jmap__node .jmap__core,
.jmap__node .jmap__halo {
  /* 关键：SVG 默认以 viewBox 为变换基准，scale 会把圆点甩到很远的地方。
     fill-box 让它以「图形自身」的包围盒为基准，center 才是圆心。 */
  transform-box: fill-box;
  transform-origin: center;
  transition:
    transform 0.32s cubic-bezier(0.34, 1.4, 0.5, 1),
    fill 0.3s ease,
    stroke 0.3s ease,
    opacity 0.3s ease;
}

.jmap__halo {
  fill: transparent;
  stroke: transparent;
}

.jmap__ring {
  fill: rgba(246, 236, 210, 0.88);
  stroke: rgba(96, 62, 22, 0.78);
  stroke-width: 2.4;
}

.jmap__core {
  fill: rgba(96, 62, 22, 0.62);
}

.jmap__label {
  font-family: var(--font-heading, serif);
  font-size: 21px;
  font-weight: 600;
  letter-spacing: 0.04em;
  fill: rgba(60, 38, 14, 0.74);
  paint-order: stroke;
  stroke: rgba(247, 238, 216, 0.84);
  stroke-width: 4.5px;
  stroke-linejoin: round;
  transition: fill 0.3s ease;
}

.jmap__node.is-board .jmap__ring {
  fill: rgba(255, 226, 158, 0.96);
  stroke: rgba(150, 92, 18, 0.95);
  stroke-width: 3;
}

.jmap__node.is-board .jmap__core {
  fill: rgba(180, 106, 20, 0.95);
}

.jmap__node.is-ahead .jmap__ring {
  fill: rgba(238, 228, 205, 0.52);
  stroke: rgba(96, 70, 40, 0.45);
  stroke-width: 1.6;
  stroke-dasharray: 3 4;
}

.jmap__node.is-ahead .jmap__core {
  fill: rgba(96, 70, 40, 0.32);
}

.jmap__node.is-ahead .jmap__label {
  fill: rgba(70, 50, 26, 0.48);
}

.jmap__node.is-active .jmap__halo {
  fill: rgba(255, 196, 96, 0.3);
  stroke: rgba(255, 186, 76, 0.75);
  stroke-width: 1.3;
  animation: haloPulse 1.8s ease-out infinite;
}

.jmap__node.is-active .jmap__ring {
  transform: scale(1.5);
}

.jmap__node.is-active .jmap__core {
  transform: scale(1.35);
}

.jmap__node.is-active .jmap__label {
  fill: rgba(34, 20, 4, 0.98);
}

.jmap__node.is-ahead.is-active .jmap__halo {
  fill: rgba(220, 206, 176, 0.28);
  stroke: rgba(120, 96, 62, 0.6);
}

.jmap__node:focus-visible .jmap__ring {
  stroke: rgba(255, 244, 216, 1);
  stroke-width: 4;
}

@keyframes haloPulse {
  0% {
    transform: scale(0.7);
    opacity: 0.9;
  }
  100% {
    transform: scale(1.5);
    opacity: 0;
  }
}

.jmap__node.is-goal .jmap__ring {
  stroke: rgba(196, 70, 46, 0.9);
}

.jmap__node.is-goal .jmap__core {
  fill: rgba(196, 70, 46, 0.88);
}

.jmap__node.is-shake .jmap__node-inner {
  animation: nodeShake 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97);
}

@keyframes nodeShake {
  20% {
    transform: translate(-2px, 1px);
  }
  40% {
    transform: translate(3px, -1px);
  }
  60% {
    transform: translate(-3px, 1px);
  }
  80% {
    transform: translate(2px, -1px);
  }
}

/* ---- 视口边缘渐隐 ---- */
.jmap__scrim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(135% 105% at 50% 50%, transparent 55%, rgba(12, 7, 3, 0.5) 100%),
    linear-gradient(
      180deg,
      rgba(14, 9, 4, 0.5) 0%,
      transparent 18%,
      transparent 76%,
      rgba(14, 9, 4, 0.62) 100%
    );
}

/* ---- 开场说明 ---- */
.jmap__intro {
  position: absolute;
  top: clamp(5rem, 14vh, 8rem);
  left: clamp(1rem, 5vw, 4rem);
  max-width: min(38ch, 46vw);
  padding: 1.1rem 1.3rem 1.3rem;
  border-radius: 14px;
  background: radial-gradient(130% 130% at 0% 0%, rgba(14, 9, 4, 0.86), rgba(14, 9, 4, 0.4) 72%);
  transition:
    opacity 0.6s ease,
    transform 0.6s ease;
}

.jmap__intro.is-hidden {
  opacity: 0;
  transform: translateY(-10px);
  pointer-events: none;
}

.jmap__eyebrow {
  font-size: 0.74rem;
  letter-spacing: 0.34em;
  color: var(--wheat-400, #e0a944);
}

.jmap__title {
  margin-top: 0.5rem;
  font-family: var(--font-heading, serif);
  font-size: clamp(1.7rem, 4.4vw, 2.7rem);
  letter-spacing: 0.06em;
  color: var(--parchment-50, #f6efdd);
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.75);
}

.jmap__lede {
  margin-top: 0.8rem;
  font-size: 0.9rem;
  line-height: 2;
  color: var(--text-muted, #cbbfa8);
}

/* ---- 信息卡 ---- */
.jmap__card {
  position: absolute;
  left: clamp(1rem, 3vw, 2.4rem);
  bottom: clamp(1rem, 3vw, 2.4rem);
  width: min(360px, calc(100vw - 2rem));
  padding: 1rem 1.15rem 1.2rem;
  border-radius: 12px;
  border: 1px solid rgba(224, 169, 68, 0.34);
  background: linear-gradient(180deg, rgba(26, 20, 12, 0.9), rgba(14, 10, 6, 0.94));
  backdrop-filter: blur(10px) saturate(130%);
  box-shadow: 0 20px 46px -22px rgba(0, 0, 0, 0.95);
}

.jmap__card-order {
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  color: var(--wheat-500, #c99a49);
}

.jmap__card-order b {
  font-size: 0.95rem;
  color: var(--wheat-300, #e9b95c);
}

.jmap__card-city {
  margin-top: 0.35rem;
  font-family: var(--font-heading, serif);
  font-size: 1.3rem;
  letter-spacing: 0.06em;
  color: var(--parchment-50, #f6efdd);
}

.jmap__card-en {
  margin-left: 0.5rem;
  font-size: 0.64rem;
  font-weight: 400;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--wheat-600, #a87c33);
}

.jmap__card-region {
  margin-top: 0.2rem;
  font-size: 0.75rem;
  color: var(--text-dim, #9d8f79);
}

.jmap__card-scene {
  margin-top: 0.65rem;
  font-family: var(--font-serif, serif);
  font-style: italic;
  font-size: 0.85rem;
  color: var(--wheat-300, #e9b95c);
}

.jmap__card-lore {
  margin-top: 0.45rem;
  font-size: 0.8rem;
  line-height: 1.8;
  color: var(--text-muted, #cbbfa8);
}

.jmap__card-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.9rem;
  padding: 0.5rem 0.95rem;
  border-radius: 999px;
  border: 1px solid rgba(233, 185, 92, 0.5);
  background: rgba(233, 185, 92, 0.14);
  color: var(--wheat-200, #f0cf90);
  font-size: 0.83rem;
  letter-spacing: 0.06em;
  transition:
    background 0.25s ease,
    transform 0.25s ease,
    border-color 0.25s ease;
}

.jmap__card-cta:hover {
  background: rgba(233, 185, 92, 0.26);
  border-color: rgba(233, 185, 92, 0.8);
  transform: translateX(3px);
}

.jmap__card-locked {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  margin-top: 0.9rem;
  font-size: 0.76rem;
  color: var(--text-dim, #9d8f79);
}

/* ---- 缩放控件 ---- */
.jmap__zoom {
  position: absolute;
  right: clamp(1rem, 3vw, 2.4rem);
  bottom: clamp(3.4rem, 8vw, 4.6rem);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.jmap__zoom button {
  width: 2.4rem;
  height: 2.4rem;
  display: grid;
  place-items: center;
  border-radius: 10px;
  border: 1px solid rgba(224, 169, 68, 0.36);
  background: rgba(20, 14, 8, 0.86);
  color: var(--wheat-200, #f0cf90);
  font-size: 1rem;
  line-height: 1;
  backdrop-filter: blur(8px);
  transition:
    background 0.22s ease,
    border-color 0.22s ease,
    transform 0.22s ease;
}

.jmap__zoom button:hover {
  background: rgba(233, 185, 92, 0.2);
  border-color: rgba(233, 185, 92, 0.7);
}

.jmap__zoom button:active {
  transform: scale(0.94);
}

.jmap__zoom-fit {
  font-size: 0.72rem !important;
  letter-spacing: 0.08em;
}

/* ---- 驿站目录 ---- */
.jmap__dir {
  position: absolute;
  right: clamp(1rem, 3vw, 2.4rem);
  top: clamp(4.6rem, 10vh, 5.6rem);
  width: min(20rem, calc(100vw - 2rem));
}

.jmap__dir-toggle {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.6rem;
  padding: 0.55rem 0.9rem;
  border-radius: 10px;
  border: 1px solid rgba(224, 169, 68, 0.36);
  background: rgba(20, 14, 8, 0.86);
  color: var(--wheat-200, #f0cf90);
  font-size: 0.82rem;
  letter-spacing: 0.1em;
  backdrop-filter: blur(8px);
}

.jmap__dir-toggle:hover {
  background: rgba(233, 185, 92, 0.18);
}

.jmap__dir-list {
  margin-top: 0.4rem;
  max-height: min(52vh, 26rem);
  overflow-y: auto;
  /* 滚到尽头不要带动外层；并隐藏系统默认滚动条 */
  overscroll-behavior: contain;
  scrollbar-width: none;
  padding: 0.4rem;
  border-radius: 10px;
  border: 1px solid rgba(224, 169, 68, 0.28);
  background: rgba(16, 11, 6, 0.94);
  backdrop-filter: blur(10px);
  display: grid;
  gap: 0.15rem;
}

.jmap__dir-list::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.jmap__dir-item {
  display: grid;
  grid-template-columns: 1.6rem 1fr auto;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: 8px;
  text-align: left;
  color: var(--text-muted, #cbbfa8);
  font-size: 0.84rem;
  transition: background 0.2s ease;
}

.jmap__dir-item:hover {
  background: rgba(233, 185, 92, 0.12);
}

.jmap__dir-item.is-board {
  color: var(--wheat-100, #f7e3b8);
}

.jmap__dir-order {
  font-variant-numeric: tabular-nums;
  font-size: 0.72rem;
  color: var(--wheat-600, #a87c33);
}

.jmap__dir-mark {
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  color: var(--text-dim, #9d8f79);
}

.jmap__dir-item.is-board .jmap__dir-mark {
  color: var(--wheat-400, #e0a944);
}

.jmap-dir-enter-active,
.jmap-dir-leave-active {
  transition:
    opacity 0.22s ease,
    transform 0.22s ease;
}

.jmap-dir-enter-from,
.jmap-dir-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* ---- 提示 ---- */
.jmap__hint {
  position: absolute;
  right: clamp(1rem, 3vw, 2.4rem);
  bottom: clamp(1rem, 3vw, 2.4rem);
  font-size: 0.74rem;
  letter-spacing: 0.08em;
  color: rgba(233, 222, 200, 0.7);
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.8);
}

.jmap__toast {
  position: absolute;
  left: 50%;
  bottom: 2.2rem;
  transform: translateX(-50%);
  padding: 0.5rem 1rem;
  border-radius: 999px;
  border: 1px solid rgba(224, 169, 68, 0.4);
  background: rgba(20, 14, 8, 0.94);
  color: var(--wheat-200, #f0cf90);
  font-size: 0.8rem;
  letter-spacing: 0.06em;
  pointer-events: none;
}

.jmap-toast-enter-active,
.jmap-toast-leave-active {
  transition:
    opacity 0.25s ease,
    transform 0.25s ease;
}

.jmap-toast-enter-from,
.jmap-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (max-width: 860px) {
  .jmap__intro {
    max-width: none;
    right: clamp(1rem, 5vw, 4rem);
  }

  .jmap__hint {
    display: none;
  }

  .jmap__zoom {
    bottom: auto;
    top: 50%;
    transform: translateY(-50%);
  }
}

/* ---- 竖屏手机 ---------------------------------------------------------
   与脚本里的 PHONE_QUERY 逐字一致（style.css 第 13 节同一断点）。
   桌面 / 平板 / 横屏手机都不命中。
   ---------- 摆位换算（iPhone 14 · 390×844 实测）----------
     viewport_x ≈ -126 + 603 × x      （x = 物件相对地图宽的比例）
     viewport_y ≈  -19 + 904 × y      （y = 相对地图高的比例）
   下面每个物件的 phone 摆位都是按这个换算反推的：左列贴屏幕左缘、
   下排贴着站牌上沿，全部落在首屏内，且避开开场说明与缩放控件。
   ------------------------------------------------------ */
@media (max-width: 700px) and (orientation: portrait) {
  /* 开场说明：压到左上角并收窄 —— 右边要给「驿站目录」腾位置，
     原来这两块固定 UI 在手机上直接叠在一起 */
  .jmap__intro {
    left: calc(12px + var(--safe-left));
    right: auto;
    top: clamp(4.4rem, 12vh, 6rem);
    max-width: 62vw;
    padding: 0.8rem 0.95rem 0.9rem;
    border-radius: 12px;
  }

  .jmap__eyebrow {
    font-size: 0.62rem;
    letter-spacing: 0.24em;
  }

  .jmap__title {
    margin-top: 0.3rem;
    font-size: 1.32rem;
    letter-spacing: 0.04em;
  }

  .jmap__lede {
    margin-top: 0.5rem;
    font-size: 0.78rem;
    line-height: 1.75;
  }

  /* 驿站目录：收成右上角一颗小按钮，不再横跨整屏 */
  .jmap__dir {
    width: auto;
    right: calc(12px + var(--safe-right));
    top: calc(var(--header-h) + 8px + var(--safe-top));
  }

  .jmap__dir-toggle {
    /* 实测 38px 高，撑到 44px 触控目标 */
    min-height: var(--tap);
    padding: 0.45rem 0.7rem;
    font-size: 0.76rem;
    letter-spacing: 0.04em;
  }

  .jmap__dir-list {
    max-height: 46dvh;
    width: min(19rem, calc(100vw - 24px - var(--safe-left) - var(--safe-right)));
  }

  .jmap__dir-item {
    min-height: var(--tap);
  }

  /* 站牌：贴底，默认只留「第 N 站 + 城市 + 进入」，细节点开才展开 */
  .jmap__card {
    left: calc(10px + var(--safe-left));
    right: calc(10px + var(--safe-right));
    bottom: calc(10px + var(--safe-bottom));
    width: auto;
    padding: 0.75rem 0.9rem 0.85rem;
    max-height: 52dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .jmap__card-more {
    display: none;
  }

  .jmap__card.is-expanded .jmap__card-more {
    display: block;
  }

  .jmap__card-city {
    font-size: 1.5rem;
  }

  .jmap__card-scene,
  .jmap__card-lore {
    margin-top: 0.5rem;
    font-size: 0.82rem;
    line-height: 1.7;
  }

  .jmap__card-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    /* 实测 32px 高，撑到 44px 触控目标 */
    min-height: var(--tap);
    margin-top: 0.4rem;
    padding: 0.2rem 0.1rem;
    color: var(--wheat-300, #f7d68d);
    font-size: 0.78rem;
    letter-spacing: 0.06em;
  }

  .jmap__card-cta {
    min-height: var(--tap);
  }

  /* 缩放控件：让开站牌，贴在卡片上沿（--card-h 由 ResizeObserver 实测） */
  .jmap__zoom {
    top: auto;
    bottom: calc(var(--card-h, 150px) + 20px + var(--safe-bottom));
    right: calc(10px + var(--safe-right));
    transform: none;
  }

  .jmap__zoom button {
    width: var(--tap);
    height: var(--tap);
    font-size: 1.05rem;
  }

  .jmap__zoom-fit {
    font-size: 0.72rem !important;
  }

  /* 操作提示：换成触屏说法，放到顶栏下方一条空带里
     （贴着站牌摆会压在麦穗上，实测过） */
  .jmap__hint {
    display: block;
    top: calc(var(--header-h) + 8px + var(--safe-top));
    right: auto;
    bottom: auto;
    left: calc(14px + var(--safe-left));
    font-size: 0.7rem;
    text-align: left;
  }

  /* 桌面物件：手机上「点得到」比「摆得像桌上」重要，命中区不小于 44px */
  .jmap__obj {
    min-width: var(--tap);
    min-height: var(--tap);
  }

  /* ---- 手机端的「选中」态 --------------------------------------------
     触屏没有 hover，一次点进去容易误触。这里把交互拆成两步：
       第一次点 → 桌面端悬停的那套（节点高亮 + 站牌 / 物件预览）
       第二次点同一处 → 才真的进入
     is-active 就是桌面悬停的观感（光环脉冲 + 放大），is-armed 再叠一圈
     常亮金环，让「下一次点会进去」这件事在触屏上看得见。
     ------------------------------------------------------------------ */
  .jmap__node.is-armed .jmap__halo {
    fill: rgba(255, 196, 96, 0.22);
    stroke: rgba(255, 214, 132, 0.95);
    stroke-width: 2.2;
  }

  .jmap__node.is-armed .jmap__ring {
    fill: rgba(255, 236, 190, 0.98);
    stroke: rgba(150, 92, 18, 0.95);
    stroke-width: 3.4;
  }

  .jmap__node.is-armed .jmap__core {
    fill: rgba(180, 106, 20, 0.95);
  }

  .jmap__node.is-armed .jmap__label {
    fill: rgba(34, 20, 4, 0.98);
  }

  /* 物件选中：等同桌面 hover 的抬起 + 暖光 */
  .jmap__obj.is-armed img {
    transform: translateY(-4px) scale(1.05);
    filter: sepia(0.1) saturate(1.14) brightness(1.06)
      drop-shadow(0 0 16px rgba(255, 198, 96, 0.62)) drop-shadow(0 18px 20px rgba(0, 0, 0, 0.65));
  }

  .jmap__obj.is-armed .jmap__obj-glow {
    opacity: 1;
  }

  /* 物件的悬停预览卡：手机上收窄一点、去掉毛玻璃（掉帧） */
  .jmap__obj-preview {
    width: min(19rem, calc(100vw - 2.5rem));
    padding: 0.7rem 0.8rem 0.75rem;
    backdrop-filter: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .jmap__world.is-smooth,
  .jmap__mist,
  .jmap__intro,
  .jmap__node .jmap__ring,
  .jmap__node .jmap__core,
  .jmap-preview-enter-active,
  .jmap-preview-leave-active {
    transition: none;
  }

  .jmap__mist,
  .jmap__route-flow,
  .jmap__node.is-active .jmap__halo,
  .jmap__node.is-shake .jmap__node-inner,
  .jmap__obj-glow {
    animation: none;
  }
}
</style>
