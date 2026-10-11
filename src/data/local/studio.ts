import { localId, hashString, readLocal, sleep, writeLocal } from './storage'
import type {
  GenerateResponse,
  StudioConfig,
  StudioHistoryEntry,
  StudioImage,
  StudioJob,
  UploadedRef,
} from '@/types/studio'

/**
 * 本地画坊。
 *
 * 角色表、禁用词、尺寸档位与原配置一致；「历史」随包带着几张示例画片；
 * 「生成」不做任何网络调用 —— 它按 角色 + 尺寸 + 质量 + 提示词 做一次确定性的选片，
 * 同一组参数永远得到同一张，换了提示词就会换一张，像是在同一个画坊里出活。
 * 上传的参考图与裁剪结果都只活在这台机器上（内存 / localStorage），不会外发。
 */

const HISTORY_KEY = 'studio.history.v2'
const PHOTO_MAX_CHARS = 300_000

/** 站点自己的画片：全部来自仓库里的 public/art，不新增任何图片文件 */
const asset = (path: string): string => `${import.meta.env.BASE_URL}${path}`

interface Sample {
  url: string
  label: string
  tags: string[]
}

const SAMPLES: Sample[] = [
  { url: asset('art/art-travel.webp'), label: '北行路上', tags: ['holo', 'lawrence'] },
  { url: asset('art/art-family.webp'), label: '旅馆一家', tags: ['holo', 'lawrence', 'myuri'] },
  { url: asset('art/hero-holo.webp'), label: '贤狼', tags: ['holo'] },
  { url: asset('art/bg-shop.webp'), label: '商行内景', tags: ['scene'] },
  { url: asset('art/bg-road.webp'), label: '夜路', tags: ['scene'] },
  { url: asset('art/obj-sketchbook.webp'), label: '速写册', tags: ['scene', 'sketch'] },
  { url: asset('art/map-world.webp'), label: '商路地图', tags: ['scene', 'map'] },
  { url: asset('art/ledger-paper.webp'), label: '账页', tags: ['scene', 'ledger'] },
]

/* ------------------------------ 角色配置 ------------------------------ */
const CHARACTERS = [
  {
    id: 'holo',
    label: '赫萝',
    en: 'Holo',
    aliases: ['赫萝', 'holo', 'ホロ', '贤狼'],
    refUrl: asset('art/hero-holo.webp'),
    appearance:
      '赫萝（2024 重制版《狼と香辛料 MERCHANT MEETS THE WISE WOLF》）：灰褐／金褐色过肩长发、鲜红瞳、头顶狼耳、狼尾，深藏青兜帽斗篷＋白衬衣＋红腰带',
  },
  {
    id: 'lawrence',
    label: '罗伦斯',
    en: 'Lawrence',
    aliases: ['罗伦斯', '勞倫斯', 'lawrence', 'ロレンス', 'kraft'],
    refUrl: asset('art/art-travel.webp'),
    appearance:
      '罗伦斯（2024 重制版《狼と香辛料》）：银灰色短发、无耳无尾，深褐色行商外套／系带羊毛束腰外衣，宽皮带',
  },
  {
    id: 'myuri',
    label: '缪莉',
    en: 'Myuri',
    aliases: ['缪莉', '繆莉', 'myuri', 'ミューリ'],
    refUrl: asset('art/art-family.webp'),
    appearance: '缪莉（《狼与羊皮纸》，赫萝与罗伦斯的女儿）：银白色长发、红瞳、狼耳，红色斗篷',
  },
]

