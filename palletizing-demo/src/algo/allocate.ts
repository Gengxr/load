/**
 * 多盘分配：出库清单 → 每个货盘装哪些货
 *
 * 思路（组合优化，不用机器学习）：
 *   1. 层单元分解 —— 同规格货物先凑成"整层"（单层最优图案的件数）；凑不满一层的零头按高度归档，
 *      同高的零头用 MaxRects 拼成"混合层"；每个高度档最后剩下的不足一层的零头打成一个"零头层"，
 *      留作某一盘的顶层（顶层不考核利用率）。
 *   2. 多路划分 —— 把层单元像搭积木一样分给各货盘：高度不超过垛高上限，各盘高度、重量尽量均衡，
 *      同一规格尽量集中在少数货盘。先贪心构造，再用"移动 / 交换"局部搜索改进。
 *   3. 验证回流 —— 每盘交给单盘码放算法真实求解；放不下的件自动回流到还有余量的货盘或新开一盘
 *      （这一步在 pipeline.ts 中，与单盘算法联动）。
 */
import type { Cargo, Constraints, PalletSpec } from './types'
import { bestPattern } from './pattern'
import { maxRectsPack, type Heuristic, type PackItem } from './maxrects'

export type AllocMode = 'balanced' | 'compact'

export interface AllocParams {
  /** balanced：各盘高度、重量均衡；compact：前面的盘尽量码满，零头集中到尾盘 */
  mode: AllocMode
  /** 指定盘数（0 = 自动取最少盘数） */
  fixedPallets: number
  /** 自动模式下的盘数下限（联动流程在放不下时用它加开一盘后重分） */
  minPallets: number
  /** 货盘数上限（例如舱内货位数），超出时给出提示；0 = 不限 */
  maxPallets: number
  /** 单盘货物重量上限 kg（来自货位限重），0 = 不限 */
  maxPalletWeight: number
  /** 同规格尽量集中在少数货盘 */
  keepSkuTogether: boolean
}

export const DEFAULT_ALLOC: AllocParams = {
  mode: 'balanced',
  fixedPallets: 0,
  minPallets: 0,
  maxPallets: 0,
  maxPalletWeight: 0,
  keepSkuTogether: true,
}

export type UnitKind = 'full' | 'mixed' | 'loose'

export interface LayerUnit {
  id: number
  kind: UnitKind
  /** 规格键（长×宽×高）；混合层与散件为多个规格 */
  skus: string[]
  /** 占用的垛高 mm */
  height: number
  weight: number
  volume: number
  /** 底面积之和 / 垛形面积 */
  utilization: number
  cargoIds: string[]
}

export interface PalletGroup {
  /** 盘号，从 1 开始 */
  no: number
  units: LayerUnit[]
  cargos: Cargo[]
  /** 预估垛高 mm */
  estHeight: number
  /** 货物重量 kg */
  weight: number
  volume: number
}

export interface AllocStats {
  cargoCount: number
  skuCount: number
  totalWeight: number
  totalVolume: number
  fullLayers: number
  mixedLayers: number
  looseCount: number
  /** 按体积算的理论最少盘数 */
  lowerBound: number
  pallets: number
  /** 局部搜索前后的高度极差 mm、重量极差 kg */
  heightSpread: [number, number]
  weightSpread: [number, number]
  /** 局部搜索接受的改进次数 */
  moves: number
  elapsedMs: number
}

export interface AllocationResult {
  groups: PalletGroup[]
  units: LayerUnit[]
  stats: AllocStats
  warnings: string[]
}

export const skuKey = (c: Cargo) => `${Math.max(c.length, c.width)}×${Math.min(c.length, c.width)}×${c.height}`

interface Bin {
  units: LayerUnit[]
  h: number
  w: number
  loose: number
  sku: Map<string, number>
}

const HEURISTICS: Heuristic[] = ['cp', 'bssf', 'bl']

