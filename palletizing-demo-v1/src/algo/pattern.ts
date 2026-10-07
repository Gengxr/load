import type { Rect } from './geometry'

/**
 * 同规格单层最优排布（制造商托盘装载问题）
 *
 * 1. 一阶段：基于"标准组合点"(raster points) 的二维断头台动态规划，
 *    g(w,l) = max{ 同向整排, 左右切分, 上下切分 }；
 * 2. 二阶段：五块（风车式）非断头台结构，四个角块 + 中心块，各块再用 g 填充。
 *    技术要求图 2-1 中 300×200、400×300、600×400 等"中心留空 200×200"的风车图案即属此类。
 */

export interface PatternResult {
  count: number
  rects: Rect[]
  /** 'guillotine' | 'pinwheel' */
  structure: string
}

function rasterPoints(a: number, b: number, W: number): number[] {
  const set = new Set<number>()
  for (let i = 0; i * a <= W; i++) for (let j = 0; i * a + j * b <= W; j++) set.add(i * a + j * b)
  return [...set].sort((p, q) => p - q)
}

class Solver {
  readonly X: number[]
  readonly Y: number[]
  private rx: Int32Array
  private ry: Int32Array
  private g: Int32Array
  private ch: Int32Array
  private nx: number
  constructor(
    readonly a: number,
    readonly b: number,
    readonly W: number,
    readonly L: number,
  ) {
    this.X = rasterPoints(a, b, W)
    this.Y = rasterPoints(a, b, L)
    this.nx = this.X.length
    const ny = this.Y.length
    this.rx = floorIndex(this.X, W)
    this.ry = floorIndex(this.Y, L)
    this.g = new Int32Array(this.nx * ny)
    this.ch = new Int32Array(this.nx * ny)
    const { X, Y, g, ch, nx, rx, ry } = this
    for (let i = 0; i < nx; i++) {
      const w = X[i]
      for (let j = 0; j < ny; j++) {
        const l = Y[j]
        let best = Math.floor(w / a) * Math.floor(l / b)
        let c = 0
        const alt = Math.floor(w / b) * Math.floor(l / a)
        if (alt > best) {
          best = alt
          c = 1
        }
        for (let k = 1; k < nx && X[k] * 2 <= w; k++) {
          const v = g[k * ny + j] + g[rx[w - X[k]] * ny + j]
          if (v > best) {
            best = v
            c = 2 + 2 * k
          }
        }
        for (let k = 1; k < ny && Y[k] * 2 <= l; k++) {
          const v = g[i * ny + k] + g[i * ny + ry[l - Y[k]]]
          if (v > best) {
            best = v
            c = 3 + 2 * k
          }
        }
        g[i * ny + j] = best
        ch[i * ny + j] = c
      }
    }
  }

  /** 任意尺寸块（向下取到标准组合点）的最大件数 */
  G(w: number, l: number): number {
    if (w <= 0 || l <= 0) return 0
    return this.g[this.rx[Math.min(w, this.W)] * this.Y.length + this.ry[Math.min(l, this.L)]]
  }

  build(w: number, l: number, ox: number, oy: number, out: Rect[]): void {
    if (w <= 0 || l <= 0) return
    const i = this.rx[Math.min(w, this.W)]
    const j = this.ry[Math.min(l, this.L)]
    this.buildIdx(i, j, ox, oy, out)
  }

  private buildIdx(i: number, j: number, ox: number, oy: number, out: Rect[]): void {
    const ny = this.Y.length
    const c = this.ch[i * ny + j]
    const w = this.X[i]
    const l = this.Y[j]
    const { a, b } = this
    if (c === 0 || c === 1) {
      const bw = c === 0 ? a : b
      const bh = c === 0 ? b : a
      const nxb = Math.floor(w / bw)
      const nyb = Math.floor(l / bh)
      for (let p = 0; p < nxb; p++) for (let q = 0; q < nyb; q++) out.push({ x: ox + p * bw, y: oy + q * bh, w: bw, h: bh })
      return
    }
    if (c % 2 === 0) {
      const k = (c - 2) / 2
      const x = this.X[k]
      this.buildIdx(k, j, ox, oy, out)
      this.buildIdx(this.rx[w - x], j, ox + x, oy, out)
    } else {
      const k = (c - 3) / 2
      const y = this.Y[k]
      this.buildIdx(i, k, ox, oy, out)
      this.buildIdx(i, this.ry[l - y], ox, oy + y, out)
    }
  }
}

