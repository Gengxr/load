import { describe, expect, it } from 'vitest'
import { DEFAULT_GEN, generateCargos } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from '../src/algo/defaults'
import { dblfLayout } from '../src/algo/dblf'
import { planDblf, planPallet } from '../src/algo/planner'
import type { Cargo } from '../src/algo/types'

const cons = DEFAULT_CONSTRAINTS
const cargo = (id: string, l: number, w: number, h: number, weight = 5): Cargo => ({ id, rfid: id, sku: `${l}x${w}x${h}`, length: l, width: w, height: h, weight })

describe('对照算法 DBLF', () => {
  it('第一件放在最深、最低、最左的角上；同一深度先往上码（最深优先于最低）', () => {
    // 4 件 500×500×300：一排两件占满远端；第 3 件应叠在远端第一件上面，而不是放到近侧地面
    const cs = [1, 2, 3, 4].map((i) => cargo('C' + i, 500, 500, 300))
    const { layout } = dblfLayout(cs, cons)
    const p = layout.placements
    expect(p.length).toBe(4)
    expect([p[0].x, p[0].y, p[0].z]).toEqual([0, 500, 0])
    expect([p[1].x, p[1].y, p[1].z]).toEqual([500, 500, 0])
    expect([p[2].x, p[2].y, p[2].z]).toEqual([0, 500, 300])
    expect([p[3].x, p[3].y, p[3].z]).toEqual([500, 500, 300])
  })

  it('体积大的先放', () => {
    const { layout } = dblfLayout([cargo('S', 200, 100, 100), cargo('B', 600, 400, 300)], cons)
    expect(layout.placements[0].cargoId).toBe('B')
  })

  it('结果不重叠、不越界、每件支撑率达标，放置次序满足先后约束', () => {
    for (const mode of ['standard', 'mixed', 'random'] as const) {
      const cargos = generateCargos({ ...DEFAULT_GEN, mode, seed: 1234 })
      const res = planDblf({ cargos, pallet: DEFAULT_PALLET, constraints: cons, sequence: DEFAULT_SEQUENCE })
      expect(res.layout.placements.length + res.layout.remaining.length).toBe(cargos.length)
      expect(res.metrics.collisions).toBe(0)
      expect(res.metrics.outOfBounds).toBe(0)
      expect(res.metrics.minSupportRatio).toBeGreaterThanOrEqual(cons.supportRatioMin - 1e-9)
      expect(res.metrics.stackSize[2]).toBeLessThanOrEqual(cons.maxStackHeight)
      expect(res.sequence.summary.valid).toBe(true)
      expect(res.sequence.order).toEqual(res.layout.placements.map((_, i) => i))
    }
  })

  it('同一批货物结果确定；随主流程一并给出', () => {
    const cargos = generateCargos({ ...DEFAULT_GEN, seed: 77 })
    const a = dblfLayout(cargos, cons).layout.placements
    const b = dblfLayout([...cargos].reverse(), cons).layout.placements
    expect(a).toEqual(b)
    const plan = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: cons, sequence: DEFAULT_SEQUENCE })
    expect(plan.dblf.layout.placements).toEqual(a)
    expect(plan.dblf.sequence.strategy).toBe('dblf')
  })
})
