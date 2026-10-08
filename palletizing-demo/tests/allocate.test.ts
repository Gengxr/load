import { describe, expect, it } from 'vitest'
import { DEFAULT_GEN, generateCargos } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from '../src/algo/defaults'
import { allocate } from '../src/algo/allocate'
import { planOrder, toPalletUnit, type PlanMany } from '../src/algo/pipeline'
import { planPallet } from '../src/algo/planner'

const order = (pallets: number, seed = 20261006) => generateCargos({ ...DEFAULT_GEN, mode: 'standard', skuCount: 8, pallets, fillRatio: 0.86, seed })
const planMany: PlanMany = async (inputs, onDone) =>
  inputs.map((inp, i) => {
    const r = planPallet(inp)
    onDone(i, r)
    return r
  })

describe('多盘分配', () => {
  it('每件货物恰好分到一个货盘', () => {
    const cargos = order(4)
    const a = allocate(cargos, DEFAULT_PALLET, DEFAULT_CONSTRAINTS)
    const ids = a.groups.flatMap((g) => g.cargos.map((c) => c.id))
    expect(ids.length).toBe(cargos.length)
    expect(new Set(ids).size).toBe(cargos.length)
    expect(a.stats.pallets).toBe(a.groups.length)
  })

  it('各盘预估垛高不超过上限，且高度、重量大致均衡', () => {
    const a = allocate(order(5), DEFAULT_PALLET, DEFAULT_CONSTRAINTS)
    for (const g of a.groups) expect(g.estHeight).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.maxStackHeight)
    const hs = a.groups.map((g) => g.estHeight)
    const ws = a.groups.map((g) => g.weight)
    expect(Math.max(...hs) - Math.min(...hs)).toBeLessThanOrEqual(300)
    expect((Math.max(...ws) - Math.min(...ws)) / (ws.reduce((x, y) => x + y, 0) / ws.length)).toBeLessThan(0.35)
    expect(a.stats.pallets).toBeGreaterThanOrEqual(a.stats.lowerBound)
  })

  it('指定盘数时按指定值分配', () => {
    const cargos = order(3)
    expect(allocate(cargos, DEFAULT_PALLET, DEFAULT_CONSTRAINTS, { fixedPallets: 4 }).groups.length).toBe(4)
  })

  it('尽量码满模式下前面的盘更高', () => {
    const a = allocate(order(4), DEFAULT_PALLET, DEFAULT_CONSTRAINTS, { mode: 'compact' })
    for (const g of a.groups) expect(g.estHeight).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.maxStackHeight)
    expect(a.groups[0].estHeight).toBeGreaterThanOrEqual(a.groups[a.groups.length - 1].estHeight)
  })

  it('联动流程：分配后各盘真实码放，全部货物放入且指标达标', async () => {
    const cargos = order(3)
    const res = await planOrder(cargos, DEFAULT_PALLET, DEFAULT_CONSTRAINTS, DEFAULT_SEQUENCE, {}, planMany)
    const placed = res.pallets.reduce((s, p) => s + p.result.layout.placements.length, 0)
    expect(placed + res.unplaced.length).toBe(cargos.length)
    expect(res.unplaced.length).toBe(0)
    for (const p of res.pallets) {
      expect(p.result.metrics.collisions).toBe(0)
      expect(p.result.metrics.stackSize[2]).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.maxStackHeight)
      const u = toPalletUnit(p, DEFAULT_PALLET, DEFAULT_CONSTRAINTS)
      expect(u.weight).toBeCloseTo(p.result.metrics.grossWeight, 1)
    }
  }, 60000)
})

describe('大件重件置底', () => {
  it('开启后下半垛重量占比不低于关闭时（同一批货物）', () => {
    const cargos = generateCargos({ ...DEFAULT_GEN, mode: 'mixed', skuCount: 9, seed: 1003 })
    const on = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: { ...DEFAULT_CONSTRAINTS }, sequence: DEFAULT_SEQUENCE })
    const off = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: { ...DEFAULT_CONSTRAINTS, heavyBottom: false, bigBottom: false }, sequence: DEFAULT_SEQUENCE })
    expect(on.metrics.lowerHalfMassRatio).toBeGreaterThanOrEqual(off.metrics.lowerHalfMassRatio - 0.02)
    expect(on.metrics.cogHeightRatio).toBeLessThanOrEqual(DEFAULT_CONSTRAINTS.cogHeightRatioMax)
  }, 30000)
})
