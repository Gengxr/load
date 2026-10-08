import { describe, expect, it } from 'vitest'
import { generateCargos, DEFAULT_GEN, type GenMode } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE, ENVELOPES } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'
import { evaluateLayout, systemCog } from '../src/algo/evaluate'
import { computeLoads } from '../src/algo/bearing'
import { buildRobotJob, robotJobCsv, ROBOT_CLEARANCE } from '../src/algo/robot'
import { parseCargoJson } from '../src/algo/io'
import type { LayoutResult, Placement } from '../src/algo/types'

/** 技术要求图 2-1 的口径：垛形 1000×1000×(1000–1200) */
const SPEC = { ...DEFAULT_CONSTRAINTS, ...ENVELOPES.spec }
const input = (mode: GenMode, seed: number, extra: object = {}) => ({
  cargos: generateCargos({ ...DEFAULT_GEN, mode, seed, ...(mode === 'single' ? { fx: 1000, fy: 1000, targetHeight: 1100 } : {}), ...extra }),
  pallet: DEFAULT_PALLET,
  constraints: mode === 'single' ? SPEC : DEFAULT_CONSTRAINTS,
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
    const [x, y, z, m] = systemCog([box(0, 400, 0, 200, 10)], DEFAULT_PALLET, SPEC)
    expect(m).toBe(30)
    expect(x).toBeCloseTo((20 * 500 + 10 * 100) / 30, 6)
    expect(y).toBeCloseTo(500, 6)
    expect(z).toBeCloseTo((20 * -37.5 + 10 * 100) / 30, 6)
  })
  it('悬空件的支撑率与碰撞被检出', () => {
    const layout: LayoutResult = {
      placements: [box(0, 0, 0, 200, 10), box(150, 0, 200, 200, 10), box(100, 0, 0, 200, 10)],
      layers: [
        { index: 0, z: 0, height: 200, kind: 'mixed', count: 2, utilization: 0.05, bbox: [0, 0, 300, 200], weight: 20, avgVolume: 8 },
        { index: 1, z: 200, height: 200, kind: 'mixed', count: 1, utilization: 0.04, bbox: [150, 0, 350, 200], weight: 10, avgVolume: 8 },
      ],
      remaining: [],
      strategy: 'layered',
    }
    const m = evaluateLayout(layout, DEFAULT_PALLET, SPEC, 10)
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
      // 承压：没有货物被压超限
      expect(r.metrics.overloaded).toBe(0)
    }, 30000)
  }

  it('同一种子结果可复现', () => {
    const a = planPallet(input('standard', 11))
    const b = planPallet(input('standard', 11))
    expect(a.sequences.balance.order).toEqual(b.sequences.balance.order)
    expect(a.layout.placements).toEqual(b.layout.placements)
  })
})

describe('货物承压', () => {
  const box = (id: string, x: number, y: number, z: number, dx: number, dy: number, dz: number, w: number, maxLoad?: number): Placement => ({
    cargoId: id, sku: id, x, y, z, dx, dy, dz, rotated: false, tipped: false, layer: 0, weight: w, maxLoad,
  })
  it('压重按接触面积向下传递（手算）', () => {
    // 底层两件并排各 400 宽；中层一件 400 宽横跨两件（左 300 / 右 100）；顶层一件压在中层上
    const pl = [box('A', 0, 0, 0, 400, 400, 200, 10), box('B', 400, 0, 0, 400, 400, 200, 10), box('C', 100, 0, 200, 400, 400, 200, 20), box('D', 100, 0, 400, 400, 400, 200, 12)]
    const loads = computeLoads(pl, 5)
    expect(loads[3]).toBe(0)
    expect(loads[2]).toBeCloseTo(12, 9)
    expect(loads[0]).toBeCloseTo(32 * 0.75, 9)
    expect(loads[1]).toBeCloseTo(32 * 0.25, 9)
  })
  it('评估器按承压上限判定', () => {
    const mk = (cap: number): LayoutResult => ({
      placements: [box('A', 0, 0, 0, 400, 400, 200, 10, cap), box('B', 0, 0, 200, 400, 400, 200, 30)],
      layers: [
        { index: 0, z: 0, height: 200, kind: 'mixed', count: 1, utilization: 0.1, bbox: [0, 0, 400, 400], weight: 10, avgVolume: 32 },
        { index: 1, z: 200, height: 200, kind: 'mixed', count: 1, utilization: 0.1, bbox: [0, 0, 400, 400], weight: 30, avgVolume: 32 },
      ],
      remaining: [],
      strategy: 'layered',
    })
    const ok = evaluateLayout(mk(40), DEFAULT_PALLET, DEFAULT_CONSTRAINTS, 1)
    const bad = evaluateLayout(mk(20), DEFAULT_PALLET, DEFAULT_CONSTRAINTS, 1)
    expect(ok.overloaded).toBe(0)
    expect(ok.maxLoadRatio).toBeCloseTo(0.75, 9)
    expect(bad.overloaded).toBe(1)
    expect(bad.items.find((i) => i.key === 'bearing')!.pass).toBe(false)
  })
  it('怕压的货物被排到上面：关闭承压约束会超限，开启后不超限', () => {
    // 两种同尺寸货物各一整层：轻而怕压的纸箱 + 重的木箱。只开"大件置底"时两层无先后之分。
    const cargos = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: 'F' + i, rfid: 'F' + i, sku: 'F', length: 600, width: 400, height: 300, weight: 6, kind: 'carton' as const, maxLoad: 8 })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: 'W' + i, rfid: 'W' + i, sku: 'W', length: 600, width: 400, height: 300, weight: 30, kind: 'wood' as const, maxLoad: 600 })),
    ]
    const run = (bearing: boolean) => planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: { ...DEFAULT_CONSTRAINTS, bearing }, sequence: DEFAULT_SEQUENCE })
    const on = run(true)
    expect(on.layout.remaining.length).toBe(0)
    expect(on.metrics.overloaded).toBe(0)
    // 木箱全部在下层
    for (const p of on.layout.placements) expect(p.z).toBe(p.kind === 'wood' ? 0 : 300)
    // 反过来让怕压的纸箱更重：关闭承压约束时"重件置底"会把它们放到下面，评估器必须报出超限；开启后不超限
    const swapped = cargos.map((c) => (c.kind === 'wood' ? { ...c, weight: 12 } : { ...c, weight: 40 }))
    const guarded = planPallet({ cargos: swapped, pallet: DEFAULT_PALLET, constraints: DEFAULT_CONSTRAINTS, sequence: DEFAULT_SEQUENCE })
    expect(guarded.metrics.overloaded).toBe(0)
    expect(guarded.layout.remaining.length).toBe(0)
    const forced = planPallet({
      cargos: swapped,
      pallet: DEFAULT_PALLET,
      constraints: { ...DEFAULT_CONSTRAINTS, bearing: false },
      sequence: DEFAULT_SEQUENCE,
    })
    expect(forced.metrics.overloaded).toBeGreaterThan(0)
  })
  it('放不下去的压重：把顶上的货物卸下，而不是压坏下面的', () => {
    // 两层都怕压：只能码一层，另一层列入未放入
    const cargos = Array.from({ length: 12 }, (_, i) => ({ id: 'F' + i, rfid: 'F' + i, sku: 'F', length: 600, width: 400, height: 300, weight: 10, kind: 'carton' as const, maxLoad: 4 }))
    const r = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: DEFAULT_CONSTRAINTS, sequence: DEFAULT_SEQUENCE })
    expect(r.metrics.overloaded).toBe(0)
    expect(r.layout.placements.length).toBe(6)
    expect(r.layout.remaining.length).toBe(6)
  })
})

