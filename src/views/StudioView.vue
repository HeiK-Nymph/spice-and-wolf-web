<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  deleteImage,
  deleteUpload,
  deriveCrop,
  fetchStudioConfig,
  fetchStudioHistory,
  generateImages,
  renameImage,
  uploadRefs,
} from '@/data/studio.source'
import ConfirmDialog from '@/components/ConfirmDialog.vue'
import type {
  StudioConfig,
  StudioHistoryEntry,
  StudioImage,
  StudioJob,
  StudioMode,
  UploadedRef,
} from '@/types/studio'
import { PHONE_QUERY, isPhoneViewport } from '@/utils/viewport'

/** 出图后必须逐项核对的清单（见 AGENTS.md） */
const QC_ITEMS = [
  '角色数量对不对，有没有多余的人或动物',
  '发色是否符合重制版设定',
  '瞳色是否正确（赫萝 / 缪莉为红瞳）',
  '服装是否合中世纪设定，有没有现代服装',
  '像不像 2024 重制版，而不是 2008 旧版',
]

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8

/** 兜底空配置：模板在 ready 之前要能安全取字段，避免到处写可选链 */
const EMPTY_CONFIG: StudioConfig = {
  configured: false,
  model: '',
  sizes: [],
  qualities: [],
  maxBatch: 4,
  maxRefImages: 4,
  maxPromptLength: 2000,
  pricePerImage: 0,
  characters: [],
  bannedWords: [],
  characterModeRules: [],
}

interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

const config = ref<StudioConfig>(EMPTY_CONFIG)
const loading = ref(true)
const loadError = ref('')
const notice = ref('')

/** 竖屏手机：三面板工作台塞不下，这一页降级成提示页（见模板与末尾样式） */
const isPhone = ref(isPhoneViewport())

/* ---------------- 表单状态 ---------------- */
const mode = ref<StudioMode>('character')
const selectedCharacters = ref<string[]>([])
const userPrompt = ref('')
const size = ref('1024x1024')
const quality = ref('low')
const count = ref(1)

const uploadedRefs = ref<UploadedRef[]>([])
const uploadError = ref('')
const uploading = ref(false)
const dragActive = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

/* ---------------- 生成 / 历史 ---------------- */
const generating = ref(false)
const elapsedMs = ref(0)
const genError = ref('')
const results = ref<StudioImage[]>([])
const activeIndex = ref(0)
const lastJob = ref<StudioJob | null>(null)
const history = ref<StudioHistoryEntry[]>([])
const historyError = ref('')

/* ---------------- 面板尺寸 / 折叠 ---------------- */
const leftWidth = ref(370)
const bottomHeight = ref(220)
const leftCollapsed = ref(false)
const bottomCollapsed = ref(false)

/* ---------------- 画布 ---------------- */
const stageEl = ref<HTMLElement | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const natural = ref({ w: 0, h: 0 })
const stageSize = ref({ w: 0, h: 0 })
const autoFit = ref(true)

/* ---------------- 裁剪 ---------------- */
const cropMode = ref(false)
const cropRect = ref<CropRect | null>(null)
const deriving = ref(false)
const cropError = ref('')

/* ---------------- 整体重绘（以当前图为参考，整张重生成） ---------------- */
const redrawOpen = ref(false)
const redrawPrompt = ref('')
const redrawError = ref('')
const redrawing = ref(false)

/* ---------------- 重命名 / 删除 ---------------- */
const renameOpen = ref(false)
const renameValue = ref('')
const renameError = ref('')
const renaming = ref(false)
const deleteTarget = ref<{ files: string[]; label: string } | null>(null)
const deleting = ref(false)
const deleteError = ref('')
const imgMissing = ref(false)

let timer: number | undefined
let resizeObserver: ResizeObserver | undefined
let phoneMql: MediaQueryList | undefined

/* ============================ 计算属性 ============================ */
const characters = computed(() => config.value.characters)
const bannedWords = computed(() => config.value.bannedWords)
const rules = computed(() => config.value.characterModeRules)

const pickedCharacters = computed(() =>
  characters.value.filter((character) => selectedCharacters.value.includes(character.id)),
)

function aliasHit(text: string, alias: string): boolean {
  const lower = alias.toLowerCase()
  if (/^[a-z]+$/.test(lower)) return new RegExp(`\\b${lower}\\b`).test(text)
  return text.includes(lower)
}

/**
 * 最终提示词的只读预览。
 * 与服务端 composeCharacterPrompt 用同一套规则；服务端在生成时会重新组装一份，
 * 所以这里算错也只是显示差异，不会真的发错提示词。
 */
const previewPrompt = computed(() => {
  const text = userPrompt.value.trim()
  if (mode.value === 'free') return text
  if (!text) return ''
  const parts = [text.replace(/[。\s]+$/u, '')]
  for (const character of pickedCharacters.value) parts.push(character.appearance)
  parts.push(...rules.value)
  return `${parts.join('。')}。`
})

const mentionedUnselected = computed(() => {
  if (mode.value !== 'character') return []
  const lower = userPrompt.value.toLowerCase()
  return characters.value.filter(
    (character) =>
      !selectedCharacters.value.includes(character.id) &&
      character.aliases.some((alias) => aliasHit(lower, alias)),
  )
})

const bannedHits = computed(() => {
  const lower = userPrompt.value.toLowerCase()
  return bannedWords.value.filter((item) => lower.includes(item.word.toLowerCase()))
})

const problems = computed(() => {
  const list: string[] = []
  if (userPrompt.value.trim().length < 4) list.push('提示词至少 4 个字。')
  if (mode.value === 'character') {
    if (selectedCharacters.value.length === 0) list.push('角色模式至少要勾选一个角色。')
    if (mentionedUnselected.value.length > 0) {
      list.push(
        `提示词提到了未勾选的角色：${mentionedUnselected.value.map((item) => item.label).join('、')}。请勾选 TA，或改写提示词。`,
      )
    }
    if (bannedHits.value.length > 0) {
      list.push(
        `含现代服装词：${bannedHits.value.map((item) => `「${item.word}」`).join('、')}，请改写。`,
      )
    }
    if (previewPrompt.value.length > config.value.maxPromptLength) {
      list.push('最终提示词过长，请把场景描述写短一些。')
    }
  }
  return list
})

const freeHints = computed(() =>
  mode.value === 'free' ? bannedHits.value.map((item) => item.word) : [],
)

const ready = computed(() => config.value.configured)
const canGenerate = computed(() => ready.value && !generating.value && problems.value.length === 0)
const estimatedCost = computed(() => config.value.pricePerImage * count.value)
const elapsedLabel = computed(() => `${elapsedMs.value.toLocaleString('zh-CN')} ms`)

const currentImage = computed<StudioImage | null>(() => results.value[activeIndex.value] ?? null)

/*
 * 只给宽度、高度交给浏览器按真实比例推导：
 * 这样即使 natural 还是上一张图的数据（切换瞬间），也绝不会拉伸变形。
 */
