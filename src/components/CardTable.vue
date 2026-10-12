<script setup lang="ts">
/**
 * 3D 牌桌 —— 只负责「把局面演出来」，不含任何 2048 规则（规则在 src/game/engine.ts）。
 *
 * 关键设计（和 ItemViewer.vue 不同，别照抄它）：
 *   ItemViewer 是「一个组件 = 一个 WebGLRenderer」，因为整页只会开一个检视器。
 *   牌桌上同时有 16 张牌，如果每张牌一个 renderer，16 个 WebGL 上下文会直接撞上
 *   浏览器上限（约 16 个）。所以这里是【单 renderer + 单场景 + 每张牌一个 mesh】。
 *
 * 相机是钉死的：游戏的方向语义（按「上下左右」滑动）在视角可自由旋转时就不成立了，
 * 所以刻意不做轨道控制。
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
// 仅取类型：three 本身是动态 import（只在进牌局时才加载），
// 这份 import 在编译期被擦掉，不会把 three 提前拖进产物
import type { Group, Mesh, MeshStandardMaterial, Texture, Vector3 } from 'three'

import { assetUrl } from '@/utils/asset'
import { isPhoneViewport } from '@/utils/viewport'

import { FACE_H, FACE_W, drawCardFace, faceArtUrl } from '@/game/cardface'
import { DIFFICULTY } from '@/game/engine'
import type { GameState, MoveOutcome } from '@/game/engine'
import {
  BOARD_HEIGHT,
  CARD_DEPTH,
  CARD_H,
  CARD_W,
  DESK_DEPTH,
  ROW_DEPTH,
  boardDepth,
  boardWidth,
  deskWidth,
  slotX,
  slotZ,
} from '@/game/layout'

const props = defineProps<{
  /** 开局局面 */
  initial: GameState
}>()

const emit = defineEmits<{ ready: [] }>()

const stageRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

/** 浮在牌位上方的数值标签（屏幕坐标，每帧投影更新） */
interface CardLabel {
  id: number
  value: number
  x: number
  y: number
}

const labels = ref<CardLabel[]>([])

/**
 * 俯视仰角。越大越接近正上方俯视；越小越「贴地平看」。
 * 40° 才看得见底座的侧壁 —— 参考图那种「托盘感」全靠这个角度露出来。
 */
/**
 * 俯视仰角。43° 是量出来的（用 generated/_probe-camera.mjs 精确投影算的）：
 * 卡竖着立 1.5 高、每排只隔一个身位，仰角越低后排被挡得越狠 ——
 * 42° 时最差只剩 65%（不到三分之二），43° 是刚好达标的最平角度（72%）。
 *
 * 【不要为了「让牌桌占满竖屏」去抬高仰角】：抬高会把卡面按 cos(仰角) 拍扁
 * （58° 时只剩 0.53 倍），卡图反而更看不清。竖屏要的是「牌桌小一点、但每张牌看得清」。
 */
const ELEVATION_DEG = 43

/**
 * 每个牌位自带的那块白色底座（参考图里跟着小动物走的就是它）。
 * 它比卡略大一圈、很矮，卡牌悬在它上方 —— 滑动 / 合并 / 生成时整组一起动。
 */
const PEDESTAL_W = CARD_W + 0.12
const PEDESTAL_D = ROW_DEPTH - 0.1
const PEDESTAL_H = 0.14
/** 卡牌底边离「自己那块底座顶面」的悬空高度 */
const FLOAT_GAP = 0.26
/** 卡牌静止时底边相对底座顶面的 y */
const CARD_LIFT = PEDESTAL_H + FLOAT_GAP
/** 悬浮起伏的幅度与角速度 */
const BOB_AMPLITUDE = 0.016
const BOB_SPEED = 0.0011
/** 滑行动画时长（毫秒） */
const SLIDE_MS = 165
const POP_MS = 220
const SPAWN_MS = 260

interface TableApi {
  playMove(outcome: MoveOutcome): Promise<void>
  reset(state: GameState): void
}

const api = shallowRef<TableApi | null>(null)
let teardown: (() => void) | null = null

