import { describe, expect, it } from 'vitest'
import { CABIN_CONFIGS, baselinePlan, buildTracks, evaluatePlan, evaluateStatic, planLoading, rotateOffset, trackAt, type Assignment, type PalletUnit } from '../src/algo/cabin'
import { loadingPayload, parsePalletUnits, palletUnitsPayload } from '../src/algo/io'

const unit = (i: number, weight: number, cx = 0, cy = 0): PalletUnit => ({ id: 'P' + String(i).padStart(2, '0'), rfid: 'R' + i, weight, cog: { x: cx, y: cy, z: 500 }, size: [1219, 1219, 1150], source: 'PREDICTED' })
const M6 = CABIN_CONFIGS.find((c) => c.id === 'M6')!
const L8 = CABIN_CONFIGS.find((c) => c.id === 'L8')!
const T7 = CABIN_CONFIGS.find((c) => c.id === 'T7')!
const H12 = CABIN_CONFIGS.find((c) => c.id === 'H12')!
const weights = [330, 210, 280, 190, 300, 240, 260, 220, 310, 200, 270, 230]

describe('舱内装载 · 重心计算', () => {
  it('单个整托放在某货位：货物重心就是该货位（含托盘自身偏心与朝向）', () => {
    const u = unit(1, 300, 40, -20)
    const a: Assignment[] = [{ palletId: 'P01', slotId: 'A3', yaw: 90 }]
    const m = evaluateStatic(M6, [u], a)
    const s = M6.slots.find((x) => x.id === 'A3')!
    const o = rotateOffset(u.cog, 90)
    expect(o).toEqual({ x: 20, y: 40 })
    expect(m.cargoCog.x).toBeCloseTo(s.x + 20, 6)
    expect(m.cargoCog.y).toBeCloseTo(s.y + 40, 6)
    expect(m.errX).toBeCloseTo((s.x + 20 - M6.targetCog.x) / M6.length, 9)
    // 含空机的系统重心被空机质量"稀释"
    expect(Math.abs(m.sysErrX)).toBeLessThan(Math.abs(m.errX))
  })

  it('超过货位或舱限重时给出违规项', () => {
    const m = evaluateStatic(M6, [unit(1, 700)], [{ palletId: 'P01', slotId: 'A1', yaw: 0 }])
    expect(m.pass).toBe(false)
    expect(m.violations.some((v) => v.code === 'SLOT_OVERWEIGHT')).toBe(true)
  })
})

describe('舱内装载 · 求解', () => {
  it('小规模全枚举：结果不劣于按顺序装入，且在允许误差内', () => {
    const us = weights.slice(0, 6).map((w, i) => unit(i + 1, w))
    const plan = planLoading(M6, us)
    expect(plan.solver.method).toBe('enumeration')
    expect(plan.solver.optimal).toBe(true)
    expect(plan.solver.evaluated).toBe(720)
    expect(plan.assignments.length).toBe(6)
    expect(new Set(plan.assignments.map((a) => a.slotId)).size).toBe(6)
    expect(plan.metrics.pass).toBe(true)
    const base = baselinePlan(M6, us)
    expect(Math.abs(plan.metrics.errX)).toBeLessThanOrEqual(Math.abs(base.metrics.errX) + 1e-9)
  })

  it('货盘少于货位时自动选择靠近理论重心的货位', () => {
    const us = weights.slice(0, 3).map((w, i) => unit(i + 1, w))
    const plan = planLoading(M6, us)
    expect(Math.abs(plan.metrics.errX)).toBeLessThan(0.03)
    expect(Math.abs(baselinePlan(M6, us).metrics.errX)).toBeGreaterThan(0.1)
  })

  it('双列、多舱构型：满足限重，横向与纵向误差均达标', () => {
    for (const cfg of [L8, T7]) {
      const us = weights.slice(0, cfg.slots.length).map((w, i) => unit(i + 1, w, 10, -8))
      const plan = planLoading(cfg, us)
      expect(plan.metrics.pass).toBe(true)
      expect(Math.abs(plan.metrics.errX)).toBeLessThan(0.02)
      expect(Math.abs(plan.metrics.errY)).toBeLessThan(0.02)
      for (const c of plan.metrics.cabinCogs) expect(c.weight).toBeLessThanOrEqual(c.limit + 1e-6)
    }
  })

  it('大规模用启发式：12 盘也能在 1 秒内给出达标方案（要求 4 货盘/秒）', () => {
    const us = weights.map((w, i) => unit(i + 1, w))
    const plan = planLoading(H12, us)
    expect(plan.solver.method).toBe('local-search')
    expect(plan.metrics.pass).toBe(true)
    expect(plan.solver.elapsedMs).toBeLessThan(1000)
    expect(us.length / (plan.solver.elapsedMs / 1000)).toBeGreaterThan(4)
  })

  it('超出货位数的整托列为未装载', () => {
    const us = weights.slice(0, 8).map((w, i) => unit(i + 1, w))
    const plan = planLoading(M6, us)
    expect(plan.assignments.length).toBe(6)
    expect(plan.unassigned).toEqual(['P07', 'P08'])
  })
})

