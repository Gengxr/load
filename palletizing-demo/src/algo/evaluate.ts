/**
 * 指标评估器：技术要求表 2-2 的码盘指标 + 稳定性研发指标。
 * 生产与报告共用这一个评估器；测试中另用独立的手算用例核对（tests/evaluate.test.ts）。
 */
import type { Constraints, LayoutMetrics, LayoutResult, MetricItem, PalletSpec, Placement } from './types'
import { bboxOf, overlap1d, supportOf } from './geometry'
import { computeLoads, loadRatio } from './bearing'

const pct = (v: number, d = 1) => (v * 100).toFixed(d) + '%'

/** 必须达标的指标：技术要求表 2-2 的各项，加上本项目要求的货物承压 */
export const isRequired = (m: MetricItem) => m.source.startsWith('表') || m.key === 'bearing'

export function systemCog(placements: Placement[], pallet: PalletSpec, cons: Constraints): [number, number, number, number] {
  let m = pallet.tareWeight
  let mx = pallet.tareWeight * (cons.footprintX / 2)
  let my = pallet.tareWeight * (cons.footprintY / 2)
  let mz = pallet.tareWeight * (-pallet.height / 2)
  for (const p of placements) {
    m += p.weight
    mx += p.weight * (p.x + p.dx / 2)
    my += p.weight * (p.y + p.dy / 2)
    mz += p.weight * (p.z + p.dz / 2)
  }
  return [mx / m, my / m, mz / m, m]
}

