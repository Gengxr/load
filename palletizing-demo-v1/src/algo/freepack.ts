/**
 * 基于高度图的自由码放（用于顶层收尾、以及完全随机尺寸货物的兜底策略）
 *
 * - 10mm 栅格高度图记录当前垛面；
 * - 对每件货物、每种朝向，用滑动窗口最大值一次性求出所有位置的落位高度；
 * - 在最低的若干高度档中评估支撑率、重心投影、空隙体积、贴合度，选最优位置。
 */

export interface FreeVariant {
  a: number
  b: number
  hgt: number
  tipped: boolean
}

export interface FreeUnit {
  key: number
  variants: FreeVariant[]
}

export interface FreePlaced {
  key: number
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
  tipped: boolean
}

export interface FreeBox {
  x: number
  y: number
  dx: number
  dy: number
  z: number
  dz: number
}

export interface FreePackOptions {
  FX: number
  FY: number
  region: [number, number, number, number]
  maxHeight: number
  supportMin: number
  tol: number
  /** 靠近中心放置（顶层收尾时用于重心对中） */
  preferCenter: boolean
}

const CELL = 10

import { supportOf, type Rect } from './geometry'

export function freePack(units: FreeUnit[], existing: FreeBox[], o: FreePackOptions): { placed: FreePlaced[]; unplaced: number[] } {
  const nx = Math.ceil(o.FX / CELL)
  const ny = Math.ceil(o.FY / CELL)
  const hm = new Float64Array(nx * ny)
  for (const b of existing) mark(hm, nx, b.x, b.y, b.dx, b.dy, b.z + b.dz)

  const ix0 = Math.ceil(o.region[0] / CELL)
  const iy0 = Math.ceil(o.region[1] / CELL)
  const ix1 = Math.floor(o.region[2] / CELL)
  const iy1 = Math.floor(o.region[3] / CELL)
  const cx = (o.region[0] + o.region[2]) / 2
  const cy = (o.region[1] + o.region[3]) / 2

  const placed: FreePlaced[] = []
  const unplaced: number[] = []
  const rowMax = new Float64Array(nx * ny)
  const winMax = new Float64Array(nx * ny)

  // 精确几何：栅格只用于快速筛选，最终落位高度与支撑按真实尺寸复核
  const boxes: FreeBox[] = existing.map((b) => ({ ...b }))

  for (const u of units) {
    const cands: { s: number; p: FreePlaced }[] = []
    for (const v of u.variants) {
      for (let r = 0; r < (v.a === v.b ? 1 : 2); r++) {
        const dx = r ? v.b : v.a
        const dy = r ? v.a : v.b
        const cw = Math.ceil(dx / CELL)
        const ch = Math.ceil(dy / CELL)
        const pxMax = ix1 - cw
        const pyMax = iy1 - ch
        if (pxMax < ix0 || pyMax < iy0) continue
        slidingMax(hm, nx, ny, cw, ch, ix0, iy0, ix1, iy1, rowMax, winMax)
        // 按落位高度分桶，从最低开始评估
        const buckets = new Map<number, number[]>()
        for (let j = iy0; j <= pyMax; j++) {
          for (let i = ix0; i <= pxMax; i++) {
            const z = winMax[j * nx + i]
            if (z + v.hgt > o.maxHeight + 1e-6) continue
            const key = Math.round(z)
            let arr = buckets.get(key)
            if (!arr) buckets.set(key, (arr = []))
            arr.push(j * nx + i)
          }
        }
        const levels = [...buckets.keys()].sort((p, q) => p - q)
        let evaluated = 0
        for (let li = 0; li < levels.length && li < 4 && evaluated < 400; li++) {
          const arr = buckets.get(levels[li])!
          // 稀疏采样，避免在大平面上逐格评估
          const stride = Math.max(1, Math.floor(arr.length / 160))
          for (let t = 0; t < arr.length; t += stride) {
            const idx = arr[t]
            const i = idx % nx
            const j = (idx - i) / nx
            const z = winMax[idx]
            const ev = evalAt(hm, nx, ny, i, j, cw, ch, z, o.tol)
            evaluated++
            if (z > 0 && (ev.support < o.supportMin || !ev.quadrants)) continue
            const x = i * CELL
            const y = j * CELL
            const mx = x + dx / 2
            const my = y + dy / 2
            const dist = Math.hypot(mx - cx, my - cy) / 1000
            const s =
              (z + v.hgt) / 100 +
              ev.waste / 100 -
              ev.contact * 0.8 +
              (o.preferCenter ? dist * 1.5 : (x + y) / 4000)
            cands.push({ s, p: { key: u.key, x, y, z, dx, dy, dz: v.hgt, tipped: v.tipped } })
          }
        }
      }
    }
    cands.sort((a, b) => a.s - b.s)
    let chosen: FreePlaced | null = null
    for (let k = 0; k < cands.length && k < 80 && !chosen; k++) {
      const p = cands[k].p
      const z = exactZ(boxes, p)
      if (z + p.dz > o.maxHeight + 1e-6) continue
      if (z > o.tol && !exactSupported(boxes, p, z, o.supportMin, o.tol)) continue
      chosen = { ...p, z }
    }
    if (!chosen) {
      unplaced.push(u.key)
      continue
    }
    mark(hm, nx, chosen.x, chosen.y, chosen.dx, chosen.dy, chosen.z + chosen.dz)
    boxes.push({ x: chosen.x, y: chosen.y, dx: chosen.dx, dy: chosen.dy, z: chosen.z, dz: chosen.dz })
    placed.push(chosen)
  }
  return { placed, unplaced }
}

