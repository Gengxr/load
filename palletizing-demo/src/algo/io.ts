/**
 * 数据接口（JSON）
 *
 * 导入：接收"多盘分配"模块或仓储系统给出的货物集合。支持三种形态：
 *   ① { schemaVersion, pallets: [{ palletNo, cargos: [...] }] }   多盘分配结果，选择其中一盘
 *   ② { cargos: [...] }
 *   ③ [ ...cargos ]
 *   货物字段：id, rfid, sku?, length|l, width|w, height|h (mm), weight (kg)；
 *   属性（可选）：kind 包装类型（carton 纸箱 / wood 木箱 / case 军用特种箱，也接受中文），name 品名，maxLoad 承压上限 kg，fragile 怕压
 *
 * 导出：单盘码放方案（与《系统架构与技术方案 v0.3》§4.2 PalletizingPlan 字段对齐）
 */
import type { Cargo, CargoKind, Constraints, PalletSpec, PlanResult } from './types'
import { buildRobotJob } from './robot'
import type { CabinConfig, LoadingPlan, PalletUnit } from './cabin'
import type { PalletPlan } from './pipeline'

export interface ImportedSet {
  palletNo: number
  cargos: Cargo[]
}

export function parseCargoJson(text: string): ImportedSet[] {
  const data = JSON.parse(text)
  const sets: { palletNo?: number; cargos: unknown[] }[] = Array.isArray(data)
    ? [{ cargos: data }]
    : Array.isArray(data.pallets)
      ? data.pallets
      : Array.isArray(data.cargos)
        ? [{ cargos: data.cargos }]
        : []
  if (!sets.length) throw new Error('未找到货物数据：需要 pallets[] 或 cargos[] 字段')
  return sets.map((s, k) => ({
    palletNo: s.palletNo ?? k + 1,
    cargos: s.cargos.map((raw, i) => normalizeCargo(raw as Record<string, unknown>, i)),
  }))
}

function num(v: unknown, name: string, i: number): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw new Error(`第 ${i + 1} 件货物的 ${name} 无效：${String(v)}`)
  return n
}

function normalizeCargo(r: Record<string, unknown>, i: number): Cargo {
  const a = Math.round(num(r.length ?? r.l, 'length', i))
  const b = Math.round(num(r.width ?? r.w, 'width', i))
  const h = Math.round(num(r.height ?? r.h, 'height', i))
  const length = Math.max(a, b)
  const width = Math.min(a, b)
  const id = String(r.id ?? r.cargoId ?? `C${String(i + 1).padStart(4, '0')}`)
  const c: Cargo = {
    id,
    rfid: String(r.rfid ?? id),
    sku: String(r.sku ?? `${length}×${width}×${h}`),
    length,
    width,
    height: h,
    weight: Math.round(num(r.weight, 'weight', i) * 100) / 100,
    kind: kindOf(r.kind ?? r.package ?? r.type),
  }
  if (r.name !== undefined) c.name = String(r.name)
  const cap = r.maxLoad ?? r.bearing ?? r.stackLimit
  if (cap !== undefined && cap !== null && cap !== '') {
    const v = Number(cap)
    if (!Number.isFinite(v) || v < 0) throw new Error(`第 ${i + 1} 件货物的 maxLoad 无效：${String(cap)}`)
    c.maxLoad = v
  }
  if (r.fragile === true || r.fragile === 1 || r.fragile === 'true') c.fragile = true
  return c
}

function kindOf(v: unknown): CargoKind {
  const s = String(v ?? '').toLowerCase()
  if (s === 'wood' || s.includes('木')) return 'wood'
  if (s === 'case' || s.includes('特种') || s.includes('军')) return 'case'
  return 'carton'
}

const cargoFields = (c: Cargo) => ({
  id: c.id,
  rfid: c.rfid,
  sku: c.sku,
  name: c.name,
  kind: c.kind ?? 'carton',
  length: c.length,
  width: c.width,
  height: c.height,
  weight: c.weight,
  maxLoad: c.maxLoad,
  fragile: c.fragile,
})

const COORD = '货盘坐标系：原点为货盘可用区域左前角（货盘上表面），X 右、Y 远离操作者、Z 上，单位 mm；位置为货物最小角点'

