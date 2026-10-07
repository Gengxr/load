/**
 * 数据接口（JSON）
 *
 * 导入：接收"多盘分配"模块或仓储系统给出的货物集合。支持三种形态：
 *   ① { schemaVersion, pallets: [{ palletNo, cargos: [...] }] }   多盘分配结果，选择其中一盘
 *   ② { cargos: [...] }
 *   ③ [ ...cargos ]
 *   货物字段：id, rfid, sku?, length|l, width|w, height|h (mm), weight (kg)
 *
 * 导出：单盘码放方案（与《系统架构与技术方案 v0.3》§4.2 PalletizingPlan 字段对齐）
 */
import type { Cargo, Constraints, PalletSpec, PlanResult } from './types'

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
  return {
    id,
    rfid: String(r.rfid ?? id),
    sku: String(r.sku ?? `${length}×${width}×${h}`),
    length,
    width,
    height: h,
    weight: Math.round(num(r.weight, 'weight', i) * 100) / 100,
  }
}

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
      supporters: res.supporters[pi].map((j) => pl[j].cargoId),
    }
  })
  const out = {
    schemaVersion: '0.1',
    planType: 'palletizing',
    generatedAt: new Date().toISOString(),
    coordinate: '垛形局部坐标：原点为 1000×1000 垛形区域左前角（货盘上表面），X 右、Y 远离操作者、Z 上，单位 mm；位置为货物最小角点',
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