function floorIndex(points: number[], max: number): Int32Array {
  const idx = new Int32Array(max + 1)
  let k = 0
  for (let v = 0; v <= max; v++) {
    while (k + 1 < points.length && points[k + 1] <= v) k++
    idx[v] = k
  }
  return idx
}

const cache = new Map<string, PatternResult>()

export function bestPattern(a: number, b: number, W: number, L: number): PatternResult {
  W = Math.floor(W)
  L = Math.floor(L)
  const key = `${a}x${b}@${W}x${L}`
  const hit = cache.get(key)
  if (hit) return hit
  const res = solve(a, b, W, L)
  if (cache.size > 4000) cache.clear()
  cache.set(key, res)
  return res
}

function solve(a: number, b: number, W: number, L: number): PatternResult {
  if ((a > W || b > L) && (b > W || a > L)) return { count: 0, rects: [], structure: 'guillotine' }
  const s = new Solver(a, b, W, L)
  const upper = Math.floor((W * L) / (a * b))
  let best = s.G(W, L)
  let pin: [number, number, number, number] | null = null

  if (best < upper) {
    const P = cutPositions(s.X, W)
    const Q = cutPositions(s.Y, L)
    const work = (P.length * P.length * Q.length * Q.length) / 4
    if (work < 3e7) {
      for (let p1 = 0; p1 < P.length; p1++) {
        const x1 = P[p1]
        for (let p2 = p1 + 1; p2 < P.length; p2++) {
          const x2 = P[p2]
          for (let q1 = 0; q1 < Q.length; q1++) {
            const y1 = Q[q1]
            const b1 = s.G(x2, y1)
            const b4base = x1
            for (let q2 = q1 + 1; q2 < Q.length; q2++) {
              const y2 = Q[q2]
              const v = b1 + s.G(W - x2, y2) + s.G(W - x1, L - y2) + s.G(b4base, L - y1) + s.G(x2 - x1, y2 - y1)
              if (v > best) {
                best = v
                pin = [x1, x2, y1, y2]
                if (best >= upper) break
              }
            }
            if (best >= upper) break
          }
          if (best >= upper) break
        }
        if (best >= upper) break
      }
    }
  }

  const rects: Rect[] = []
  if (pin) {
    const [x1, x2, y1, y2] = pin
    s.build(x2, y1, 0, 0, rects) // 左下
    s.build(W - x2, y2, x2, 0, rects) // 右下
    s.build(W - x1, L - y2, x1, y2, rects) // 右上
    s.build(x1, L - y1, 0, y1, rects) // 左上
    s.build(x2 - x1, y2 - y1, x1, y1, rects) // 中心
  } else {
    s.build(W, L, 0, 0, rects)
  }
  return { count: rects.length, rects: centerRects(rects, W, L), structure: pin ? 'pinwheel' : 'guillotine' }
}

function cutPositions(points: number[], W: number): number[] {
  const set = new Set<number>()
  for (const p of points) {
    if (p > 0 && p < W) set.add(p)
    if (W - p > 0 && W - p < W) set.add(W - p)
  }
  return [...set].sort((p, q) => p - q)
}

/** 把图案整体居中到区域内（外轮廓居中，便于重心对中） */
export function centerRects(rects: Rect[], W: number, L: number): Rect[] {
  if (!rects.length) return rects
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
  const sx = Math.floor((W - (x1 - x0)) / 2) - x0
  const sy = Math.floor((L - (y1 - y0)) / 2) - y0
  return rects.map((r) => ({ ...r, x: r.x + sx, y: r.y + sy }))
}
