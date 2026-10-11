/** 把站点坐标连成平滑路线的工具（Catmull-Rom → 三次贝塞尔）。 */

export type Point = readonly [number, number]

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

/**
 * Catmull-Rom 样条转三次贝塞尔：曲线精确穿过每个站点，
 * 所以站点坐标一改，路线自动跟着变，无需手工调 path。
 *
 * 少于两个点返回空串（单点无法成线）。
 */
export function buildSmoothPath(points: readonly Point[], tension = 1): string {
  if (points.length < 2) return ''

  const d: string[] = [`M ${fmt(points[0][0])} ${fmt(points[0][1])}`]

  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2

    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension

    d.push(`C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2[0])} ${fmt(p2[1])}`)
  }

  return d.join(' ')
}
