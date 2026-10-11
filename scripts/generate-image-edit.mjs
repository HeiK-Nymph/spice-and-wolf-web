#!/usr/bin/env node
/**
 * 角色图生成 · 多参考图版
 * ---------------------------------------------------------------------------
 * 项目约定（AGENTS.md）：生成任何含角色的图片前，必须先上传该角色的官方立绘参考图；
 * 画面里有几个角色，就要上传几张参考图。本脚本就是干这个的。
 *
 * 用法：
 *   node scripts/generate-image-edit.mjs \
 *     --ref generated/refs/holo.jpg \
 *     --ref generated/refs/lawrence.png \
 *     --prompt "..." --size 1536x1024 --out public/art/scene.png
 *
 * --ref 可重复，每个角色一张。--transparent 可要求透明背景。
 */
import 'dotenv/config'

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const API_KEY = process.env.TOKENWORLD_API_KEY ?? ''
const BASE_URL = (process.env.TOKENWORLD_BASE_URL ?? 'https://tokenworldai.com/v1').replace(/\/+$/, '')
const MODEL = process.env.TOKENWORLD_IMAGE_MODEL ?? 'gpt-image-2'

function parseArgs(argv) {
  const args = { ref: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
    } else {
      if (key === 'ref') args.ref.push(next)
      else args[key] = next
      i += 1
    }
  }
  return args
}

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

const args = parseArgs(process.argv.slice(2))
const prompt = typeof args.prompt === 'string' ? args.prompt : ''
const refs = args.ref

if (!prompt) {
  console.error('请用 --prompt "..." 指定提示词。')
  process.exitCode = 1
} else if (refs.length === 0) {
  console.error('至少要用一个 --ref <官方参考图> 指定角色参考图（项目硬性约定）。')
  process.exitCode = 1
} else if (!API_KEY) {
  console.error('缺少 TOKENWORLD_API_KEY，请先配置 .env。')
  process.exitCode = 1
} else {
  const missing = refs.filter((r) => !fs.existsSync(path.resolve(ROOT, r)))
  if (missing.length) {
    console.error('参考图不存在：', missing.join(', '))
    process.exitCode = 1
  } else {
    const size = typeof args.size === 'string' ? args.size : '1024x1024'
    const quality = typeof args.quality === 'string' ? args.quality : 'medium'
    const count = Number(args.n ?? 1)
    const out = path.resolve(ROOT, typeof args.out === 'string' ? args.out : `generated/edit-${Date.now()}.png`)

    console.log(`模型：${MODEL}  尺寸：${size}  质量：${quality}  参考图：${refs.length} 张`)

    const form = new FormData()
    form.append('model', MODEL)
    form.append('prompt', prompt)
    form.append('size', size)
    form.append('n', String(count))
    form.append('response_format', 'b64_json')
    if (args.transparent) {
      form.append('background', 'transparent')
      form.append('output_format', 'png')
    }
    for (const r of refs) {
      const abs = path.resolve(ROOT, r)
      const ext = path.extname(abs).toLowerCase()
      form.append('image[]', new Blob([fs.readFileSync(abs)], { type: MIME[ext] ?? 'image/png' }), path.basename(abs))
    }

    const response = await fetch(`${BASE_URL}/images/edits`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: form,
      signal: AbortSignal.timeout(300_000),
    })

    const body = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('生成失败：', body?.error?.message ?? body?.message ?? `HTTP ${response.status}`)
      process.exitCode = 1
    } else {
      const items = Array.isArray(body?.data) ? body.data : []
      if (items.length === 0) {
        console.error('上游未返回图片。')
        process.exitCode = 1
      } else {
        fs.mkdirSync(path.dirname(out), { recursive: true })
        const saved = []
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i]
          const buf = item.b64_json
            ? Buffer.from(item.b64_json, 'base64')
            : item.url
              ? Buffer.from(await (await fetch(item.url)).arrayBuffer())
              : null
          if (!buf) continue
          const target = items.length > 1 ? out.replace(/(\.[^.]+)?$/, `-${i + 1}$1`) : out
          fs.writeFileSync(target, buf)
          saved.push(path.relative(ROOT, target))
        }
        console.log('\n已保存：')
        saved.forEach((f) => console.log('  ' + f))
        if (body?.data?.[0]?.revised_prompt) console.log('\n上游改写后的提示词：\n  ' + body.data[0].revised_prompt)
      }
    }
  }
}
