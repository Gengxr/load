import { Rng } from './rng'
import type { Cargo, CargoKind } from './types'

/**
 * 模拟货物生成（对应技术要求表 2-3 第 ① 项）
 * 货物均为规则直方体，包装分纸箱、木箱、军用特种箱三类；每件带体积、重量和属性（类型、承压上限、是否怕压）。
 */

/** 技术要求图 2-1 中的 14 种单规格码放示例（长×宽 → 单层件数） */
export const FIG21_PATTERNS: { l: number; w: number; n: number }[] = [
  { l: 250, w: 200, n: 20 },
  { l: 200, w: 200, n: 25 },
  { l: 300, w: 200, n: 16 },
  { l: 400, w: 300, n: 8 },
  { l: 150, w: 100, n: 66 },
  { l: 600, w: 400, n: 4 },
  { l: 400, w: 200, n: 12 },
  { l: 400, w: 150, n: 16 },
  { l: 600, w: 200, n: 8 },
  { l: 120, w: 100, n: 82 },
  { l: 200, w: 150, n: 33 },
  { l: 200, w: 120, n: 41 },
  { l: 300, w: 100, n: 33 },
  { l: 200, w: 100, n: 50 },
]

/**
 * 物资目录（示例）：应急救援与前线保障中常见的三类包装。
 * 尺寸取能在 1200×1200 货盘上整齐排布的模数；pr = 顶面允许承受的压强 kg/m²，
 * 承压上限 = pr × 顶面面积。数值为演示用的示例值，正式数据以出库清单为准。
 */
interface Supply {
  name: string
  kind: CargoKind
  /** 可选规格：长 × 宽 × 高 mm */
  sizes: [number, number, number][]
  /** 密度范围 kg/m³ */
  density: [number, number]
  pr: number
  fragile?: boolean
  /** 常见程度：[应急救援物资, 综合保障物资] */
  p: [number, number]
}

const CATALOG: Supply[] = [
  { name: '瓶装饮用水', kind: 'carton', sizes: [[400, 300, 300], [400, 300, 200]], density: [470, 540], pr: 900, p: [3, 1.5] },
  { name: '自热食品', kind: 'carton', sizes: [[600, 400, 300], [400, 300, 300], [400, 300, 200]], density: [200, 260], pr: 520, p: [3, 1.5] },
  { name: '压缩干粮', kind: 'carton', sizes: [[300, 200, 150], [400, 200, 150], [300, 200, 200]], density: [400, 480], pr: 800, p: [2, 1] },
  { name: '药品', kind: 'carton', sizes: [[400, 300, 200], [300, 200, 200], [300, 300, 200]], density: [150, 210], pr: 340, p: [2, 1] },
  { name: '医疗耗材', kind: 'carton', sizes: [[600, 400, 200], [400, 400, 200]], density: [120, 170], pr: 300, p: [1.5, 1] },
  { name: '棉被', kind: 'carton', sizes: [[600, 400, 400], [600, 400, 300]], density: [80, 110], pr: 240, p: [2, 0.8] },
  { name: '防寒服', kind: 'carton', sizes: [[600, 300, 300], [400, 400, 300]], density: [100, 140], pr: 260, p: [1.5, 0.8] },
  { name: '精密医疗器械', kind: 'carton', sizes: [[400, 300, 300], [400, 400, 300]], density: [110, 150], pr: 90, fragile: true, p: [0.8, 0.8] },
  { name: '发电机组', kind: 'wood', sizes: [[600, 400, 400], [600, 600, 400]], density: [300, 380], pr: 2500, p: [1, 1.5] },
  { name: '抢修器材', kind: 'wood', sizes: [[600, 400, 300], [800, 400, 300]], density: [280, 360], pr: 2500, p: [1, 1.5] },
  { name: '帐篷及支架', kind: 'wood', sizes: [[1200, 400, 300], [600, 300, 300]], density: [220, 300], pr: 2500, p: [0.8, 1] },
  { name: '通信器材', kind: 'case', sizes: [[600, 400, 300], [600, 400, 400]], density: [200, 280], pr: 1500, p: [0.8, 1.5] },
  { name: '光电设备', kind: 'case', sizes: [[400, 300, 300], [400, 400, 300]], density: [180, 240], pr: 1500, p: [0.5, 1.5] },
  { name: '野战医疗箱组', kind: 'case', sizes: [[600, 400, 400], [600, 300, 300]], density: [220, 300], pr: 1500, p: [0.8, 1.2] },
  { name: '维修备件', kind: 'case', sizes: [[400, 300, 200], [300, 300, 200]], density: [300, 400], pr: 1500, p: [0.3, 1.2] },
]

