#!/usr/bin/env node
/**
 * 麦穗画廊 · 命令行生图工具
 * ---------------------------------------------------------------------------
 * 直接调用 TokenWorld API 生成图片并落盘，用于准备站点的静态美术资源。
 *
 * 用法：
 *   npm run gen:image -- --preset wheat-field --out public/art/hero.png
 *   npm run gen:image -- --prompt "a snowy medieval village" --size 1536x1024
 *   npm run gen:image -- --preset tavern --quality medium --n 2 --out-dir public/art
 *   node scripts/generate-image.mjs --prompt "..." --transparent --out public/art/thing.png
 *
 * 所有参数均可省略，省略时使用 .env 中的默认模型与最低成本档位。
 */
import 'dotenv/config'

import crypto from 'node:crypto'
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

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      args[key] = next
      i += 1
    }
  }
  return args
}

/** 动态导入预设，避免 CLI 依赖 TS 构建产物 */
async function loadPresets() {
  const file = path.join(ROOT, 'src/data/gallery.ts')
  const source = await fs.readFile(file, 'utf8')
  const presets = []
  const re =
    /\{\s*id:\s*'([^']+)',\s*name:\s*'([^']*)',\s*scene:\s*'([^']*)',\s*prompt:\s*\n?\s*'([^']*)',?\s*\}/g
  let match
  while ((match = re.exec(source)) !== null) {
    presets.push({ id: match[1], name: match[2], scene: match[3], prompt: match[4] })
  }
  return presets
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.help) {
    console.log(await fs.readFile(fileURLToPath(import.meta.url), 'utf8'))
    return
  }

  let prompt = typeof args.prompt === 'string' ? args.prompt : ''

  if (typeof args.preset === 'string') {
    const presets = await loadPresets()
    const preset = presets.find((p) => p.id === args.preset)
    if (!preset) {
      console.error(`未找到预设 "${args.preset}"。可用预设：${presets.map((p) => p.id).join(', ')}`)
      process.exitCode = 1
      return
    }
    prompt = preset.prompt
    console.log(`使用预设：${preset.name}（${preset.id}）`)
  }

  if (!prompt) {
    console.error('请用 --prompt "..." 或 --preset <id> 指定提示词。')
    process.exitCode = 1
    return
  }

  if (!API_KEY) {
    console.error('缺少 TOKENWORLD_API_KEY，请先配置 .env。')
    process.exitCode = 1
    return
  }

  const size = typeof args.size === 'string' ? args.size : '1536x1024'
  const quality = typeof args.quality === 'string' ? args.quality : 'low'
  const count = Number(args.n ?? 1)
  const outDir = path.resolve(
    ROOT,
    typeof args['out-dir'] === 'string' ? args['out-dir'] : 'public/art',
  )
  const explicitOut = typeof args.out === 'string' ? path.resolve(ROOT, args.out) : null

  console.log(`模型：${MODEL}  尺寸：${size}  质量：${quality}  数量：${count}`)

  const response = await fetch(`${BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      size,
      quality,
      n: count,
      response_format: 'b64_json',
      // --transparent：让上游直接输出带 Alpha 的 PNG，省掉「白底抠图」那一步
      // （抠图永远会留白边，尤其是物件之间有细缝的时候）
      ...(args.transparent ? { background: 'transparent', output_format: 'png' } : {}),
    }),
    signal: AbortSignal.timeout(240_000),
  })

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    console.error('生图失败：', body?.error?.message ?? body?.message ?? `HTTP ${response.status}`)
    process.exitCode = 1
    return
  }

  const items = Array.isArray(body?.data) ? body.data : []
  if (items.length === 0) {
    console.error('上游未返回图片。')
    process.exitCode = 1
    return
  }

  await fs.mkdir(outDir, { recursive: true })
  const saved = []

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i]
    let buffer
    if (item.b64_json) {
      buffer = Buffer.from(item.b64_json, 'base64')
    } else if (item.url) {
      const remote = await fetch(item.url)
      buffer = Buffer.from(await remote.arrayBuffer())
    } else {
      console.warn(`第 ${i + 1} 张没有可用数据，已跳过。`)
      continue
    }

    const target = explicitOut
      ? explicitOut
      : path.join(outDir, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.png`)

    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, buffer)
    saved.push(path.relative(ROOT, target))
  }

  console.log('\n已保存：')
  saved.forEach((file) => console.log(`  ${file}`))
}

await main()
