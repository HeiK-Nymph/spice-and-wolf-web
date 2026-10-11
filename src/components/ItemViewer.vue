<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
// 仅取类型：three 本身是动态 import，这份声明在编译期就被擦掉，不进产物
import type { MeshStandardMaterial, Texture } from 'three'

import { assetUrl } from '@/utils/asset'
import { isPhoneViewport } from '@/utils/viewport'

/**
 * 道具检视 —— 生化危机重制版那种「拿到东西后可以翻转查看」的立体检视器。
 *
 * 画片本身是带画框的平面，所以做成一块有厚度的板：
 *   正面 = 画片，背面 = 画框背板，四条侧边 = 画框侧面的材质贴图（木纹 / 鎏金）。
 * 用 three.js 真 3D 渲染，带环境反射与推进灯，拖拽旋转、滚轮缩放、静止会缓慢自转。
 *
 * 侧边的 UV 轴是正交的：左右两面「高」是长轴，上下两面「宽」是长轴，
 * 所以同一张贴图要备两份朝向（一份旋转 90°），否则纹路会横着长。
 *
 * three 体积不小，所以只在打开时动态 import，不拖累首页。
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    src: string
    title: string
    body: string
    /** 侧边兜底色，没有贴图时用它 */
    edge?: string
    /** 侧边金属度：金框给高一点，木框给低一点 */
    edgeMetalness?: number
    /** 画框侧面材质贴图 */
    edgeTexture?: string
  }>(),
  { edge: '#3a2418', edgeMetalness: 0.1, edgeTexture: '' },
)

/** 竖屏手机：提示语换触屏说法，渲染分辨率降一档（见下面的 setPixelRatio） */
const isPhone = isPhoneViewport()

const emit = defineEmits<{ close: [] }>()

const stageRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const loading = ref(true)

let teardown: (() => void) | null = null
let cancelled = false

function onKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

/** 把贴图转 90°，供另一个朝向的侧面使用 */
function rotatedCanvas(img: HTMLImageElement, deg: number): HTMLCanvasElement {
  const rad = (deg * Math.PI) / 180
  const swap = Math.abs(deg) % 180 === 90
  const cv = document.createElement('canvas')
  cv.width = swap ? img.naturalHeight : img.naturalWidth
  cv.height = swap ? img.naturalWidth : img.naturalHeight
  const ctx = cv.getContext('2d')
  if (ctx) {
    ctx.translate(cv.width / 2, cv.height / 2)
    ctx.rotate(rad)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  }
  return cv
}