/** 随机尺寸模式下各包装类型的密度与承压（示例值） */
const KIND_RANDOM: { kind: CargoKind; name: string; density: [number, number]; pr: number; p: number }[] = [
  { kind: 'carton', name: '纸箱散件', density: [120, 380], pr: 420, p: 6 },
  { kind: 'wood', name: '木箱散件', density: [260, 380], pr: 2500, p: 2 },
  { kind: 'case', name: '特种箱散件', density: [200, 320], pr: 1500, p: 2 },
]

export type GenMode = 'standard' | 'mixed' | 'random' | 'single'

export interface GenParams {
  /** standard = 应急救援物资（纸箱为主）；mixed = 综合保障物资（三类包装）；random = 随机尺寸；single = 图 2-1 单规格 */
  mode: GenMode
  seed: number
  /** 规格数（standard / mixed） */
  skuCount: number
  /** 目标装载体积 = fillRatio × fx × fy × targetHeight × 盘数 */
  fillRatio: number
  targetHeight: number
  /** 货盘可用区域 mm */
  fx: number
  fy: number
  /** 货物密度范围 kg/m³（single 模式使用） */
  densityMin: number
  densityMax: number
  /** single 模式：图 2-1 中的第几种 */
  singleIndex: number
  singleHeight: number
  /** random 模式：高度取整档位 mm（50 = 高度档位化；10 = 完全随机） */
  heightStep: number
  /** 出库清单规模：目标货盘数（货量 = 单盘目标体积 × 盘数） */
  pallets: number
}

export const DEFAULT_GEN: GenParams = {
  mode: 'standard',
  seed: 20261052,
  skuCount: 6,
  fillRatio: 0.85,
  targetHeight: 1350,
  fx: 1200,
  fy: 1200,
  densityMin: 120,
  densityMax: 380,
  singleIndex: 3,
  singleHeight: 200,
  heightStep: 50,
  pallets: 1,
}

function rfidOf(rng: Rng): string {
  let s = 'E200'
  for (let i = 0; i < 5; i++) s += rng.u32().toString(16).padStart(8, '0').slice(0, 4)
  return s.toUpperCase()
}

function weighted<T>(rng: Rng, arr: T[], w: (a: T) => number): T {
  const total = arr.reduce((s, a) => s + w(a), 0)
  let r = rng.next() * total
  for (const a of arr) {
    r -= w(a)
    if (r <= 0) return a
  }
  return arr[arr.length - 1]
}

interface SkuDef {
  sku: string
  l: number
  w: number
  h: number
  density: number
  kind: CargoKind
  name: string
  /** 承压上限 kg */
  maxLoad: number
  fragile?: boolean
}

const capOf = (pr: number, l: number, w: number) => Math.max(1, Math.round((pr * l * w) / 1e6))

function unitWeight(rng: Rng, s: SkuDef): number {
  const vol = (s.l * s.w * s.h) / 1e9
  const kg = vol * s.density * rng.range(0.95, 1.05)
  return Math.round(Math.max(0.5, kg) * 100) / 100
}

function cargoOf(rng: Rng, def: SkuDef): Cargo {
  const c: Cargo = { id: '', rfid: rfidOf(rng), sku: def.sku, length: def.l, width: def.w, height: def.h, weight: unitWeight(rng, def), kind: def.kind, name: def.name, maxLoad: def.maxLoad }
  if (def.fragile) c.fragile = true
  return c
}