export function allocate(cargos: Cargo[], _pallet: PalletSpec, cons: Constraints, params: Partial<AllocParams> = {}): AllocationResult {
  const t0 = performance.now()
  const p = { ...DEFAULT_ALLOC, ...params }
  const FX = cons.footprintX
  const FY = cons.footprintY
  const area = FX * FY
  const Hmax = cons.maxStackHeight
  const warnings: string[] = []
  const byId = new Map(cargos.map((c) => [c.id, c]))

  // ── 1. 层单元分解 ──
  const groups = new Map<string, Cargo[]>()
  for (const c of cargos) {
    const k = skuKey(c)
    let arr = groups.get(k)
    if (!arr) groups.set(k, (arr = []))
    arr.push(c)
  }
  const units: LayerUnit[] = []
  const mk = (kind: UnitKind, list: Cargo[], height: number): LayerUnit => {
    const u: LayerUnit = {
      id: units.length,
      kind,
      skus: [...new Set(list.map(skuKey))],
      height,
      weight: list.reduce((s, c) => s + c.weight, 0),
      volume: list.reduce((s, c) => s + c.length * c.width * c.height, 0),
      utilization: list.reduce((s, c) => s + c.length * c.width, 0) / area,
      cargoIds: list.map((c) => c.id),
    }
    units.push(u)
    return u
  }
  const looseByH = new Map<number, Cargo[]>()
  const pushLoose = (c: Cargo) => {
    let arr = looseByH.get(c.height)
    if (!arr) looseByH.set(c.height, (arr = []))
    arr.push(c)
  }
  const keys = [...groups.keys()].sort()
  for (const k of keys) {
    const list = groups.get(k)!
    const c0 = list[0]
    const l = Math.max(c0.length, c0.width)
    const w = Math.min(c0.length, c0.width)
    const fits = (l <= FX && w <= FY) || (w <= FX && l <= FY)
    if (!fits || c0.height > Hmax) {
      warnings.push(`规格 ${k} 超出垛形尺寸，共 ${list.length} 件需人工处理`)
      continue
    }
    const n = bestPattern(l, w, FX, FY).count
    const util = (n * l * w) / area
    // 重的在前：同规格里较重的件凑成的层更适合放在下面
    list.sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1))
    let i = 0
    if (n > 0 && util >= cons.utilizationMin) {
      for (; i + n <= list.length; i += n) mk('full', list.slice(i, i + n), c0.height)
    }
    for (; i < list.length; i++) pushLoose(list[i])
  }
  // 同高零头 → MaxRects 拼混合层
  const leftovers: Cargo[] = []
  for (const h of [...looseByH.keys()].sort((a, b) => b - a)) {
    let pool = looseByH.get(h)!.sort((a, b) => b.length * b.width - a.length * a.width || (a.id < b.id ? -1 : 1))
    for (let guard = 0; guard < 200 && pool.length; guard++) {
      const poolArea = pool.reduce((s, c) => s + c.length * c.width, 0)
      if (poolArea < cons.utilizationMin * area) break
      const items: PackItem[] = pool.map((c, idx) => ({ id: idx, w: Math.max(c.length, c.width), h: Math.min(c.length, c.width), canRotate: true, prio: 0 }))
      let best: number[] = []
      let bestArea = 0
      for (const heu of HEURISTICS) {
        const packed = maxRectsPack(items, FX, FY, heu)
        const a = packed.reduce((s, r) => s + r.w * r.h, 0)
        if (a > bestArea) {
          bestArea = a
          best = packed.map((r) => r.id)
        }
      }
      if (bestArea < cons.utilizationMin * area) break
      const chosen = new Set(best)
      mk('mixed', pool.filter((_, idx) => chosen.has(idx)), h)
      pool = pool.filter((_, idx) => !chosen.has(idx))
    }
    leftovers.push(...pool)
  }
  // 零头层：同一高度档剩下的不足一层的件打成一个单元，占一层的高度，适合放在某一盘的最上面
  const leftByH = new Map<number, Cargo[]>()
  for (const c of leftovers) {
    let arr = leftByH.get(c.height)
    if (!arr) leftByH.set(c.height, (arr = []))
    arr.push(c)
  }
  for (const h of [...leftByH.keys()].sort((a, b) => b - a)) mk('loose', leftByH.get(h)!, h)

  const totalWeight = cargos.reduce((s, c) => s + c.weight, 0)
  const totalVolume = cargos.reduce((s, c) => s + c.length * c.width * c.height, 0)
  const Htot = units.reduce((s, u) => s + u.height, 0)
  const lowerBound = Math.max(1, Math.ceil(totalVolume / (area * Hmax)))

  // ── 2. 多路划分 ──
  const order = [...units].sort((a, b) => b.height - a.height || b.weight - a.weight || a.id - b.id)
  const feasible = (b: Bin, u: LayerUnit) => b.h + u.height <= Hmax + 1e-6 && (!p.maxPalletWeight || b.w + u.weight <= p.maxPalletWeight + 1e-6)
  const newBin = (): Bin => ({ units: [], h: 0, w: 0, loose: 0, sku: new Map() })
  const add = (b: Bin, u: LayerUnit) => {
    b.units.push(u)
    b.h += u.height
    b.w += u.weight
    if (u.kind === 'loose') b.loose++
    else for (const s of u.skus) b.sku.set(s, (b.sku.get(s) ?? 0) + 1)
  }
  const remove = (b: Bin, u: LayerUnit) => {
    b.units.splice(b.units.indexOf(u), 1)
    b.h -= u.height
    b.w -= u.weight
    if (u.kind === 'loose') b.loose--
    else
      for (const s of u.skus) {
        const n = (b.sku.get(s) ?? 1) - 1
        if (n <= 0) b.sku.delete(s)
        else b.sku.set(s, n)
      }
  }

  /** 给定盘数 K 构造一个初始划分；放不下返回 null */
  const construct = (K: number): Bin[] | null => {
    const bins = Array.from({ length: K }, newBin)
    if (p.mode === 'compact') {
      // 逐盘用子集和动态规划尽量码到上限
      let rest = [...order]
      for (let b = 0; b < K && rest.length; b++) {
        if (b === K - 1) {
          for (const u of rest) {
            if (!feasible(bins[b], u)) return null
            add(bins[b], u)
          }
          rest = []
        } else {
          const pick = subsetNear(rest, Hmax, p.maxPalletWeight)
          for (const u of pick) add(bins[b], u)
          const set = new Set(pick)
          rest = rest.filter((u) => !set.has(u))
        }
      }
      return rest.length ? null : bins
    }
    const T = Htot / K
    for (const u of order) {
      // 优先放进已有同规格、且不超过平均高度的盘；否则放最矮的盘
      let best = -1
      let bestKey = Infinity
      for (let b = 0; b < K; b++) {
        if (!feasible(bins[b], u)) continue
        const same = p.keepSkuTogether && u.kind !== 'loose' && u.skus.some((s) => bins[b].sku.has(s)) && bins[b].h + u.height <= T + 60
        const key = bins[b].h - (same ? 1e6 : 0) + (u.kind === 'loose' ? bins[b].loose * 1e7 : 0)
        if (key < bestKey) {
          bestKey = key
          best = b
        }
      }
      if (best < 0) return null
      add(bins[best], u)
    }
    return bins
  }

  // 盘数：先取高度下界；平均余量不足一小层时直接多开一盘，给单盘算法留出调整空间
  let K = Math.max(1, Math.ceil(Htot / Hmax), p.maxPalletWeight ? Math.ceil(totalWeight / p.maxPalletWeight) : 1)
  if (Htot / K > Hmax - 40) K++
  K = Math.max(K, p.minPallets)
  let bins: Bin[] | null = null
  if (p.fixedPallets > 0) {
    K = p.fixedPallets
    bins = construct(K) ?? forceFit(order, K, newBin, add)
  } else {
    for (let tries = 0; tries < 12 && !bins; tries++) {
      bins = construct(K)
      if (!bins) K++
    }
    if (!bins) bins = forceFit(order, K, newBin, add)
  }
  K = bins.length

  // ── 局部搜索：移动 / 交换 ──
  const spread = (f: (b: Bin) => number) => (bins!.length ? Math.max(...bins!.map(f)) - Math.min(...bins!.map(f)) : 0)
  const before: [number, number] = [spread((b) => b.h), spread((b) => b.w)]
  let moves = 0
  if (p.mode === 'balanced' && K > 1) {
    const Hbar = Htot / K
    const Wbar = totalWeight / K || 1
    const strict = p.fixedPallets === 0
    const cost = (h: number, w: number, skuN: number, loose: number) =>
      Math.abs(h - Hbar) / Hmax +
      Math.max(0, cons.minStackHeight - h) / Hmax +
      (strict || h <= Hmax ? 0 : (h - Hmax) / Hmax) * 20 +
      0.6 * (Math.abs(w - Wbar) / Wbar) +
      (p.keepSkuTogether ? 0.05 * skuN : 0) +
      0.5 * Math.max(0, loose - 1)
    const cb = (b: Bin) => cost(b.h, b.w, b.sku.size, b.loose)
    const okH = (h: number) => !strict || h <= Hmax + 1e-6
    const okW = (w: number) => !p.maxPalletWeight || w <= p.maxPalletWeight + 1e-6
    for (let pass = 0; pass < 60; pass++) {
      let improved = false
      for (let a = 0; a < K; a++) {
        for (let b = 0; b < K; b++) {
          if (a === b) continue
          const A = bins[a]
          const B = bins[b]
          // 移动 A → B
          for (let i = 0; i < A.units.length; i++) {
            const u = A.units[i]
            if (!okH(B.h + u.height) || !okW(B.w + u.weight)) continue
            const old = cb(A) + cb(B)
            remove(A, u)
            add(B, u)
            if (cb(A) + cb(B) < old - 1e-9) {
              improved = true
              moves++
              i--
            } else {
              remove(B, u)
              A.units.splice(i, 0, u)
              A.h += u.height
              A.w += u.weight
              if (u.kind === 'loose') A.loose++
              else for (const s of u.skus) A.sku.set(s, (A.sku.get(s) ?? 0) + 1)
            }
          }
          if (a > b) continue
          // 交换
          for (let i = 0; i < A.units.length; i++) {
            for (let j = 0; j < B.units.length; j++) {
              const u = A.units[i]
              const v = B.units[j]
              if (u.kind === v.kind && u.height === v.height && u.weight === v.weight && u.skus[0] === v.skus[0]) continue
              if (!okH(A.h - u.height + v.height) || !okH(B.h - v.height + u.height)) continue
              if (!okW(A.w - u.weight + v.weight) || !okW(B.w - v.weight + u.weight)) continue
              const old = cb(A) + cb(B)
              remove(A, u)
              remove(B, v)
              add(A, v)
              add(B, u)
              if (cb(A) + cb(B) < old - 1e-9) {
                improved = true
                moves++
              } else {
                remove(A, v)
                remove(B, u)
                A.units.splice(i, 0, u)
                A.h += u.height
                A.w += u.weight
                if (u.kind === 'loose') A.loose++
                else for (const s of u.skus) A.sku.set(s, (A.sku.get(s) ?? 0) + 1)
                B.units.splice(j, 0, v)
                B.h += v.height
                B.w += v.weight
                if (v.kind === 'loose') B.loose++
                else for (const s of v.skus) B.sku.set(s, (B.sku.get(s) ?? 0) + 1)
              }
            }
          }
        }
      }
      if (!improved) break
    }
  }
  const after: [number, number] = [spread((b) => b.h), spread((b) => b.w)]

  // 空盘剔除，盘号按划分顺序
  const used = bins.filter((b) => b.units.length)
  const result: PalletGroup[] = used.map((b, i) => {
    const us = [...b.units].sort((x, y) => (x.kind === 'loose' ? 1 : 0) - (y.kind === 'loose' ? 1 : 0) || y.weight / y.height - x.weight / x.height)
    const list = us.flatMap((u) => u.cargoIds.map((id) => byId.get(id)!))
    return { no: i + 1, units: us, cargos: list, estHeight: Math.round(b.h), weight: b.w, volume: us.reduce((s, u) => s + u.volume, 0) }
  })
  if (p.maxPallets && result.length > p.maxPallets) warnings.push(`需要 ${result.length} 个货盘，超过当前构型的 ${p.maxPallets} 个货位，需分批装载或更换构型`)
  if (p.fixedPallets > 0 && bins.some((b) => b.h > Hmax + 1)) warnings.push('指定盘数下预估垛高超过上限，放不下的货物将列入人工处理清单')

  return {
    groups: result,
    units,
    stats: {
      cargoCount: cargos.length,
      skuCount: groups.size,
      totalWeight,
      totalVolume,
      fullLayers: units.filter((u) => u.kind === 'full').length,
      mixedLayers: units.filter((u) => u.kind === 'mixed').length,
      looseCount: leftovers.length,
      lowerBound,
      pallets: result.length,
      heightSpread: [Math.round(before[0]), Math.round(after[0])],
      weightSpread: [before[1], after[1]],
      moves,
      elapsedMs: performance.now() - t0,
    },
    warnings,
  }
}

