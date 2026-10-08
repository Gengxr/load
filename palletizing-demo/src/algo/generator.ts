import { Rng } from './rng'
import type { Cargo } from './types'

/**
 * 模拟货物生成（对应技术要求表 2-3 第 ① 项）
 * 散件尺寸范围：120×100×100 ~ 600×400×300（技术要求第 3 章）
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

/** 模数化标准规格（与图 2-1 同源），权重越大越常见 */
const STANDARD_FOOTPRINTS: { l: number; w: number; p: number }[] = [
  { l: 600, w: 400, p: 2 },
  { l: 400, w: 300, p: 3 },
  { l: 300, w: 200, p: 3 },
  { l: 250, w: 200, p: 2 },
  { l: 200, w: 200, p: 2 },
  { l: 400, w: 200, p: 2 },
  { l: 600, w: 200, p: 1 },
  { l: 400, w: 150, p: 1 },
  { l: 300, w: 100, p: 1 },
  { l: 200, w: 150, p: 1 },
  { l: 200, w: 100, p: 1 },
]
const STANDARD_HEIGHTS = [100, 150, 200, 250, 300]

export type GenMode = 'standard' | 'mixed' | 'random' | 'single'

export interface GenParams {
  mode: GenMode
  seed: number
  /** 规格数（standard / mixed） */
  skuCount: number
  /** 目标装载体积 = fillRatio × 1000×1000×targetHeight */
  fillRatio: number
  targetHeight: number
  /** 货物密度范围 kg/m³ */
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
  skuCount: 5,
  fillRatio: 0.85,
  targetHeight: 1100,
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

function weighted<T extends { p: number }>(rng: Rng, arr: T[]): T {
  const total = arr.reduce((s, a) => s + a.p, 0)
  let r = rng.next() * total
  for (const a of arr) {
    r -= a.p
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
}

function unitWeight(rng: Rng, s: SkuDef): number {
  const vol = (s.l * s.w * s.h) / 1e9
  const kg = vol * s.density * rng.range(0.95, 1.05)
  return Math.round(Math.max(0.5, kg) * 100) / 100
}

function makeCargos(rng: Rng, defs: { def: SkuDef; qty: number }[]): Cargo[] {
  const out: Cargo[] = []
  for (const { def, qty } of defs) {
    for (let i = 0; i < qty; i++) {
      out.push({
        id: '',
        rfid: rfidOf(rng),
        sku: def.sku,
        length: def.l,
        width: def.w,
        height: def.h,
        weight: unitWeight(rng, def),
      })
    }
  }
  // 仓储出库清单的原始顺序与规格无关：打乱后编号
  rng.shuffle(out)
  out.forEach((c, i) => (c.id = 'C' + String(i + 1).padStart(4, '0')))
  return out
}

function skuDefs(rng: Rng, count: number, p: GenParams): SkuDef[] {
  // 同一批货物的高度常常共用少数几个档位，便于凑成平整层
  const nHeights = Math.max(1, Math.min(STANDARD_HEIGHTS.length, Math.ceil(count / 2)))
  const heights = rng.shuffle([...STANDARD_HEIGHTS]).slice(0, nHeights)
  const pool = [...STANDARD_FOOTPRINTS]
  const defs: SkuDef[] = []
  for (let i = 0; i < count && pool.length; i++) {
    const fp = weighted(rng, pool)
    pool.splice(pool.indexOf(fp), 1)
    defs.push({
      sku: 'S' + String(i + 1).padStart(2, '0'),
      l: fp.l,
      w: fp.w,
      h: rng.pick(heights),
      density: rng.range(p.densityMin, p.densityMax),
    })
  }
  return defs
}

export function generateCargos(p: GenParams): Cargo[] {
  const rng = new Rng(p.seed)
  const K = Math.max(1, Math.round(p.pallets ?? 1))
  const targetVol = p.fillRatio * 1000 * 1000 * p.targetHeight * K

  if (p.mode === 'single') {
    const fp = FIG21_PATTERNS[Math.max(0, Math.min(FIG21_PATTERNS.length - 1, p.singleIndex))]
    const layers = Math.max(1, Math.floor(p.targetHeight / p.singleHeight))
    const def: SkuDef = { sku: 'S01', l: fp.l, w: fp.w, h: p.singleHeight, density: rng.range(p.densityMin, p.densityMax) }
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
      const def: SkuDef = { sku: 'R' + String(++i).padStart(3, '0'), l, w, h, density: rng.range(p.densityMin, p.densityMax) }
      out.push({ id: '', rfid: rfidOf(rng), sku: def.sku, length: l, width: w, height: h, weight: unitWeight(rng, def) })
      vol += v
    }
    out.forEach((c, k) => (c.id = 'C' + String(k + 1).padStart(4, '0')))
    return out
  }

  const count = p.mode === 'mixed' ? Math.max(p.skuCount, 8) : p.skuCount
  const defs = skuDefs(rng, count, p)
  // 按随机份额分配体积
  const shares = defs.map(() => rng.range(0.4, 1.6))
  const sum = shares.reduce((a, b) => a + b, 0)
  const plan = defs.map((def, k) => {
    const unit = def.l * def.w * def.h
    return { def, qty: Math.max(p.mode === 'mixed' ? 2 : 4, Math.round(((shares[k] / sum) * targetVol) / unit)) }
  })
  return makeCargos(rng, plan)
}