function makeCargos(rng: Rng, defs: { def: SkuDef; qty: number }[]): Cargo[] {
  const out: Cargo[] = []
  for (const { def, qty } of defs) for (let i = 0; i < qty; i++) out.push(cargoOf(rng, def))
  // 仓储出库清单的原始顺序与规格无关：打乱后编号
  rng.shuffle(out)
  out.forEach((c, i) => (c.id = 'C' + String(i + 1).padStart(4, '0')))
  return out
}

/** 从物资目录里按常见程度抽取 count 种规格（尺寸互不相同） */
function skuDefs(rng: Rng, count: number, scene: 0 | 1): SkuDef[] {
  const pool = [...CATALOG]
  const used = new Set<string>()
  const defs: SkuDef[] = []
  while (defs.length < count && pool.length) {
    const sp = weighted(rng, pool, (a) => a.p[scene])
    pool.splice(pool.indexOf(sp), 1)
    const size = rng.shuffle([...sp.sizes]).find(([l, w, h]) => !used.has(`${l}x${w}x${h}`))
    if (!size) continue
    const [l, w, h] = size
    used.add(`${l}x${w}x${h}`)
    defs.push({
      sku: 'S' + String(defs.length + 1).padStart(2, '0'),
      l,
      w,
      h,
      density: rng.range(sp.density[0], sp.density[1]),
      kind: sp.kind,
      name: sp.name,
      maxLoad: capOf(sp.pr, l, w),
      fragile: sp.fragile,
    })
  }
  return defs
}

export function generateCargos(p: GenParams): Cargo[] {
  const rng = new Rng(p.seed)
  const K = Math.max(1, Math.round(p.pallets ?? 1))
  const targetVol = p.fillRatio * (p.fx ?? 1200) * (p.fy ?? 1200) * p.targetHeight * K

  if (p.mode === 'single') {
    const fp = FIG21_PATTERNS[Math.max(0, Math.min(FIG21_PATTERNS.length - 1, p.singleIndex))]
    const layers = Math.max(1, Math.floor(p.targetHeight / p.singleHeight))
    const def: SkuDef = { sku: 'S01', l: fp.l, w: fp.w, h: p.singleHeight, density: rng.range(p.densityMin, p.densityMax), kind: 'carton', name: '标准纸箱', maxLoad: capOf(600, fp.l, fp.w) }
    return makeCargos(rng, [{ def, qty: fp.n * layers * K }])
  }

  if (p.mode === 'random') {
    const out: Cargo[] = []
    let vol = 0
    const step = Math.max(10, p.heightStep)
    let i = 0
    while (vol < targetVol && i < 2000 * K) {
      const l = Math.round(rng.range(120, 600) / 10) * 10
      const w = Math.round(rng.range(100, Math.min(400, l)) / 10) * 10
      const h = Math.min(300, Math.max(100, Math.round(rng.range(100, 300) / step) * step))
      const v = l * w * h
      if (vol + v > targetVol * 1.02) break
      const kd = weighted(rng, KIND_RANDOM, (a) => a.p)
      const def: SkuDef = { sku: 'R' + String(++i).padStart(3, '0'), l, w, h, density: rng.range(kd.density[0], kd.density[1]), kind: kd.kind, name: kd.name, maxLoad: capOf(kd.pr, l, w) }
      out.push(cargoOf(rng, def))
      vol += v
    }
    out.forEach((c, k) => (c.id = 'C' + String(k + 1).padStart(4, '0')))
    return out
  }

  const mixed = p.mode === 'mixed'
  const defs = skuDefs(rng, mixed ? Math.max(p.skuCount, 8) : p.skuCount, mixed ? 1 : 0)
  // 按随机份额分配体积
  const shares = defs.map(() => rng.range(0.4, 1.6))
  const sum = shares.reduce((a, b) => a + b, 0)
  const plan = defs.map((def, k) => {
    const unit = def.l * def.w * def.h
    return { def, qty: Math.max(mixed ? 2 : 4, Math.round(((shares[k] / sum) * targetVol) / unit)) }
  })
  return makeCargos(rng, plan)
}