export function evaluateLayout(layout: LayoutResult, pallet: PalletSpec, cons: Constraints, elapsedMs: number): LayoutMetrics {
  const pl = layout.placements
  const tol = cons.heightTolerance
  const rects = pl.map((p) => ({ x: p.x, y: p.y, w: p.dx, h: p.dy }))
  const [bx0, by0, bx1, by1] = bboxOf(rects)
  const height = pl.length ? Math.max(...pl.map((p) => p.z + p.dz)) : 0
  const stackSize: [number, number, number] = [bx1 - bx0, by1 - by0, height]
  const cargoWeight = pl.reduce((s, p) => s + p.weight, 0)
  const lowerHalfMassRatio = cargoWeight ? pl.filter((p) => p.z + p.dz / 2 < height / 2).reduce((s, p) => s + p.weight, 0) / cargoWeight : 0
  const [cx, cy, cz, gross] = systemCog(pl, pallet, cons)
  const base = cons.cogOffsetBase === 'pallet' ? pallet.length : cons.footprintX
  const baseY = cons.cogOffsetBase === 'pallet' ? pallet.width : cons.footprintY
  const cogOffsetRatio: [number, number] = [(cx - cons.footprintX / 2) / base, (cy - cons.footprintY / 2) / baseY]
  const cogHeightTotal = cz + pallet.height
  const cogHeightRatio = pl.length ? cogHeightTotal / (height + pallet.height) : 0

  const layerUtilization = layout.layers.map((l) => l.utilization)
  const judged = layerUtilization.length > 1 ? layerUtilization.slice(0, -1) : layerUtilization
  const minLayerUtilization = judged.length ? Math.min(...judged) : 0
  const meanUtil = judged.length ? judged.reduce((a, b) => a + b, 0) / judged.length : 0

  // 相邻层外轮廓外扩
  let maxOverhangRatio = 0
  for (let i = 1; i < layout.layers.length; i++) {
    const [lx0, ly0, lx1, ly1] = layout.layers[i - 1].bbox
    const [ux0, uy0, ux1, uy1] = layout.layers[i].bbox
    const w = lx1 - lx0 || 1
    const h = ly1 - ly0 || 1
    maxOverhangRatio = Math.max(maxOverhangRatio, (lx0 - ux0) / w, (ux1 - lx1) / w, (ly0 - uy0) / h, (uy1 - ly1) / h)
  }

  // 支撑
  let minSupportRatio = 1
  let cogOutside = 0
  for (let j = 0; j < pl.length; j++) {
    const b = pl[j]
    if (b.z <= tol) continue
    const sup = []
    for (let i = 0; i < pl.length; i++) {
      if (i === j) continue
      const a = pl[i]
      if (Math.abs(a.z + a.dz - b.z) <= tol) sup.push({ x: a.x, y: a.y, w: a.dx, h: a.dy })
    }
    const s = supportOf({ x: b.x, y: b.y, w: b.dx, h: b.dy }, sup)
    minSupportRatio = Math.min(minSupportRatio, s.ratio)
    if (!s.cogInside) cogOutside++
  }

  // 碰撞与越界
  let collisions = 0
  let outOfBounds = 0
  for (let i = 0; i < pl.length; i++) {
    const a = pl[i]
    if (a.x < -0.5 || a.y < -0.5 || a.x + a.dx > cons.footprintX + 0.5 || a.y + a.dy > cons.footprintY + 0.5 || a.z + a.dz > cons.maxStackHeight + 0.5)
      outOfBounds++
    for (let j = i + 1; j < pl.length; j++) {
      const b = pl[j]
      if (
        overlap1d(a.x, a.x + a.dx, b.x, b.x + b.dx) > 0.5 &&
        overlap1d(a.y, a.y + a.dy, b.y, b.y + b.dy) > 0.5 &&
        overlap1d(a.z, a.z + a.dz, b.z, b.z + b.dz) > 0.5
      )
        collisions++
    }
  }

  // 承压：每件顶面的压重与承压上限比较
  const loads = computeLoads(pl, tol)
  const ratios = pl.map((p, i) => loadRatio(loads[i], p.maxLoad))
  const maxLoadRatio = ratios.length ? Math.max(...ratios) : 0
  const overloaded = ratios.filter((r) => r > 1 + 1e-6).length
  const limited = pl.filter((p) => p.maxLoad !== undefined).length
  const worst = ratios.indexOf(maxLoadRatio)
  const cargoVolume = pl.reduce((s, p) => s + p.dx * p.dy * p.dz, 0)
  const volumeUtilization = height > 0 ? cargoVolume / (cons.footprintX * cons.footprintY * height) : 0

  const interlockRatio = seamCoverage(pl, tol)
  const sec = elapsedMs / 1000
  const fx = cons.footprintX
  const fy = cons.footprintY
  const offMax = Math.max(Math.abs(cogOffsetRatio[0]), Math.abs(cogOffsetRatio[1]))

  const items: MetricItem[] = [
    {
      key: 'cogHeight',
      name: '整托重心高度',
      value: cogHeightRatio,
      display: `${pct(cogHeightRatio)} · ${cogHeightTotal.toFixed(0)} mm`,
      limit: `≤ ${pct(cons.cogHeightRatioMax, 0)} 总高`,
      pass: cogHeightRatio <= cons.cogHeightRatioMax + 1e-9,
      source: '表 2-2 第 1 项',
      note: `总高 = 垛高 ${height} + 货盘 ${pallet.height} mm，含货盘自重`,
    },
    {
      key: 'cogOffset',
      name: '重心偏离几何中心',
      value: offMax,
      display: `X ${signedPct(cogOffsetRatio[0])} · Y ${signedPct(cogOffsetRatio[1])}`,
      limit: `≤ ±${pct(cons.cogOffsetRatioMax, 0)}`,
      pass: offMax <= cons.cogOffsetRatioMax + 1e-9,
      source: '表 2-2 第 2 项',
      note: `基准 = ${cons.cogOffsetBase === 'pallet' ? `货盘 ${pallet.length}×${pallet.width}` : `垛形 ${fx}×${fy}`} mm`,
    },
    {
      key: 'utilization',
      name: '货盘利用率（长宽）',
      value: minLayerUtilization,
      display: `最低 ${pct(minLayerUtilization)} · 平均 ${pct(meanUtil)}`,
      limit: `≥ ${pct(cons.utilizationMin, 0)}`,
      pass: minLayerUtilization >= cons.utilizationMin - 1e-9,
      source: '表 2-2 第 3 项',
      note: `相对 ${fx}×${fy} 可用区域，逐层计算，顶层不计`,
    },
    {
      key: 'envelope',
      name: '垛形外边界',
      value: height,
      display: `${stackSize[0]}×${stackSize[1]}×${height}`,
      limit: cons.minStackHeight > 0 ? `≤ ${fx}×${fy}×(${cons.minStackHeight}–${cons.maxStackHeight})` : `≤ ${fx}×${fy}×${cons.maxStackHeight}`,
      pass: stackSize[0] <= fx + 0.5 && stackSize[1] <= fy + 0.5 && height <= cons.maxStackHeight + 0.5,
      source: '表 2-2 第 4 项',
      note: height < cons.minStackHeight ? `垛高低于 ${cons.minStackHeight} mm：本盘货量不足（由多盘分配决定）` : undefined,
    },
    {
      key: 'bearing',
      name: '货物承压',
      value: maxLoadRatio,
      display: !limited ? '未给承压上限' : overloaded ? `${overloaded} 件超限 · 最大 ${pct(maxLoadRatio, 0)}` : `最大承压比 ${pct(maxLoadRatio, 0)}`,
      limit: '压重 ≤ 承压上限',
      pass: limited ? overloaded === 0 : null,
      source: '承压（项目要求）',
      note:
        limited && worst >= 0 && maxLoadRatio > 0
          ? `压得最重的一件：上方压重 ${loads[worst].toFixed(1)} kg，承压上限 ${pl[worst].maxLoad} kg。压重按接触面积向下逐层传递`
          : '每件货物顶面承受的压重（上方货物的重量按接触面积向下传递）不超过它的承压上限',
    },
    {
      key: 'overhang',
      name: '码盘垛形误差',
      value: maxOverhangRatio,
      display: `上层最大外扩 ${pct(Math.max(0, maxOverhangRatio))}`,
      limit: `≤ ${pct(cons.overhangRatioMax, 0)}`,
      pass: maxOverhangRatio <= cons.overhangRatioMax + 1e-9,
      source: '表 2-2 第 5 项',
    },
    {
      key: 'time',
      name: '方案生成用时',
      value: sec,
      display: sec < 1 ? `${elapsedMs.toFixed(0)} ms` : `${sec.toFixed(2)} s`,
      limit: '≤ 120 s / 垛',
      pass: sec <= 120,
      source: '表 2-2 第 7 项',
    },
    {
      key: 'support',
      name: '最小底面支撑率',
      value: minSupportRatio,
      display: `${pct(minSupportRatio)}${cogOutside ? ` · ${cogOutside} 件重心出界` : ''}`,
      limit: `≥ ${pct(cons.supportRatioMin, 0)}`,
      pass: minSupportRatio >= cons.supportRatioMin - 1e-9 && cogOutside === 0,
      source: '稳定性（研发约束）',
      note: '每件货物底面被下方货物托住的比例，且重心投影落在支撑区内',
    },
    {
      key: 'collision',
      name: '碰撞 / 越界',
      value: collisions + outOfBounds,
      display: `${collisions} / ${outOfBounds}`,
      limit: '0 / 0',
      pass: collisions + outOfBounds === 0,
      source: '硬约束独立校验',
    },
    {
      key: 'volume',
      name: '空间利用率',
      value: volumeUtilization,
      display: pl.length ? pct(volumeUtilization) : '—',
      limit: '参考',
      pass: null,
      source: '空间（参考）',
      note: `货物体积 ÷（${fx}×${fy} × 垛高 ${height} mm）`,
    },
    {
      key: 'bottomHeavy',
      name: '下半垛重量占比',
      value: lowerHalfMassRatio,
      display: pl.length ? pct(lowerHalfMassRatio) : '—',
      limit: '参考',
      pass: null,
      source: '稳定性（参考）',
      note: '大件、重件优先放在下面：垛高一半以下的货物重量占全部货物重量的比例，越高重心越低、越稳',
    },
    {
      key: 'interlock',
      name: '层间压缝率',
      value: interlockRatio,
      display: Number.isNaN(interlockRatio) ? '—' : pct(interlockRatio),
      limit: '参考',
      pass: null,
      source: '稳定性（参考）',
      note: '下层内部接缝被上层货物跨越的长度比例，越高越不易散垛',
    },
  ]

  return {
    stackSize,
    cargoWeight,
    grossWeight: gross,
    cog: [cx, cy, cz],
    cogOffsetRatio,
    cogHeightRatio,
    cogHeightTotal,
    layerUtilization,
    minLayerUtilization,
    maxOverhangRatio,
    minSupportRatio,
    interlockRatio,
    lowerHalfMassRatio,
    loads,
    maxLoadRatio,
    overloaded,
    volumeUtilization,
    collisions,
    outOfBounds,
    items,
  }
}