export function exportPlan(res: PlanResult, cargos: Cargo[], pallet: PalletSpec, cons: Constraints): string {
  const byId = new Map(cargos.map((c) => [c.id, c]))
  const seq = res.sequences.balance
  const pl = res.layout.placements
  const placements = seq.order.map((pi, k) => {
    const p = pl[pi]
    return {
      seq: k + 1,
      cargoId: p.cargoId,
      rfid: byId.get(p.cargoId)?.rfid,
      sku: p.sku,
      layer: p.layer + 1,
      x: p.x,
      y: p.y,
      z: p.z,
      size: [p.dx, p.dy, p.dz],
      rotated: p.rotated,
      tipped: p.tipped,
      weight: p.weight,
      kind: p.kind ?? 'carton',
      maxLoad: p.maxLoad,
      topLoad: Math.round(res.metrics.loads[pi] * 10) / 10,
      supporters: res.supporters[pi].map((j) => pl[j].cargoId),
    }
  })
  const out = {
    schemaVersion: '0.1',
    planType: 'palletizing',
    generatedAt: new Date().toISOString(),
    coordinate: COORD,
    pallet,
    constraints: cons,
    solveStatus: res.layout.remaining.length ? 'PARTIAL' : 'COMPLETE',
    layoutStrategy: res.layout.strategy,
    placements,
    pickSequence: placements.map((p) => p.rfid),
    remainingCargo: res.layout.remaining,
    layers: res.layout.layers,
    metrics: Object.fromEntries(res.metrics.items.map((m) => [m.key, { name: m.name, value: m.value, display: m.display, limit: m.limit, pass: m.pass, source: m.source }])),
    process: { balance: seq.summary, baseline: res.sequences.baseline.summary },
    solverInfo: { algoVersion: '0.1.0', elapsedMs: Math.round(res.timings.totalMs) },
  }
  return JSON.stringify(out, null, 2)
}

/** 导出当前货物集合（供多盘分配 / 仓储侧对接测试） */
export function exportCargos(cargos: Cargo[]): string {
  return JSON.stringify({ schemaVersion: '0.1', pallets: [{ palletNo: 1, cargos }] }, null, 2)
}

// ───────────────────────── 出库清单 / 多盘码盘方案（对接智能仓储子系统） ─────────────────────────

/** 多个货盘集合合并为一张出库清单（货物编号去重） */
export function flattenImported(sets: ImportedSet[]): Cargo[] {
  const seen = new Set<string>()
  const out: Cargo[] = []
  for (const s of sets)
    for (const c of s.cargos) {
      let id = c.id
      for (let k = 2; seen.has(id); k++) id = `${c.id}-${k}`
      seen.add(id)
      out.push({ ...c, id })
    }
  return out
}

/** 出库清单（智能仓储子系统 → 本模块） */
export function orderPayload(orderId: string, cargos: Cargo[]) {
  return {
    schemaVersion: '0.2',
    requestId: 'REQ-' + orderId,
    orderId,
    createdAt: new Date().toISOString(),
    unit: { length: 'mm', weight: 'kg' },
    cargos: cargos.map(cargoFields),
  }
}

