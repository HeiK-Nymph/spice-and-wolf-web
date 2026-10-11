/**
 * 狼与香辛料主题站 —— 生图服务
 * ---------------------------------------------------------------------------
 * 职责：
 *   1. 以服务端身份调用 TokenWorld API 的图像生成接口，API Key 不出现在前端；
 *   2. 把生成结果落盘到 `generated/`，并返回本站可访问的 URL；
 *   3. 生产环境下顺带托管 `dist/` 静态产物（可选）。
 *
 * 启动：node server/index.js  （开发时由 `npm run dev` 与 Vite 一起拉起）
 */
import 'dotenv/config'

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import express from 'express'
import multer from 'multer'

import { BANNED_WORDS, CHARACTER_MODE_RULES, CHARACTERS, PRICE_PER_IMAGE } from './studio-config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
/** 产物目录：可用 GENERATED_DIR 覆盖。测试时指向临时目录，避免碰到真实产物 */
const GENERATED_DIR = process.env.GENERATED_DIR
  ? path.resolve(process.env.GENERATED_DIR)
  : path.join(ROOT, 'generated')
const DIST_DIR = path.join(ROOT, 'dist')

const PORT = Number(process.env.PORT ?? 8788)
const API_KEY = process.env.TOKENWORLD_API_KEY ?? ''
const BASE_URL = (process.env.TOKENWORLD_BASE_URL ?? 'https://tokenworldai.com/v1').replace(
  /\/+$/,
  '',
)
const IMAGE_MODEL = process.env.TOKENWORLD_IMAGE_MODEL ?? 'gpt-image-2'

/** 允许的尺寸（与 gpt-image-2 兼容的 OpenAI 图像尺寸签名一致） */
/**
 * 允许的尺寸。
 * 官方文档：gpt-image-2 与 OG/image2_* 可用 "1K" / "2K" / "4K" 档位；
 * 具体像素尺寸网关同样放行，所以两套都留着。
 */
const ALLOWED_SIZES = new Set(['1024x1024', '1536x1024', '1024x1536', '1K', '2K', '4K'])
const ALLOWED_QUALITIES = new Set(['low', 'medium', 'high'])
const MAX_PROMPT_LENGTH = 2000
const MAX_BATCH = 4

/** 单次生成的粗略超时（毫秒）：上游图片模型较慢，给足时间 */
const UPSTREAM_TIMEOUT_MS = 600_000
/** 图生图（edits）更慢，单独给更长的超时 */
const EDIT_TIMEOUT_MS = 600_000

/** 画坊相关常量 */
const UPLOADS_DIR = path.join(GENERATED_DIR, 'uploads')
/** 生成结果目录：从 generated/ 根目录独立出来，不再和站点美术素材混在一起 */
const OUTPUTS_DIR = path.join(GENERATED_DIR, 'outputs')
/** 画坊历史：可用 STUDIO_HISTORY_FILE 覆盖，理由同上 */
const HISTORY_FILE = process.env.STUDIO_HISTORY_FILE
  ? path.resolve(process.env.STUDIO_HISTORY_FILE)
  : path.join(__dirname, 'data', 'studio-history.json')
const MAX_REFS = 4
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const HISTORY_LIMIT = 200
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

fs.mkdirSync(GENERATED_DIR, { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })
fs.mkdirSync(OUTPUTS_DIR, { recursive: true })
fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true })

/* -------------------------------------------------------------------------- */
/* 简易内存限流：防止前端被刷导致额度迅速耗尽                                    */
/* -------------------------------------------------------------------------- */
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 8
/** @type {Map<string, number[]>} */
const hits = new Map()

function rateLimited(ip) {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (list.length >= RATE_LIMIT_MAX) {
    hits.set(ip, list)
    return true
  }
  list.push(now)
  hits.set(ip, list)
  return false
}

/* -------------------------------------------------------------------------- */
/* 工具函数                                                                    */
/* -------------------------------------------------------------------------- */
const ok = (res, data, status = 200) => res.status(status).json({ ok: true, data })
const fail = (res, error, status = 400) => res.status(status).json({ ok: false, error })

function extFromContentType(contentType) {
  if (!contentType) return 'png'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  return 'png'
}

/** 把一段 base64 或远端 URL 统一保存为本地文件，返回相对 URL */
async function persistImage({ b64, remoteUrl }) {
  const id = crypto.randomUUID()
  let buffer
  let ext = 'png'

  if (b64) {
    buffer = Buffer.from(b64, 'base64')
  } else if (remoteUrl) {
    const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(60_000) })
    if (!res.ok) throw new Error(`下载生成结果失败：HTTP ${res.status}`)
    ext = extFromContentType(res.headers.get('content-type'))
    buffer = Buffer.from(await res.arrayBuffer())
  } else {
    throw new Error('上游未返回图片数据')
  }

  const filename = `${id}.${ext}`
  await fsp.writeFile(path.join(OUTPUTS_DIR, filename), buffer)
  return { id, url: `/generated/outputs/${filename}` }
}