onMounted(async () => {
  const canvas = canvasRef.value
  const stageOrNull = stageRef.value
  if (!canvas || !stageOrNull) return
  // 收窄成非空常量：下面 resize() 是函数声明（会提升），闭包里拿不到外层的收窄
  const stage: HTMLDivElement = stageOrNull

  const THREE = await import('three')
  // 圆角盒来自 three 的 examples。跟着 three 一起【动态】导入是必须的：
  // 若写成静态 import，它内部会静态引用 'three'，three 就会被提前拽进主包。
  const { RoundedBoxGeometry } = await import(
    'three/examples/jsm/geometries/RoundedBoxGeometry.js'
  )
  const isPhone = isPhoneViewport()

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isPhone ? 1.5 : 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.06
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()

  /* ------------------------------ 环境反射 ------------------------------ */
  // 一个假的「房间」过一遍 PMREM，给金属卡框一点柔和高光（同 ItemViewer 的思路）
  const envScene = new THREE.Scene()
  envScene.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(14, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0x2b2418, side: THREE.BackSide }),
    ),
  )
  const warmPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  )
  warmPanel.position.set(0, 6.8, 0)
  warmPanel.rotation.x = Math.PI / 2
  envScene.add(warmPanel)
  const coolPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({ color: 0x2f3a52 }),
  )
  coolPanel.position.set(-5, 1, -3)
  coolPanel.rotation.y = Math.PI / 2
  envScene.add(coolPanel)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const envTex = pmrem.fromScene(envScene, 0.05).texture
  scene.environment = envTex

  /* -------------------------------- 灯光 -------------------------------- */
  scene.add(new THREE.AmbientLight(0xfff0dc, 0.62))

  const key = new THREE.DirectionalLight(0xffe6c0, 2.6)
  key.position.set(3.6, 9, 5)
  key.castShadow = true
  key.shadow.mapSize.set(1024, 1024)
  key.shadow.radius = 2.5
  key.shadow.bias = -0.0012
  // 薄片（卡牌）最容易自阴影 —— 法线偏移比单纯调 bias 更有效
  key.shadow.normalBias = 0.02
  // 按最大边长（5×5）算一次即可：所有难度都够用，不必随难度重建阴影相机
  const shadowSpan = Math.max(boardWidth(5), boardDepth(5)) / 2 + 2.6
  key.shadow.camera.left = -shadowSpan
  key.shadow.camera.right = shadowSpan
  key.shadow.camera.top = shadowSpan
  key.shadow.camera.bottom = -shadowSpan
  key.shadow.camera.near = 1
  key.shadow.camera.far = 26
  scene.add(key)

  const rim = new THREE.DirectionalLight(0x9fc0ff, 0.6)
  rim.position.set(-5, 4.5, -6)
  scene.add(rim)

  /* -------------------------------- 相机 -------------------------------- */
    /*
   * 近裁剪面取 1、远取 120 —— 不要把近裁剪面设得很小。
   * 深度精度由 远/近 的比值决定：原来 0.1/160 是 1600 倍，手机上（常见 16 位深度缓冲）
   * 精度差到会让贴得很近的两个面互相穿插（z-fighting），表现就是卡面上闪动的黑条。
   * 场景最近的物体离相机也有十几，近裁剪面 1 完全够用。
   */
  const camera = new THREE.PerspectiveCamera(24, 1, 1, 120)

  /** 竖屏判定：牌桌是横着的，窄到这个比例就该换一套取景 */
  const isPortrait = (aspect: number): boolean => aspect < 0.9


  /**
   * 把相机拉到「刚好装下整个棋盘」的距离。
   * 用包围球算太保守（棋盘是扁的），所以直接把四个角投影到 NDC，
   * 按超出比例缩放距离 —— 投影尺度与距离成反比，两轮就收敛。
   */
  function fitCamera(aspect: number): void {
    camera.aspect = aspect
    camera.updateProjectionMatrix()

    /*
     * 取景随视口方向走 —— 手机竖屏是重点：
     *   横屏：仰角 43°，横向按【桌子】算（左右那两条边线要留在画面里）；
     *   竖屏：仰角不变，但横向只按【牌桌】算 —— 竖屏里牌桌的投影宽高比约 1.6，
 *         照横屏那套取景它只占中间一条；改用牌桌宽度取景能大出不少，
 *         代价是桌子那两条边线让出画面（竖屏里本来就看不全，不心疼）。
     * 纵向一律只按【牌桌】算：桌子的近端要出画、远端要化进背景，都不该被取景框住。
     */
    const portrait = isPortrait(aspect)
    const rad = (ELEVATION_DEG * Math.PI) / 180
    const dir = new THREE.Vector3(0, Math.sin(rad), Math.cos(rad)).normalize()
    const halfWidth = (portrait ? boardWidth(boardSize) : deskWidth(boardSize)) / 2

    let distance = 12
    const probe = new THREE.Vector3()

    // 角点每次现算 —— 边长随难度变，写死一次就不对了。上下沿都算进去，免得近端底边被切。
    const corners: Array<[number, number, number]> = []
    for (const x of [-halfWidth, halfWidth]) {
      for (const z of [-boardDepth(boardSize) / 2, boardDepth(boardSize) / 2]) {
        for (const y of [CARD_LIFT + CARD_H, 0, -BOARD_HEIGHT]) corners.push([x, y, z])
      }
    }
    for (let pass = 0; pass < 3; pass += 1) {
      camera.position.copy(dir).multiplyScalar(distance)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld()
      let maxX = 0
      let maxY = 0
      for (const [x, y, z] of corners) {
        probe.set(x, y, z).project(camera)
        maxX = Math.max(maxX, Math.abs(probe.x))
        maxY = Math.max(maxY, Math.abs(probe.y))
      }
      // 0.9 = 画面里给牌桌留一成边距（早先是 0.8，留两成，牌偏小）。
      // 这个系数只改取景范围，不影响遮挡比例。
      distance *= Math.max(maxX, maxY) / 0.9
    }
    camera.position.copy(dir).multiplyScalar(distance)
    camera.lookAt(0, 0, 0)
  }

  /* ----------------------------- 桌面与牌垫 ----------------------------- */
  const loader = new THREE.TextureLoader()
  const disposeList: Array<{ dispose(): void }> = []

  function loadTexture(url: string, repeat?: [number, number]): Texture {
    const texture = loader.load(assetUrl(url))
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4)
    if (repeat) {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      texture.repeat.set(repeat[0], repeat[1])
    }
    disposeList.push(texture)
    return texture
  }

  /*
   * 三层台面（照例图从下往上）。
   *
   * ① 桌子：垫在最底下的大台面。颜色刻意贴近背景 —— 例图里这张桌子融合得几乎看不见，
   *    最明显的痕迹其实是牌桌投在它上面的那圈阴影。尺寸远大于牌桌，
   *    因为【靠近镜头的那条边必须落在画面外】（例图里就看不到这条边），
   *    所以取景时也不能把它算进去。
   */
  // 颜色是按实测反推的：材质 0x15100a 渲出来是 RGB(31,23,15)，比它身下的背景 (10,7,5) 亮三倍，
  // 所以那圈边才会那么显眼。压到 0x0d0905 之后，渲出来的值才和背景基本齐平。
  const deskCanvas = document.createElement('canvas')
  deskCanvas.width = 64
  deskCanvas.height = 512
  const deskCtx = deskCanvas.getContext('2d')
  if (deskCtx) {
    // 【只沿 v 方向渐隐】，不碰横向 —— 径向渐隐会把左右两条边线一起抹掉，
    // 而例图里那两条边线是看得见的。画布上方 = 贴图 v=1 = 世界 -z = 远端。
    // 用 alpha 渐隐而不是「把颜色调暗」：调暗只会把硬边变成一条暗线，边还在。
    const haze = deskCtx.createLinearGradient(0, 0, 0, 512)
    haze.addColorStop(0, 'rgba(88, 64, 40, 0)')
    haze.addColorStop(0.23, 'rgba(88, 64, 40, 0)')
    haze.addColorStop(0.41, 'rgba(92, 67, 42, 1)')
    haze.addColorStop(1, 'rgba(96, 70, 44, 1)')
    deskCtx.fillStyle = haze
    deskCtx.fillRect(0, 0, 64, 512)
  }
  const deskTexture = new THREE.CanvasTexture(deskCanvas)
  deskTexture.colorSpace = THREE.SRGBColorSpace
  disposeList.push(deskTexture)

  const deskMaterial = new THREE.MeshStandardMaterial({
    map: deskTexture,
    transparent: true,
    roughness: 0.95,
    metalness: 0.02,
    depthWrite: false,
  })
  /**
   * 当前局面的边长。难度一换（5×5 / 4×4 / 3×3）牌桌与桌子都要重建，
   * 否则格子会按旧尺寸铺，当场错位。
   */
  let boardSize = DIFFICULTY[props.initial.difficulty].size
  let boardMesh: Mesh | null = null
  let deskMesh: Mesh | null = null

  function applyBoardSize(size: number): void {
    if (boardMesh && deskMesh && size === boardSize) return
    boardSize = size

    if (boardMesh) {
      scene.remove(boardMesh)
      boardMesh.geometry.dispose()
    }
    if (deskMesh) {
      scene.remove(deskMesh)
      deskMesh.geometry.dispose()
    }

    // 桌子：远端渐隐、近端伸出画面（只沿 v 方向渐隐，左右两条边线要留着）
    deskMesh = new THREE.Mesh(new THREE.PlaneGeometry(deskWidth(size), DESK_DEPTH), deskMaterial)
    deskMesh.rotation.x = -Math.PI / 2
    deskMesh.position.y = -BOARD_HEIGHT
    // 【不接阴影】：牌桌投在桌面上的影子会形成一条比背景还暗的带子 ——
    // 那正是「远端看着有硬边」的真正来源。桌面要的是一片化开的雾，不是一条影。
    deskMesh.receiveShadow = false
    scene.add(deskMesh)

    // 牌桌：顶面齐平 y=0，厚度全部向下去 —— 白底座与卡牌都以 y=0 为基准
    boardMesh = new THREE.Mesh(
      // 圆角盒：90° 硬边在这个视距下很扎眼，倒一圈 0.12 的圆角就柔和了
      new RoundedBoxGeometry(boardWidth(size), BOARD_HEIGHT, boardDepth(size), 5, 0.12),
      boardMaterial,
    )
    boardMesh.position.y = -BOARD_HEIGHT / 2
    boardMesh.castShadow = true
    boardMesh.receiveShadow = true
    scene.add(boardMesh)
  }
  disposeList.push(deskMaterial)

  /*
   * ② 牌桌：黄米色、有厚度的那一块，白底座直接坐在它上面。
   *    它才是画面里真正的实体 —— 体积感全来自它这条侧壁。
   */
  // 表面材质：浅色橡木纹（public/art/board-tile.webp）。
  // 那张图本身已经是合适的米白木色、且是均匀平光，所以这里不再叠色（color 保持白）。
  const boardSurfaceTexture = loadTexture('art/board-tile.webp')
  const boardMaterial = new THREE.MeshStandardMaterial({
    map: boardSurfaceTexture,
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.02,
  })
  disposeList.push(boardMaterial)

  // 台面上【不铺固定格子】：白底座是跟着牌走的，每张牌自己带一块（见 makeCard）。

  /* -------------------------------- 卡片 -------------------------------- */
  // 牌位底座：所有牌共用同一份几何体与材质
  const pedestalGeometry = new RoundedBoxGeometry(PEDESTAL_W, PEDESTAL_H, PEDESTAL_D, 3, 0.045)
  const pedestalMaterial = new THREE.MeshStandardMaterial({
    color: 0xe9dfca,
    roughness: 0.72,
    metalness: 0.03,
  })
  disposeList.push(pedestalGeometry, pedestalMaterial)

  // 厚度落在 Z 轴上：牌是竖着立的，正面朝 +Z（朝相机）
  const bodyGeometry = new THREE.BoxGeometry(CARD_W, CARD_H, CARD_DEPTH)
  disposeList.push(bodyGeometry)

  // 卡侧边用木框贴图，和站点里「检视画片」的那套一致
  const edgeTexture = loadTexture('art/frame-side-wood.webp')
  const bodyMaterial = new THREE.MeshStandardMaterial({
    map: edgeTexture,
    color: 0xa98d63,
    roughness: 0.7,
    metalness: 0.06,
  })
  disposeList.push(bodyMaterial)

  /** 卡面纹理缓存：value → CanvasTexture。第一次出现某个面值时才画、才加载卡图 */
  const faceTextures = new Map<number, Texture>()
  /**
   * 同一个面值可能同时有好几张牌在等纹理（开局的牌常常同值），
   * 所以必须排队等 —— 只留一个回调会让后来的牌永远拿不到图，显示成一张黑牌。
   */
  const faceWaiters = new Map<number, Array<(texture: Texture) => void>>()
  const imageCache = new Map<string, HTMLImageElement>()

  function ensureFace(value: number, onReady: (texture: Texture) => void): Texture | null {
    const cached = faceTextures.get(value)
    if (cached) return cached
    const waiting = faceWaiters.get(value)
    if (waiting) {
      waiting.push(onReady)
      return null
    }
    faceWaiters.set(value, [onReady])

    const canvas = document.createElement('canvas')
    canvas.width = FACE_W
    canvas.height = FACE_H
    const ctx = canvas.getContext('2d')

    const finish = (image: HTMLImageElement | null): void => {
      if (ctx) drawCardFace(ctx, value, image)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4)
      faceTextures.set(value, texture)
      const notify = faceWaiters.get(value) ?? []
      faceWaiters.delete(value)
      for (const call of notify) call(texture)
    }

    const url = faceArtUrl(value)
    // 4096 以上的面值没有专属卡图：直接画一张只有数字的素卡
    if (!url) {
      finish(null)
      return null
    }

    const known = imageCache.get(url)
    if (known?.complete) {
      finish(known)
      return faceTextures.get(value) ?? null
    }

    const image = known ?? new Image()
    if (!known) {
      image.src = url
      imageCache.set(url, image)
    }
    image
      .decode()
      .then(() => finish(image))
      // 卡图加载失败不该让整局崩掉：退回素卡
      .catch(() => finish(null))
    return null
  }

  const cards = new Map<number, Group>()
  const faceMaterials = new Set<MeshStandardMaterial>()

  /**
   * 换掉某张牌的卡面。
   *
   * 合并时【必须】调它：合并保留的是 keeper 的 id，但它的数值变了（2+2 → 4）。
   * 只让 keeper 滑过去而不换面的话，牌上还画着旧数字 —— 看起来就像「合了还是原数」。
   */
  function setFace(group: Group, value: number): void {
    const material = group.userData.material as MeshStandardMaterial | undefined
    if (!material) return
    group.userData.value = value
    const apply = (texture: Texture): void => {
      material.map = texture
      material.color.set(0xffffff)
      material.needsUpdate = true
    }
    const ready = ensureFace(value, apply)
    if (ready) apply(ready)
  }

  function makeCard(value: number): Group {
    const group = new THREE.Group()
    // 悬停起伏的相位：存在 mesh 上，牌进牌出都不会让别的牌跳一下
    group.userData.phase = Math.random() * Math.PI * 2

    // ① 白色底座：跟着牌走的那一块
    const pedestal = new THREE.Mesh(pedestalGeometry, pedestalMaterial)
    pedestal.position.y = PEDESTAL_H / 2
    pedestal.castShadow = true
    pedestal.receiveShadow = true
    group.add(pedestal)

    // ② 卡牌本体挂在里面这一层，好让它相对底座浮起来（起伏只动这一层，底座留在台面上）
    const card = new THREE.Group()
    card.position.y = CARD_LIFT
    group.add(card)
    group.userData.card = card

    const material = new THREE.MeshStandardMaterial({ color: 0x3a2a16, roughness: 0.6, metalness: 0.05 })
    faceMaterials.add(material)

    /*
     * 卡面【直接贴在盒子的 +Z 面上】，不再另铺一层平面。
     *
     * 原先那层平面与盒面只差 0.0016，而相机近裁剪面是 0.1、远的 160 —— 深度精度被拉得
     * 很差，手机（16 位深度缓冲）上两个面会互相穿插（z-fighting），
     * 表现就是卡面上快速闪动的黑色长条。
     * BoxGeometry 的材质顺序是 [+x, -x, +y, -y, +z, -z]，所以正面是第 5 个（下标 4）。
     */
    const frontMaterials = [
      bodyMaterial,
      bodyMaterial,
      bodyMaterial,
      bodyMaterial,
      material,
      bodyMaterial,
    ]
    const body = new THREE.Mesh(bodyGeometry, frontMaterials)
    body.position.y = CARD_H / 2
    body.castShadow = true
    // 牌【不接阴影】：它只会接自己的影子（自阴影 acne），既不好看，也是闪动的来源之一
    body.receiveShadow = false
    card.add(body)

    group.userData.material = material
    setFace(group, value)

    return group
  }

  /**
   * 数值标签（HTML 浮层，不是画在卡面上的）。
   *
   * 卡是竖着立起来的：1.5 高，而每排只隔 0.92 —— 前排必然挡住后排卡面的下半截。
   * 数字画在卡上就注定看不全（上一版就是这样）。改成浮层钉在【白底座的前缘】，
   * 它在 DOM 里、永远压在最上层，谁也挡不住。
   */
  /**
   * 数值锚点：底座顶面【靠左、偏后一点】。
   *
   * z 取在前缘之内（PEDESTAL_D/2 减去一段）—— 之前是 +0.14、整个药丸挂在底座外面，
   * 看起来像悬空掉出去。收进来之后它落在白底座的顶面上，也在屏幕上更靠上。
   */
  const labelAnchor = new THREE.Vector3(
    // 贴住底座的左边缘，只留一点点内缩
    -PEDESTAL_W / 2 + 0.1,
    PEDESTAL_H + 0.02,
    PEDESTAL_D / 2 - 0.16,
  )
  const projected = new THREE.Vector3()
  let labelsDirty = true
  let labelSignature = ''

  function refreshLabels(): void {
    const width = stage.clientWidth
    const height = stage.clientHeight
    if (width === 0 || height === 0) return

    const next: CardLabel[] = []
    for (const [id, group] of cards) {
      const value = group.userData.value as number | undefined
      if (!value) continue
      projected.copy(labelAnchor).add(group.position).project(camera)
      next.push({
        id,
        value,
        x: Math.round((projected.x * 0.5 + 0.5) * width),
        y: Math.round((-projected.y * 0.5 + 0.5) * height),
      })
    }
    next.sort((a, b) => a.id - b.id)

    // 只在真的变了才写回：否则每帧都触发 Vue 重渲染，白白烧性能
    const signature = next.map((item) => `${item.id}:${item.value}:${item.x}:${item.y}`).join('|')
    if (signature !== labelSignature) {
      labelSignature = signature
      labels.value = next
    }
  }
  function placeCard(group: Group, row: number, col: number): void {
    group.position.set(slotX(col, boardSize), 0, slotZ(row, boardSize))
  }

  /** 把一批方块挂到场里（开局 / 重开用） */
  function reset(state: GameState): void {
    // 换难度会连带换边长 —— 先把台面按新尺寸重建，再摆牌
    applyBoardSize(DIFFICULTY[state.difficulty].size)
    for (const group of cards.values()) scene.remove(group)
    cards.clear()
    for (const tile of state.tiles) {
      const group = makeCard(tile.value)
      placeCard(group, tile.row, tile.col)
      scene.add(group)
      cards.set(tile.id, group)
    }
    labelsDirty = true
    resize() // 尺寸变了，重新取景
  }

  /* ------------------------------- 动画驱动 ------------------------------- */
  let updaters: Array<(now: number) => boolean> = []

  function animate(ms: number, onUpdate: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now()
      const step = (now: number): boolean => {
        const raw = Math.min(1, (now - start) / ms)
        onUpdate(raw)
        if (raw >= 1) {
          resolve()
          return false
        }
        return true
      }
      updaters.push(step)
    })
  }

  const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3
  const easeOutBack = (t: number): number => {
    const c1 = 1.70158
    const c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  }

  const toVec = new THREE.Vector3()

  async function playMove(outcome: MoveOutcome): Promise<void> {
    const sliders: Group[] = []
    const slides: Array<{ group: Group; from: Vector3; to: Vector3 }> = []

    // 1) 留下来的方块：滑到新格
    for (const tile of outcome.state.tiles) {
      const group = cards.get(tile.id)
      if (!group) continue
      toVec.set(slotX(tile.col, boardSize), 0, slotZ(tile.row, boardSize))
      if (group.position.distanceToSquared(toVec) > 1e-8) {
        slides.push({ group, from: group.position.clone(), to: toVec.clone() })
        sliders.push(group)
      }
    }

    // 2) 被吞掉的方块：也滑到 keeper 那一格，滑完就撤掉（视觉上就是「合进去了」）
    const dying: Group[] = []
    for (const merge of outcome.merges) {
      const group = cards.get(merge.absorbed)
      cards.delete(merge.absorbed)
      if (!group) continue
      const keeper = outcome.state.tiles.find((tile) => tile.id === merge.keeper)
      if (keeper) {
        toVec.set(slotX(keeper.col, boardSize), 0, slotZ(keeper.row, boardSize))
        slides.push({ group, from: group.position.clone(), to: toVec.clone() })
        sliders.push(group)
      }
      dying.push(group)
    }

    if (slides.length > 0) {
      await Promise.all(
        slides.map((slide) =>
          animate(SLIDE_MS, (t) => {
            slide.group.position.lerpVectors(slide.from, slide.to, easeOutCubic(t))
          }),
        ),
      )
    }
    for (const group of dying) scene.remove(group)

    // 合并落地：keeper 的数值变了，卡面必须跟着换（见 setFace 的注释）
    for (const merge of outcome.merges) {
      const keeperGroup = cards.get(merge.keeper)
      if (keeperGroup) setFace(keeperGroup, merge.value)
    }

    // 3) 新方块：等滑完再弹出来，免得抢镜头
    const popups: Promise<void>[] = []
    if (outcome.spawned) {
      const group = makeCard(outcome.spawned.value)
      placeCard(group, outcome.spawned.row, outcome.spawned.col)
      group.scale.setScalar(0.001)
      scene.add(group)
      cards.set(outcome.spawned.id, group)
      popups.push(animate(SPAWN_MS, (t) => group.scale.setScalar(easeOutBack(t))))
    }

    // 4) 合并后的那张牌顶一下，给一点手感
    for (const merge of outcome.merges) {
      const group = cards.get(merge.keeper)
      if (!group) continue
      popups.push(animate(POP_MS, (t) => group.scale.setScalar(1 + 0.15 * Math.sin(Math.PI * t))))
    }

    await Promise.all(popups)
    labelsDirty = true
  }

  /* -------------------------------- 尺寸 -------------------------------- */
  function resize(): void {
    const width = stage.clientWidth
    const height = stage.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    fitCamera(width / height)
    labelsDirty = true
  }

  const observer = new ResizeObserver(resize)
  observer.observe(stage)
  resize()

  /* -------------------------------- 主循环 -------------------------------- */
  let raf = 0
  function tick(now: number): void {
    raf = requestAnimationFrame(tick)
    const animating = updaters.length > 0
    if (animating) updaters = updaters.filter((step) => step(now))
    if (animating || labelsDirty) {
      labelsDirty = false
      refreshLabels()
    }
    // 悬停起伏：整片棋盘的牌轻轻浮着，每张相位不同
    for (const group of cards.values()) {
      const phase = (group.userData.phase as number) ?? 0
      const card = group.userData.card as Group | undefined
      if (card) card.position.y = CARD_LIFT + Math.sin(now * BOB_SPEED + phase) * BOB_AMPLITUDE
    }
    renderer.render(scene, camera)
  }
  raf = requestAnimationFrame(tick)

  reset(props.initial)
  api.value = { playMove, reset }
  emit('ready')

  teardown = (): void => {
    cancelAnimationFrame(raf)
    observer.disconnect()
    for (const group of cards.values()) scene.remove(group)
    cards.clear()
    for (const material of faceMaterials) material.dispose()
    for (const texture of faceTextures.values()) texture.dispose()
    for (const item of disposeList) item.dispose()
    pmrem.dispose()
    scene.environment = null
    renderer.dispose()
  }
})

