import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// 生图接口运行在独立的 Node 服务里（见 server/index.js）。
// 这样 API Key 只存在于服务端，永远不会被编译进前端产物。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiPort = Number(env.PORT || process.env.PORT || 8788)

  // 「单机版」构建（GitHub Pages 项目站点）：vite build --mode pages
  //   · 产物落 dist-pages/，base 取 /<仓库名>/（项目站点不是用户站点）
  //   · 数据与交互全部在浏览器本地完成（见 src/data/*），不代理任何后端
  const isPages = mode === 'pages'
  const pagesBase = env.PAGES_BASE || '/spice-and-wolf-web/'

  return {
    base: isPages ? pagesBase : '/',
    plugins: [vue()],
    define: {
      // 数据接缝的开关（见 src/data/*.source.ts）：写成构建期字面量，
      // 未选中的那条分支连同它的动态 import 会被静态消除，产物里只留一套实现。
      __LOCAL_SOURCE__: JSON.stringify(isPages),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // 单机版没有任何后端可代理：本地起 pages 模式时就直接看静态产物
    server: isPages
      ? { port: 5174 }
      : {
          port: 5173,
          proxy: {
            '/api': {
              target: `http://127.0.0.1:${apiPort}`,
              changeOrigin: true,
            },
            '/generated': {
              target: `http://127.0.0.1:${apiPort}`,
              changeOrigin: true,
            },
          },
        },
    build: {
      outDir: isPages ? 'dist-pages' : 'dist',
      sourcemap: false,
      // three.js 是「道具检视」用的，只在打开检视器时动态 import，
      // 所以它天然是一个 700KB+ 的独立分包 —— 不是首屏体积问题。
      chunkSizeWarningLimit: 800,
    },
  }
})
