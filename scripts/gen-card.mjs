#!/usr/bin/env node
/**
 * 2048 卡牌 · 卡图生成器
 * ---------------------------------------------------------------------------
 * 按配方生成「商路卡牌」的卡面插画，落盘到 generated/cards/。
 *
 * 为什么不能直接用 scripts/generate-image.mjs：
 *   · 含角色的卡图必须走 /v1/images/edits 并上传官方参考图（见 AGENTS.md），
 *     而 generate-image.mjs 只会调 /v1/images/generations，做不到这件事；
 *   · 它的 --preset 读的 src/data/gallery.ts 已经不存在了（实测 ENOENT）。
 *   所以这个脚本是必需的第二条生图路径，不是重复建设。
 *
 * 用法：
 *   node scripts/gen-card.mjs --list                       # 列出所有配方
 *   node scripts/gen-card.mjs --recipe holo-1024           # 按配方出图
 *   node scripts/gen-card.mjs --recipe holo-1024 --quality high
 *   node scripts/gen-card.mjs --recipe holo-1024 --format webp --out generated/cards/probe.webp
 *   node scripts/gen-card.mjs --prompt "a wheat sheaf" --size 1024x1024 --quality low
 *
 * 配方（提示词 + 参考图）在 scripts/card-recipes.mjs，运行时不进前端产物。
 */
import 'dotenv/config'

import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const API_KEY = process.env.TOKENWORLD_API_KEY ?? ''
const BASE_URL = (process.env.TOKENWORLD_BASE_URL ?? 'https://tokenworldai.com/v1').replace(
  /\/+$/,
  '',
)
const MODEL = process.env.TOKENWORLD_IMAGE_MODEL ?? 'gpt-image-2'

/** 上游出一张图最长等多久（服务端用 600s，这里对齐） */
const TIMEOUT_MS = 600_000

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

const USAGE = `用法：
  node scripts/gen-card.mjs --list
  node scripts/gen-card.mjs --recipe <id> [--quality high] [--format webp] [--out <path>]
  node scripts/gen-card.mjs --prompt "..." [--size 1024x1536] [--quality low]
  参考图：--ref <path> 可重复出现（最多 4 张，与 MAX_REFS 一致）`

/** 解析 argv；--ref 可重复，收集成数组 */
function parseArgs(argv) {
  const args = { refs: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    const isFlag = next === undefined || next.startsWith('--')
    const value = isFlag ? true : next
    if (!isFlag) i += 1
    if (key === 'ref') args.refs.push(value)
    else args[key] = value
  }
  return args
}

async function readRef(relPath) {
  const abs = path.resolve(ROOT, relPath)
  let buffer
  try {
    buffer = await fs.readFile(abs)
  } catch {
    throw new Error(`参考图读不到：${relPath}`)
  }
  const mime = MIME_BY_EXT[path.extname(abs).toLowerCase()]
  if (!mime) throw new Error(`不认识的参考图格式：${relPath}`)
  return { buffer, mime, filename: path.basename(abs) }
}