/** 码盘方案 + 按托盘分组的散货出库顺序（本模块 → 智能仓储子系统） */
export function palletizingPayload(orderId: string, pallets: PalletPlan[], pallet: PalletSpec, cons: Constraints) {
  return {
    schemaVersion: '0.2',
    planId: 'PP-' + orderId,
    version: 1,
    orderId,
    generatedAt: new Date().toISOString(),
    solveStatus: pallets.some((p) => p.result.layout.remaining.length) ? 'PARTIAL' : 'FEASIBLE',
    coordinate: COORD,
    palletSpec: pallet,
    constraints: cons,
    pallets: pallets.map((p) => {
      const byId = new Map(p.cargos.map((c) => [c.id, c]))
      const seq = p.result.sequences.balance
      const pl = p.result.layout.placements
      const mt = p.result.metrics
      return {
        palletNo: p.no,
        palletId: p.id,
        placements: seq.order.map((pi, k) => {
          const q = pl[pi]
          return { seq: k + 1, cargoId: q.cargoId, rfid: byId.get(q.cargoId)?.rfid, kind: q.kind ?? 'carton', layer: q.layer + 1, x: q.x, y: q.y, z: q.z, size: [q.dx, q.dy, q.dz], rotated: q.rotated, weight: q.weight, topLoad: Math.round(mt.loads[pi] * 10) / 10, maxLoad: q.maxLoad }
        }),
        pickSequence: seq.order.map((pi) => byId.get(pl[pi].cargoId)?.rfid),
        remainingCargo: p.result.layout.remaining.map((c) => c.rfid),
        metrics: {
          stackSize: mt.stackSize,
          totalWeight: Math.round(mt.grossWeight * 100) / 100,
          cog: { x: Math.round(mt.cog[0] * 10) / 10, y: Math.round(mt.cog[1] * 10) / 10, z: Math.round(mt.cog[2] * 10) / 10 },
          cogHeightTotal: Math.round(mt.cogHeightTotal * 10) / 10,
          cogOffsetRatio: { x: +mt.cogOffsetRatio[0].toFixed(4), y: +mt.cogOffsetRatio[1].toFixed(4) },
          cogHeightRatio: +mt.cogHeightRatio.toFixed(4),
          layerUtilization: mt.layerUtilization.map((u) => +u.toFixed(4)),
          maxLayerOverhang: +mt.maxOverhangRatio.toFixed(4),
          minSupportRatio: +mt.minSupportRatio.toFixed(4),
          maxLoadRatio: +mt.maxLoadRatio.toFixed(4),
          volumeUtilization: +mt.volumeUtilization.toFixed(4),
          checks: Object.fromEntries(mt.items.filter((m) => m.pass !== null).map((m) => [m.key, m.pass])),
        },
      }
    }),
    solverInfo: { algoVersion: '0.2.0', elapsedMs: Math.round(pallets.reduce((s, p) => s + p.result.timings.totalMs, 0)) },
  }
}

/** 机械臂作业指令（本模块 → 码垛机械臂控制器）：逐盘的取放任务，与具体设备无关 */
export function robotPayload(orderId: string, pallets: PalletPlan[], cons: Constraints) {
  return {
    schemaVersion: '0.2',
    orderId,
    generatedAt: new Date().toISOString(),
    jobs: pallets.map((p) => buildRobotJob(p.id, p.result, p.result.sequences.balance, p.cargos, cons)),
  }
}

/** 整托货物数据（智能仓储子系统 → 本模块；预测值或三点称重实测值） */
export function palletUnitsPayload(units: PalletUnit[]) {
  return {
    schemaVersion: '0.2',
    unit: { length: 'mm', weight: 'kg' },
    reference: '重心 x/y 为相对货盘几何中心的偏移，z 为距货盘底面的高度',
    pallets: units.map((u) => ({ palletRfid: u.rfid, palletId: u.id, grossWeight: u.weight, cog: u.cog, size: u.size, source: u.source })),
  }
}

export function parsePalletUnits(text: string): PalletUnit[] {
  const data = JSON.parse(text)
  const arr: Record<string, unknown>[] = Array.isArray(data) ? data : data.pallets
  if (!Array.isArray(arr) || !arr.length) throw new Error('未找到整托数据：需要 pallets[] 字段')
  return arr.map((r, i) => {
    const w = Number(r.grossWeight ?? r.weight)
    if (!Number.isFinite(w) || w <= 0) throw new Error(`第 ${i + 1} 个整托的重量无效`)
    const cog = (r.cog ?? {}) as Record<string, unknown>
    const size = (Array.isArray(r.size) ? r.size : [1219, 1219, 1575]).map(Number) as [number, number, number]
    const id = String(r.palletId ?? r.id ?? 'P' + String(i + 1).padStart(2, '0'))
    return {
      id,
      rfid: String(r.palletRfid ?? r.rfid ?? 'PLT-' + id),
      weight: Math.round(w * 100) / 100,
      cog: { x: Number(cog.x) || 0, y: Number(cog.y) || 0, z: Number(cog.z) || size[2] / 2 },
      size,
      source: r.source === 'MEASURED' ? 'MEASURED' : 'PREDICTED',
    }
  })
}

