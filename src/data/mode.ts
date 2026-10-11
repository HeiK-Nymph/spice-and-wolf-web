/**
 * 数据来源开关。
 *
 * http  —— 走 /api（本机 Node 服务，见 server/）—— 开发与自用版本
 * local —— 全部在浏览器本地完成，不向任何服务端发请求 —— 静态站点版本
 *
 * 这个值由构建模式决定：`vite build --mode pages` 会让 vite.config.ts 把
 * __LOCAL_SOURCE__ 定义成 true。它是构建期字面量，所以两套实现各自只留一套，
 * 见 src/data/*.source.ts。
 */
export type DataSource = 'http' | 'local'

/** 当前是否是「单机版」构建 */
export const IS_LOCAL_SOURCE = __LOCAL_SOURCE__

export const DATA_SOURCE: DataSource = IS_LOCAL_SOURCE ? 'local' : 'http'
