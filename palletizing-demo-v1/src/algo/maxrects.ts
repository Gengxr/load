import type { Rect } from './geometry'

/**
 * 混合规格单层装填：MaxRects（Jylänki, 2010）
 * 采用"全局最优匹配"：每一步在所有剩余货物类型 × 所有空闲矩形中选评分最好的放置。
 * 同尺寸货物合并为一个类型，复杂度与件数基本无关。
 */

export interface PackItem {
  id: number
  w: number
  h: number
  canRotate: boolean
  /** 优先级：数值小的先放；只有高优先级都放不下时才考虑低优先级（例如叠放列作为填缝） */
  prio: number
}

export interface Packed extends Rect {
  id: number
  rotated: boolean
}

export type Heuristic = 'bssf' | 'baf' | 'bl' | 'cp'

interface Type {
  w: number
  h: number
  canRotate: boolean
  prio: number
  ids: number[]
}

export function maxRectsPack(items: PackItem[], W: number, L: number, heuristic: Heuristic): Packed[] {
  const types = new Map<string, Type>()
  for (const it of items) {
    const key = `${it.w}x${it.h}:${it.canRotate}:${it.prio}`
    let t = types.get(key)
    if (!t) types.set(key, (t = { w: it.w, h: it.h, canRotate: it.canRotate, prio: it.prio, ids: [] }))
    t.ids.push(it.id)
  }
  // 大件优先：同分时先放面积大的类型
  const typeList = [...types.values()].sort((p, q) => p.prio - q.prio || q.w * q.h - p.w * p.h)
  const prios = [...new Set(typeList.map((t) => t.prio))].sort((p, q) => p - q)

  let free: Rect[] = [{ x: 0, y: 0, w: W, h: L }]
  const placed: Packed[] = []

  for (;;) {
    let best = null as { t: Type; r: Rect; rot: boolean; s1: number; s2: number } | null
    for (const pr of prios) {
      for (const t of typeList) {
        if (t.prio !== pr || !t.ids.length) continue
        for (const f of free) {
          for (let o = 0; o < (t.canRotate && t.w !== t.h ? 2 : 1); o++) {
            const w = o ? t.h : t.w
            const h = o ? t.w : t.h
            if (w > f.w || h > f.h) continue
            const [s1, s2] = score(heuristic, f, f.x, f.y, w, h, placed, W, L)
            if (!best || s1 < best.s1 || (s1 === best.s1 && s2 < best.s2)) {
              best = { t, r: { x: f.x, y: f.y, w, h }, rot: o === 1, s1, s2 }
            }
          }
        }
      }
      if (best) break
    }
    if (!best) break
    const id = best.t.ids.shift()!
    placed.push({ ...best.r, id, rotated: best.rot })
    free = splitFree(free, best.r)
  }
  return placed
}

function score(h: Heuristic, f: Rect, x: number, y: number, w: number, hh: number, placed: Packed[], W: number, L: number): [number, number] {
  switch (h) {
    case 'bssf': {
      const a = Math.abs(f.w - w)
      const b = Math.abs(f.h - hh)
      return [Math.min(a, b), Math.max(a, b)]
    }
    case 'baf': {
      const a = f.w * f.h - w * hh
      return [a, Math.min(Math.abs(f.w - w), Math.abs(f.h - hh))]
    }
    case 'bl':
      return [y + hh, x]
    case 'cp': {
      let c = 0
      if (x === 0 || x + w === W) c += hh
      if (y === 0 || y + hh === L) c += w
      for (const p of placed) {
        if (p.x === x + w || p.x + p.w === x) c += common(p.y, p.y + p.h, y, y + hh)
        if (p.y === y + hh || p.y + p.h === y) c += common(p.x, p.x + p.w, x, x + w)
      }
      return [-c, y + hh]
    }
  }
}

function common(a0: number, a1: number, b0: number, b1: number): number {
  return a1 < b0 || b1 < a0 ? 0 : Math.min(a1, b1) - Math.max(a0, b0)
}

function splitFree(free: Rect[], u: Rect): Rect[] {
  const out: Rect[] = []
  for (const f of free) {
    if (u.x >= f.x + f.w || u.x + u.w <= f.x || u.y >= f.y + f.h || u.y + u.h <= f.y) {
      out.push(f)
      continue
    }
    if (u.x > f.x) out.push({ x: f.x, y: f.y, w: u.x - f.x, h: f.h })
    if (u.x + u.w < f.x + f.w) out.push({ x: u.x + u.w, y: f.y, w: f.x + f.w - (u.x + u.w), h: f.h })
    if (u.y > f.y) out.push({ x: f.x, y: f.y, w: f.w, h: u.y - f.y })
    if (u.y + u.h < f.y + f.h) out.push({ x: f.x, y: u.y + u.h, w: f.w, h: f.y + f.h - (u.y + u.h) })
  }
  // 删除被包含的空闲矩形
  const res: Rect[] = []
  for (let i = 0; i < out.length; i++) {
    const a = out[i]
    let contained = false
    for (let j = 0; j < out.length && !contained; j++) {
      if (i === j) continue
      const b = out[j]
      if (a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h) {
        // 完全相同的矩形只保留下标较小者
        contained = !(a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) || j < i
      }
    }
    if (!contained) res.push(a)
  }
  return res
}
