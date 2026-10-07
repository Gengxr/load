/**
 * 对照算法：DBLF（Deepest-Bottom-Left with Fill，最深-最低-最左填充）
 *
 * 出处：Karabulut K., İnceoğlu M. M. A Hybrid Genetic Algorithm for Packing in 3D with Deepest Bottom Left
 *       with Fill Method. ADVIS 2004, LNCS 3261, pp. 441–450.
 * 这是三维装箱文献中最常用的对照算法之一。它同时决定"放在哪"和"先放哪件"，因此可以与本方案做整体对比。
 *
 * 放置规则（原文）：每件货物放到当前可行位置中【最深】的一个；深度相同取【最低】；再相同取【最左】。
 *   "Fill" 指每次都重新考察所有空位，能填进之前留下的空隙。
 *
 * 用于货盘时的约定（均为保证可比性，不改变放置规则本身）：
 *   · "深"取远离操作者的一侧（Y 大的一侧），与集装箱"从里向外装"一致；
 *   · 货物按体积从大到小依次放置（原文用遗传算法搜索放置次序，这里取文献中常用的静态排序，不含遗传算法）；
 *   · 允许绕竖轴旋转 90°，不允许侧放；
 *   · 与本方案受同样的硬约束：垛形不超过 footprint × maxStackHeight，底面支撑率 ≥ supportRatioMin 且重心投影
 *     落在支撑面内 —— 否则基线会码出悬空的垛，比较没有意义。
 */
import type { Cargo, Constraints, LayerInfo, LayoutResult, Placement } from './types'
import { bboxOf, supportOf, unionArea } from './geometry'

const EPS = 0.5

interface Box {
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
}

export function dblfLayout(cargos: Cargo[], cons: Constraints): { layout: LayoutResult; supporters: number[][] } {
  const FX = cons.footprintX
  const FY = cons.footprintY
  const H = cons.maxStackHeight
  const tol = cons.heightTolerance

  // 放置次序：体积大的先放；体积相同底面积大的先放；再按重量、编号（保证结果确定）
  const order = [...cargos].sort(
    (a, b) =>
      b.length * b.width * b.height - a.length * a.width * a.height ||
      b.length * b.width - a.length * a.width ||
      b.weight - a.weight ||
      (a.id < b.id ? -1 : 1),
  )

  const placed: Box[] = []
  const placements: Placement[] = []
  const supporters: number[][] = []
  const remaining: Cargo[] = []
  // 候选坐标：左边界 / 已放货物的右侧面；远端边界 / 已放货物的近侧面（以"到远端的距离"表示深度）
  const xs = new Set<number>([0])
  const ds = new Set<number>([0])

  for (const c of order) {
    const l = Math.max(c.length, c.width)
    const w = Math.min(c.length, c.width)
    const dz = c.height
    const orients: [number, number][] = l === w ? [[l, w]] : [[l, w], [w, l]]
    const xList = [...xs].sort((p, q) => p - q)
    const dList = [...ds].sort((p, q) => p - q)
    let best = null as { x: number; y: number; z: number; dx: number; dy: number; sup: number[] } | null

    // 最深优先：按深度从小到大逐档查找，找到可行位置即停止
    for (const d of dList) {
      for (const [dx, dy] of orients) {
        const y = FY - d - dy
        if (y < -EPS) continue
        for (const x of xList) {
          if (x + dx > FX + EPS) break
          // 竖直落下后的静止高度 = 脚下所有货物顶面的最大值
          let z = 0
          for (const b of placed) {
            if (x < b.x + b.dx - EPS && b.x < x + dx - EPS && y < b.y + b.dy - EPS && b.y < y + dy - EPS) z = Math.max(z, b.z + b.dz)
          }
          if (z + dz > H + EPS) continue
          // 同一深度内：最低优先，再最左
          if (best && (z > best.z + EPS || (Math.abs(z - best.z) <= EPS && x >= best.x))) continue
          const sup: number[] = []
          if (z > tol) {
            const rects = []
            for (let i = 0; i < placed.length; i++) {
              const b = placed[i]
              if (Math.abs(b.z + b.dz - z) <= tol && x < b.x + b.dx - EPS && b.x < x + dx - EPS && y < b.y + b.dy - EPS && b.y < y + dy - EPS) {
                sup.push(i)
                rects.push({ x: b.x, y: b.y, w: b.dx, h: b.dy })
              }
            }
            const s = supportOf({ x, y, w: dx, h: dy }, rects)
            if (s.ratio < cons.supportRatioMin - 1e-9 || !s.cogInside) continue
          }
          best = { x, y, z, dx, dy, sup }
        }
      }
      if (best) break
    }

    if (!best) {
      remaining.push(c)
      continue
    }
    placed.push({ x: best.x, y: best.y, z: best.z, dx: best.dx, dy: best.dy, dz })
    supporters.push(best.sup)
    // 支撑层级：落在货盘上为 0，否则 = 支撑者的最大层级 + 1
    const layer = best.sup.length ? Math.max(...best.sup.map((i) => placements[i].layer)) + 1 : 0
    placements.push({
      cargoId: c.id,
      sku: c.sku,
      x: best.x,
      y: best.y,
      z: best.z,
      dx: best.dx,
      dy: best.dy,
      dz,
      rotated: best.dy > best.dx,
      tipped: false,
      layer,
      weight: c.weight,
    })
    xs.add(best.x + best.dx)
    ds.add(FY - best.y)
  }

  const nLayers = placements.reduce((m, p) => Math.max(m, p.layer + 1), 0)
  const layers: LayerInfo[] = Array.from({ length: nLayers }, (_, li) => {
    const pl = placements.filter((p) => p.layer === li)
    const rects = pl.map((p) => ({ x: p.x, y: p.y, w: p.dx, h: p.dy }))
    const z = Math.min(...pl.map((p) => p.z))
    return {
      index: li,
      z,
      height: Math.max(...pl.map((p) => p.z + p.dz)) - z,
      kind: 'free',
      count: pl.length,
      utilization: unionArea(rects) / (FX * FY),
      bbox: bboxOf(rects),
      weight: pl.reduce((s, p) => s + p.weight, 0),
    }
  })
  return { layout: { placements, layers, remaining, strategy: 'free' }, supporters }
}