const imgStyle = computed(() => ({
  width: natural.value.w ? `${natural.value.w}px` : 'auto',
  height: 'auto',
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${zoom.value})`,
}))

const zoomLabel = computed(() => `${Math.round(zoom.value * 100)}%`)

const cropStyle = computed(() => {
  const c = cropRect.value
  if (!c) return {}
  return {
    left: `${panX.value + c.x * zoom.value}px`,
    top: `${panY.value + c.y * zoom.value}px`,
    width: `${c.w * zoom.value}px`,
    height: `${c.h * zoom.value}px`,
  }
})

const cropSizeLabel = computed(() => {
  const c = cropRect.value
  if (!c) return ''
  return `${Math.round(c.w)} × ${Math.round(c.h)}`
})
/* ============================ 工具函数 ============================ */
function basename(url: string): string {
  return url.split('/').pop() ?? url
}

function timeLabel(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** 历史标签：优先看 kind（裁剪 / 重绘），否则按模式 */
function entryLabel(entry: StudioHistoryEntry): string {
  if (entry.kind === 'crop') return '裁剪'
  if (entry.kind === 'redraw') return '重绘'
  return entry.mode === 'free' ? '自由' : '角色'
}

function startTimer(): void {
  elapsedMs.value = 0
  const startedAt = performance.now()
  timer = window.setInterval(() => {
    elapsedMs.value = Math.round(performance.now() - startedAt)
  }, 100)
}

function stopTimer(): void {
  if (timer !== undefined) {
    window.clearInterval(timer)
    timer = undefined
  }
}

function flash(message: string): void {
  notice.value = message
  window.setTimeout(() => {
    if (notice.value === message) notice.value = ''
  }, 2600)
}

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

/* ============================ 配置 ============================ */
async function loadConfig(): Promise<void> {
  loading.value = true
  loadError.value = ''
  try {
    config.value = await fetchStudioConfig()
    if (!config.value.sizes.includes(size.value)) size.value = config.value.sizes[0]
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loading.value = false
  }
}

async function loadHistory(): Promise<void> {
  historyError.value = ''
  try {
    history.value = await fetchStudioHistory()
  } catch (error) {
    historyError.value = error instanceof Error ? error.message : String(error)
  }
}

/* ============================ 面板拖拽 ============================ */
function beginDrag(event: MouseEvent, onMove: (ev: MouseEvent) => void): void {
  event.preventDefault()
  const move = (ev: MouseEvent) => onMove(ev)
  const up = () => {
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mouseup', up)
}

function onLeftGutter(event: MouseEvent): void {
  const startX = event.clientX
  const startWidth = leftWidth.value
  beginDrag(event, (ev) => {
    leftWidth.value = Math.min(640, Math.max(280, startWidth + (ev.clientX - startX)))
  })
}

function onBottomGutter(event: MouseEvent): void {
  const startY = event.clientY
  const startHeight = bottomHeight.value
  beginDrag(event, (ev) => {
    bottomHeight.value = Math.min(560, Math.max(120, startHeight - (ev.clientY - startY)))
  })
}

/* ============ 画布：测量 / 适应 / 缩放 / 平移 ============ */
function measureStage(): void {
  const el = stageEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  stageSize.value = { w: rect.width, h: rect.height }
}

function centerImage(): void {
  const { w, h } = natural.value
  const { w: cw, h: ch } = stageSize.value
  panX.value = (cw - w * zoom.value) / 2
  panY.value = (ch - h * zoom.value) / 2
}

function fitToWindow(): void {
  measureStage()
  const { w, h } = natural.value
  const { w: cw, h: ch } = stageSize.value
  if (!w || !h || !cw || !ch) return
  const pad = 0.94
  zoom.value = clampZoom(Math.min((cw * pad) / w, (ch * pad) / h))
  centerImage()
  autoFit.value = true
}

function resetOneToOne(): void {
  measureStage()
  zoom.value = 1
  centerImage()
  autoFit.value = false
}

function onImgLoad(): void {
  const el = imgEl.value
  if (!el) return
  imgMissing.value = false
  natural.value = { w: el.naturalWidth, h: el.naturalHeight }
  fitToWindow()
}

/** 图片文件在磁盘上没了：画布给个明确提示，而不是一张破图 */
function onImgError(): void {
  imgMissing.value = true
  natural.value = { w: 0, h: 0 }
}

/** 屏幕坐标 → 图片自然坐标 */
function toImage(sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - panX.value) / zoom.value, y: (sy - panY.value) / zoom.value }
}

function onWheel(event: WheelEvent): void {
  if (!natural.value.w) return
  measureStage()
  const el = stageEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const mx = event.clientX - rect.left
  const my = event.clientY - rect.top
  const anchor = toImage(mx, my)
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
  zoom.value = clampZoom(zoom.value * factor)
  // 以鼠标位置为锚点：缩放前后，鼠标下的图片坐标保持不变
  panX.value = mx - anchor.x * zoom.value
  panY.value = my - anchor.y * zoom.value
  autoFit.value = false
}

type DragState = {
  mode: 'pan' | 'crop'
  startX: number
  startY: number
  startPanX: number
  startPanY: number
  startImgX: number
  startImgY: number
}
let dragState: DragState | null = null

function onStageDown(event: MouseEvent): void {
  if (!currentImage.value || !natural.value.w || event.button !== 0) return
  measureStage()
  const el = stageEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const mx = event.clientX - rect.left
  const my = event.clientY - rect.top
  const point = toImage(mx, my)

  if (cropMode.value) {
    cropRect.value = { x: point.x, y: point.y, w: 0, h: 0 }
    dragState = {
      mode: 'crop',
      startX: mx,
      startY: my,
      startPanX: 0,
      startPanY: 0,
      startImgX: point.x,
      startImgY: point.y,
    }
  } else {
    dragState = {
      mode: 'pan',
      startX: mx,
      startY: my,
      startPanX: panX.value,
      startPanY: panY.value,
      startImgX: point.x,
      startImgY: point.y,
    }
  }
  window.addEventListener('mousemove', onStageMove)
  window.addEventListener('mouseup', onStageUp)
}

function onStageMove(event: MouseEvent): void {
  if (!dragState) return
  const el = stageEl.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const mx = event.clientX - rect.left
  const my = event.clientY - rect.top

  if (dragState.mode === 'pan') {
    panX.value = dragState.startPanX + (mx - dragState.startX)
    panY.value = dragState.startPanY + (my - dragState.startY)
    autoFit.value = false
    return
  }

  const point = toImage(mx, my)
  const x = Math.max(0, Math.min(dragState.startImgX, point.x))
  const y = Math.max(0, Math.min(dragState.startImgY, point.y))
  const x2 = Math.min(natural.value.w, Math.max(dragState.startImgX, point.x))
  const y2 = Math.min(natural.value.h, Math.max(dragState.startImgY, point.y))
  cropRect.value = { x, y, w: x2 - x, h: y2 - y }
}

function onStageUp(): void {
  dragState = null
  window.removeEventListener('mousemove', onStageMove)
  window.removeEventListener('mouseup', onStageUp)
  const c = cropRect.value
  if (c && (c.w < 8 || c.h < 8)) cropRect.value = null
}

function toggleCropMode(): void {
  cropMode.value = !cropMode.value
  if (!cropMode.value) cropRect.value = null
  cropError.value = ''
}
/* ============ 裁剪：应用 / 设为参考图 ============ */
async function applyCrop(): Promise<void> {
  const img = imgEl.value
  const c = cropRect.value
  if (!img || !c || c.w < 8 || c.h < 8) return
  deriving.value = true
  cropError.value = ''
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(c.w)
    canvas.height = Math.round(c.h)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建画布上下文')
    ctx.drawImage(
      img,
      Math.round(c.x),
      Math.round(c.y),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('裁剪结果编码失败')

    const response = await deriveCrop({
      blob,
      source: currentImage.value ? basename(currentImage.value.url) : '',
      label: `裁剪 ${canvas.width}×${canvas.height}`,
      width: canvas.width,
      height: canvas.height,
    })
    results.value = response.images
    activeIndex.value = 0
    lastJob.value = response.job
    cropMode.value = false
    cropRect.value = null
    await loadHistory()
    await nextTick()
    flash('裁剪已存入历史。')
  } catch (error) {
    cropError.value = error instanceof Error ? error.message : String(error)
  } finally {
    deriving.value = false
  }
}

function useAsReference(): void {
  const image = currentImage.value
  if (!image) return
  const id = basename(image.url)
  if (uploadedRefs.value.some((item) => item.id === id)) {
    flash('这张已经在参考图里了。')
    return
  }
  if (uploadedRefs.value.length >= config.value.maxRefImages) {
    uploadError.value = `参考图最多 ${config.value.maxRefImages} 张。`
    return
  }
  uploadedRefs.value.push({ id, url: image.url, name: `产物 ${id}`, size: 0 })
  mode.value = 'free'
  flash('已加入参考图（自由模式才会用它）。')
}

function openRename(): void {
  const image = currentImage.value
  if (!image) return
  renameValue.value = basename(image.url).replace(/\.[^.]+$/, '')
  renameOpen.value = true
  renameError.value = ''
}

async function submitRename(): Promise<void> {
  const image = currentImage.value
  const next = renameValue.value.trim()
  if (!image || !next) return
  const oldName = basename(image.url)
  renaming.value = true
  renameError.value = ''
  try {
    const result = await renameImage(oldName, next)
    for (const item of results.value) {
      if (basename(item.url) === oldName) item.url = result.url
    }
    renameOpen.value = false
    await loadHistory()
    flash(result.renamed ? `已重命名为 ${result.name}` : '名字没有变化。')
  } catch (error) {
    renameError.value = error instanceof Error ? error.message : String(error)
  } finally {
    renaming.value = false
  }
}

function askDelete(files: string[], label: string): void {
  if (files.length === 0) return
  deleteError.value = ''
  deleteTarget.value = { files, label }
}

/** 工具栏「删除」：只删画布上当前这一张 */
function askDeleteCurrent(): void {
  const image = currentImage.value
  if (!image) return
  askDelete([basename(image.url)], lastJob.value?.userPrompt || basename(image.url))
}

/** 历史卡片右上角那颗：删掉这条记录里的全部图片 */
function askDeleteEntry(entry: StudioHistoryEntry): void {
  askDelete(
    entry.images.map((image) => basename(image.url)),
    entry.userPrompt,
  )
}

async function confirmDelete(): Promise<void> {
  const target = deleteTarget.value
  if (!target) return
  deleting.value = true
  deleteError.value = ''
  try {
    let failedCount = 0
    for (const filename of target.files) {
      try {
        await deleteImage(filename)
      } catch {
        failedCount += 1
      }
    }
    deleteTarget.value = null

    const removed = new Set(target.files)
    // 画布上如果正好是其中一张，清空；否则从当前结果集里摘掉
    const onCanvas = currentImage.value && removed.has(basename(currentImage.value.url))
    if (onCanvas) {
      results.value = []
      activeIndex.value = 0
      natural.value = { w: 0, h: 0 }
      imgMissing.value = false
    } else {
      results.value = results.value.filter((item) => !removed.has(basename(item.url)))
      if (activeIndex.value >= results.value.length) activeIndex.value = 0
    }
    await loadHistory()
    flash(failedCount > 0 ? `已删除，但有 ${failedCount} 张没能删掉。` : '已删除。')
  } catch (error) {
    deleteError.value = error instanceof Error ? error.message : String(error)
  } finally {
    deleting.value = false
  }
}

function toggleRedraw(): void {
  redrawOpen.value = !redrawOpen.value
  redrawError.value = ''
}

/**
 * 整体重绘：把当前画布这张图当参考图，配上改动描述，整张重新生成。
 * 不做任何区域蒙版——上游 mask 实测不按标准语义工作。
 */
async function runRedraw(): Promise<void> {
  const image = currentImage.value
  if (!image || redrawPrompt.value.trim().length < 4) return
  redrawError.value = ''
  results.value = []
  activeIndex.value = 0
  redrawing.value = true
  generating.value = true
  startTimer()
  try {
    const response = await generateImages({
      mode: 'free',
      prompt: redrawPrompt.value,
      characters: [],
      refs: [basename(image.url)],
      size: size.value,
      quality: quality.value,
      n: 1,
      intent: 'redraw',
    })
    results.value = response.images
    activeIndex.value = 0
    lastJob.value = response.job
    redrawOpen.value = false
    redrawPrompt.value = ''
    await loadHistory()
  } catch (error) {
    redrawError.value = error instanceof Error ? error.message : String(error)
  } finally {
    redrawing.value = false
    generating.value = false
    stopTimer()
  }
}

/* ============================ 角色 / 上传 ============================ */
function toggleCharacter(id: string): void {
  const index = selectedCharacters.value.indexOf(id)
  if (index >= 0) selectedCharacters.value.splice(index, 1)
  else selectedCharacters.value.push(id)
}

function openFileDialog(): void {
  fileInput.value?.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  void addFiles(input.files)
}

function onDrop(event: DragEvent): void {
  dragActive.value = false
  void addFiles(event.dataTransfer?.files ?? null)
}

async function addFiles(list: FileList | null): Promise<void> {
  if (!list || list.length === 0) return
  uploadError.value = ''
  const max = config.value.maxRefImages
  const room = max - uploadedRefs.value.length
  if (room <= 0) {
    uploadError.value = `参考图最多 ${max} 张。`
    return
  }
  const files = Array.from(list).slice(0, room)
  uploading.value = true
  try {
    const result = await uploadRefs(files)
    uploadedRefs.value.push(...result.files)
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : String(error)
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function removeRef(item: UploadedRef): Promise<void> {
  uploadedRefs.value = uploadedRefs.value.filter((ref) => ref.id !== item.id)
  // 产物（裁剪结果）不在 uploads 目录里，删不动是正常的
  if (item.size === 0) return
  try {
    await deleteUpload(item.id)
  } catch {
    // 文件可能已经被清理，删不掉就算了
  }
}

/* ============================ 生成 ============================ */
async function generate(): Promise<void> {
  if (!canGenerate.value) return
  genError.value = ''
  results.value = []
  activeIndex.value = 0
  generating.value = true
  startTimer()
  try {
    const response = await generateImages({
      mode: mode.value,
      prompt: userPrompt.value,
      characters: mode.value === 'character' ? selectedCharacters.value : [],
      refs: mode.value === 'free' ? uploadedRefs.value.map((item) => item.id) : [],
      size: size.value,
      quality: quality.value,
      n: count.value,
    })
    results.value = response.images
    activeIndex.value = 0
    lastJob.value = response.job
    await loadHistory()
  } catch (error) {
    genError.value = error instanceof Error ? error.message : String(error)
  } finally {
    generating.value = false
    stopTimer()
  }
}

/* ============================ 历史 ============================ */
function showHistoryEntry(entry: StudioHistoryEntry): void {
  lastJob.value = entry
  results.value = entry.images.map((image) => ({
    id: image.id,
    url: image.url,
    size: image.size,
    quality: entry.quality,
    model: entry.model,
    prompt: entry.prompt,
    createdAt: Date.parse(entry.createdAt),
  }))
  activeIndex.value = 0
}

function selectImage(index: number): void {
  activeIndex.value = index
}

/* ============================ 生命周期 ============================ */
function syncPhone(): void {
  isPhone.value = phoneMql?.matches ?? false
}

onMounted(() => {
  phoneMql = window.matchMedia(PHONE_QUERY)
  phoneMql.addEventListener('change', syncPhone)
  void loadConfig()
  void loadHistory()
})

watch(stageEl, (el) => {
  resizeObserver?.disconnect()
  if (!el) return
  resizeObserver = new ResizeObserver(() => {
    measureStage()
    if (autoFit.value) fitToWindow()
  })
  resizeObserver.observe(el)
  measureStage()
  if (natural.value.w) fitToWindow()
})

onBeforeUnmount(() => {
  phoneMql?.removeEventListener('change', syncPhone)
  if (timer !== undefined) window.clearInterval(timer)
  resizeObserver?.disconnect()
})
</script>
<template>
  <div class="studio">
    <p v-if="loading" class="studio__note">正在读取画坊配置…</p>
    <p v-else-if="loadError" class="studio__alert studio__alert--pad">{{ loadError }}</p>
    <p v-else-if="!ready" class="studio__alert studio__alert--pad">
      服务端没有配置 TOKENWORLD_API_KEY，先补上 <code>.env</code> 再来。
    </p>

    <!-- 竖屏手机：工作台要同时摆下三块面板 + 拖拽调宽，手机上塞不下也没法改图，
         按「提示页」处理（判定与样式见本文件末尾的手机块） -->
    <div v-else-if="isPhone" class="studio__mobile">
      <p class="studio__mobile-kicker display">画坊 · 绘图工作台</p>
      <h2 class="studio__mobile-title">画案要摊在桌上</h2>
      <p class="studio__mobile-body">
        「角色设定 / 画布 / 生成历史」三块板子要并排摊开，还得拖拽调宽 ——
        手上这块竖屏摊不下，也没有落笔改画的余地。
      </p>
      <p class="studio__mobile-body">
        请在电脑上打开这一页 —— 桌面宽敞，才好接着给赫萝与罗伦斯画新的画片。
      </p>
      <p class="studio__mobile-note">画片不赶时间 —— 等你回到桌前，再落笔。</p>
      <div class="studio__mobile-actions">
        <RouterLink class="btn btn--primary" to="/">回到旅途地图</RouterLink>
        <RouterLink class="btn btn--ghost" to="/market">去商行看看牌价</RouterLink>
      </div>
    </div>

    <div v-else class="shell">
      <!-- ==================== 左：工作台 ==================== -->
      <aside class="pane pane--left" :style="{ width: leftCollapsed ? '46px' : `${leftWidth}px` }">
        <div class="pane__bar">
          <button type="button" class="pane__toggle" @click="leftCollapsed = !leftCollapsed">
            {{ leftCollapsed ? '»' : '«' }}
          </button>
          <span v-if="!leftCollapsed" class="pane__title">工作台</span>
          <span v-if="!leftCollapsed && notice" class="pane__notice">{{ notice }}</span>
        </div>

        <div v-if="!leftCollapsed" class="pane__body">
          <div class="tabs">
            <button
              v-for="tab in ['character', 'free'] as StudioMode[]"
              :key="tab"
              type="button"
              class="tabs__btn"
              :class="{ 'is-active': mode === tab }"
              @click="mode = tab"
            >
              {{ tab === 'character' ? '角色 · 强约束' : '自由 · 实验' }}
            </button>
          </div>

          <template v-if="mode === 'character'">
            <p class="label">角色（几个角色就勾几个，自动挂对应参考图）</p>
            <div class="chars">
              <button
                v-for="character in characters"
                :key="character.id"
                type="button"
                class="char"
                :class="{ 'is-on': selectedCharacters.includes(character.id) }"
                @click="toggleCharacter(character.id)"
              >
                <img class="char__img" :src="character.refUrl" :alt="character.label" />
                <span class="char__name">{{ character.label }}</span>
              </button>
            </div>
          </template>

          <template v-else>
            <p class="label">参考图（可选，最多 {{ config.maxRefImages }} 张）</p>
            <div
              class="drop"
              :class="{ 'is-active': dragActive, 'is-busy': uploading }"
              role="button"
              tabindex="0"
              @click="openFileDialog"
              @keydown.enter="openFileDialog"
              @dragover.prevent="dragActive = true"
              @dragleave.prevent="dragActive = false"
              @drop.prevent="onDrop"
            >
              <span v-if="uploading">上传中…</span>
              <span v-else-if="uploadedRefs.length === 0">点这里选图 / 拖进来</span>
              <span v-else>再加一张</span>
              <input
                ref="fileInput"
                class="drop__input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                @change="onFileChange"
              />
            </div>
            <ul v-if="uploadedRefs.length > 0" class="thumbs">
              <li v-for="item in uploadedRefs" :key="item.id" class="thumbs__item">
                <img :src="item.url" :alt="item.name" />
                <button type="button" class="thumbs__del" @click="removeRef(item)">×</button>
              </li>
            </ul>
            <p v-if="uploadError" class="studio__alert studio__alert--tight">{{ uploadError }}</p>
          </template>

          <label class="field">
            <span class="label">提示词（场景 / 动作 / 构图）</span>
            <textarea
              v-model="userPrompt"
              class="field__input"
              rows="4"
              :maxlength="config.maxPromptLength"
              placeholder="例如：赫萝在黄昏的麦田里回头微笑，半身构图，暖光"
            ></textarea>
          </label>

          <p v-if="freeHints.length > 0" class="warn">
            自由模式提示：出现了现代服装词 {{ freeHints.join('、') }}，可能不合项目设定。
          </p>

          <div class="preview">
            <div class="preview__head">最终提示词（只读 · 与生成时同规则拼装）</div>
            <pre class="preview__body">{{ previewPrompt || '（等待输入…）' }}</pre>
          </div>

          <ul v-if="problems.length > 0" class="problems">
            <li v-for="problem in problems" :key="problem">{{ problem }}</li>
          </ul>

          <div class="params">
            <label class="params__item">
              <span>尺寸</span>
              <select v-model="size">
                <option v-for="item in config.sizes" :key="item" :value="item">{{ item }}</option>
              </select>
            </label>
            <label class="params__item">
              <span>质量</span>
              <select v-model="quality">
                <option v-for="item in config.qualities" :key="item" :value="item">
                  {{ item }}
                </option>
              </select>
            </label>
            <label class="params__item">
              <span>张数</span>
              <select v-model.number="count">
                <option v-for="n in config.maxBatch" :key="n" :value="n">{{ n }}</option>
              </select>
            </label>
          </div>

          <div class="cost">
            预估花费 <strong>${{ estimatedCost.toFixed(2) }}</strong>
            <span class="cost__note">（${{ config.pricePerImage }} / 张）</span>
          </div>

          <button
            type="button"
            class="btn btn--primary gen-btn"
            :disabled="!canGenerate"
            @click="generate"
          >
            {{ generating ? '生成中…' : '开始生成' }}
          </button>

          <p v-if="generating" class="timer">
            已等待 {{ elapsedLabel }}
            <span class="timer__note">
              刷新/离开不会中止：这一张会画完并入历史。（没有取消按钮，因为颜料已经调好了）
            </span>
          </p>

          <p v-if="genError" class="studio__alert">{{ genError }}</p>

          <details class="qc">
            <summary>出图自检清单（AGENTS.md 硬约定）</summary>
            <ul>
              <li v-for="item in QC_ITEMS" :key="item">{{ item }}</li>
            </ul>
            <p class="qc__note">不合格就重出，别把「像但不是」的图当合格素材。</p>
          </details>
        </div>
      </aside>

      <div v-if="!leftCollapsed" class="gutter gutter--v" @mousedown="onLeftGutter"></div>

      <!-- ==================== 右：画布 + 历史 ==================== -->
      <div class="pane pane--right">
        <section class="pane pane--canvas">
          <div class="toolbar">
            <button
              type="button"
              class="tool"
              :class="{ 'is-on': cropMode }"
              :disabled="!currentImage"
              title="矩形框选，再点「应用裁剪」"
              @click="toggleCropMode"
            >
              裁剪
            </button>
            <button type="button" class="tool" :disabled="!cropRect" @click="applyCrop">
              {{ deriving ? '保存中…' : '应用裁剪' }}
            </button>
            <button type="button" class="tool" :disabled="!cropRect" @click="cropRect = null">
              清除选区
            </button>
            <span class="toolbar__sep"></span>
            <button type="button" class="tool" :disabled="!currentImage" @click="fitToWindow">
              适应窗口
            </button>
            <button type="button" class="tool" :disabled="!currentImage" @click="resetOneToOne">
              1:1
            </button>
            <span class="toolbar__zoom">{{ zoomLabel }}</span>
            <span v-if="natural.w" class="toolbar__dims">{{ natural.w }} × {{ natural.h }}</span>
            <span class="toolbar__sep"></span>
            <button type="button" class="tool" :disabled="!currentImage" @click="useAsReference">
              设为参考图
            </button>
            <button
              type="button"
              class="tool"
              :class="{ 'is-on': redrawOpen }"
              :disabled="!currentImage"
              title="以当前图为参考，整张重新生成"
              @click="toggleRedraw"
            >
              重绘整图
            </button>
            <span class="toolbar__sep"></span>
            <button type="button" class="tool" :disabled="!currentImage" @click="openRename">
              重命名
            </button>
            <button
              type="button"
              class="tool tool--danger"
              :disabled="!currentImage"
              @click="askDeleteCurrent"
            >
              删除
            </button>
            <span class="toolbar__spacer"></span>
            <span v-if="lastJob" class="toolbar__meta">
              {{ lastJob.kind === 'crop' ? '裁剪' : lastJob.model }} · {{ lastJob.size }}
              <template v-if="lastJob.kind !== 'crop'">
                · 用时 {{ lastJob.elapsedMs.toLocaleString('zh-CN') }} ms
              </template>
            </span>
          </div>

          <div v-if="renameOpen" class="redraw">
            <span class="redraw__label">重命名当前图片（扩展名保持不变）</span>
            <input
              v-model="renameValue"
              class="redraw__input"
              type="text"
              maxlength="60"
              placeholder="输入新的文件名"
              @keydown.enter="submitRename"
            />
            <div class="redraw__actions">
              <button
                type="button"
                class="tool tool--primary"
                :disabled="!renameValue.trim() || renaming"
                @click="submitRename"
              >
                {{ renaming ? '改名中…' : '确定' }}
              </button>
              <button type="button" class="tool" :disabled="renaming" @click="renameOpen = false">
                取消
              </button>
            </div>
            <p v-if="renameError" class="studio__alert studio__alert--tight">{{ renameError }}</p>
          </div>

          <div v-if="redrawOpen" class="redraw">
            <span class="redraw__label">重绘整图 · 以当前图为参考，整张重新生成</span>
            <textarea
              v-model="redrawPrompt"
              class="redraw__input"
              rows="2"
              placeholder="描述要改成什么样，例如：改成雨夜街道，保留人物与服装细节"
            ></textarea>
            <div class="redraw__actions">
              <button
                type="button"
                class="tool tool--primary"
                :disabled="redrawPrompt.trim().length < 4 || redrawing"
                @click="runRedraw"
              >
                {{ redrawing ? '重绘中…' : '开始重绘' }}
              </button>
              <button type="button" class="tool" :disabled="redrawing" @click="redrawOpen = false">
                取消
              </button>
              <span v-if="redrawing" class="redraw__timer">已等待 {{ elapsedLabel }}</span>
            </div>
            <p v-if="redrawError" class="studio__alert studio__alert--tight">{{ redrawError }}</p>
          </div>

          <div
            ref="stageEl"
            class="stage"
            :class="{ 'is-crop': cropMode }"
            @wheel.prevent="onWheel"
            @mousedown="onStageDown"
            @dblclick="resetOneToOne"
          >
            <img
              v-if="currentImage"
              ref="imgEl"
              class="stage__img"
              :src="currentImage.url"
              alt="生成结果"
              :style="imgStyle"
              draggable="false"
              @load="onImgLoad"
              @error="onImgError"
            />
            <p v-else class="stage__empty">还没有图。左边生成一张，或在下面的历史里点一条。</p>
            <div v-if="imgMissing" class="stage__missing">
              <p>这张图的文件已经不在了（可能在文件夹里被删掉了）。</p>
              <button type="button" class="tool" @click="loadHistory">刷新历史</button>
            </div>
            <div v-if="cropRect" class="cropbox" :style="cropStyle">
              <span class="cropbox__label">{{ cropSizeLabel }}</span>
            </div>
          </div>

          <div v-if="results.length > 1" class="filmstrip">
            <button
              v-for="(image, index) in results"
              :key="image.id"
              type="button"
              class="film"
              :class="{ 'is-on': index === activeIndex }"
              @click="selectImage(index)"
            >
              <img :src="image.url" alt="" loading="lazy" />
            </button>
          </div>

          <p v-if="cropError" class="studio__alert studio__alert--tight">{{ cropError }}</p>
        </section>

        <div v-if="!bottomCollapsed" class="gutter gutter--h" @mousedown="onBottomGutter"></div>

        <section
          class="pane pane--bottom"
          :style="{ height: bottomCollapsed ? '40px' : `${bottomHeight}px` }"
        >
          <div class="pane__bar">
            <button type="button" class="pane__toggle" @click="bottomCollapsed = !bottomCollapsed">
              {{ bottomCollapsed ? '˄' : '˅' }}
            </button>
            <span class="pane__title">生成历史</span>
            <span v-if="!bottomCollapsed" class="pane__count">{{ history.length }} 条</span>
            <button
              v-if="!bottomCollapsed"
              type="button"
              class="tool tool--mini"
              @click="loadHistory"
            >
              刷新
            </button>
          </div>

          <div v-if="!bottomCollapsed" class="pane__body pane__body--row">
            <p v-if="historyError" class="studio__alert studio__alert--tight">{{ historyError }}</p>
            <p v-else-if="history.length === 0" class="hint">还没有生成记录。</p>
            <template v-else>
              <article
                v-for="entry in history"
                :key="entry.id"
                class="hist"
                @click="showHistoryEntry(entry)"
              >
                <button
                  type="button"
                  class="hist__del"
                  title="删除这条记录"
                  @click.stop="askDeleteEntry(entry)"
                >
                  ×
                </button>
                <div class="hist__head">
                  <span
                    class="hist__badge"
                    :class="{
                      'is-crop': entry.kind === 'crop',
                      'is-redraw': entry.kind === 'redraw',
                    }"
                  >
                    {{ entryLabel(entry) }}
                  </span>
                  <span class="hist__time">{{ timeLabel(entry.createdAt) }}</span>
                </div>
                <div class="hist__thumbs">
                  <img
                    v-for="image in entry.images.slice(0, 3)"
                    :key="image.id"
                    :src="image.url"
                    alt=""
                    loading="lazy"
                  />
                </div>
                <p class="hist__prompt">{{ entry.userPrompt }}</p>
              </article>
            </template>
          </div>
        </section>
      </div>
    </div>

    <ConfirmDialog
      :open="deleteTarget !== null"
      title="删掉这张图？"
      :message="
        deleteTarget
          ? `将永久删除这条记录的全部 ${deleteTarget.files.length} 张图，并从生成历史里移除。此操作不可撤销。`
          : ''
      "
      confirm-text="删除"
      cancel-text="算了"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />
  </div>
</template>
<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.studio__note {
  padding: 1.5rem clamp(1.1rem, 4vw, 2.5rem);
  color: var(--text-muted);
}

.studio__alert--pad {
  margin: 1.5rem clamp(1.1rem, 4vw, 2.5rem);
}

.studio__alert {
  padding: 0.6rem 0.8rem;
  border: 1px solid rgba(208, 95, 74, 0.45);
  border-radius: var(--radius-sm);
  background: rgba(176, 67, 47, 0.14);
  color: #f0c9bd;
  font-size: 0.82rem;
  line-height: 1.6;
}

.studio__alert--tight {
  margin-top: 0.55rem;
}

/* ---------- 外壳 ---------- */
.shell {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: rgba(13, 10, 18, 0.42);
}

.pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: rgba(20, 16, 25, 0.72);
}

.pane--left {
  border-right: 1px solid var(--border);
  overflow: hidden;
  transition: width 0.18s ease;
}

.pane--right {
  flex: 1;
  background: transparent;
}

.pane--canvas {
  flex: 1;
  min-height: 0;
}

.pane--bottom {
  flex: none;
  border-top: 1px solid var(--border);
  background: rgba(20, 16, 25, 0.78);
}

.pane__bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: none;
  height: 38px;
  padding: 0 0.6rem;
  border-bottom: 1px solid var(--border);
  background: rgba(13, 10, 18, 0.5);
}

.pane__toggle {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid var(--border);
  color: var(--wheat-300);
  font-size: 0.85rem;
  line-height: 1;
  cursor: pointer;
}

.pane__title {
  font-family: var(--font-heading);
  font-size: 0.84rem;
  letter-spacing: 0.08em;
  color: var(--parchment-200);
}

.pane__count {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-dim);
}

.pane__notice {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--wheat-300);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pane__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0.8rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  /* 滚轮滚到头不要继续带动外层 */
  overscroll-behavior: contain;
  /* 与站点一致：隐藏系统默认滚动条 */
  scrollbar-width: none;
}

.pane__body::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

/*
 * 生成历史：卡片铺满可见的一行，满了就换下一行；行数超过面板高度时纵向滚动。
 * 原来这里是单行横向排（flex + 固定宽 190px），而全站约定又隐藏了系统滚动条，
 * 于是记录一多就「右边被切掉、滚轮也推不动」—— 只有 Shift+滚轮 / 触控板横滑才够得着。
 * 面板高度由拖拽分隔条决定，所以滚动交给这里。
 */
.pane__body--row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  align-content: start;
  gap: 0.6rem;
  padding: 0.7rem;
  overflow-x: hidden;
  overflow-y: auto;
  /* 例外：这一块把系统滚动条显出来（细、配主题色）。
     能滚却看不见，正是上面那个 bug 的成因，滚动条在这里是必须的提示。 */
  scrollbar-width: thin;
  scrollbar-color: rgba(233, 185, 92, 0.45) transparent;
}

.pane__body--row::-webkit-scrollbar {
  width: 8px;
  height: 8px;
  display: block;
}

.pane__body--row::-webkit-scrollbar-track {
  background: transparent;
}

.pane__body--row::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(233, 185, 92, 0.38);
}

.pane__body--row::-webkit-scrollbar-thumb:hover {
  background: rgba(233, 185, 92, 0.62);
}

/* ---------- 分隔条 ---------- */
.gutter {
  flex: none;
  background: transparent;
  transition: background 0.18s ease;
}

.gutter:hover {
  background: rgba(233, 185, 92, 0.45);
}

.gutter--v {
  width: 6px;
  cursor: col-resize;
}

.gutter--h {
  height: 6px;
  cursor: row-resize;
}

/* ---------- 左栏内容 ---------- */
.tabs {
  display: flex;
  gap: 0.3rem;
  padding: 0.25rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(13, 10, 18, 0.6);
}

.tabs__btn {
  flex: 1;
  padding: 0.45rem 0.6rem;
  border-radius: 999px;
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
  transition:
    color 0.2s ease,
    background 0.2s ease;
}

.tabs__btn.is-active {
  color: #21160a;
  font-weight: 700;
  background: linear-gradient(135deg, var(--wheat-400), var(--wheat-600));
}

.label {
  display: block;
  font-size: 0.76rem;
  letter-spacing: 0.03em;
  color: var(--parchment-200);
}

.chars {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.char {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  width: 84px;
  padding: 0.45rem 0.3rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(13, 10, 18, 0.5);
  color: var(--text-muted);
  font-size: 0.78rem;
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    color 0.2s ease;
}

.char.is-on {
  border-color: rgba(233, 185, 92, 0.75);
  color: var(--parchment-50);
}

.char__img {
  width: 46px;
  height: 46px;
  object-fit: cover;
  object-position: top center;
  border-radius: 50%;
  border: 1px solid rgba(224, 169, 68, 0.35);
}

.char__name {
  font-family: var(--font-heading);
}

.drop {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70px;
  padding: 0.7rem;
  border: 1px dashed rgba(224, 169, 68, 0.4);
  border-radius: var(--radius-sm);
  background: rgba(13, 10, 18, 0.45);
  color: var(--text-muted);
  font-size: 0.8rem;
  cursor: pointer;
}

.drop.is-active {
  border-color: var(--wheat-400);
  background: rgba(233, 185, 92, 0.1);
}

.drop.is-busy {
  opacity: 0.7;
}

.drop__input {
  display: none;
}

.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding: 0;
  list-style: none;
}

.thumbs__item {
  position: relative;
  width: 62px;
  height: 62px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  border: 1px solid var(--border);
}

.thumbs__item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumbs__del {
  position: absolute;
  top: 1px;
  right: 1px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(13, 10, 18, 0.85);
  color: var(--parchment-100);
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
}

.field {
  display: block;
}

.field__input {
  width: 100%;
  margin-top: 0.4rem;
  padding: 0.6rem 0.7rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(13, 10, 18, 0.6);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 0.85rem;
  line-height: 1.6;
  resize: vertical;
}

.field__input:focus {
  outline: none;
  border-color: rgba(233, 185, 92, 0.55);
}

.warn {
  padding: 0.5rem 0.65rem;
  border: 1px solid rgba(233, 185, 92, 0.35);
  border-radius: var(--radius-sm);
  background: rgba(233, 185, 92, 0.08);
  font-size: 0.76rem;
  color: var(--parchment-200);
}

.preview {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(13, 10, 18, 0.55);
  overflow: hidden;
}

.preview__head {
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--border);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  color: var(--wheat-500);
  background: rgba(233, 185, 92, 0.06);
}

.preview__body {
  margin: 0;
  padding: 0.6rem;
  max-height: 130px;
  overflow: auto;
  scrollbar-width: none;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-sans);
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--parchment-200);
}

.preview__body::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.problems {
  margin: 0;
  padding: 0.55rem 0.8rem 0.55rem 1.7rem;
  border: 1px solid rgba(208, 95, 74, 0.4);
  border-radius: var(--radius-sm);
  background: rgba(176, 67, 47, 0.12);
  color: #f0c9bd;
  font-size: 0.78rem;
  line-height: 1.6;
}

.params {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.params__item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.72rem;
  color: var(--text-muted);
}

.params__item select {
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(13, 10, 18, 0.7);
  color: var(--text);
  font-size: 0.8rem;
}

.cost {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.cost strong {
  color: var(--wheat-300);
  font-size: 1rem;
}

.cost__note {
  font-size: 0.7rem;
  color: var(--text-dim);
}

.gen-btn {
  width: 100%;
}

.timer {
  font-family: var(--font-mono);
  font-size: 0.76rem;
  color: var(--wheat-300);
  line-height: 1.7;
}

.timer__note {
  display: block;
  font-family: var(--font-sans);
  font-size: 0.72rem;
  color: var(--text-dim);
}

.qc {
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0.5rem 0.7rem;
  background: rgba(233, 185, 92, 0.05);
  font-size: 0.76rem;
  color: var(--text-muted);
}

.qc summary {
  cursor: pointer;
  color: var(--wheat-300);
}

.qc ul {
  margin: 0.45rem 0 0;
  padding-left: 1.1rem;
  line-height: 1.75;
}

.qc__note {
  margin-top: 0.4rem;
  font-size: 0.72rem;
  color: var(--text-dim);
}
/* ---------- 画布工具栏 ---------- */
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: none;
  height: 38px;
  padding: 0 0.6rem;
  border-bottom: 1px solid var(--border);
  background: rgba(13, 10, 18, 0.55);
  overflow-x: auto;
  scrollbar-width: none;
}

.toolbar::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.tool {
  padding: 0.3rem 0.65rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(233, 185, 92, 0.05);
  color: var(--parchment-100);
  font-size: 0.76rem;
  white-space: nowrap;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease;
}

.tool:hover:not(:disabled) {
  border-color: rgba(233, 185, 92, 0.5);
  background: rgba(233, 185, 92, 0.12);
}

.tool:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

.tool.is-on {
  border-color: rgba(233, 185, 92, 0.8);
  color: #21160a;
  background: linear-gradient(135deg, var(--wheat-400), var(--wheat-600));
}

.tool--mini {
  padding: 0.2rem 0.5rem;
  font-size: 0.7rem;
}

.toolbar__sep {
  width: 1px;
  height: 18px;
  background: var(--border);
  margin: 0 0.25rem;
  flex: none;
}

.toolbar__zoom {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: var(--wheat-300);
  min-width: 46px;
  text-align: center;
  flex: none;
}

.tool--danger {
  border-color: rgba(208, 95, 74, 0.55);
  color: var(--crimson-400);
}

.tool--danger:hover:not(:disabled) {
  border-color: rgba(208, 95, 74, 0.9);
  background: rgba(176, 67, 47, 0.18);
}

.toolbar__dims {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  white-space: nowrap;
  flex: none;
}

.stage__missing {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  padding: 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--crimson-400);
  background: rgba(9, 7, 12, 0.7);
}

.tool--primary {
  border-color: rgba(233, 185, 92, 0.75);
  color: #21160a;
  background: linear-gradient(135deg, var(--wheat-400), var(--wheat-600));
  font-weight: 600;
}

/* ---------- 整体重绘面板 ---------- */
.redraw {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  flex: none;
  padding: 0.6rem;
  border-bottom: 1px solid var(--border);
  background: rgba(233, 185, 92, 0.07);
}

.redraw__label {
  font-size: 0.74rem;
  letter-spacing: 0.04em;
  color: var(--wheat-300);
}

.redraw__input {
  width: 100%;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(13, 10, 18, 0.7);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 0.82rem;
  line-height: 1.6;
  resize: vertical;
}

.redraw__input:focus {
  outline: none;
  border-color: rgba(233, 185, 92, 0.55);
}

.redraw__actions {
  display: flex;
  align-items: center;
  gap: 0.45rem;
}

.redraw__timer {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  color: var(--wheat-300);
}

.toolbar__spacer {
  flex: 1;
}

.toolbar__meta {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  white-space: nowrap;
}

/* ---------- 画布 ---------- */
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background:
    repeating-conic-gradient(rgba(255, 255, 255, 0.025) 0% 25%, transparent 0% 50%) 50% / 22px 22px,
    rgba(9, 7, 12, 0.85);
  cursor: grab;
  user-select: none;
}

.stage:active {
  cursor: grabbing;
}

.stage.is-crop {
  cursor: crosshair;
}

.stage__img {
  position: absolute;
  left: 0;
  top: 0;
  /* 全局有 img{max-width:100%}，会把 inline width 压到容器宽、而 height 不变 → 图被横向压扁 */
  max-width: none;
  max-height: none;
  transform-origin: 0 0;
  will-change: transform;
  user-select: none;
  -webkit-user-drag: none;
  box-shadow: 0 18px 60px -20px rgba(0, 0, 0, 0.9);
}

.stage__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-dim);
}

.cropbox {
  position: absolute;
  border: 1px solid var(--wheat-300);
  box-shadow:
    0 0 0 9999px rgba(9, 7, 12, 0.55),
    0 0 0 1px rgba(0, 0, 0, 0.6) inset;
  pointer-events: none;
}

.cropbox__label {
  position: absolute;
  left: 0;
  top: -20px;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  background: rgba(13, 10, 18, 0.9);
  color: var(--wheat-300);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  white-space: nowrap;
}

.filmstrip {
  display: flex;
  gap: 0.35rem;
  flex: none;
  padding: 0.4rem 0.6rem;
  border-top: 1px solid var(--border);
  background: rgba(13, 10, 18, 0.6);
  overflow-x: auto;
  scrollbar-width: none;
}

.filmstrip::-webkit-scrollbar {
  width: 0;
  height: 0;
  display: none;
}

.film {
  flex: none;
  width: 46px;
  height: 46px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: none;
  cursor: pointer;
}

.film img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.film.is-on {
  border-color: var(--wheat-400);
  box-shadow: 0 0 0 1px rgba(233, 185, 92, 0.5);
}

/* ---------- 历史 ---------- */
.hint {
  font-size: 0.8rem;
  color: var(--text-dim);
}

.hist {
  position: relative;
  /* 宽度由网格给（铺满一行），卡片自己不再定死 190px */
  min-width: 0;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: rgba(13, 10, 18, 0.45);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease;
}

.hist:hover {
  border-color: rgba(233, 185, 92, 0.45);
  background: rgba(233, 185, 92, 0.07);
}

.hist__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  /* 给右上角那颗删除按钮让位，时间戳不会被压住 */
  padding-right: 22px;
}

.hist__badge {
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  border: 1px solid rgba(233, 185, 92, 0.5);
  font-size: 0.62rem;
  color: var(--wheat-300);
}

.hist__badge.is-crop {
  border-color: rgba(125, 154, 106, 0.6);
  color: var(--moss-400);
}

.hist__badge.is-redraw {
  border-color: rgba(208, 95, 74, 0.6);
  color: var(--crimson-400);
}

.hist__time {
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--text-dim);
}

.hist__thumbs {
  display: flex;
  gap: 0.25rem;
  margin: 0.35rem 0;
}

.hist__thumbs img {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--border);
  display: block;
}

/* 删除按钮挂在卡片右上角，默认隐形，鼠标悬停卡片才出现 */
.hist__del {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid rgba(208, 95, 74, 0.75);
  background: rgba(13, 10, 18, 0.94);
  color: var(--crimson-400);
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.18s ease,
    background 0.18s ease,
    color 0.18s ease;
}

.hist:hover .hist__del,
.hist:focus-within .hist__del {
  opacity: 1;
  pointer-events: auto;
}

.hist__del:hover {
  background: rgba(176, 67, 47, 0.45);
  color: #fff;
}

.hist__prompt {
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ---------- 窄屏：降级成上下堆叠 ---------- */
@media (max-width: 900px) {
  .studio {
    height: auto;
    overflow: visible;
  }

  .shell {
    flex-direction: column;
    height: auto;
  }

  .pane--left {
    width: 100% !important;
    border-right: none;
    border-bottom: 1px solid var(--border);
  }

  .pane--left .pane__body {
    overflow: visible;
  }

  .gutter {
    display: none;
  }

  .pane--right {
    display: block;
  }

  .pane--canvas,
  .pane--bottom {
    height: auto !important;
  }

  .stage {
    height: 60vh;
  }
}

/* ---------- 竖屏手机：整页降级成一张提示卡 ---------- */
@media (max-width: 700px) and (orientation: portrait) {
  .studio__mobile {
    display: grid;
    gap: 0.65rem;
    /* 上下 auto：在剩余高度里既居中又保持内容高度（不要撑成整屏面板） */
    margin: auto calc(0.9rem + var(--safe-right)) auto calc(0.9rem + var(--safe-left));
    padding: 1.7rem 1.2rem calc(1.7rem + var(--safe-bottom));
    border: 1px solid rgba(224, 169, 68, 0.22);
    border-radius: 16px;
    background: radial-gradient(130% 130% at 0% 0%, rgba(26, 20, 12, 0.92), rgba(13, 10, 18, 0.78));
  }

  .studio__mobile-kicker {
    font-size: 0.66rem;
    letter-spacing: 0.26em;
    color: var(--wheat-500);
  }

  .studio__mobile-title {
    font-size: 1.5rem;
    color: var(--parchment-50);
  }

  .studio__mobile-body {
    font-size: 0.9rem;
    line-height: 1.9;
    color: var(--text-muted);
  }

  /* 收尾一句闲话：沿用驿站页 .station__scene 的衬线斜体 + 麦色 */
  .studio__mobile-note {
    margin-top: 0.2rem;
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 0.88rem;
    line-height: 1.8;
    color: var(--wheat-300);
  }

  .studio__mobile-actions {
    display: grid;
    gap: 0.6rem;
    margin-top: 0.9rem;
  }

  .studio__mobile-actions .btn {
    width: 100%;
  }
}
</style>