/* -------------------------------------------------------------------------- */
/* 画坊（/studio）工具：角色校验、提示词组装、上传与历史                          */
/* -------------------------------------------------------------------------- */

/** 大小写不敏感的别名匹配：拉丁字母按词边界，中日文按子串 */
function aliasHit(text, alias) {
  const a = alias.toLowerCase()
  if (/^[a-z]+$/.test(a)) return new RegExp(`\\b${a}\\b`).test(text)
  return text.includes(a)
}

/** 找出提示词里提到的所有角色 id */
function mentionedCharacterIds(prompt) {
  const lower = prompt.toLowerCase()
  const found = new Set()
  for (const character of CHARACTERS) {
    if (character.aliases.some((alias) => aliasHit(lower, alias))) found.add(character.id)
  }
  return [...found]
}

/** 找出提示词里命中的现代服装禁用词 */
function bannedWordHits(prompt) {
  const lower = prompt.toLowerCase()
  return BANNED_WORDS.filter((item) => lower.includes(item.word.toLowerCase()))
}

/** 角色模式的全部硬校验；返回问题列表（空数组 = 通过） */
function validateCharacterRequest(prompt, characterIds) {
  const problems = []
  if (characterIds.length === 0) problems.push('角色模式至少要勾选一个角色。')

  const missing = mentionedCharacterIds(prompt).filter((id) => !characterIds.includes(id))
  if (missing.length > 0) {
    const labels = missing.map((id) => CHARACTERS.find((c) => c.id === id)?.label ?? id)
    problems.push(`提示词里提到了未勾选的角色：${labels.join('、')}。请勾选 TA 或改写提示词。`)
  }

  const banned = bannedWordHits(prompt)
  if (banned.length > 0) {
    const detail = banned.map((item) => `「${item.word}」— ${item.hint}`).join('；')
    problems.push(`提示词含现代服装词：${detail}。`)
  }

  return problems
}

/** 角色模式最终提示词：用户场景 + 角色重制版设定 + 中世纪约束 */
function composeCharacterPrompt(userPrompt, characterIds) {
  const picked = CHARACTERS.filter((character) => characterIds.includes(character.id))
  const parts = [userPrompt.trim().replace(/[。\s]+$/u, '')]
  for (const character of picked) parts.push(character.appearance)
  parts.push(...CHARACTER_MODE_RULES)
  return `${parts.join('。')}。`
}

/** 读一张仓库内的参考图，转成可以直接喂给上游的形态 */
function readLocalRef(relativePath) {
  const abs = path.join(ROOT, relativePath)
  return {
    buffer: fs.readFileSync(abs),
    filename: path.basename(abs),
    mime: MIME_BY_EXT[path.extname(abs).toLowerCase()] ?? 'image/png',
  }
}

/** 把上传 id 解析成 uploads 目录内的真实路径，挡住目录穿越 */
function resolveUpload(id) {
  const safe = path.basename(String(id))
  const abs = path.join(UPLOADS_DIR, safe)
  if (!abs.startsWith(`${UPLOADS_DIR}${path.sep}`) || !fs.existsSync(abs)) return null
  return { abs, filename: safe, mime: MIME_BY_EXT[path.extname(safe).toLowerCase()] ?? 'image/png' }
}

/**
 * 参考图解析：先找上传目录，再找产物根目录。
 * 产物根目录里放的是裁剪结果——所以「裁剪 → 设参考图 → 再生成」这条链路才通。
 */
function resolveRefImage(id) {
  const safe = path.basename(String(id))
  for (const dir of [UPLOADS_DIR, OUTPUTS_DIR, GENERATED_DIR]) {
    const abs = path.join(dir, safe)
    if (abs.startsWith(`${dir}${path.sep}`) && fs.existsSync(abs)) {
      return {
        abs,
        filename: safe,
        mime: MIME_BY_EXT[path.extname(safe).toLowerCase()] ?? 'image/png',
      }
    }
  }
  return null
}

/** 把本站 /generated/ URL 还原成磁盘绝对路径 */
function diskPathFromUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('/generated/')) return null
  const abs = path.join(GENERATED_DIR, url.slice('/generated/'.length))
  if (!abs.startsWith(`${GENERATED_DIR}${path.sep}`)) return null
  return abs
}

/**
 * 按磁盘实况清理历史：图片被手动删掉之后，条目不该继续挂在历史里。
 * 只改索引文件，不碰任何图片。
 */
