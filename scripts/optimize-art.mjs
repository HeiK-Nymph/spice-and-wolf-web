#!/usr/bin/env node
/**
 * 卡图加工：generated/cards/ 里的原始大图 → public/art/cards/ 里能上线的 webp。
 *
 * 为什么必须有这一步：上游网关【无视 output_format】，无论请求什么都返回 PNG
 * （实测 1024x1024 的低质量 PNG 就有 1.4MB），而线上是静态站，11 张原图会把
 * dist-pages 从 6MB 撑到 30MB+。所以压缩只能在本地做。
 *
 * 用法：
 *   node scripts/optimize-art.mjs                     # 全部加工
 *   node scripts/optimize-art.mjs --width 768 --quality 82
 *   node scripts/optimize-art.mjs --only holo-1024    # 只加工某一组
 *   node scripts/optimize-art.mjs --src generated/bg --out public/art --width 1920   # 加工页面背景
 *
 * 以 `_` 开头的文件（探测图）会被跳过。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 默认处理卡图；用 --src / --out 可以处理别的图（如页面背景） */
const DEFAULT_SRC = 'generated/cards'
const DEFAULT_OUT = 'public/art/cards'

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    const isFlag = next === undefined || next.startsWith('--')
    args[key] = isFlag ? true : next
    if (!isFlag) i += 1
  }
  return args
}

function bytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const width = Number(args.width ?? 768)
  const quality = Number(args.quality ?? 82)
  const srcDir = path.resolve(ROOT, String(args.src ?? DEFAULT_SRC))
  const outDir = path.resolve(ROOT, String(args.out ?? DEFAULT_OUT))

  let files
  try {
    files = await fs.readdir(srcDir)
  } catch {
    console.error(`源目录不存在：${path.relative(ROOT, srcDir)}`)
    process.exitCode = 1
    return
  }

  const targets = files
    .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f) && !f.startsWith('_'))
    .filter((f) => !args.only || f.startsWith(String(args.only)))

  if (targets.length === 0) {
    console.error('没有可加工的图（是不是还没生成？见 scripts/gen-card.mjs --list）')
    process.exitCode = 1
    return
  }

  await fs.mkdir(outDir, { recursive: true })

  let totalIn = 0
  let totalOut = 0

  for (const file of targets.sort()) {
    const src = path.join(srcDir, file)
    const out = path.join(outDir, `${path.basename(file, path.extname(file))}.webp`)

    const input = await fs.readFile(src)
    const buffer = await sharp(input)
      .resize({ width, withoutEnlargement: true })
      .webp({ quality, effort: 5 })
      .toBuffer()
    await fs.writeFile(out, buffer)

    const meta = await sharp(buffer).metadata()
    totalIn += input.length
    totalOut += buffer.length
    console.log(
      `  ${file.padEnd(22)} ${bytes(input.length).padStart(8)} → ${bytes(buffer.length).padStart(8)}  ${meta.width}x${meta.height}`,
    )
  }

  console.log(`\n共 ${targets.length} 张：${bytes(totalIn)} → ${bytes(totalOut)}（压缩到 ${Math.round((totalOut / totalIn) * 100)}%）`)
  console.log(`输出目录：${path.relative(ROOT, outDir)}`)
}

await main()