/** 子集和（按 10 mm 取整）：从 units 中选一组，使总高尽量接近 cap 且不超过 */
function subsetNear(units: LayerUnit[], cap: number, maxW: number): LayerUnit[] {
  const S = Math.floor(cap / 10)
  const from = new Int32Array(S + 1).fill(-2)
  const prev = new Int32Array(S + 1).fill(-1)
  from[0] = -1
  units.forEach((u, i) => {
    const h = Math.max(1, Math.round(u.height / 10))
    for (let s = S; s >= h; s--) {
      if (from[s] === -2 && from[s - h] !== -2 && from[s - h] !== i) {
        from[s] = i
        prev[s] = s - h
      }
    }
  })
  let s = S
  while (s > 0 && from[s] === -2) s--
  const out: LayerUnit[] = []
  let w = 0
  while (s > 0) {
    const u = units[from[s]]
    if (!maxW || w + u.weight <= maxW) {
      out.push(u)
      w += u.weight
    }
    s = prev[s]
  }
  return out
}

/** 指定盘数但按上限放不下时：仍按最矮优先分完（超高部分由单盘算法列为"未放入"） */
function forceFit(order: LayerUnit[], K: number, newBin: () => Bin, add: (b: Bin, u: LayerUnit) => void): Bin[] {
  const bins = Array.from({ length: K }, newBin)
  for (const u of order) {
    let best = 0
    for (let b = 1; b < K; b++) if (bins[b].h < bins[best].h) best = b
    add(bins[best], u)
  }
  return bins
}