async function start(): Promise<void> {
  const stage = stageRef.value
  const canvas = canvasRef.value
  if (!stage || !canvas) return

  cancelled = false
  loading.value = true

  const THREE = await import('three')
  if (cancelled) return

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  // 竖屏手机把渲染分辨率上限压到 1.5：dpr=3 的屏按 2 渲染 = 4 倍像素填充，
  // 这是全站最容易掉帧的一处，而 1.5 与 2 的视觉差异肉眼几乎看不出
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.5 : 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100)

  /* ---- 环境反射：手搭一个暖色小房间，供金属画框反射 ---- */
  const envScene = new THREE.Scene()
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(14, 14, 14),
    new THREE.MeshBasicMaterial({ color: 0x2b2418, side: THREE.BackSide }),
  )
  envScene.add(room)
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
  mkPanel(0xffb870, 4, [-4, 2, 3])
  mkPanel(0x8fb0e0, 3, [0, -4, 3])
  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTex = pmrem.fromScene(envScene, 0.05).texture
  scene.environment = envTex

  /* ---- 灯 ---- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.35))
  const key = new THREE.DirectionalLight(0xffe6c0, 1.5)
  key.position.set(2.5, 3.5, 4)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0x9fc0ff, 0.7)
  rim.position.set(-3, 1.5, -3)
  scene.add(rim)

  /* ---- 贴图 ---- */
  const load = (url: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })

  const [frontImg, backImg] = await Promise.all([
    load(props.src),
    load(assetUrl('art/frame-back.webp')),
  ])
  const edgeImg = props.edgeTexture ? await load(props.edgeTexture).catch(() => null) : null
  if (cancelled) {
    pmrem.dispose()
    renderer.dispose()
    return
  }

  const textures: Texture[] = []
  const mkTex = (source: TexImageSource) => {
    const tex = new THREE.Texture(source)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy()
    tex.needsUpdate = true
    textures.push(tex)
    return tex
  }

  const frontTex = mkTex(frontImg)
  const backTex = mkTex(backImg)

  /* ---- 道具本体：一块带厚度的画框 ---- */
  const aspect = frontImg.naturalWidth / frontImg.naturalHeight
  const LONG = 2
  const w = aspect >= 1 ? LONG : LONG * aspect
  const h = aspect >= 1 ? LONG / aspect : LONG
  const depth = Math.min(w, h) * 0.11

  /**
   * 侧边材质。贴图本身是一段「线脚剖面 + 纹样」：
   *   横向 = 沿画框长度方向的纹样，纵向 = 剖面层次。
   * 左右两面（长轴在竖直方向）需要把贴图转 90°，纹样才会顺着边走。
   */
  const EDGE_TILES = 4
  let edgeMatX: MeshStandardMaterial
  let edgeMatY: MeshStandardMaterial
  if (edgeImg) {
    const texY = mkTex(edgeImg)
    texY.wrapS = texY.wrapT = THREE.RepeatWrapping
    texY.repeat.set(EDGE_TILES, 1)

    const texX = mkTex(rotatedCanvas(edgeImg, 90))
    texX.wrapS = texX.wrapT = THREE.RepeatWrapping
    texX.repeat.set(1, EDGE_TILES)

    const common = { bumpScale: 0.35, roughness: 0.5, metalness: props.edgeMetalness }
    edgeMatY = new THREE.MeshStandardMaterial({ map: texY, bumpMap: texY, ...common })
    edgeMatX = new THREE.MeshStandardMaterial({ map: texX, bumpMap: texX, ...common })
  } else {
    const fallback = new THREE.MeshStandardMaterial({
      color: new THREE.Color(props.edge),
      roughness: 0.42,
      metalness: props.edgeMetalness,
    })
    edgeMatX = fallback
    edgeMatY = fallback
  }

  const frontMat = new THREE.MeshStandardMaterial({
    map: frontTex,
    roughness: 0.52,
    metalness: 0.02,
  })
  const backMat = new THREE.MeshStandardMaterial({ map: backTex, roughness: 0.85, metalness: 0.05 })

  const item = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), [
    edgeMatX,
    edgeMatX,
    edgeMatY,
    edgeMatY,
    frontMat,
    backMat,
  ])
  scene.add(item)

  /* ---- 自适应取景 ---- */
  let baseDist = 5
  const fitCamera = () => {
    const vw = stage.clientWidth || 1
    const vh = stage.clientHeight || 1
    renderer.setSize(vw, vh, false)
    camera.aspect = vw / vh
    const vFov = (camera.fov * Math.PI) / 180
    const distV = h / 2 / Math.tan(vFov / 2)
    const distH = w / 2 / (Math.tan(vFov / 2) * camera.aspect)
    baseDist = Math.max(distV, distH) * 1.42
    camera.updateProjectionMatrix()
  }
  fitCamera()

  /* ---- 交互 ---- */
  const cur = { rx: -0.14, ry: -0.42, zoom: 1 }
  const tgt = { rx: -0.14, ry: -0.42, zoom: 1 }
  let dragging = false
  let lastX = 0
  let lastY = 0
  let lastInput = performance.now()
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const onPointerDown = (e: PointerEvent) => {
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      /* 合成事件或指针已释放时可能抛错，忽略即可 */
    }
    lastInput = performance.now()
  }
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging) return
    const dx = e.clientX - lastX
    const dy = e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    tgt.ry += dx * 0.0085
    tgt.rx = Math.max(-1.15, Math.min(1.15, tgt.rx + dy * 0.0085))
    lastInput = performance.now()
  }
  const onPointerUp = (e: PointerEvent) => {
    dragging = false
    try {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* 同上 */
    }
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    tgt.zoom = Math.max(0.62, Math.min(1.9, tgt.zoom * (1 - e.deltaY * 0.0012)))
    lastInput = performance.now()
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  const ro = new ResizeObserver(fitCamera)
  ro.observe(stage)

  /* ---- 渲染循环 ---- */
  const clock = new THREE.Clock()
  let raf = 0
  const tick = () => {
    raf = requestAnimationFrame(tick)
    const t = clock.getElapsedTime()

    if (!reduce && !dragging && performance.now() - lastInput > 3200) tgt.ry += 0.0032

    cur.rx += (tgt.rx - cur.rx) * 0.12
    cur.ry += (tgt.ry - cur.ry) * 0.12
    cur.zoom += (tgt.zoom - cur.zoom) * 0.12

    item.rotation.x = cur.rx
    item.rotation.y = cur.ry
    item.position.y = reduce ? 0 : Math.sin(t * 0.7) * 0.022
    camera.position.z = baseDist / cur.zoom
    camera.lookAt(0, 0, 0)

    renderer.render(scene, camera)
  }
  tick()
  loading.value = false

  teardown = () => {
    cancelAnimationFrame(raf)
    ro.disconnect()
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    canvas.removeEventListener('wheel', onWheel)
    item.geometry.dispose()
    for (const tex of textures) tex.dispose()
    frontMat.dispose()
    backMat.dispose()
    edgeMatX.dispose()
    if (edgeMatY !== edgeMatX) edgeMatY.dispose()
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
      document.addEventListener('keydown', onKeydown)
      await nextTick()
      await start()
    } else {
      stop()
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeydown)
    }
  },
)

