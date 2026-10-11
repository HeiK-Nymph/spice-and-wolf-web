/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/** 由 vite.config.ts 的 define 注入：true = 单机版（数据全部在浏览器本地） */
declare const __LOCAL_SOURCE__: boolean
