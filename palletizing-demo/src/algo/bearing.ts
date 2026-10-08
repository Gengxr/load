/**
 * 货物承压：每件货物顶面实际承受的压重。
 *
 * 模型（静力、刚性箱体）：一件货物把"自重 + 它顶面承受的压重"按接触面积的比例
 * 传给正下方托住它的各件货物；落在货盘上的不再向下传。从上往下逐件累加即可。
 * 结果与码放顺序无关，且码放过程中任何一步的压重都不超过码完之后的值。
 */
import type { Placement } from './types'
import { overlap1d } from './geometry'

export function computeLoads(pl: Placement[], tol: number): number[] {
  const n = pl.length
  const load = new Array<number>(n).fill(0)
  const order = pl.map((_, i) => i).sort((a, b) => pl[b].z - pl[a].z)
  for (const j of order) {
    const b = pl[j]
    if (b.z <= tol) continue
    const sup: { i: number; a: number }[] = []
    let area = 0
    for (let i = 0; i < n; i++) {
      if (i === j) continue
      const a = pl[i]
      if (Math.abs(a.z + a.dz - b.z) > tol) continue
      const o = overlap1d(a.x, a.x + a.dx, b.x, b.x + b.dx) * overlap1d(a.y, a.y + a.dy, b.y, b.y + b.dy)
      if (o <= 0) continue
      sup.push({ i, a: o })
      area += o
    }
    if (!area) continue
    const w = b.weight + load[j]
    for (const s of sup) load[s.i] += (w * s.a) / area
  }
  return load
}

/** 承压比 = 压重 / 承压上限；未给上限的货物记 0；上限为 0（不可受压）而被压时记 9.99 */
export function loadRatio(load: number, maxLoad: number | undefined): number {
  if (maxLoad === undefined) return 0
  if (maxLoad <= 0) return load > 0.01 ? 9.99 : 0
  return Math.min(9.99, load / maxLoad)
}
