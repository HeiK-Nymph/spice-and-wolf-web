#!/usr/bin/env node
/**
 * 截图 + 抓控制台报错（零依赖，走 CDP）。
 *
 * 为什么不用 puppeteer / playwright：本机没装，装了也重。Node 22 自带 WebSocket，
 * 直接跟 Chrome DevTools Protocol 说话就够了。见 AGENTS.md「失败重试要有硬边界」。
 *
 * 用法：
 *   node scripts/shot.mjs --url http://localhost:5173/game --out generated/_shot.png
 *   node scripts/shot.mjs --url ... --width 390 --height 844 --wait 6000 --dpr 2
 *   node scripts/shot.mjs --url ... --eval "document.title" --full
 *
 * 注意：WebGL 需要 --enable-unsafe-swiftshader（headless 里没有真 GPU，走软件渲染）。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.access(candidate)
      return candidate
    } catch {
      /* 继续找下一个 */
    }
  }
  throw new Error('找不到 Chrome / Edge。')
}

/** 等 DevTools 的 HTTP 端点起来，返回页面 target 的 WebSocket 地址 */
async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* 还没起来 */
    }
    await sleep(150)
  }
  throw new Error('Chrome 的调试端口没起来。')
}

/** 极简 CDP 客户端 */
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    const listeners = new Set()
    let nextId = 0

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const entry = pending.get(message.id)
        if (!entry) return
        pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message))
        else entry.resolve(message.result)
        return
      }
      if (message.method) listeners.forEach((fn) => fn(message))
    })
    socket.addEventListener('error', () => reject(new Error('CDP WebSocket 出错')))
    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = ++nextId
          socket.send(JSON.stringify({ id, method, params }))
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej }))
        },
        on(fn) {
          listeners.add(fn)
        },
        close() {
          socket.close()
        },
      })
    })
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const url = args.url ?? 'about:blank'
  const width = Number(args.width ?? 1600)
  const height = Number(args.height ?? 1000)
  const dpr = Number(args.dpr ?? 1)
  const wait = Number(args.wait ?? 4500)
  const out = path.resolve(args.out ?? 'generated/_shot.png')
  const chrome = await findChrome()
  const port = Number(args.port ?? 9333)
  const profile = path.join(process.env.TEMP ?? '.', `cdp-profile-${Date.now()}`)

  const child = spawn(
    chrome,
    [
      '--headless=new',
      // 注意：不要加 --disable-gpu —— 它和软件 WebGL 一起会把合成帧搞成全黑截图。
      // 正确做法是让 ANGLE 走 SwiftShader（headless 里没有真 GPU）。
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--mute-audio',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      url,
    ],
    { stdio: 'ignore' },
  )

  let client
  try {
    client = await connect(await waitForTarget(port, 20000))

    const problems = []
    await client.send('Runtime.enable')
    await client.send('Log.enable')
    client.on((message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails
        problems.push(`未捕获异常: ${details.exception?.description ?? details.text}`)
      }
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        const text = message.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')
        problems.push(`console.${message.params.type}: ${text}`)
      }
      if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) {
        problems.push(`log.${message.params.entry.level}: ${message.params.entry.text}`)
      }
    })

    if (dpr !== 1) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: dpr,
        mobile: false,
      })
    }

    await sleep(wait)

    if (typeof args.eval === 'string') {
      const result = await client.send('Runtime.evaluate', {
        expression: args.eval,
        returnByValue: true,
        awaitPromise: true,
      })
      console.log('eval 结果：', JSON.stringify(result.result?.value ?? result.result?.description ?? null))
    }

    const shot = await client.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: Boolean(args.full),
    })
    await fs.mkdir(path.dirname(out), { recursive: true })
    await fs.writeFile(out, Buffer.from(shot.data, 'base64'))
    console.log(`截图已保存：${path.relative(process.cwd(), out)}（${width}x${height} @${dpr}x）`)

    if (problems.length > 0) {
      console.log(`\n⚠ 页面报了 ${problems.length} 条问题：`)
      for (const line of problems.slice(0, 25)) console.log(`  · ${line}`)
    } else {
      console.log('\n页面无 console 报错 / 异常。')
    }
  } finally {
    client?.close()
    child.kill()
    await sleep(250)
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

await main()
