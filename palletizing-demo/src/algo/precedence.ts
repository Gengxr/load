/**
 * 码放先后约束图（DAG）
 *
 * 人工/机械手都是"从上方竖直放下"货物，因此：
 *   若 A 与 B 俯视投影重叠，且 A 在 B 下方（A 顶面 ≤ B 底面），则 A 必须先于 B 码放。
 * 其中顶面与 B 底面等高的 A 称为 B 的"直接支撑者"——B 放下时它们必须都已就位，
 * 这保证了每一个中间状态中，每件已放货物都与最终方案一样被完整托住。
 */
import type { Placement } from './types'
import { overlap1d } from './geometry'

export interface Neighbor {
  j: number
  /** 0:+X 1:−X 2:+Y 3:−Y */
  side: number
  len: number
}

export interface Precedence {
  preds: number[][]
  succs: number[][]
  supporters: number[][]
  /** 同高度段内侧面贴合的邻居（用于判断"封闭孔位"） */
  neighbors: Neighbor[][]
}

export function buildPrecedence(pl: Placement[], tol: number): Precedence {
  const n = pl.length
  const preds: number[][] = Array.from({ length: n }, () => [])
  const succs: number[][] = Array.from({ length: n }, () => [])
  const supporters: number[][] = Array.from({ length: n }, () => [])
  const neighbors: Neighbor[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n; i++) {
    const a = pl[i]
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      const b = pl[j]
      const ox = overlap1d(a.x, a.x + a.dx, b.x, b.x + b.dx)
      const oy = overlap1d(a.y, a.y + a.dy, b.y, b.y + b.dy)
      if (ox > 0.5 && oy > 0.5) {
        const aTop = a.z + a.dz
        if (aTop <= b.z + tol) {
          preds[j].push(i)
          succs[i].push(j)
          if (Math.abs(aTop - b.z) <= tol) supporters[j].push(i)
        }
        continue
      }
      // 侧面贴合：竖直方向重叠一半以上
      const oz = overlap1d(a.z, a.z + a.dz, b.z, b.z + b.dz)
      if (oz < 0.5 * Math.min(a.dz, b.dz)) continue
      if (Math.abs(a.x + a.dx - b.x) <= 2 && oy > 0.5) neighbors[i].push({ j, side: 0, len: oy })
      else if (Math.abs(b.x + b.dx - a.x) <= 2 && oy > 0.5) neighbors[i].push({ j, side: 1, len: oy })
      else if (Math.abs(a.y + a.dy - b.y) <= 2 && ox > 0.5) neighbors[i].push({ j, side: 2, len: ox })
      else if (Math.abs(b.y + b.dy - a.y) <= 2 && ox > 0.5) neighbors[i].push({ j, side: 3, len: ox })
    }
  }
  return { preds, succs, supporters, neighbors }
}

/** 放置第 i 件时，被已放货物挡住的侧面数（某侧被挡住 ≥ 60% 边长算封闭） */
export function enclosedSides(i: number, pl: Placement[], prec: Precedence, placed: (j: number) => boolean): number {
  const cover = [0, 0, 0, 0]
  for (const nb of prec.neighbors[i]) if (placed(nb.j)) cover[nb.side] += nb.len
  const p = pl[i]
  let s = 0
  if (cover[0] >= 0.6 * p.dy) s++
  if (cover[1] >= 0.6 * p.dy) s++
  if (cover[2] >= 0.6 * p.dx) s++
  if (cover[3] >= 0.6 * p.dx) s++
  return s
}