/** 构型参数校验（航空货运模拟舱段子系统 → 本模块） */
export function parseCabinConfig(text: string): CabinConfig {
  const c = JSON.parse(text) as CabinConfig
  const need = ['id', 'name', 'length', 'width', 'cabins', 'slots', 'doors', 'emptyWeight', 'emptyCog', 'targetCog'] as const
  for (const k of need) if (c[k] === undefined) throw new Error(`构型参数缺少字段 ${k}`)
  if (!c.slots.length || c.slots.length > 16) throw new Error('货位数应在 1–16 之间')
  for (const cab of c.cabins) if (!c.doors.some((d) => d.id === cab.loadDoor)) throw new Error(`货舱 ${cab.id} 的装载舱门 ${cab.loadDoor} 未定义`)
  const defaults = {
    model: c.id,
    desc: '外部导入构型',
    version: 'import',
    drops: [],
    tolX: 0.1,
    tolY: 0.1,
    envGround: [-0.05, 0.05] as [number, number],
    envFlight: [-0.04, 0.04] as [number, number],
    envLateral: 0.04,
  }
  return Object.assign(defaults, c)
}

/** 装载方案 + 装载 / 投放顺序（本模块 → 航空货运模拟舱段子系统；整托出库顺序同时发给仓储子系统） */
export function loadingPayload(orderId: string, cfg: CabinConfig, units: PalletUnit[], plan: LoadingPlan) {
  const r2 = (v: number) => Math.round(v * 10) / 10
  const loadSeq = new Map(plan.tracks.load.order.map((id, i) => [id, i + 1]))
  const unitOf = new Map(units.map((u) => [u.id, u]))
  return {
    schemaVersion: '0.2',
    planId: 'LP-' + orderId,
    version: 1,
    generatedAt: new Date().toISOString(),
    configId: cfg.id,
    configVersion: cfg.version,
    solveStatus: plan.solver.optimal ? 'OPTIMAL' : plan.solver.method === 'manual' ? 'MANUAL' : 'FEASIBLE',
    coordinate: '机体坐标：X 沿机身由前向后，原点在货舱地板最前端；Y 横向，机身中线为 0、向右为正；单位 mm',
    assignments: plan.assignments.map((a) => ({
      palletRfid: unitOf.get(a.palletId)?.rfid,
      palletId: a.palletId,
      slotId: a.slotId,
      palletYaw: a.yaw,
      loadSeq: loadSeq.get(a.palletId),
      dropSeq: Object.fromEntries(cfg.drops.map((d) => [d.kind, plan.tracks[d.id].order.indexOf(a.palletId) + 1 || null])),
    })),
    palletOutboundSequence: plan.tracks.load.order.map((id) => unitOf.get(id)?.rfid),
    acceptanceMetric: 'cargoCog',
    targetCog: cfg.targetCog,
    cargoCog: { x: r2(plan.metrics.cargoCog.x), y: r2(plan.metrics.cargoCog.y) },
    cargoCogError: { x: +plan.metrics.errX.toFixed(4), y: +plan.metrics.errY.toFixed(4), limit: cfg.tolX },
    systemCog: { x: r2(plan.metrics.systemCog.x), y: r2(plan.metrics.systemCog.y) },
    compartmentCogs: plan.metrics.cabinCogs.map((c) => ({ compartment: c.cabin, weight: r2(c.weight), x: c.cog ? r2(c.cog.x) : null, y: c.cog ? r2(c.cog.y) : null })),
    stageCogs: Object.values(plan.tracks).flatMap((t) =>
      t.points
        .filter((p) => p.op >= 0)
        .map((p) => ({ stage: t.mode.toUpperCase().replace('-', '_'), segment: p.op + 1, palletId: p.palletId, event: p.label, systemCog: { x: r2(p.system.x), y: r2(p.system.y) }, inEnvelope: p.ok, source: 'PREDICTED' })),
    ),
    violations: plan.metrics.violations,
    solverInfo: { method: plan.solver.method, evaluated: plan.solver.evaluated, searchSpace: plan.solver.space, elapsedMs: +plan.solver.elapsedMs.toFixed(2) },
  }
}
