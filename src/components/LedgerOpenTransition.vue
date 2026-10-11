<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

// 仅取类型：three 是动态 import，这份声明编译期被擦除，不进产物
import type { BufferGeometry, Group, Material, Texture } from 'three'

import { assetUrl } from '@/utils/asset'
import { isPhoneViewport } from '@/utils/viewport'

/**
 * 「翻开账本」过场。
 *
 * 一次 3D 演出，代替生硬的跳转：
 *   1) 账本从桌面浮起、微微转正
 *   2) 皮面封面绕书脊翻开
 *   3) 三页账纸依次翻过
 *   4) 镜头俯冲贴近摊开的账页，纸面最终铺满整屏 —— 再淡出接上 /ledger
 *
 * 挂在 App 上（跨路由存活），所以跳转不会把动画打断。
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ done: [] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
// 首帧真正画出来之前先显示「取书…」，避免黑屏被当成卡死
const ready = ref(false)

let teardown: (() => void) | null = null
let cancelled = false
let skipping = false
function skip(): void {
  skipping = true
}

/* 时间轴（秒） */
const T_TOTAL = 2.35
/** 时间轴倍速：竖屏手机上整段过场压到 60%（见 tick 里的 elapsed / SPEED） */
const SPEED = isPhoneViewport() ? 0.6 : 1
const T_RISE = [0, 0.45] as const
const T_COVER = [0.28, 0.92] as const
const T_DIVE = [1.62, T_TOTAL] as const

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
const range = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a))
const easeOut = (x: number): number => 1 - (1 - x) ** 3
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)