describe('起步阶段与过程峰值', () => {
  it('起步阶段的步不计入峰值，但单独给出', () => {
    const r = planPallet(input('standard', 1))
    const s = r.sequences.balance
    const cargo = r.metrics.cargoWeight
    expect(s.summary.warmupSteps).toBeGreaterThan(0)
    // 起步阶段结束时，盘上货物刚好达到整盘的 20%
    expect(s.steps.mass[s.summary.warmupSteps] - DEFAULT_PALLET.tareWeight).toBeLessThan(0.2 * cargo)
    expect(s.steps.mass[s.summary.warmupSteps + 1] - DEFAULT_PALLET.tareWeight).toBeGreaterThanOrEqual(0.2 * cargo - 1e-6)
    expect(s.summary.peakRatio).toBeCloseTo(Math.max(...s.steps.ratio.slice(s.summary.warmupSteps + 1)), 12)
  })
})

describe('机械臂作业指令', () => {
  const inp = input('mixed', 3)
  const r = planPallet(inp)
  const job = buildRobotJob('P01', r, r.sequences.balance, inp.cargos, DEFAULT_CONSTRAINTS)
  it('逐件一条任务，位姿与码放方案一致', () => {
    expect(job.tasks.length).toBe(r.layout.placements.length)
    job.tasks.forEach((t, k) => {
      const p = r.layout.placements[r.sequences.balance.order[k]]
      expect(t.seq).toBe(k + 1)
      expect(t.cargoId).toBe(p.cargoId)
      expect(t.place.x).toBeCloseTo(p.x + p.dx / 2, 6)
      expect(t.place.y).toBeCloseTo(p.y + p.dy / 2, 6)
      expect(t.place.z).toBeCloseTo(p.z + p.dz, 6)
      expect(t.place.rz).toBe(p.dx >= p.dy ? 0 : 90)
    })
  })
  it('平移高度高于此前所有已码货物；支撑件都排在前面', () => {
    let top = 0
    for (const t of job.tasks) {
      // 平移时货物底面高于已码货物顶面至少一个余量
      expect(t.transferZ - t.size[2]).toBeGreaterThanOrEqual(top + ROBOT_CLEARANCE - 1e-6)
      expect(t.approachZ).toBeGreaterThanOrEqual(t.place.z)
      for (const a of t.after) expect(a).toBeLessThan(t.seq)
      top = Math.max(top, t.place.z)
    }
    expect(job.requirement.payload).toBe(Math.max(...job.tasks.map((t) => t.weight)))
  })
  it('CSV 行数与任务数一致', () => {
    expect(robotJobCsv(job).split('\n').length).toBe(job.tasks.length + 1)
  })
})

describe('接口：货物属性', () => {
  it('导入时识别包装类型、承压上限与怕压标记', () => {
    const [set] = parseCargoJson(JSON.stringify({ cargos: [
      { id: 'A', length: 400, width: 600, height: 300, weight: 12, kind: '木箱', maxLoad: 500 },
      { id: 'B', l: 400, w: 300, h: 200, weight: 5, kind: 'case', fragile: true },
      { id: 'C', l: 300, w: 200, h: 200, weight: 3 },
    ] }))
    expect(set.cargos[0]).toMatchObject({ kind: 'wood', maxLoad: 500, length: 600, width: 400 })
    expect(set.cargos[1]).toMatchObject({ kind: 'case', fragile: true })
    expect(set.cargos[1].maxLoad).toBeUndefined()
    expect(set.cargos[2].kind).toBe('carton')
  })
})