onBeforeUnmount(() => {
  teardown?.()
  teardown = null
})

defineExpose({
  playMove(outcome: MoveOutcome): Promise<void> {
    return api.value?.playMove(outcome) ?? Promise.resolve()
  },
  reset(state: GameState): void {
    api.value?.reset(state)
  },
})
</script>

<template>
  <div ref="stageRef" class="card-table">
    <canvas ref="canvasRef" class="card-table__canvas" role="img" aria-label="2048 牌桌（3D 渲染）" />

    <!--
      数值浮层：钉在每块白底座的前缘。
      做成 DOM 而不是画在卡面上，是为了「永远可见」—— 它在最上层，谁也挡不住。
    -->
    <div class="card-table__labels" aria-hidden="true">
      <span
        v-for="label in labels"
        :key="label.id"
        class="card-table__label"
        :style="{ left: `${label.x}px`, top: `${label.y}px` }"
        >{{ label.value }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.card-table {
  position: absolute;
  inset: 0;
}

.card-table__canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.card-table__labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/*
 * 数值牌：木牌配色 —— 跟牌桌同一个暖褐色系（比牌桌深一档），
 * 这样压在近乎白色的底座上才分得开。早先是米白底，跟底座糊在一起了。
 */
.card-table__label {
  position: absolute;
  /* 从左边缘往右排：长数字（2048、4096）也不会越出底座左边 */
  transform: translate(0, -50%);
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(74, 48, 18, 0.5);
  background: linear-gradient(180deg, #cfae74 0%, #b28b4f 100%);
  color: #33240f;
  font-family: var(--font-display, Georgia, serif);
  font-size: 13px;
  font-weight: 700;
  line-height: 18px;
  white-space: nowrap;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
</style>