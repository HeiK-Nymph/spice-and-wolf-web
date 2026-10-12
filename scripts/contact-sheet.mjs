#!/usr/bin/env node
/**
 * 联系表（contact sheet）：把多张图连同文件名拼成一张，用于「一次看完」。
 *
 * 为什么需要它：本环境只保留最近 6 张图（见 AGENTS.md「读图方法」），
 * 逐张看图会互相挤掉。拼成一张就只占 1 个图片位。
 *
 * 用法：
 *   node scripts/contact-sheet.mjs --out generated/_sheet-items.jpg --cols 4 generated/cards/wheat-2.png ...
 *   node scripts/contact-sheet.mjs --out x.jpg --cols 4 --width 300 a.png b.png
 */
import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'

const PAD = 8
const LABEL_H = 26

function parseArgs(argv) {
  const args = { files: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[i + 1]
      const isFlag = next === undefined || next.startsWith('--')
      args[key] = isFlag ? true : next
      if (!isFlag) i += 1
    } else {
      args.files.push(token)
    }
  }
  return args
}

function escapeXml(text) {
  return text.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const files = args.files
  if (files.length === 0) {
    console.error('至少给一张图。用法见文件头注释。')
    process.exitCode = 1
    return
  }

  const width = Number(args.width ?? 300)
  const cols = Number(args.cols ?? 4)
  const out = path.resolve(args.out ?? 'generated/_sheet.jpg')

  const thumbs = []
  for (const file of files) {
    const meta = await sharp(file).metadata()
    const height = Math.round((width * (meta.height ?? 1)) / (meta.width ?? 1))
    thumbs.push({
      label: path.basename(file),
      input: await sharp(file).resize({ width }).toBuffer(),
      height,
    })
  }

  const rows = Math.ceil(thumbs.length / cols)
  const maxH = Math.max(...thumbs.map((t) => t.height))
  const cellW = width + PAD * 2
  const cellH = maxH + LABEL_H + PAD * 2

  const composites = []
  thumbs.forEach((thumb, index) => {
    const left = (index % cols) * cellW + PAD
    const top = Math.floor(index / cols) * cellH + PAD
    composites.push({ input: thumb.input, left, top })
    const svg = `<svg width="${cellW}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${cellW / 2}" y="${LABEL_H - 8}" font-family="Arial, Helvetica, sans-serif"
        font-size="15" fill="#e9b95c" text-anchor="middle">${escapeXml(thumb.label)}</text>
    </svg>`
    composites.push({ input: Buffer.from(svg), left: (index % cols) * cellW, top: top + thumb.height })
  })

  await sharp({
    create: { width: cols * cellW, height: rows * cellH, channels: 3, background: '#141019' },
  })
    .composite(composites)
    .jpeg({ quality: 84 })
    .toFile(out)

  console.log(`联系表：${path.relative(process.cwd(), out)}  共 ${thumbs.length} 张（${cols} 列）`)
}

await main()
