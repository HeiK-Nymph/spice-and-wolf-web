/**
 * 竖屏手机判定 —— 全站唯一来源。
 * 与 style.css 第 13 节的媒体查询、各组件的手机样式块逐字一致；
 * 桌面端 / 平板 / 横屏手机都不命中，所以「手机分支」碰不到桌面观感。
 */
export const PHONE_QUERY = '(max-width: 700px) and (orientation: portrait)'

/** 当前视口是否属于「竖屏手机」 */
export function isPhoneViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches
}
