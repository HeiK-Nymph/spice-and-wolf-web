/**
 * GitHub Pages 项目站点的收尾件（在 vite build --mode pages 之后跑）：
 *
 *   404.html —— Pages 没有 rewrite 规则，深链（/<repo>/market）要由它接管，
 *               内容就是 index.html 的副本；SPA 路由起来后地址栏不变。
 *   .nojekyll —— 不加的话 GitHub 会拿 Jekyll 处理产物，以 _ 开头的文件会被吃掉，
 *               而 Vite 的 chunk 里正好有 _plugin-vue_export-helper-*.js。
 */
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, process.argv[2] ?? 'dist-pages')
const indexHtml = resolve(outDir, 'index.html')

if (!existsSync(indexHtml)) {
  console.error(`[pages] 找不到 ${indexHtml}，先跑 npm run build:pages`)
  process.exit(1)
}

copyFileSync(indexHtml, resolve(outDir, '404.html'))
writeFileSync(resolve(outDir, '.nojekyll'), '')
console.log('[pages] 已写入 404.html（SPA 回退）与 .nojekyll')