describe('舱内装载 · 过程重心', () => {
  const us = weights.slice(0, 6).map((w, i) => unit(i + 1, w))
  const plan = planLoading(M6, us)

  it('装载：离门远的先装；结束状态与静态结果一致', () => {
    const tr = plan.tracks.load
    expect(tr.ops.length).toBe(6)
    const slotX = (id: string) => M6.slots.find((s) => s.id === id)!.x
    for (let i = 1; i < tr.ops.length; i++) expect(slotX(tr.ops[i].slotId)).toBeGreaterThan(slotX(tr.ops[i - 1].slotId))
    const end = tr.points[tr.points.length - 1]
    expect(end.system.x).toBeCloseTo(plan.metrics.systemCog.x, 6)
    expect(end.cargo!.x).toBeCloseTo(plan.metrics.cargoCog.x, 6)
    expect(tr.points[0].cargo).toBeNull()
  })

  it('尾投：离门近的先出；全部离机后回到空机重心', () => {
    const tr = plan.tracks['drop-tail']
    const slotX = (id: string) => M6.slots.find((s) => s.id === id)!.x
    for (let i = 1; i < tr.ops.length; i++) expect(slotX(tr.ops[i].slotId)).toBeLessThan(slotX(tr.ops[i - 1].slotId))
    const end = tr.points[tr.points.length - 1]
    expect(end.cargoMass).toBeCloseTo(0, 6)
    expect(end.system.x).toBeCloseTo(M6.emptyCog.x, 6)
  })

  it('卸载是装载的逆过程：峰值相同', () => {
    expect(plan.tracks.unload.peak).toBeCloseTo(plan.tracks.load.peak, 9)
    expect(plan.tracks.unload.order).toEqual([...plan.tracks.load.order].reverse())
  })

  it('时间轴插值：整步处等于校核点，托盘进舱前重心保持不变', () => {
    const tr = plan.tracks.load
    expect(trackAt(tr, 0).devX).toBeCloseTo(tr.points[0].devX, 12)
    expect(trackAt(tr, 0.2).devX).toBeCloseTo(tr.points[0].devX, 12)
    expect(trackAt(tr, 6).system.x).toBeCloseTo(plan.metrics.systemCog.x, 6)
  })

  it('人工互换两盘后即时重算，并可与最优方案比较', () => {
    const a = plan.assignments.map((x) => ({ ...x }))
    ;[a[0].slotId, a[5].slotId] = [a[5].slotId, a[0].slotId]
    const manual = evaluatePlan(M6, us, a, plan)
    expect(manual.solver.method).toBe('manual')
    expect(Math.abs(manual.metrics.errX)).toBeGreaterThanOrEqual(Math.abs(plan.metrics.errX) - 1e-9)
    expect(Object.keys(buildTracks(M6, us, a))).toEqual(Object.keys(plan.tracks))
  })
})

describe('接口报文', () => {
  it('整托数据导出后可原样导入', () => {
    const us = weights.slice(0, 4).map((w, i) => unit(i + 1, w, 5, -3))
    const back = parsePalletUnits(JSON.stringify(palletUnitsPayload(us)))
    expect(back.map((u) => [u.id, u.weight, u.cog.x, u.cog.y])).toEqual(us.map((u) => [u.id, u.weight, u.cog.x, u.cog.y]))
  })

  it('装载方案报文包含货位、朝向、装载与投放顺序、三种重心', () => {
    const us = weights.slice(0, 6).map((w, i) => unit(i + 1, w))
    const plan = planLoading(M6, us)
    const p = loadingPayload('T1', M6, us, plan)
    expect(p.assignments.length).toBe(6)
    expect(p.assignments.every((a) => a.loadSeq && a.dropSeq.tail)).toBe(true)
    expect(p.palletOutboundSequence.length).toBe(6)
    expect(p.acceptanceMetric).toBe('cargoCog')
    expect(p.stageCogs.length).toBeGreaterThan(20)
  })
})