const BANNED_WORDS = [
  { word: '立领', hint: '中世纪服装请用系带或敞领' },
  { word: '拉链', hint: '中世纪服装请用系带门襟' },
  { word: '西装领', hint: '请改用斗篷／羊毛外衣' },
  { word: '驳头', hint: '请改用斗篷／羊毛外衣' },
  { word: '西装', hint: '请改用羊毛外衣／束腰外衣' },
  { word: '西服', hint: '请改用羊毛外衣／束腰外衣' },
  { word: '夹克', hint: '请改用羊毛外衣' },
  { word: '卫衣', hint: '请改用亚麻衬衣／羊毛外衣' },
  { word: '连帽衫', hint: '请改用兜帽斗篷' },
  { word: '牛仔', hint: '请改用羊毛／亚麻下装' },
  { word: 't恤', hint: '请改用亚麻衬衣' },
  { word: '运动鞋', hint: '请改用皮靴' },
  { word: '球鞋', hint: '请改用皮靴' },
  { word: '棒球帽', hint: '请改用兜帽' },
  { word: '羽绒服', hint: '请改用斗篷／羊毛外套' },
  { word: '冲锋衣', hint: '请改用斗篷／羊毛外套' },
  { word: '合成面料', hint: '请改用羊毛／亚麻' },
  { word: '涤纶', hint: '请改用羊毛／亚麻' },
]

const CHARACTER_MODE_RULES = [
  '中世纪欧洲奇幻世界（《狼与香辛料》设定），非现代场景',
  '画面中只出现所勾选的角色，不要添加任何多余人物或动物',
  '服装必须合中世纪设定：羊毛外衣、系带门襟、宽皮带、斗篷、亚麻内衬；禁止立领、拉链、夹克、卫衣、牛仔等现代服装与合成面料',
]

const CONFIG: StudioConfig = {
  configured: true,
  model: 'gpt-image-2',
  sizes: ['1024x1024', '1536x1024', '1024x1536', '2K'],
  qualities: ['low', 'medium', 'high'],
  maxBatch: 4,
  maxRefImages: 4,
  maxPromptLength: 2000,
  pricePerImage: 0.1,
  characters: CHARACTERS,
  bannedWords: BANNED_WORDS,
  characterModeRules: CHARACTER_MODE_RULES,
}

export async function fetchStudioConfig(): Promise<StudioConfig> {
  await sleep(120)
  return structuredClone(CONFIG)
}

/* ------------------------------ 示例历史 ------------------------------ */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

function sampleHistory(): StudioHistoryEntry[] {
  const job = (
    index: number,
    input: {
      kind: string
      mode: 'character' | 'free'
      userPrompt: string
      characters: string[]
      size: string
      quality: string
      hours: number
      elapsedMs: number
      sample: Sample
    },
  ): StudioHistoryEntry => ({
    id: `sample-job-${index}`,
    kind: input.kind,
    mode: input.mode,
    status: 'succeeded',
    userPrompt: input.userPrompt,
    prompt: input.userPrompt,
    characters: input.characters,
    refs: [],
    size: input.size,
    quality: input.quality,
    n: 1,
    model: CONFIG.model,
    createdAt: hoursAgo(input.hours),
    elapsedMs: input.elapsedMs,
    images: [
      {
        id: `sample-image-${index}`,
        url: input.sample.url,
        size: input.size,
      },
    ],
  })

  return [
    job(1, {
      kind: 'generate',
      mode: 'character',
      userPrompt: '在旅馆的房间里，赫萝依靠在罗伦斯肩上，在昏黄的烛光下谈话',
      characters: ['holo', 'lawrence'],
      size: '1536x1024',
      quality: 'high',
      hours: 2,
      elapsedMs: 42299,
      sample: SAMPLES[0]!,
    }),
    job(2, {
      kind: 'generate',
      mode: 'character',
      userPrompt: '赫萝蹲在麦田边，回头看向行商的车辙',
      characters: ['holo'],
      size: '1024x1024',
      quality: 'medium',
      hours: 26,
      elapsedMs: 36840,
      sample: SAMPLES[2]!,
    }),
    job(3, {
      kind: 'redraw',
      mode: 'free',
      userPrompt: '把光线压暗一些，让烛火更暖',
      characters: [],
      size: '1536x1024',
      quality: 'high',
      hours: 30,
      elapsedMs: 31320,
      sample: SAMPLES[1]!,
    }),
    job(4, {
      kind: 'generate',
      mode: 'free',
      userPrompt: '商行柜台上摊开的地图，旁边压着一枚银币',
      characters: [],
      size: '1024x1536',
      quality: 'medium',
      hours: 52,
      elapsedMs: 28460,
      sample: SAMPLES[6]!,
    }),
    job(5, {
      kind: 'generate',
      mode: 'free',
      userPrompt: '摊开的速写册，页角压着一束麦穗',
      characters: [],
      size: '1024x1024',
      quality: 'low',
      hours: 74,
      elapsedMs: 19040,
      sample: SAMPLES[5]!,
    }),
  ]
}

