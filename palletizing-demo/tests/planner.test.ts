import { describe, expect, it } from 'vitest'
import { generateCargos, DEFAULT_GEN, type GenMode } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'
import { evaluateLayout, systemCog } from '../src/algo/evaluate'
import type { LayoutResult, Placement } from '../src/algo/types'

const input = (mode: GenMode, seed: number, extra: object = {}) => ({
  cargos: generateCargos({ ...DEFAULT_GEN, mode, seed, ...extra }),
  pallet: DEFAULT_PALLET,
  constraints: DEFAULT_CONSTRAINTS,
  sequence: DEFAULT_SEQUENCE,
})

describe('评估器：独立手算用例', () => {
  const box = (x: number, y: number, z: number, d: number, w: number): Placement => ({
    cargoId: 'X',
    sku: 'S',
    x,
    y,
    z,
    dx: d,
    dy: d,
    dz: d,
    rotated: false,
    tipped: false,
    layer: 0,
    weight: w,
  })
  it('系统重心含货盘自重', () => {
    // 20kg 货盘重心在 (500,500,-37.5)；10kg 货物重心在 (100,500,50)
    const [x, y, z, m] = systemCog([box(0, 400, 0, 200, 10)], DEFAULT_PALLET, DEFAULT_CONSTRAINTS)
    expect(m).toBe(30)
    expect(x).toBeCloseTo((20 * 500 + 10 * 100) / 30, 6)
    expect(y).toBeCloseTo(500, 6)
    expect(z).toBeCloseTo((20 * -37.5 + 10 * 100) / 30, 6)
  })
  it('悬空件的支撑率与碰撞被检出', () => {
    const layout: LayoutResult = {
      placements: [box(0, 0, 0, 200, 10), box(150, 0, 200, 200, 10), box(100, 0, 0, 200, 10)],
      layers: [
        { index: 0, z: 0, height: 200, kind: 'mixed', count: 2, utilization: 0.05, bbox: [0, 0, 300, 200], weight: 20 },
        { index: 1, z: 200, height: 200, kind: 'mixed', count: 1, utilization: 0.04, bbox: [150, 0, 350, 200], weight: 10 },
      ],
      remaining: [],
      strategy: 'layered',
    }
    const m = evaluateLayout(layout, DEFAULT_PALLET, DEFAULT_CONSTRAINTS, 10)
    expect(m.collisions).toBe(1) // 第 1、3 件在 x∈[100,200] 重叠
    expect(m.minSupportRatio).toBeCloseTo(150 / 200, 6) // 上层件 x∈[150,350] 只有 [150,300] 有支撑
  })
})

describe('单盘规划：硬约束与顺序合法性', () => {
  const cases: [GenMode, number, object?][] = [
    ['standard', 1],
    ['standard', 7],
    ['mixed', 3],
    ['single', 2, { singleIndex: 3 }],
    ['single', 5, { singleIndex: 9 }],
    ['random', 4, { fillRatio: 0.75 }],
  ]
  for (const [mode, seed, extra] of cases) {
    it(`${mode} #${seed}`, () => {
      const inp = input(mode, seed, extra)
      const r = planPallet(inp)
      const pl = r.layout.placements
      // 件数守恒
      expect(pl.length + r.layout.remaining.length).toBe(inp.cargos.length)
      expect(new Set(pl.map((p) => p.cargoId)).size).toBe(pl.length)
      // 硬约束
      expect(r.metrics.collisions).toBe(0)
      expect(r.metrics.outOfBounds).toBe(0)
      expect(r.metrics.minSupportRatio).toBeGreaterThanOrEqual(DEFAULT_CONSTRAINTS.supportRatioMin - 1e-9)
      // 两种顺序都是合法排列，且满足先后约束
      for (const seq of [r.sequences.balance, r.sequences.baseline]) {
        expect([...seq.order].sort((a, b) => a - b)).toEqual(pl.map((_, i) => i))
        expect(seq.summary.valid).toBe(true)
        // 每一步放置的货物都被完整托住
        for (let k = 1; k < seq.steps.support.length; k++) expect(seq.steps.support[k]).toBeGreaterThanOrEqual(DEFAULT_CONSTRAINTS.supportRatioMin - 1e-9)
      }
      // 本方案的过程峰值偏心不劣于基线
      expect(r.sequences.balance.summary.peakRatio).toBeLessThanOrEqual(r.sequences.baseline.summary.peakRatio + 1e-9)
    })
  }

  it('同一种子结果可复现', () => {
    const a = planPallet(input('standard', 11))
    const b = planPallet(input('standard', 11))
    expect(a.sequences.balance.order).toEqual(b.sequences.balance.order)
    expect(a.layout.placements).toEqual(b.layout.placements)
  })
})