onBeforeUnmount(() => {
  stop()
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="viewer">
      <div
        v-if="open"
        class="viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="viewer-title"
      >
        <div class="viewer__backdrop" @click="emit('close')"></div>

        <div class="viewer__frame">
          <span class="viewer__corner viewer__corner--tl"></span>
          <span class="viewer__corner viewer__corner--tr"></span>
          <span class="viewer__corner viewer__corner--bl"></span>
          <span class="viewer__corner viewer__corner--br"></span>

          <p class="viewer__eyebrow">EXAMINE</p>

          <div ref="stageRef" class="viewer__stage">
            <canvas ref="canvasRef" class="viewer__canvas"></canvas>
            <p v-if="loading" class="viewer__loading">正在取来·摆正·掌灯…</p>
          </div>

          <div class="viewer__info">
            <h2 id="viewer-title" class="viewer__title">{{ title }}</h2>
            <p class="viewer__body">{{ body }}</p>
            <p class="viewer__hint">
              {{
                isPhone ? '单指旋转 · 双指缩放 · 点 ✕ 放回' : '拖动旋转 · 滚轮缩放 · 按 Esc 放回'
              }}
            </p>
          </div>

          <button class="viewer__close" type="button" aria-label="放回" @click="emit('close')">
            ✕
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.viewer {
  position: fixed;
  inset: 0;
  z-index: 210;
  display: grid;
  place-items: center;
  padding: clamp(0.8rem, 2.5vw, 2rem);
}

/* 竖屏手机：让开刘海与 Home 指示条，关闭按钮撑到 44px 触控目标 */
@media (max-width: 700px) and (orientation: portrait) {
  .viewer {
    padding: calc(0.6rem + var(--safe-top)) calc(0.6rem + var(--safe-right))
      calc(0.6rem + var(--safe-bottom)) calc(0.6rem + var(--safe-left));
  }

  .viewer__close {
    width: var(--tap);
    height: var(--tap);
    top: 0.7rem;
    right: 0.8rem;
  }

  .viewer__title {
    font-size: 1.1rem;
    padding-inline: 2.6rem;
  }

  .viewer__body {
    font-size: 0.84rem;
  }
}

.viewer__backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(70% 55% at 50% 42%, rgba(38, 30, 20, 0.6), rgba(4, 3, 6, 0.97) 100%), #05040a;
}

.viewer__frame {
  position: relative;
  display: flex;
  flex-direction: column;
  width: min(60rem, 100%);
  height: min(46rem, 100%);
  padding: clamp(1rem, 2.4vw, 1.8rem);
  border: 1px solid rgba(224, 169, 68, 0.22);
  border-radius: 6px;
  background: linear-gradient(180deg, rgba(24, 19, 14, 0.72), rgba(10, 8, 7, 0.86));
  box-shadow: 0 40px 90px -30px rgba(0, 0, 0, 0.95);
}

/* 取景四角，模仿检视界面的边框 */
.viewer__corner {
  position: absolute;
  width: 22px;
  height: 22px;
  border: 1px solid rgba(233, 185, 92, 0.55);
  pointer-events: none;
}
.viewer__corner--tl {
  top: -1px;
  left: -1px;
  border-right: 0;
  border-bottom: 0;
}
.viewer__corner--tr {
  top: -1px;
  right: -1px;
  border-left: 0;
  border-bottom: 0;
}
.viewer__corner--bl {
  bottom: -1px;
  left: -1px;
  border-right: 0;
  border-top: 0;
}
.viewer__corner--br {
  bottom: -1px;
  right: -1px;
  border-left: 0;
  border-top: 0;
}

.viewer__eyebrow {
  flex: 0 0 auto;
  font-family: var(--font-display);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.42em;
  text-transform: uppercase;
  color: rgba(233, 185, 92, 0.7);
  text-align: center;
}

.viewer__stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
}

.viewer__canvas {
  display: block;
  width: 100%;
  height: 100%;
  cursor: grab;
  touch-action: none;
}

.viewer__canvas:active {
  cursor: grabbing;
}

.viewer__loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: rgba(233, 185, 92, 0.75);
  font-size: 0.86rem;
  letter-spacing: 0.16em;
}

.viewer__info {
  flex: 0 0 auto;
  padding-top: 0.9rem;
  border-top: 1px solid rgba(224, 169, 68, 0.16);
  text-align: center;
}

.viewer__title {
  font-size: 1.2rem;
  color: var(--parchment-50);
}

.viewer__body {
  max-width: 40rem;
  margin: 0.35rem auto 0;
  color: #c8bba6;
  font-size: 0.88rem;
  line-height: 1.8;
}

.viewer__hint {
  margin-top: 0.55rem;
  color: rgba(233, 185, 92, 0.55);
  font-size: 0.74rem;
  letter-spacing: 0.12em;
}

.viewer__close {
  position: absolute;
  top: 0.5rem;
  right: 0.6rem;
  width: 2.1rem;
  height: 2.1rem;
  border: 1px solid rgba(224, 169, 68, 0.3);
  border-radius: 999px;
  background: rgba(13, 10, 18, 0.7);
  color: var(--wheat-300);
  font-size: 0.9rem;
  line-height: 1;
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}

.viewer__close:hover {
  border-color: rgba(233, 185, 92, 0.75);
  background: rgba(32, 25, 38, 0.9);
}

.viewer-enter-active,
.viewer-leave-active {
  transition: opacity 0.22s ease;
}

.viewer-enter-from,
.viewer-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .viewer-enter-active,
  .viewer-leave-active {
    transition: none;
  }
}
</style>