/**
 * 历史里带 dataURL 的条目（裁剪出来的画片）只有小图才写进 localStorage：
 * 一条几百 KB 的 base64 很容易把 5MB 的配额吃光。
 */
function persistable(entries: StudioHistoryEntry[]): StudioHistoryEntry[] {
  return entries.filter((entry) =>
    entry.images.every(
      (image) => !image.url.startsWith('data:') || image.url.length <= PHOTO_MAX_CHARS,
    ),
  )
}

function loadHistory(): StudioHistoryEntry[] {
  const saved = readLocal<StudioHistoryEntry[] | null>(HISTORY_KEY, null)
  if (Array.isArray(saved)) return saved
  const seeded = sampleHistory()
  writeLocal(HISTORY_KEY, seeded)
  return seeded
}

function saveHistory(entries: StudioHistoryEntry[]): void {
  writeLocal(HISTORY_KEY, persistable(entries))
}

export async function fetchStudioHistory(): Promise<StudioHistoryEntry[]> {
  await sleep(140)
  return loadHistory()
}

/* ------------------------------ 参考图 ------------------------------ */
const uploads = new Map<string, UploadedRef>()

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('这张参考图读不出来。'))
    reader.readAsDataURL(file)
  })
}

export async function uploadRefs(files: File[]): Promise<{ files: UploadedRef[] }> {
  const stored: UploadedRef[] = []
  for (const file of files) {
    const url = await readAsDataUrl(file)
    const id = localId()
    const item: UploadedRef = { id, url, name: file.name, size: file.size }
    uploads.set(id, item)
    stored.push(item)
  }
  return { files: stored }
}

export async function deleteUpload(id: string): Promise<{ deleted: boolean }> {
  uploads.delete(id)
  return { deleted: true }
}

/* ------------------------------ 选片 ------------------------------ */
function candidates(characters: string[]): Sample[] {
  if (characters.length === 0) {
    return SAMPLES.filter((sample) => sample.tags.includes('scene'))
  }
  const all = SAMPLES.filter((sample) => characters.every((id) => sample.tags.includes(id)))
  if (all.length > 0) return all
  const some = SAMPLES.filter((sample) => characters.some((id) => sample.tags.includes(id)))
  return some.length > 0 ? some : SAMPLES.filter((sample) => sample.tags.includes('scene'))
}

function pickImages(
  seed: string,
  characters: string[],
  count: number,
  size: string,
): StudioImage[] {
  const pool = candidates(characters)
  const start = hashString(seed) % pool.length
  const images: StudioImage[] = []
  for (let index = 0; index < count; index += 1) {
    const sample = pool[(start + index) % pool.length]!
    images.push({
      id: localId(),
      url: sample.url,
      size,
      createdAt: Date.now(),
    })
  }
  return images
}

/* ------------------------------ 生成 ------------------------------ */
export interface GeneratePayload {
  mode: 'character' | 'free'
  prompt: string
  characters: string[]
  refs: string[]
  size: string
  quality: string
  n: number
  intent?: string
}