async function pruneHistory() {
  const data = readHistory()
  let changed = false
  const entries = []
  for (const entry of data.entries) {
    const before = Array.isArray(entry.images) ? entry.images : []
    const images = before.filter((image) => {
      const abs = diskPathFromUrl(image.url)
      return abs ? fs.existsSync(abs) : false
    })
    if (images.length !== before.length) changed = true
    if (images.length === 0) {
      changed = true
      continue
    }
    entries.push({ ...entry, images })
  }
  if (changed) {
    await fsp.writeFile(HISTORY_FILE, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8')
  }
  return entries
}

/** 文件名安全化：去掉路径分隔与 Windows 非法字符，扩展名保持原样 */
function sanitizeImageName(raw, ext) {
  const base = String(raw ?? '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  const withoutExt = base.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim()
  if (!withoutExt) return null
  return `${withoutExt}${ext}`
}

/** 在产物目录 / 上传目录里定位一个文件名 */
function locateImage(filename) {
  const safe = path.basename(String(filename))
  for (const dir of [OUTPUTS_DIR, UPLOADS_DIR]) {
    const abs = path.join(dir, safe)
    if (abs.startsWith(`${dir}${path.sep}`) && fs.existsSync(abs)) return { abs, dir, name: safe }
  }
  return null
}

function urlOf(abs) {
  return `/generated/${path.relative(GENERATED_DIR, abs).split(path.sep).join('/')}`
}

function readHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return { entries: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'))
    return Array.isArray(parsed?.entries) ? parsed : { entries: [] }
  } catch {
    return { entries: [] }
  }
}

async function appendHistory(entry) {
  const data = readHistory()
  data.entries.unshift(entry)
  data.entries = data.entries.slice(0, HISTORY_LIMIT)
  await fsp.writeFile(HISTORY_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/**
 * 统一的生图上游调用：
 *   有参考图 → /v1/images/edits（multipart，image[] 多图）
 *   无参考图 → /v1/images/generations（JSON）
 */
async function requestUpstreamImages({ prompt, size, quality, n, refs }) {
  if (refs.length > 0) {
    const form = new FormData()
    form.append('model', IMAGE_MODEL)
    form.append('prompt', prompt)
    form.append('size', size)
    form.append('quality', quality)
    form.append('n', String(n))
    form.append('response_format', 'b64_json')
    for (const ref of refs) {
      form.append('image[]', new Blob([ref.buffer], { type: ref.mime }), ref.filename)
    }
    const response = await fetch(`${BASE_URL}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(EDIT_TIMEOUT_MS),
    })
    return { response, body: await response.json().catch(() => null) }
  }

  const response = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      prompt,
      size,
      quality,
      n,
      response_format: 'b64_json',
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  })
  return { response, body: await response.json().catch(() => null) }
}

/** 收集上游返回的图片并落盘，返回本站可访问的结果 */
async function persistUpstreamImages(items, { prompt, size, quality, createdAt }) {
  const results = []
  for (const item of items) {
    try {
      const { id, url } = await persistImage({ b64: item.b64_json, remoteUrl: item.url })
      results.push({
        id,
        url,
        revisedPrompt: item.revised_prompt,
        size: item.size ?? size,
        quality,
        model: IMAGE_MODEL,
        prompt,
        createdAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[studio] 保存结果失败：', message)
    }
  }
  return results
}
/* -------------------------------------------------------------------------- */
/* 应用                                                                        */
/* -------------------------------------------------------------------------- */
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '256kb' }))

// 生成结果：长期缓存，文件名即 UUID
app.use(
  '/generated',
  express.static(GENERATED_DIR, {
    immutable: true,
    maxAge: '30d',
    fallthrough: false,
  }),
)

app.get('/api/health', (_req, res) => {
  ok(res, {
    service: 'spice-and-wolf-image-api',
    configured: Boolean(API_KEY),
    model: IMAGE_MODEL,
    baseUrl: BASE_URL,
    sizes: [...ALLOWED_SIZES],
    qualities: [...ALLOWED_QUALITIES],
  })
})

app.post('/api/generate-image', async (req, res) => {
  if (!API_KEY) {
    return fail(
      res,
      '服务端未配置 TOKENWORLD_API_KEY，请复制 .env.example 为 .env 并填入密钥。',
      500,
    )
  }

  const ip = req.ip ?? 'unknown'
  if (rateLimited(ip)) {
    return fail(res, '生成过于频繁，请稍后再试。', 429)
  }

  const { prompt, size = '1024x1024', quality = 'low', n = 1 } = req.body ?? {}

  if (typeof prompt !== 'string' || prompt.trim().length < 4) {
    return fail(res, '提示词至少需要 4 个字符。')
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return fail(res, `提示词最长 ${MAX_PROMPT_LENGTH} 个字符。`)
  }
  if (!ALLOWED_SIZES.has(size)) {
    return fail(res, `不支持的尺寸：${size}`)
  }
  if (!ALLOWED_QUALITIES.has(quality)) {
    return fail(res, `不支持的质量档位：${quality}`)
  }
  const count = Number(n)
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    return fail(res, `每次生成数量需在 1 – ${MAX_BATCH} 之间。`)
  }

  const payload = {
    model: IMAGE_MODEL,
    prompt: prompt.trim(),
    size,
    quality,
    n: count,
    response_format: 'b64_json',
  }

  let upstream
  try {
    const response = await fetch(`${BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    upstream = await response.json().catch(() => null)

    if (!response.ok) {
      const message = upstream?.error?.message ?? upstream?.message ?? `HTTP ${response.status}`
      console.error('[generate-image] 上游返回错误：', message)
      return fail(res, `生图失败：${message}`, response.status >= 500 ? 502 : response.status)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[generate-image] 请求上游失败：', message)
    return fail(res, `无法连接生图服务：${message}`, 502)
  }

  const items = Array.isArray(upstream?.data) ? upstream.data : []
  if (items.length === 0) {
    return fail(res, '生图服务未返回任何图片。', 502)
  }

  const createdAt = Date.now()
  const results = []

  for (const item of items) {
    try {
      const { id, url } = await persistImage({ b64: item.b64_json, remoteUrl: item.url })
      results.push({
        id,
        url,
        revisedPrompt: item.revised_prompt,
        size: item.size ?? size,
        quality,
        model: IMAGE_MODEL,
        prompt: prompt.trim(),
        createdAt,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[generate-image] 保存结果失败：', message)
    }
  }

  if (results.length === 0) {
    return fail(res, '图片已生成，但保存到本地失败。', 502)
  }

  return ok(res, { images: results, usage: upstream?.usage ?? null })
})

/* -------------------------------------------------------------------------- */
/* 画坊（/studio）路由                                                          */
/* -------------------------------------------------------------------------- */

/** 参考图上传：落盘 generated/uploads/，只收图片 */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase()
      cb(null, `${crypto.randomUUID()}${MIME_BY_EXT[ext] ? ext : '.png'}`)
    },
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_REFS },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
})

/** 画坊配置：角色、禁用词、可选尺寸/质量、单价 —— 前端只做展示 */
app.get('/api/studio/config', (_req, res) => {
  ok(res, {
    configured: Boolean(API_KEY),
    model: IMAGE_MODEL,
    sizes: [...ALLOWED_SIZES],
    qualities: [...ALLOWED_QUALITIES],
    maxBatch: MAX_BATCH,
    maxRefImages: MAX_REFS,
    maxPromptLength: MAX_PROMPT_LENGTH,
    pricePerImage: PRICE_PER_IMAGE,
    characters: CHARACTERS.map((character) => ({
      id: character.id,
      label: character.label,
      en: character.en,
      aliases: character.aliases,
      appearance: character.appearance,
      refUrl: `/${character.ref}`,
    })),
    bannedWords: BANNED_WORDS,
    characterModeRules: CHARACTER_MODE_RULES,
  })
})

app.post('/api/uploads', upload.array('files', MAX_REFS), (req, res) => {
  const files = Array.isArray(req.files) ? req.files : []
  if (files.length === 0) {
    return fail(res, '没有收到图片文件（仅支持 png / jpg / webp）。')
  }
  return ok(
    res,
    {
      files: files.map((file) => ({
        id: file.filename,
        url: `/generated/uploads/${file.filename}`,
        name: file.originalname,
        size: file.size,
      })),
    },
    201,
  )
})

app.delete('/api/uploads/:id', async (req, res) => {
  const target = resolveUpload(req.params.id)
  if (!target) return fail(res, '参考图不存在。', 404)
  await fsp.rm(target.abs, { force: true })
  return ok(res, { deleted: true })
})

app.get('/api/studio/history', async (_req, res) => {
  try {
    // 顺手按磁盘实况清理一遍：手动删掉的图不该继续留在历史里
    return ok(res, await pruneHistory())
  } catch (error) {
    return fail(res, `读取历史失败：${error.message}`, 500)
  }
})

app.post('/api/studio/generate', async (req, res) => {
  const startedAt = Date.now()

  if (!API_KEY) {
    return fail(
      res,
      '服务端未配置 TOKENWORLD_API_KEY，请复制 .env.example 为 .env 并填入密钥。',
      500,
    )
  }

  const ip = req.ip ?? 'unknown'
  if (rateLimited(ip)) {
    return fail(res, '生成过于频繁，请稍后再试。', 429)
  }

  const body = req.body ?? {}
  const mode = body.mode === 'free' ? 'free' : 'character'
  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const size = typeof body.size === 'string' ? body.size : '1024x1024'
  const quality = typeof body.quality === 'string' ? body.quality : 'low'
  const count = Number(body.n ?? 1)

  if (prompt.trim().length < 4) return fail(res, '提示词至少需要 4 个字符。')
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return fail(res, `提示词最长 ${MAX_PROMPT_LENGTH} 个字符。`)
  }
  if (!ALLOWED_SIZES.has(size)) return fail(res, `不支持的尺寸：${size}`)
  if (!ALLOWED_QUALITIES.has(quality)) return fail(res, `不支持的质量档位：${quality}`)
  if (!Number.isInteger(count) || count < 1 || count > MAX_BATCH) {
    return fail(res, `每次生成数量需在 1 – ${MAX_BATCH} 之间。`)
  }

  const characterIds = Array.isArray(body.characters)
    ? [...new Set(body.characters.filter((id) => CHARACTERS.some((c) => c.id === id)))]
    : []
  const uploadIds = Array.isArray(body.refs) ? body.refs : []
  /** 整体重绘：客户端拿当前图当参考图，语义上不是普通生成 */
  const intent = body.intent === 'redraw' ? 'redraw' : null

  let finalPrompt = prompt.trim()
  /** @type {{ buffer: Buffer, filename: string, mime: string }[]} */
  let refFiles = []
  let refLabels = []

  if (mode === 'character') {
    const problems = validateCharacterRequest(prompt, characterIds)
    if (problems.length > 0) return fail(res, problems.join(' '))

    finalPrompt = composeCharacterPrompt(prompt, characterIds)
    if (finalPrompt.length > MAX_PROMPT_LENGTH) {
      return fail(
        res,
        `最终提示词（含自动注入的角色设定）超过 ${MAX_PROMPT_LENGTH} 字，请把场景描述写短一些。`,
      )
    }
    refFiles = characterIds.map((id) =>
      readLocalRef(CHARACTERS.find((character) => character.id === id).ref),
    )
    refLabels = characterIds.map((id) => CHARACTERS.find((character) => character.id === id).label)
  } else {
    if (uploadIds.length > MAX_REFS) return fail(res, `参考图最多 ${MAX_REFS} 张。`)
    for (const id of uploadIds) {
      const found = resolveRefImage(id)
      if (!found) return fail(res, '有参考图已不存在，请重新选择。')
      refFiles.push({
        buffer: await fsp.readFile(found.abs),
        filename: found.filename,
        mime: found.mime,
      })
      refLabels.push(found.filename)
    }
  }

  let upstream
  try {
    const { response, body: upstreamBody } = await requestUpstreamImages({
      prompt: finalPrompt,
      size,
      quality,
      n: count,
      refs: refFiles,
    })
    upstream = upstreamBody
    if (!response.ok) {
      const message = upstream?.error?.message ?? upstream?.message ?? `HTTP ${response.status}`
      console.error('[studio/generate] 上游返回错误：', message)
      return fail(res, `生图失败：${message}`, response.status >= 500 ? 502 : response.status)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[studio/generate] 请求上游失败：', message)
    return fail(res, `无法连接生图服务：${message}`, 502)
  }

  const items = Array.isArray(upstream?.data) ? upstream.data : []
  if (items.length === 0) return fail(res, '生图服务未返回任何图片。', 502)

  const createdAt = Date.now()
  const images = await persistUpstreamImages(items, {
    prompt: finalPrompt,
    size,
    quality,
    createdAt,
  })
  if (images.length === 0) return fail(res, '图片已生成，但保存到本地失败。', 502)

  const job = {
    id: crypto.randomUUID(),
    kind: intent ?? 'generate',
    mode,
    status: 'succeeded',
    userPrompt: prompt.trim(),
    prompt: finalPrompt,
    characters: characterIds,
    refs: refLabels,
    size,
    quality,
    n: count,
    model: IMAGE_MODEL,
    createdAt: new Date(createdAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
  }

  try {
    await appendHistory({
      ...job,
      images: images.map((image) => ({ id: image.id, url: image.url, size: image.size })),
    })
  } catch (error) {
    console.error('[studio/generate] 写历史失败：', error instanceof Error ? error.message : error)
  }

  return ok(res, { job, images, usage: upstream?.usage ?? null })
})
/** 删除一张产物（同时把它从历史里摘掉） */
app.delete('/api/studio/images/:filename', async (req, res) => {
  const found = locateImage(req.params.filename)
  if (!found) return fail(res, '图片不存在。', 404)

  const url = urlOf(found.abs)
  await fsp.rm(found.abs, { force: true })

  const data = readHistory()
  const entries = []
  for (const entry of data.entries) {
    const images = (Array.isArray(entry.images) ? entry.images : []).filter(
      (image) => image.url !== url,
    )
    if (images.length === 0) continue
    entries.push({ ...entry, images })
  }
  await fsp.writeFile(HISTORY_FILE, `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8')

  return ok(res, { deleted: true, url })
})

/** 重命名一张产物：文件改名，历史里的 URL 与 refs 一起跟着改 */
app.post('/api/studio/images/:filename/rename', async (req, res) => {
  const found = locateImage(req.params.filename)
  if (!found) return fail(res, '图片不存在。', 404)

  const ext = path.extname(found.name).toLowerCase() || '.png'
  const nextName = sanitizeImageName(req.body?.name, ext)
  if (!nextName) return fail(res, '文件名不合法（不能为空，也不能含路径分隔符）。')

  const oldUrl = urlOf(found.abs)
  if (nextName === found.name) return ok(res, { renamed: false, name: found.name, url: oldUrl })

  const target = path.join(found.dir, nextName)
  if (fs.existsSync(target)) return fail(res, '已存在同名文件。', 409)

  await fsp.rename(found.abs, target)
  const newUrl = urlOf(target)

  const data = readHistory()
  let changed = false
  for (const entry of data.entries) {
    if (Array.isArray(entry.images)) {
      for (const image of entry.images) {
        if (image.url === oldUrl) {
          image.url = newUrl
          image.id = path.basename(nextName, ext)
          changed = true
        }
      }
    }
    if (Array.isArray(entry.refs) && entry.refs.includes(found.name)) {
      entry.refs = entry.refs.map((ref) => (ref === found.name ? nextName : ref))
      changed = true
    }
  }
  if (changed) {
    await fsp.writeFile(HISTORY_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  }

  return ok(res, { renamed: true, name: nextName, url: newUrl })
})

/**
 * 裁剪落库：前端把裁剪结果作为 PNG 传上来，这里存进 generated/ 根目录，
 * 并作为一条 kind=crop 的历史记录。存根目录是为了让它能被 resolveRefImage 直接当参考图。
 */
app.post('/api/studio/derive', upload.single('image'), async (req, res) => {
  const file = req.file
  if (!file) return fail(res, '没有收到裁剪结果。')

  const ext = path.extname(file.filename).toLowerCase() || '.png'
  const id = crypto.randomUUID()
  const filename = `${id}${ext}`
  const target = path.join(OUTPUTS_DIR, filename)

  try {
    await fsp.rename(file.path, target)
  } catch (error) {
    await fsp.rm(file.path, { force: true })
    return fail(res, `保存裁剪结果失败：${error.message}`, 500)
  }

  const source = typeof req.body?.source === 'string' ? req.body.source : ''
  const label = typeof req.body?.label === 'string' ? req.body.label : ''
  const width = Number(req.body?.width) || null
  const height = Number(req.body?.height) || null
  const at = Date.now()
  const sizeLabel = width && height ? `${width}x${height}` : 'crop'

  const job = {
    id: crypto.randomUUID(),
    kind: 'crop',
    mode: 'crop',
    status: 'succeeded',
    userPrompt: label || (source ? `从 ${source} 裁剪` : '裁剪'),
    prompt: '',
    characters: [],
    refs: source ? [source] : [],
    size: sizeLabel,
    quality: 'crop',
    n: 1,
    model: 'crop',
    createdAt: new Date(at).toISOString(),
    elapsedMs: 0,
  }
  const images = [
    {
      id,
      url: `/generated/outputs/${filename}`,
      size: sizeLabel,
      quality: 'crop',
      model: 'crop',
      createdAt: at,
    },
  ]

  try {
    await appendHistory({
      ...job,
      images: images.map((image) => ({ id: image.id, url: image.url, size: image.size })),
    })
  } catch (error) {
    console.error('[studio/derive] 写历史失败：', error instanceof Error ? error.message : error)
  }

  return ok(res, { job, images }, 201)
})

/* -------------------------------------------------------------------------- */
/* 生产环境：托管 Vite 构建产物                                                  */
/* 注意：dist 可能在后端启动之后才生成，所以不能只在启动时判断一次，                */
/* 否则会出现「后端先启动、再执行构建」导致整站 404 的问题。                       */
/* -------------------------------------------------------------------------- */
/* -------------------------------------------------------------------------- */
/* 价格数据：单一数据源 server/data/pricing.json                                */
/*   改汇率只需改这一处，前端所有数字都由它派生重算。                             */
/* -------------------------------------------------------------------------- */
const PRICING_FILE = path.join(__dirname, 'data', 'pricing.json')
const ACCOUNTS_FILE = path.join(__dirname, 'data', 'accounts.json')

function readPricing() {
  return JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'))
}

function readAccounts() {
  if (!fs.existsSync(ACCOUNTS_FILE)) return { accounts: [] }
  try {
    const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'))
    return Array.isArray(parsed?.accounts) ? parsed : { accounts: [] }
  } catch {
    return { accounts: [] }
  }
}

async function writeAccounts(data) {
  await fsp.writeFile(ACCOUNTS_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/* -------------------------------------------------------------------------- */
/* API 额度账本                                                                */
/*   用户只需选择供应商 + 填 API Key，不需要额外的「配置名称」。                 */
/*   DeepSeek   → 官方余额接口，返回金额；                                      */
/*   OpenCode Go→ 订阅用量接口，返回滚動 / 每周 / 每月的使用百分比。             */
/* -------------------------------------------------------------------------- */
const ACCOUNT_PROVIDERS = {
  deepseek: { label: 'DeepSeek', url: 'https://api.deepseek.com/user/balance' },
  opencode: { label: 'OpenCode Go', url: 'https://opencode.ai/zen/go/v1/usage' },
}

function isProvider(value) {
  return typeof value === 'string' && Object.hasOwn(ACCOUNT_PROVIDERS, value)
}

/** 把 Key 脱敏，仅保留用于辨认的首尾片段 */
function maskKey(apiKey) {
  if (!apiKey) return ''
  if (apiKey.length <= 12) return `${apiKey.slice(0, 4)}…`
  return `${apiKey.slice(0, 6)}…${apiKey.slice(-4)}`
}

/** 对外输出时永远剥掉明文 Key 与历史遗留的 name 字段 */
function publicAccount(account) {
  const { apiKey, ...safe } = account
  delete safe.name
  return { ...safe, keyHint: maskKey(apiKey) }
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * 各供应商返回结构完全不同，统一归一化成 meters。
 *   DeepSeek   → { is_available, balance_infos:[{ currency, total_balance, granted_balance, topped_up_balance }] }
 *   OpenCode Go→ { usage:{ rolling|weekly|monthly:{ status, percent, resetsAt } } }
 */
function normalizeBalance(provider, body) {
  if (provider === 'deepseek') return normalizeDeepSeek(body)
  if (provider === 'opencode') return normalizeOpenCode(body)
  throw new Error(`暂不支持的供应商：${provider}`)
}

function normalizeDeepSeek(body) {
  const info = Array.isArray(body?.balance_infos) ? body.balance_infos[0] : null
  if (!info) throw new Error('DeepSeek 未返回余额信息（balance_infos 为空）。')

  const amountMeter = (label, value) => {
    const amount = toNumber(value)
    return amount === null ? null : { label, kind: 'amount', amount, percent: null, resetAt: null }
  }
  const meters = [
    amountMeter('剩余余额', info.total_balance),
    amountMeter('赠送余额', info.granted_balance),
    amountMeter('充值余额', info.topped_up_balance),
  ].filter(Boolean)

  if (meters.length === 0) throw new Error('DeepSeek 未返回可用的余额数字。')
  return { unit: info.currency ?? 'CNY', meters }
}

const OPENCODE_WINDOWS = [
  { key: 'rolling', label: '5 小时' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
]

function normalizeOpenCode(body) {
  const usage = body?.usage ?? body
  const meters = []
  for (const { key, label } of OPENCODE_WINDOWS) {
    const window = usage?.[key]
    if (!window || typeof window !== 'object') continue
    // status 非 ok（如 exceeded）说明该窗口已被用完，按 100% 处理
    const exhausted = Boolean(window.status && window.status !== 'ok')
    meters.push({
      label,
      kind: 'percent',
      amount: null,
      percent: exhausted ? 100 : toNumber(window.percent),
      resetAt: window.resetsAt ?? null,
    })
  }
  if (meters.length === 0) throw new Error('OpenCode Go 未返回用量信息。')
  return { unit: '%', meters }
}

async function queryAccount(account) {
  const provider = ACCOUNT_PROVIDERS[account.provider]
  if (!provider) throw new Error(`暂不支持的供应商：${account.provider}`)

  const response = await fetch(provider.url, {
    headers: { Authorization: `Bearer ${account.apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  })

  const raw = await response.text()
  let body = null
  if (raw) {
    try {
      body = JSON.parse(raw)
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    const detail = body?.error?.message ?? body?.message ?? ''
    if (response.status === 401) {
      throw new Error(
        `${provider.label} 拒绝了该 Key（HTTP 401），请确认是否填错或已失效。${detail}`,
      )
    }
    if (response.status === 403) {
      throw new Error(`${provider.label} 无权访问：Key 有效但缺少对应订阅（HTTP 403）。${detail}`)
    }
    throw new Error(
      `${provider.label} 查询失败（HTTP ${response.status}）。${detail || raw.slice(0, 160)}`,
    )
  }

  if (!body) throw new Error(`${provider.label} 返回了无法解析的内容。`)
  return normalizeBalance(account.provider, body)
}

/** 跑一次查询并把结果写回账号对象（含状态与时间戳） */
async function applyRefresh(account) {
  try {
    account.balance = await queryAccount(account)
    account.status = 'ok'
    account.error = null
  } catch (error) {
    account.status = 'error'
    account.error = error instanceof Error ? error.message : String(error)
  }
  account.lastChecked = new Date().toISOString()
}

app.get('/api/accounts', (_req, res) => {
  try {
    return ok(res, readAccounts().accounts.map(publicAccount))
  } catch (error) {
    return fail(res, `读取账本失败：${error.message}`, 500)
  }
})

app.post('/api/accounts', async (req, res) => {
  const provider = req.body?.provider
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
  if (!isProvider(provider)) return fail(res, '请选择 DeepSeek 或 OpenCode Go。')
  if (!apiKey) return fail(res, 'API Key 不能为空。')

  const data = readAccounts()
  if (data.accounts.some((item) => item.provider === provider && item.apiKey === apiKey)) {
    return fail(res, '该配置已存在。', 409)
  }

  const account = {
    id: crypto.randomUUID(),
    provider,
    apiKey,
    balance: null,
    status: 'pending',
    lastChecked: null,
    error: null,
  }
  // 保存后立刻查询一次：用户填完 Key 就能马上看到余额
  await applyRefresh(account)
  data.accounts.push(account)
  await writeAccounts(data)
  return ok(res, publicAccount(account), 201)
})

app.post('/api/accounts/refresh', async (_req, res) => {
  const data = readAccounts()
  await Promise.all(data.accounts.map((account) => applyRefresh(account)))
  await writeAccounts(data)
  return ok(res, data.accounts.map(publicAccount))
})

app.post('/api/accounts/:id/refresh', async (req, res) => {
  const data = readAccounts()
  const account = data.accounts.find((item) => item.id === req.params.id)
  if (!account) return fail(res, '账本配置不存在。', 404)
  await applyRefresh(account)
  await writeAccounts(data)
  return ok(res, publicAccount(account))
})

app.delete('/api/accounts/:id', async (req, res) => {
  const data = readAccounts()
  const next = data.accounts.filter((item) => item.id !== req.params.id)
  if (next.length === data.accounts.length) return fail(res, '账本配置不存在。', 404)
  data.accounts = next
  await writeAccounts(data)
  return ok(res, { deleted: true })
})

app.get('/api/pricing', (_req, res) => {
  try {
    return ok(res, readPricing())
  } catch (error) {
    return fail(res, `读取价格数据失败：${error.message}`, 500)
  }
})

app.get('/api/meta', (_req, res) => {
  try {
    return ok(res, readPricing().meta)
  } catch (error) {
    return fail(res, `读取汇率失败：${error.message}`, 500)
  }
})

app.put('/api/meta/rate', async (req, res) => {
  const rate = Number(req.body?.usdToCny)
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    return fail(res, '汇率需为 0 – 100 之间的数字。')
  }
  try {
    const data = readPricing()
    data.meta.usdToCny = rate
    data.meta.rateDate = new Date().toISOString().slice(0, 10)
    await fsp.writeFile(PRICING_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    return ok(res, data.meta)
  } catch (error) {
    return fail(res, `写入汇率失败：${error.message}`, 500)
  }
})
app.use(express.static(DIST_DIR))

app.get(/^(?!\/api|\/generated).*/, (_req, res) => {
  const indexFile = path.join(DIST_DIR, 'index.html')
  if (!fs.existsSync(indexFile)) return fail(res, 'Not Found', 404)
  return res.sendFile(indexFile)
})

app.use((_req, res) => fail(res, 'Not Found', 404))
// multer（参考图上传）的错误要给出可读提示，而不是笼统的 500
app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: `单张参考图不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB。`,
      LIMIT_FILE_COUNT: `参考图最多 ${MAX_REFS} 张。`,
      LIMIT_UNEXPECTED_FILE: `参考图最多 ${MAX_REFS} 张，字段名应为 files。`,
    }
    return fail(res, messages[error.code] ?? `上传失败：${error.message}`)
  }
  return next(error)
})

app.use((error, _req, res, _next) => {
  console.error('[server] 未捕获错误：', error)
  fail(res, '服务器内部错误', 500)
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  狼与香辛料 · 生图服务已启动  http://127.0.0.1:${PORT}`)
  console.log(`  模型：${IMAGE_MODEL}${API_KEY ? '' : '   ⚠ 未配置 TOKENWORLD_API_KEY'}`)
  console.log(`  产物目录：${GENERATED_DIR}\n`)
})