async function start(): Promise<void> {
  const canvas = canvasRef.value
  if (!canvas) return
  cancelled = false
  skipping = false
  ready.value = false

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) {
    window.setTimeout(() => emit('done'), 220)
    return
  }

  const THREE = await import('three')
  if (cancelled) return

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  // 手机上限 1.5：全屏过场是像素填充最重的一帧序列
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhoneViewport() ? 1.5 : 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(38, 1, 0.02, 100)

  /* ---- 环境：暖色小房间，供皮面与烫金反射 ---- */
  const envScene = new THREE.Scene()
  envScene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(14, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0x2a2118, side: THREE.BackSide }),
    ),
  )
  const mkPanel = (color: number, size: number, pos: [number, number, number]) => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ color }),
    )
    panel.position.set(...pos)
    panel.lookAt(0, 0, 0)
    envScene.add(panel)
  }
  mkPanel(0xffe0b0, 5, [4, 4, 4])
  mkPanel(0xffb370, 4, [-4, 2, 3])
  mkPanel(0x9fc0ff, 3, [0, -4, 2])
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTex = pmrem.fromScene(envScene, 0.05).texture
  scene.environment = envTex

  scene.add(new THREE.AmbientLight(0xffffff, 0.3))
  const key = new THREE.DirectionalLight(0xffe4bc, 1.6)
  key.position.set(2.5, 4, 3.5)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.55)
  fill.position.set(-3, 2, -2.5)
  scene.add(fill)

  /* ---- 贴图 ---- */
  const load = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
  const [coverImg, spreadImg, edgesImg] = await Promise.all([
    load(assetUrl('art/book-cover.webp')),
    load(assetUrl('art/book-spread.webp')),
    load(assetUrl('art/book-edges.webp')),
  ])
  if (cancelled) {
    pmrem.dispose()
    renderer.dispose()
    return
  }

  const textures: Texture[] = []
  const mkTex = (src: HTMLImageElement) => {
    const tex = new THREE.Texture(src)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
    tex.needsUpdate = true
    textures.push(tex)
    return tex
  }
  const coverTex = mkTex(coverImg)
  const edgesTex = mkTex(edgesImg)
  // 翻页纸取自摊开账页贴图的「右半张」——同一张纸，只是不含中缝
  // 摊开图左右各一页：右半张给书芯顶面，左半张给翻动的纸
  const rightPageTex = mkTex(spreadImg)
  rightPageTex.repeat.set(0.5, 1)
  rightPageTex.offset.set(0.5, 0)

  const leftPageTex = mkTex(spreadImg)
  leftPageTex.repeat.set(0.5, 1)
  leftPageTex.offset.set(0, 0)

  /* ---- 账本模型 ----------------------------------------------------------
     书脊在 x = SPINE。关键：书芯只占「一页宽」，顶面也只贴一页纸；
     左页是翻过去的纸，两页在书脊处相接才构成一个跨页。
     封面/封底比纸页三边外扩一点（书口、天头、地脚出血），书脊处齐平。
  ---------------------------------------------------------------------- */
  const W = 1.5 // 封面宽 = 一页宽
  const D = 2.0 // 书高
  const PW = W * 0.96 // 纸页宽（略窄于封面）
  const PD = D * 0.95 // 纸页高
  const COVER_T = 0.045
  const BLOCK_T = 0.18
  const PAGE_T = 0.01 // 三张翻页纸合起来的厚度

  const SPINE = -W / 2
  /** 书芯顶面：翻页纸铺在它上面 */
  const BLOCK_TOP = COVER_T / 2 + BLOCK_T
  /** 封面轴心：合上时在翻页纸之上；翻开后压到封底上 */
  const COVER_CLOSED_Y = BLOCK_TOP + PAGE_T + COVER_T / 2
  const COVER_OPEN_Y = COVER_T
  /**
   * 翻页纸轴心：合上时贴着书芯顶面，翻过去后直接落在摊平的封面上。
   * 左边**不放任何"垫块"** —— 左页只能由真正翻过去的纸提供，
   * 否则就会出现「封面还没翻，左边已经有纸」或者一块怪异材质。
   */
  const PAGE_CLOSED_Y = BLOCK_TOP + 0.002
  const COVER_REST_TOP = COVER_T / 2 + COVER_T
  const PAGE_OPEN_Y = COVER_REST_TOP + 0.002

  const leather = new THREE.MeshStandardMaterial({
    color: 0x3a2318,
    roughness: 0.78,
    metalness: 0.06,
  })
  const edgeMat = new THREE.MeshStandardMaterial({
    map: edgesTex,
    roughness: 0.72,
    metalness: 0.03,
  })
  const coverOuter = new THREE.MeshStandardMaterial({
    map: coverTex,
    roughness: 0.58,
    metalness: 0.16,
  })
  const coverInner = new THREE.MeshStandardMaterial({
    color: 0x2f1c12,
    roughness: 0.85,
    metalness: 0.04,
  })
  // 摊开图是左右两页：右半张给书芯顶面，左半张给翻过去的纸
  const rightPageMat = new THREE.MeshStandardMaterial({
    map: rightPageTex,
    roughness: 0.74,
    metalness: 0.02,
  })
  const pageMat = new THREE.MeshStandardMaterial({
    map: leftPageTex,
    roughness: 0.74,
    metalness: 0.02,
    side: THREE.DoubleSide,
  })

  const book = new THREE.Group()
  const materials: Material[] = [leather, edgeMat, coverOuter, coverInner, rightPageMat, pageMat]
  const geometries: BufferGeometry[] = []

  const boxMats = (top: Material, bottom: Material, sides: Material): Material[] => [
    sides, // +X 书口
    leather, // -X 书脊侧（包进书脊，露出来的是皮）
    top, // +Y
    bottom, // -Y
    sides, // +Z 天头
    sides, // -Z 地脚
  ]

  // 封底：外皮朝下
  const backGeo = new THREE.BoxGeometry(W, COVER_T, D)
  geometries.push(backGeo)
  const back = new THREE.Mesh(backGeo, boxMats(coverInner, coverOuter, edgeMat))
  back.position.set(SPINE + W / 2, 0, 0)
  book.add(back)

  // 书芯：只占一页宽，从书脊起算；顶面是「右页」
  const blockGeo = new THREE.BoxGeometry(PW, BLOCK_T, PD)
  geometries.push(blockGeo)
  const block = new THREE.Mesh(blockGeo, boxMats(rightPageMat, leather, edgeMat))
  block.position.set(SPINE + PW / 2, COVER_T / 2 + BLOCK_T / 2, 0)
  book.add(block)

  // 书脊：一根圆棱，把上下封面连起来，翻开后就是左侧那道接缝
  const spineGeo = new THREE.CylinderGeometry(COVER_T * 0.9, COVER_T * 0.9, D, 20, 1, false)
  geometries.push(spineGeo)
  const spine = new THREE.Mesh(spineGeo, leather)
  spine.rotation.x = Math.PI / 2
  spine.position.set(SPINE - COVER_T * 0.35, COVER_CLOSED_Y / 2 + COVER_T * 0.25, 0)
  book.add(spine)

  // 封面：以书脊为轴
  const frontPivot = new THREE.Group()
  frontPivot.position.set(SPINE, COVER_CLOSED_Y, 0)
  const frontGeo = new THREE.BoxGeometry(W, COVER_T, D)
  geometries.push(frontGeo)
  const front = new THREE.Mesh(frontGeo, boxMats(coverOuter, coverInner, edgeMat))
  front.position.x = W / 2
  frontPivot.add(front)
  book.add(frontPivot)

  // 三张翻动的账纸：贴着书脊，翻开后正好接在书芯左缘
  const pageGeo = new THREE.PlaneGeometry(PW, PD)
  geometries.push(pageGeo)
  const flippers: Group[] = []
  for (let i = 0; i < 3; i += 1) {
    const pivot = new THREE.Group()
    pivot.position.set(SPINE, PAGE_CLOSED_Y + i * 0.0025, 0)
    const page = new THREE.Mesh(pageGeo, pageMat)
    page.rotation.x = -Math.PI / 2
    page.position.set(PW / 2, 0, 0)
    pivot.add(page)
    pivot.rotation.z = 0
    book.add(pivot)
    flippers.push(pivot)
  }

  const bookGroup = new THREE.Group()
  bookGroup.add(book)
  scene.add(bookGroup)

  /* ---- 镜头 ---- */
  const camStart = new THREE.Vector3(0.95, 2.55, 2.95)
  const camEnd = new THREE.Vector3(-0.1, 0.5, 0.6)
  const lookStart = new THREE.Vector3(0.02, 0.12, 0)
  // 摊平后视线落到「右页」中心：账本页正是从这里接上
  const lookEnd = new THREE.Vector3(-0.08, 0.3, 0)
  const look = new THREE.Vector3()
  camera.position.copy(camStart)
  camera.lookAt(lookStart)

  const resize = () => {
    const w = window.innerWidth
    const h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  /* ---- 循环 ---- */
  const clock = new THREE.Clock()
  let raf = 0
  let finished = false
  const tick = () => {
    raf = requestAnimationFrame(tick)
    let t = clock.getElapsedTime() / SPEED
    if (skipping) t = T_TOTAL

    // 账本浮起
    const rise = easeOut(range(t, T_RISE[0], T_RISE[1]))
    bookGroup.scale.setScalar(0.86 + 0.14 * rise)
    bookGroup.position.y = (1 - rise) * -0.1

    // 封面翻开：翻的同时整体下沉，最终平压在封底上。
    // 必须真的翻平（180°）且落到封面之下，翻过去的账页才有地方落，
    // 否则纸页会停在封面的厚度里 —— 看起来就是「翻进了封面」。
    const coverP = easeOut(range(t, T_COVER[0], T_COVER[1]))
    frontPivot.rotation.z = coverP * Math.PI
    frontPivot.position.y = COVER_CLOSED_Y + (COVER_OPEN_Y - COVER_CLOSED_Y) * coverP

    // 三页依次翻过
    flippers.forEach((pivot, i) => {
      const a = 0.92 + i * 0.12
      const b = 1.46 + i * 0.12
      const p = easeOut(range(t, a, b))
      // 正角才是「从右半边抬起、翻过书脊落到左边」。
      pivot.rotation.z = p * Math.PI
      // 一边翻一边降：从书芯顶面落到摊平封面的纸面上，
      // 全程最低点都不低于封面顶面，所以不会穿插。
      pivot.position.y = PAGE_CLOSED_Y + i * 0.0025 + (PAGE_OPEN_Y - PAGE_CLOSED_Y) * p
    })

    // 左侧那一摞随翻页长高，翻过去的纸才有落点
    // 镜头俯冲进账页
    const dive = easeInOut(range(t, T_DIVE[0], T_DIVE[1]))
    camera.position.lerpVectors(camStart, camEnd, dive)
    look.lerpVectors(lookStart, lookEnd, dive)
    camera.lookAt(look)

    renderer.render(scene, camera)
    if (!ready.value) ready.value = true

    if (!finished && t >= T_TOTAL) {
      finished = true
      emit('done')
    }
  }
  tick()

  teardown = () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('resize', resize)
    for (const g of geometries) g.dispose()
    for (const m of materials) m.dispose()
    for (const tex of textures) tex.dispose()
    envTex.dispose()
    pmrem.dispose()
    renderer.dispose()
    scene.clear()
  }
}

