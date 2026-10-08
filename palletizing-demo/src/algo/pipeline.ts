/**
 * 码盘联动流程：多盘分配 → 逐盘真实码放 → 放不下的件回流重分（有限次迭代）
 *
 * 单盘求解器通过参数注入：浏览器里是 Web Worker 并行池，测试与命令行里是同步调用。
 */
import type { Cargo, Constraints, PalletSpec, PlanInput, PlanResult, SequenceParams } from './types'
import { allocate, type AllocParams, type AllocationResult } from './allocate'
import type { PalletUnit } from './cabin'

export interface PalletPlan {
  /** 盘号，从 1 开始 */
  no: number
  id: string
  cargos: Cargo[]
  result: PlanResult
}

export interface OrderPlan {
  allocation: AllocationResult
  pallets: PalletPlan[]
  /** 回流迭代轮数与回流件数 */
  rounds: number
  rerouted: number
  /** 最终仍放不下、需人工处理的货物 */
  unplaced: Cargo[]
  elapsedMs: number
}

export type PlanMany = (inputs: PlanInput[], onDone: (index: number, result: PlanResult) => void) => Promise<PlanResult[]>

export interface PipelineHooks {
  onAllocated?: (a: AllocationResult) => void
  /** 第 round 轮开始规划 indices 这些盘 */
  onRound?: (round: number, indices: number[]) => void
  onPallet?: (index: number, result: PlanResult) => void
}

export const palletId = (no: number) => 'P' + String(no).padStart(2, '0')

export async function planOrder(
  cargos: Cargo[],
  pallet: PalletSpec,
  cons: Constraints,
  sequence: SequenceParams,
  alloc: Partial<AllocParams>,
  planMany: PlanMany,
  hooks: PipelineHooks = {},
): Promise<OrderPlan> {
  const t0 = performance.now()
  const fixed = (alloc.fixedPallets ?? 0) > 0
  let minPallets = alloc.minPallets ?? 0
  let rerouted = 0
  let rounds = 0
  let allocation!: AllocationResult
  let sets: Cargo[][] = []
  let results: (PlanResult | null)[] = []

  // 外层：放不下且不允许超出时，多开一盘重新分配（最多两次）
  for (let attempt = 0; attempt < 3; attempt++) {
    allocation = allocate(cargos, pallet, cons, { ...alloc, minPallets })
    hooks.onAllocated?.(allocation)
    sets = allocation.groups.map((g) => [...g.cargos])
    results = sets.map(() => null)
    let dirty = sets.map((_, i) => i)
    const input = (i: number): PlanInput => ({ cargos: sets[i], pallet, constraints: cons, sequence })
    let stuck = 0

    // 内层：逐盘真实码放，放不下的件回流到实际垛高最低、且还有余量的货盘
    for (let r = 0; r < 4 && dirty.length; r++) {
      hooks.onRound?.(rounds, dirty)
      rounds++
      const idx = dirty
      const out = await planMany(idx.map(input), (k, res) => hooks.onPallet?.(idx[k], res))
      idx.forEach((i, k) => (results[i] = out[k]))
      dirty = []
      const left: { c: Cargo; from: number }[] = []
      results.forEach((res, i) => res!.layout.remaining.forEach((c) => left.push({ c, from: i })))
      stuck = left.length
      if (!left.length || r === 3) break
      const height = results.map((res) => res!.metrics.stackSize[2])
      const weight = sets.map((s) => s.reduce((a, c) => a + c.weight, 0))
      const blocked = new Set(left.map((l) => l.from))
      const touched = new Set<number>()
      left.sort((a, b) => b.c.length * b.c.width * b.c.height - a.c.length * a.c.width * a.c.height)
      let moved = 0
      for (const { c, from } of left) {
        let best = -1
        for (let i = 0; i < sets.length; i++) {
          if (i === from || blocked.has(i)) continue
          if (height[i] + c.height > cons.maxStackHeight) continue
          if (alloc.maxPalletWeight && weight[i] + c.weight > alloc.maxPalletWeight) continue
          if (best < 0 || height[i] < height[best]) best = i
        }
        if (best < 0) continue
        sets[from] = sets[from].filter((x) => x.id !== c.id)
        results[from]!.layout.remaining = results[from]!.layout.remaining.filter((x) => x.id !== c.id)
        sets[best].push(c)
        // 粗略占用：按该件体积折算垛高，避免把所有回流件都塞给同一盘
        height[best] += (c.length * c.width * c.height) / (cons.footprintX * cons.footprintY * 0.6)
        weight[best] += c.weight
        touched.add(best)
        moved++
      }
      rerouted += moved
      if (!moved) break
      dirty = [...touched]
    }
    if (!stuck || fixed || attempt === 2) break
    minPallets = allocation.groups.length + 1
  }

  const pallets: PalletPlan[] = []
  sets.forEach((s, i) => {
    if (!s.length || !results[i]) return
    const no = pallets.length + 1
    pallets.push({ no, id: palletId(no), cargos: s, result: results[i]! })
  })
  return {
    allocation,
    pallets,
    rounds,
    rerouted,
    unplaced: pallets.flatMap((p) => p.result.layout.remaining),
    elapsedMs: performance.now() - t0,
  }
}

/** 码盘结果 → 整托货物（装载规划的输入）：毛重、重心（相对货盘中心）、外形 */
export function toPalletUnit(p: PalletPlan, pallet: PalletSpec, cons: Constraints, rfid = ''): PalletUnit {
  const mt = p.result.metrics
  return {
    id: p.id,
    rfid: rfid || 'PLT-' + p.id,
    weight: Math.round(mt.grossWeight * 100) / 100,
    cog: {
      x: Math.round((mt.cog[0] - cons.footprintX / 2) * 10) / 10,
      y: Math.round((mt.cog[1] - cons.footprintY / 2) * 10) / 10,
      z: Math.round(mt.cogHeightTotal * 10) / 10,
    },
    size: [pallet.length, pallet.width, Math.round(mt.stackSize[2] + pallet.height)],
    source: 'PREDICTED',
    count: p.result.layout.placements.length,
  }
}
