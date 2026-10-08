/** 轴对齐矩形（俯视）：x,y 为最小角点，w 沿 X，h 沿 Y */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const EPS = 0.5

export function overlap1d(a0: number, a1: number, b0: number, b1: number): number {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
}

export function overlapArea(a: Rect, b: Rect): number {
  return overlap1d(a.x, a.x + a.w, b.x, b.x + b.w) * overlap1d(a.y, a.y + a.h, b.y, b.y + b.h)
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS
  )
}

export function bboxOf(rects: Rect[]): [number, number, number, number] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const r of rects) {
    x0 = Math.min(x0, r.x)
    y0 = Math.min(y0, r.y)
    x1 = Math.max(x1, r.x + r.w)
    y1 = Math.max(y1, r.y + r.h)
  }
  return rects.length ? [x0, y0, x1, y1] : [0, 0, 0, 0]
}

/** 矩形并集面积（坐标压缩，精确） */
export function unionArea(rects: Rect[]): number {
  if (!rects.length) return 0
  const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b)
  const ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b)
  let area = 0
  for (let i = 0; i + 1 < xs.length; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2
    for (let j = 0; j + 1 < ys.length; j++) {
      const cy = (ys[j] + ys[j + 1]) / 2
      for (const r of rects) {
        if (cx > r.x && cx < r.x + r.w && cy > r.y && cy < r.y + r.h) {
          area += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
          break
        }
      }
    }
  }
  return area
}

type Pt = [number, number]

/** Andrew 单调链凸包 */
export function convexHull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Pt[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Pt[] = []
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop()
    upper.push(q)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

/** 点是否在凸多边形内（含边界，容差 tol mm） */
export function pointInConvex(poly: Pt[], x: number, y: number, tol = 1): boolean {
  if (poly.length === 0) return false
  if (poly.length < 3) {
    const xs = poly.map((q) => q[0])
    const ys = poly.map((q) => q[1])
    return (
      x >= Math.min(...xs) - tol && x <= Math.max(...xs) + tol && y >= Math.min(...ys) - tol && y <= Math.max(...ys) + tol
    )
  }
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]
    const [bx, by] = poly[(i + 1) % poly.length]
    const len = Math.hypot(bx - ax, by - ay) || 1
    if (((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len < -tol) return false
  }
  return true
}

/**
 * 支撑评估：box 底面落在 supports 顶面上的面积比例，
 * 以及 box 重心投影是否落在接触区域凸包内。
 */
export function supportOf(box: Rect, supports: Rect[]): { ratio: number; cogInside: boolean } {
  const pts: Pt[] = []
  const parts: Rect[] = []
  for (const s of supports) {
    const x0 = Math.max(box.x, s.x)
    const x1 = Math.min(box.x + box.w, s.x + s.w)
    const y0 = Math.max(box.y, s.y)
    const y1 = Math.min(box.y + box.h, s.y + s.h)
    if (x1 - x0 > EPS && y1 - y0 > EPS) {
      parts.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      pts.push([x0, y0], [x1, y0], [x1, y1], [x0, y1])
    }
  }
  // 支撑面之间正常不重叠；取并集以免异常输入被重复计算
  const area = parts.length === 1 ? parts[0].w * parts[0].h : unionArea(parts)
  const ratio = area / (box.w * box.h)
  const cogInside = pointInConvex(convexHull(pts), box.x + box.w / 2, box.y + box.h / 2)
  return { ratio: Math.min(1, ratio), cogInside }
}