function stop(): void {
  cancelled = true
  teardown?.()
  teardown = null
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      document.body.style.overflow = 'hidden'
      await nextTick()
      await start()
    } else {
      stop()
      document.body.style.overflow = ''
    }
  },
)

onBeforeUnmount(() => {
  stop()
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="lopen">
      <div v-if="open" class="lopen" @click="skip">
        <canvas ref="canvasRef" class="lopen__canvas"></canvas>
        <p class="lopen__caption display">翻开账本</p>
        <p v-if="!ready" class="lopen__loading">取书…</p>
        <p class="lopen__skip">点击跳过</p>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.lopen {
  position: fixed;
  inset: 0;
  z-index: 220;
  background:
    radial-gradient(70% 60% at 50% 44%, rgba(40, 30, 20, 0.75), rgba(4, 3, 6, 0.99) 100%), #05040a;
}

.lopen__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.lopen__caption {
  position: absolute;
  top: clamp(1.2rem, 4vh, 2.4rem);
  left: 50%;
  transform: translateX(-50%);
  color: rgba(233, 185, 92, 0.8);
  font-size: 0.72rem;
  letter-spacing: 0.5em;
  text-transform: uppercase;
  pointer-events: none;
}

.lopen__loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: rgba(233, 185, 92, 0.62);
  font-size: 0.86rem;
  letter-spacing: 0.34em;
  pointer-events: none;
}

.lopen__skip {
  position: absolute;
  bottom: clamp(1rem, 3vh, 1.8rem);
  left: 50%;
  transform: translateX(-50%);
  color: rgba(200, 187, 166, 0.4);
  font-size: 0.72rem;
  letter-spacing: 0.2em;
  pointer-events: none;
}

.lopen-enter-active,
.lopen-leave-active {
  transition: opacity 0.4s ease;
}

.lopen-enter-from,
.lopen-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .lopen-enter-active,
  .lopen-leave-active {
    transition: none;
  }
}
</style>