function exactZ(boxes: FreeBox[], p: FreePlaced): number {
  let z = 0
  for (const b of boxes) {
    if (b.x < p.x + p.dx - 0.5 && p.x < b.x + b.dx - 0.5 && b.y < p.y + p.dy - 0.5 && p.y < b.y + b.dy - 0.5) z = Math.max(z, b.z + b.dz)
  }
  return z
}

function exactSupported(boxes: FreeBox[], p: FreePlaced, z: number, min: number, tol: number): boolean {
  const sup: Rect[] = []
  for (const b of boxes) if (Math.abs(b.z + b.dz - z) <= tol) sup.push({ x: b.x, y: b.y, w: b.dx, h: b.dy })
  const s = supportOf({ x: p.x, y: p.y, w: p.dx, h: p.dy }, sup)
  return s.ratio >= min - 1e-9 && s.cogInside
}

function mark(hm: Float64Array, nx: number, x: number, y: number, dx: number, dy: number, top: number) {
  const i0 = Math.max(0, Math.floor(x / CELL + 1e-6))
  const j0 = Math.max(0, Math.floor(y / CELL + 1e-6))
  const i1 = Math.ceil((x + dx) / CELL - 1e-6)
  const j1 = Math.ceil((y + dy) / CELL - 1e-6)
  const ny = hm.length / nx
  for (let j = j0; j < Math.min(j1, ny); j++) for (let i = i0; i < Math.min(i1, nx); i++) hm[j * nx + i] = Math.max(hm[j * nx + i], top)
}

/** 二维滑动窗口最大值：winMax[j][i] = max hm[j..j+ch-1][i..i+cw-1] */
function slidingMax(
  hm: Float64Array,
  nx: number,
  ny: number,
  cw: number,
  ch: number,
  ix0: number,
  iy0: number,
  ix1: number,
  iy1: number,
  rowMax: Float64Array,
  winMax: Float64Array,
) {
  const dq = new Int32Array(Math.max(nx, ny))
  for (let j = iy0; j < Math.min(iy1, ny); j++) {
    let h = 0,
      t = 0
    for (let i = ix0; i < Math.min(ix1, nx); i++) {
      const v = hm[j * nx + i]
      while (t > h && hm[j * nx + dq[t - 1]] <= v) t--
      dq[t++] = i
      if (dq[h] <= i - cw) h++
      if (i - cw + 1 >= ix0) rowMax[j * nx + (i - cw + 1)] = hm[j * nx + dq[h]]
    }
  }
  for (let i = ix0; i + cw <= Math.min(ix1, nx); i++) {
    let h = 0,
      t = 0
    for (let j = iy0; j < Math.min(iy1, ny); j++) {
      const v = rowMax[j * nx + i]
      while (t > h && rowMax[dq[t - 1] * nx + i] <= v) t--
      dq[t++] = j
      if (dq[h] <= j - ch) h++
      if (j - ch + 1 >= iy0) winMax[(j - ch + 1) * nx + i] = rowMax[dq[h] * nx + i]
    }
  }
}

function evalAt(hm: Float64Array, nx: number, ny: number, i: number, j: number, cw: number, ch: number, z: number, tol: number) {
  let sup = 0
  let waste = 0
  const ci = i + cw / 2
  const cj = j + ch / 2
  let q = 0
  for (let jj = j; jj < j + ch; jj++) {
    for (let ii = i; ii < i + cw; ii++) {
      const h = hm[jj * nx + ii]
      if (h >= z - tol) {
        sup++
        q |= 1 << ((ii + 0.5 < ci ? 0 : 1) | (jj + 0.5 < cj ? 0 : 2))
      } else waste += z - h
    }
  }
  // 贴合度：四周已有货物（或垛形边界）高出本件底面的比例
  let contact = 0
  let per = 0
  for (let ii = i; ii < i + cw; ii++) {
    per += 2
    if (j - 1 < 0 || hm[(j - 1) * nx + ii] > z + tol) contact++
    if (j + ch >= ny || hm[(j + ch) * nx + ii] > z + tol) contact++
  }
  for (let jj = j; jj < j + ch; jj++) {
    per += 2
    if (i - 1 < 0 || hm[jj * nx + i - 1] > z + tol) contact++
    if (i + cw >= nx || hm[jj * nx + i + cw] > z + tol) contact++
  }
  return {
    support: sup / (cw * ch),
    waste: (waste * CELL * CELL) / (cw * ch * CELL * CELL),
    contact: contact / per,
    quadrants: q === 15,
  }
}