function signedPct(v: number) {
  return (v >= 0 ? '+' : '−') + (Math.abs(v) * 100).toFixed(1) + '%'
}

/** 压缝率：下层内部接缝（两件相邻的公共边）被上层货物内部跨越的比例 */
export function seamCoverage(pl: Placement[], tol: number): number {
  let total = 0
  let covered = 0
  const STEP = 10
  for (let i = 0; i < pl.length; i++) {
    const a = pl[i]
    const top = a.z + a.dz
    const uppers = pl.filter((u) => Math.abs(u.z - top) <= tol)
    if (!uppers.length) continue
    for (let j = i + 1; j < pl.length; j++) {
      const b = pl[j]
      if (Math.abs(b.z + b.dz - top) > tol) continue
      // 竖直接缝（沿 Y）
      let seg: [number, number, number, number] | null = null
      if (Math.abs(a.x + a.dx - b.x) <= 1 || Math.abs(b.x + b.dx - a.x) <= 1) {
        const x = Math.abs(a.x + a.dx - b.x) <= 1 ? b.x : a.x
        const y0 = Math.max(a.y, b.y)
        const y1 = Math.min(a.y + a.dy, b.y + b.dy)
        if (y1 - y0 > STEP) seg = [x, y0, x, y1]
      } else if (Math.abs(a.y + a.dy - b.y) <= 1 || Math.abs(b.y + b.dy - a.y) <= 1) {
        const y = Math.abs(a.y + a.dy - b.y) <= 1 ? b.y : a.y
        const x0 = Math.max(a.x, b.x)
        const x1 = Math.min(a.x + a.dx, b.x + b.dx)
        if (x1 - x0 > STEP) seg = [x0, y, x1, y]
      }
      if (!seg) continue
      const len = Math.hypot(seg[2] - seg[0], seg[3] - seg[1])
      const n = Math.max(1, Math.floor(len / STEP))
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        const px = seg[0] + (seg[2] - seg[0]) * t
        const py = seg[1] + (seg[3] - seg[1]) * t
        total++
        if (uppers.some((u) => px > u.x + 2 && px < u.x + u.dx - 2 && py > u.y + 2 && py < u.y + u.dy - 2)) covered++
      }
    }
  }
  return total ? covered / total : NaN
}