export async function generateImages(payload: GeneratePayload): Promise<GenerateResponse> {
  // 让人看得到「在画」：耗时随张数走，但不会真的卡住
  await sleep(1500 + Math.min(payload.n, 4) * 420)

  const trimmedPrompt = payload.prompt.trim()
  const userPrompt = trimmedPrompt || '（未写描述）'
  const seed = [
    payload.mode,
    payload.prompt.trim(),
    payload.characters.join(','),
    payload.size,
    payload.quality,
    payload.n,
    payload.intent ?? 'generate',
  ].join('|')

  const images = pickImages(
    seed,
    payload.mode === 'character' ? payload.characters : [],
    payload.n,
    payload.size,
  )
  const job: StudioJob = {
    id: localId(),
    kind: payload.intent === 'redraw' ? 'redraw' : 'generate',
    mode: payload.mode,
    status: 'succeeded',
    userPrompt,
    prompt: payload.prompt.trim(),
    characters: payload.mode === 'character' ? payload.characters : [],
    refs: payload.refs,
    size: payload.size,
    quality: payload.quality,
    n: payload.n,
    model: CONFIG.model,
    createdAt: new Date().toISOString(),
    elapsedMs: 1500 + Math.min(payload.n, 4) * 420,
  }

  const entry: StudioHistoryEntry = {
    ...job,
    images: images.map((image) => ({ id: image.id, url: image.url, size: image.size })),
  }
  const history = loadHistory()
  history.unshift(entry)
  saveHistory(history)

  return { job, images }
}

export interface DerivePayload {
  blob: Blob
  source: string
  label: string
  width: number
  height: number
}

export async function deriveCrop(payload: DerivePayload): Promise<GenerateResponse> {
  await sleep(420)
  const url = await readAsDataUrl(new File([payload.blob], 'crop.png', { type: 'image/png' }))
  const id = localId()
  const image: StudioImage = {
    id,
    url,
    size: `${payload.width}x${payload.height}`,
    createdAt: Date.now(),
  }
  const job: StudioJob = {
    id: localId(),
    kind: 'crop',
    mode: 'crop',
    status: 'succeeded',
    userPrompt: payload.label,
    prompt: payload.label,
    characters: [],
    refs: payload.source ? [payload.source] : [],
    size: `${payload.width}x${payload.height}`,
    quality: '',
    n: 1,
    model: CONFIG.model,
    createdAt: new Date().toISOString(),
    elapsedMs: 420,
  }

  const history = loadHistory()
  history.unshift({ ...job, images: [{ id, url, size: image.size }] })
  saveHistory(history)

  return { job, images: [image] }
}

/* ------------------------------ 历史维护 ------------------------------ */
function basename(url: string): string {
  return url.split('/').pop() ?? url
}

export async function deleteImage(filename: string): Promise<{ deleted: boolean; url: string }> {
  await sleep(160)
  const history = loadHistory()
  const index = history.findIndex((entry) =>
    entry.images.some((image) => basename(image.url) === filename),
  )
  if (index < 0) return { deleted: false, url: filename }
  const entry = history[index]!
  const images = entry.images.filter((image) => basename(image.url) !== filename)
  if (images.length === 0) history.splice(index, 1)
  else history[index] = { ...entry, images }
  saveHistory(history)
  return { deleted: true, url: filename }
}

export async function renameImage(
  filename: string,
  name: string,
): Promise<{ renamed: boolean; name: string; url: string }> {
  await sleep(220)
  const trimmed = name.trim()
  if (!trimmed) throw new Error('名字不能是空的。')

  // 站点是静态的：改不了磁盘上的文件名，所以只把这条记录的名字改掉。
  // 画片本身照旧显示（链接不变），列表里也不会出现坏图。
  const history = loadHistory()
  const index = history.findIndex((entry) =>
    entry.images.some((image) => basename(image.url) === filename),
  )
  if (index >= 0) {
    const entry = history[index]!
    history[index] = { ...entry, userPrompt: trimmed }
    saveHistory(history)
  }
  return { renamed: true, name: trimmed, url: filename }
}