/** 有参考图走 edits（multipart，image[] 多图），没有走 generations（JSON） */
function buildRequest({ prompt, size, quality, n, format, refs }) {
  const headers = { Authorization: `Bearer ${API_KEY}` }
  if (refs.length === 0) {
    return {
      url: `${BASE_URL}/images/generations`,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        size,
        quality,
        n,
        response_format: 'b64_json',
        ...(format ? { output_format: format } : {}),
      }),
    }
  }
  const form = new FormData()
  form.append('model', MODEL)
  form.append('prompt', prompt)
  form.append('size', size)
  form.append('quality', quality)
  form.append('n', String(n))
  form.append('response_format', 'b64_json')
  if (format) form.append('output_format', format)
  for (const ref of refs) {
    form.append('image[]', new Blob([ref.buffer], { type: ref.mime }), ref.filename)
  }
  return { url: `${BASE_URL}/images/edits`, headers, body: form }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(USAGE)
    return
  }

  const mod = await import('./card-recipes.mjs')
  const recipes = mod.recipes

  if (args.list) {
    for (const r of recipes) {
      console.log(
        `  ${r.id.padEnd(16)} 面值 ${String(r.value).padEnd(6)} ${r.name}  参考图 ${r.refs.length} 张`,
      )
    }
    return
  }

  let prompt = typeof args.prompt === 'string' ? args.prompt : ''
  let size = typeof args.size === 'string' ? args.size : '1024x1536'
  let refs = []

  if (typeof args.recipe === 'string') {
    const recipe = recipes.find((r) => r.id === args.recipe)
    if (!recipe) {
      console.error(`未找到配方 "${args.recipe}"。用 --list 看可用的。`)
      process.exitCode = 1
      return
    }
    prompt = `${recipe.subject}\n\n${mod.STYLE}`
    size = recipe.size ?? size
    refs = await Promise.all(recipe.refs.map(readRef))
    console.log(`配方：${recipe.id}（${recipe.name} · 面值 ${recipe.value}）`)
  } else {
    refs = await Promise.all(args.refs.map(readRef))
  }

  if (!prompt) {
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  if (!API_KEY) {
    console.error('缺少 TOKENWORLD_API_KEY，请先配置 .env。')
    process.exitCode = 1
    return
  }

  const quality = typeof args.quality === 'string' ? args.quality : 'medium'
  const n = Number(args.n ?? 1)
  const format = typeof args.format === 'string' ? args.format : ''
  const ext = format === 'jpeg' ? '.jpg' : format === 'webp' ? '.webp' : '.png'
  const out = path.resolve(
    ROOT,
    typeof args.out === 'string'
      ? args.out
      : `generated/cards/${args.recipe ?? `probe-${Date.now()}`}${ext}`,
  )

  console.log(
    `模型：${MODEL}  端点：${refs.length ? 'edits' : 'generations'}  尺寸：${size}  质量：${quality}  参考图：${refs.length} 张`,
  )
  if (format) console.log(`请求输出格式：${format}`)
  console.log('生成中（上游超时上限 600s）...')

  const request = buildRequest({ prompt, size, quality, n, format, refs })
  const started = Date.now()
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const body = await response.json().catch(() => null)

  if (!response.ok) {
    console.error(
      `生图失败（${Math.round((Date.now() - started) / 1000)}s）：`,
      body?.error?.message ?? body?.message ?? `HTTP ${response.status}`,
    )
    process.exitCode = 1
    return
  }

  const items = Array.isArray(body?.data) ? body.data : []
  const first = items[0]
  if (!first) {
    console.error('上游未返回图片。')
    process.exitCode = 1
    return
  }

  const buffer = first.b64_json
    ? Buffer.from(first.b64_json, 'base64')
    : first.url
      ? Buffer.from(await (await fetch(first.url)).arrayBuffer())
      : null
  if (!buffer) {
    console.error('上游返回的条目里既没有 b64_json 也没有 url。')
    process.exitCode = 1
    return
  }

  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, buffer)

  // 上游可能无视 output_format —— 按真实文件头报出来，别信自己的参数
  const magic = buffer.subarray(0, 4)
  const hex = magic.toString('hex')
  const kind =
    magic.subarray(0, 4).toString('ascii') === 'RIFF'
      ? 'WEBP'
      : hex === '89504e47'
        ? 'PNG'
        : hex.startsWith('ffd8ff')
          ? 'JPEG'
          : `未知(${hex})`

  console.log(`\n已保存：${path.relative(ROOT, out)}`)
  console.log(`耗时：${Math.round((Date.now() - started) / 1000)}s  体积：${Math.round(buffer.length / 1024)} KB  实际格式：${kind}`)
  if (format && kind.toLowerCase() !== format) {
    console.log(`⚠ 请求了 ${format}，但落盘的是 ${kind} —— 上游忽略了 output_format。`)
  }
}

await main()
