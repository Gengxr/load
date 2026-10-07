import { describe, expect, it } from 'vitest'
import { exportCargos, exportPlan, parseCargoJson } from '../src/algo/io'
import { generateCargos, DEFAULT_GEN } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'

describe('JSON 接口', () => {
  it('货物集合导出后可原样导入', () => {
    const cargos = generateCargos({ ...DEFAULT_GEN, seed: 3 })
    const sets = parseCargoJson(exportCargos(cargos))
    expect(sets).toHaveLength(1)
    expect(sets[0].cargos).toEqual(cargos)
  })
  it('兼容裸数组与简写字段，长宽自动规范为 长≥宽', () => {
    const sets = parseCargoJson(JSON.stringify([{ id: 'A', l: 300, w: 400, h: 200, weight: 5 }]))
    expect(sets[0].cargos[0]).toMatchObject({ id: 'A', length: 400, width: 300, height: 200, sku: '400×300×200' })
  })
  it('非法数据给出可读错误', () => {
    expect(() => parseCargoJson('{"foo":1}')).toThrow(/pallets|cargos/)
    expect(() => parseCargoJson('[{"l":0,"w":1,"h":1,"weight":1}]')).toThrow(/length/)
  })
  it('方案导出包含出库顺序与支撑关系', () => {
    const cargos = generateCargos({ ...DEFAULT_GEN, seed: 5 })
    const r = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: DEFAULT_CONSTRAINTS, sequence: DEFAULT_SEQUENCE })
    const out = JSON.parse(exportPlan(r, cargos, DEFAULT_PALLET, DEFAULT_CONSTRAINTS))
    expect(out.placements).toHaveLength(r.layout.placements.length)
    expect(out.pickSequence).toHaveLength(r.layout.placements.length)
    expect(new Set(out.pickSequence).size).toBe(out.pickSequence.length)
    expect(out.placements[0].seq).toBe(1)
  })
})
