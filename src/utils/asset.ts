/**
 * public/ 里静态资源的地址。
 *
 * 部署到 GitHub Pages「项目站点」时，站点挂在 /<仓库名>/ 下，所以地址必须带上
 * 部署子路径（Vite 的 BASE_URL）。
 *
 * 注意：模板里的 src="/art/x.webp" 和 CSS 里的 url('/art/x.webp') 会被 Vite
 * 自动加上 base；但写在 JS/TS 字符串里的路径不会被改写，必须过这个函数。
 */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}
