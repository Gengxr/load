/**
 * 单盘空间布局：层构造 + 层序列束搜索
 *
 *   ① 按高度把货物归入"高度类"（同层平整，容差 heightTolerance；矮件可叠成列补高）；
 *   ② 每个高度类生成候选层：同规格 → 最优图案（断头台 DP + 风车式），混合规格 → MaxRects；
 *   ③ 候选层按支撑、压缝选择镜像方向，并剔除支撑不足的件；
 *   ④ 束搜索选择层序列（体积密度高、重层在下），剩余货物用高度图自由码放收顶；
 *   ⑤ 与"全自由码放"策略比较，择优；
 *   ⑥ 重心精修：层镜像 / 平移，同规格不同重量的货物重新指派（重件在下、左右配平）。
 */
import type { Cargo, Constraints, LayerInfo, LayerKind, LayoutResult, PalletSpec, Placement } from './types'
import { bestPattern } from './pattern'
import { maxRectsPack, type Heuristic, type PackItem } from './maxrects'
import { freePack, type FreeBox, type FreeUnit, type FreeVariant } from './freepack'
import { bboxOf, overlapArea, supportOf, unionArea, type Rect } from './geometry'

interface Variant extends FreeVariant {}

interface Group {
  sku: string
  units: Cargo[]
  avgW: number
  unitVol: number
  variants: Variant[]
}

interface Item {
  g: number
  x: number
  y: number
  z: number
  dx: number
  dy: number
  unitH: number
  stack: number
  tipped: boolean
}

interface BLayer {
  kind: LayerKind
  z: number
  height: number
  items: Item[]
}

interface LState {
  layers: BLayer[]
  counts: number[]
  z: number
  vol: number
  mass: number
  mx: number
  my: number
  mz: number
  done: boolean
}

interface Ctx {
  groups: Group[]
  cons: Constraints
  pallet: PalletSpec
  FX: number
  FY: number
  H: number
  tol: number
  base: number
  deadline: number
  totalMass: number
  totalVol: number
}

export interface LayoutOptions {
  beamWidth: number
  branch: number
  timeBudgetMs: number
}

const DEFAULT_OPTS: LayoutOptions = { beamWidth: 6, branch: 4, timeBudgetMs: 6000 }

export function buildLayout(cargos: Cargo[], pallet: PalletSpec, cons: Constraints, opts: Partial<LayoutOptions> = {}): LayoutResult {
  const o = { ...DEFAULT_OPTS, ...opts }
  const ctx: Ctx = {
    groups: groupCargos(cargos, cons),
    cons,
    pallet,
    FX: cons.footprintX,
    FY: cons.footprintY,
    H: cons.maxStackHeight,
    tol: cons.heightTolerance,
    base: cons.cogOffsetBase === 'pallet' ? pallet.length : cons.footprintX,
    deadline: Date.now() + o.timeBudgetMs,
    totalMass: cargos.reduce((s, c) => s + c.weight, 0),
    totalVol: cargos.reduce((s, c) => s + c.length * c.width * c.height, 0) || 1,
  }
  const layered = layeredSearch(ctx, o)
  const free = freeStrategy(ctx)
  let best = layered
  let strategy: 'layered' | 'free' = 'layered'
  if (!layered || (free && finalScore(ctx, free) > finalScore(ctx, layered) + 1e-9)) {
    best = free
    strategy = 'free'
  }
  if (!best) best = emptyState(ctx)
  if (strategy === 'layered') {
    reorderByDensity(ctx, best)
    refineBalance(ctx, best)
  }
  return toResult(ctx, best, strategy)
}

// ───────────────────────── 分组 ─────────────────────────

function groupCargos(cargos: Cargo[], cons: Constraints): Group[] {
  const map = new Map<string, Cargo[]>()
  for (const c of cargos) {
    const l = Math.max(c.length, c.width)
    const w = Math.min(c.length, c.width)
    const key = `${c.sku}|${l}x${w}x${c.height}`
    let arr = map.get(key)
    if (!arr) map.set(key, (arr = []))
    arr.push(c)
  }
  const groups: Group[] = []
  for (const units of map.values()) {
    const c = units[0]
    const l = Math.max(c.length, c.width)
    const w = Math.min(c.length, c.width)
    const h = c.height
    const variants: Variant[] = [{ a: l, b: w, hgt: h, tipped: false }]
    if (cons.allowTipping) {
      const alt: [number, number, number][] = [
        [l, h, w],
        [w, h, l],
      ]
      for (const [p, q, hh] of alt) {
        const a = Math.max(p, q)
        const b = Math.min(p, q)
        if (hh <= cons.maxStackHeight && !variants.some((v) => v.a === a && v.b === b && v.hgt === hh))
          variants.push({ a, b, hgt: hh, tipped: true })
      }
    }
    const fits = variants.filter((v) => (v.a <= cons.footprintX && v.b <= cons.footprintY) || (v.b <= cons.footprintX && v.a <= cons.footprintY))
    units.sort((p, q) => q.weight - p.weight || (p.id < q.id ? -1 : 1))
    groups.push({
      sku: c.sku,
      units,
      avgW: units.reduce((s, u) => s + u.weight, 0) / units.length,
      unitVol: l * w * h,
      variants: fits,
    })
  }
  // 稳定排序：体积大的规格在前
  groups.sort((p, q) => q.unitVol - p.unitVol || (p.sku < q.sku ? -1 : 1))
  return groups
}

function emptyState(ctx: Ctx): LState {
  return {
    layers: [],
    counts: ctx.groups.map((g) => g.units.length),
    z: 0,
    vol: 0,
    mass: 0,
    mx: 0,
    my: 0,
    mz: 0,
    done: false,
  }
}

// ───────────────────────── 层序列束搜索 ─────────────────────────

interface Cand {
  kind: LayerKind
  height: number
  items: Item[]
  used: number[]
  score: number
}

function layeredSearch(ctx: Ctx, o: LayoutOptions): LState | null {
  let beam: LState[] = [emptyState(ctx)]
  const finals: LState[] = []
  for (let depth = 0; depth < 24 && beam.length; depth++) {
    const next: LState[] = []
    for (const st of beam) {
      if (remainingCount(st) === 0) {
        finals.push(st)
        continue
      }
      const timeUp = Date.now() > ctx.deadline
      const cands = timeUp ? [] : genCandidates(ctx, st)
      // 剩余货量不足约两层时，尝试用自由码放收顶
      const remVol = remainingVolume(ctx, st)
      const capCapacity = ctx.FX * ctx.FY * Math.min(ctx.H - st.z, 400)
      if (!cands.length || remVol <= capCapacity * 0.9) {
        const fin = capFinish(ctx, st)
        if (fin) finals.push(fin)
      }
      for (const c of cands.slice(0, o.branch)) next.push(extend(ctx, st, c))
    }
    // 去重 + 排序
    const seen = new Map<string, LState>()
    for (const s of next) {
      const key = s.counts.join(',') + '@' + s.z
      const prev = seen.get(key)
      if (!prev || partialScore(ctx, s) > partialScore(ctx, prev)) seen.set(key, s)
    }
    beam = [...seen.values()].sort((p, q) => partialScore(ctx, q) - partialScore(ctx, p)).slice(0, o.beamWidth)
  }
  if (!finals.length) return null
  finals.sort((p, q) => finalScore(ctx, q) - finalScore(ctx, p))
  return finals[0]
}

function remainingCount(st: LState): number {
  let n = 0
  for (const c of st.counts) n += c
  return n
}

function remainingVolume(ctx: Ctx, st: LState): number {
  let v = 0
  st.counts.forEach((c, g) => (v += c * ctx.groups[g].unitVol))
  return v
}

function regionOf(ctx: Ctx, st: LState): [number, number, number, number] {
  if (!st.layers.length) return [0, 0, ctx.FX, ctx.FY]
  const [x0, y0, x1, y1] = bboxOf(st.layers[st.layers.length - 1].items.map(itemRect))
  const r = ctx.cons.overhangRatioMax
  return [
    Math.max(0, Math.ceil(x0 - r * (x1 - x0))),
    Math.max(0, Math.ceil(y0 - r * (y1 - y0))),
    Math.min(ctx.FX, Math.floor(x1 + r * (x1 - x0))),
    Math.min(ctx.FY, Math.floor(y1 + r * (y1 - y0))),
  ]
}

const itemRect = (it: Item): Rect => ({ x: it.x, y: it.y, w: it.dx, h: it.dy })
const itemTop = (it: Item) => it.z + it.unitH * it.stack

function topRects(ctx: Ctx, layer: BLayer | undefined, z: number): Rect[] {
  if (!layer) return []
  return layer.items.filter((it) => itemTop(it) >= z - ctx.tol).map(itemRect)
}

function genCandidates(ctx: Ctx, st: LState): Cand[] {
  const region = regionOf(ctx, st)
  const [rx0, ry0, rx1, ry1] = region
  const RW = rx1 - rx0
  const RL = ry1 - ry0
  const hl = ctx.H - st.z
  const lower = st.layers[st.layers.length - 1]
  const lowerTop = topRects(ctx, lower, st.z)

  interface Entry {
    g: number
    v: Variant
  }
  const entries: Entry[] = []
  ctx.groups.forEach((grp, g) => {
    if (st.counts[g] <= 0) return
    for (const v of grp.variants) if (v.hgt <= hl) entries.push({ g, v })
  })
  const heights = [...new Set(entries.map((e) => e.v.hgt))].sort((p, q) => p - q)
  const clusters: number[][] = []
  for (const h of heights) {
    const last = clusters[clusters.length - 1]
    if (last && h - last[0] <= ctx.tol) last.push(h)
    else clusters.push([h])
  }

  const cands: Cand[] = []
  for (const cl of clusters) {
    const H = Math.max(...cl)
    const lo = Math.min(...cl)
    const singles: Entry[] = []
    const seenG = new Set<number>()
    for (const e of entries) {
      if (e.v.hgt >= lo && e.v.hgt <= H && !seenG.has(e.g)) {
        singles.push(e)
        seenG.add(e.g)
      }
    }
    // 矮件叠列补高
    const columns: { g: number; v: Variant; k: number; n: number }[] = []
    ctx.groups.forEach((grp, g) => {
      if (seenG.has(g) || st.counts[g] < 2) return
      for (const v of grp.variants) {
        for (let k = 2; k <= 3; k++) {
          const hh = k * v.hgt
          if (hh <= H + 1e-9 && hh >= H - ctx.tol && hh <= hl) {
            const n = Math.floor(st.counts[g] / k)
            if (n > 0) columns.push({ g, v, k, n })
          }
        }
      }
    })

    // (a) 同规格最优图案
    for (const s of singles) {
      const p = bestPattern(s.v.a, s.v.b, RW, RL)
      if (p.count === 0 || st.counts[s.g] < p.count) continue
      const items = p.rects.map<Item>((r) => ({
        g: s.g,
        x: rx0 + r.x,
        y: ry0 + r.y,
        z: st.z,
        dx: r.w,
        dy: r.h,
        unitH: s.v.hgt,
        stack: 1,
        tipped: s.v.tipped,
      }))
      pushCand(ctx, cands, 'pattern', H, items, region, lowerTop, st)
    }

    // (b) 混合规格 MaxRects
    const packItems: PackItem[] = []
    const meta: { g: number; v: Variant; k: number }[] = []
    for (const s of singles) {
      for (let i = 0; i < st.counts[s.g]; i++) {
        packItems.push({ id: meta.length, w: s.v.a, h: s.v.b, canRotate: true, prio: 0 })
        meta.push({ g: s.g, v: s.v, k: 1 })
      }
    }
    for (const c of columns) {
      for (let i = 0; i < c.n; i++) {
        packItems.push({ id: meta.length, w: c.v.a, h: c.v.b, canRotate: true, prio: 1 })
        meta.push({ g: c.g, v: c.v, k: c.k })
      }
    }
    if (!packItems.length) continue
    const heuristics: Heuristic[] = ['cp', 'bssf', 'bl']
    for (const h of heuristics) {
      const packed = maxRectsPack(packItems, RW, RL, h)
      if (!packed.length) continue
      const rects = packed.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }))
      const [bx0, by0, bx1, by1] = bboxOf(rects)
      // 外轮廓居中
      const sx = rx0 + Math.floor((RW - (bx1 - bx0)) / 2) - bx0
      const sy = ry0 + Math.floor((RL - (by1 - by0)) / 2) - by0
      const items = packed.map<Item>((p) => {
        const m = meta[p.id]
        return { g: m.g, x: p.x + sx, y: p.y + sy, z: st.z, dx: p.w, dy: p.h, unitH: m.v.hgt, stack: m.k, tipped: m.v.tipped }
      })
      pushCand(ctx, cands, 'mixed', H, items, region, lowerTop, st)
    }
  }

  // 去重（同样的用量只保留得分最高者）
  cands.sort((p, q) => q.score - p.score)
  const uniq: Cand[] = []
  const seen = new Set<string>()
  for (const c of cands) {
    const key = c.used.join(',') + '@' + c.height
    if (seen.has(key)) continue
    seen.add(key)
    uniq.push(c)
  }
  return uniq
}

/**
 * 层变换：t 的第 0/1 位 = X/Y 镜像，第 2 位 = 转置（旋转 90°，仅在方形区域内使用），
 * 用于上下层错缝（压缝）与重心配平。
 */
function transformItems(items: Item[], region: [number, number, number, number], t: number): Item[] {
  if (t === 0) return items
  const [rx0, ry0, rx1, ry1] = region
  return items.map((it) => {
    let { x, y, dx, dy } = it
    if (t & 4) {
      ;[x, y] = [rx0 + (y - ry0), ry0 + (x - rx0)]
      ;[dx, dy] = [dy, dx]
    }
    return {
      ...it,
      x: t & 1 ? rx0 + rx1 - (x + dx) : x,
      y: t & 2 ? ry0 + ry1 - (y + dy) : y,
      dx,
      dy,
    }
  })
}

/** 支撑不足（面积比例或重心投影）的件的下标 */
function unsupported(ctx: Ctx, items: Item[], lowerTop: Rect[], z: number): number[] {
  if (z <= 0) return []
  const bad: number[] = []
  items.forEach((it, i) => {
    const s = supportOf(itemRect(it), lowerTop)
    if (s.ratio < ctx.cons.supportRatioMin - 1e-9 || !s.cogInside) bad.push(i)
  })
  return bad
}

/** 压缝度：上层每件平均跨越的下层件数（>1 表示有压缝） */
function interlock(items: Item[], lowerTop: Rect[]): number {
  if (!lowerTop.length || !items.length) return 0
  let s = 0
  for (const it of items) {
    const r = itemRect(it)
    const area = r.w * r.h
    let n = 0
    for (const l of lowerTop) if (overlapArea(r, l) > 0.05 * area) n++
    s += Math.max(0, n - 1)
  }
  return s / items.length
}

function pushCand(
  ctx: Ctx,
  out: Cand[],
  kind: LayerKind,
  H: number,
  raw: Item[],
  region: [number, number, number, number],
  lowerTop: Rect[],
  st: LState,
) {
  let best: { items: Item[]; key: number } | null = null
  const square = Math.abs(region[2] - region[0] - (region[3] - region[1])) <= 1
  for (let t = 0; t < (square ? 8 : 4); t++) {
    const tr = transformItems(raw, region, t)
    const bad = unsupported(ctx, tr, lowerTop, st.z)
    const kept = bad.length ? tr.filter((_, i) => !bad.includes(i)) : tr
    // 与当前重心方向相反的放置更利于配平
    let mx = st.mx
    let my = st.my
    for (const it of kept) {
      const m = ctx.groups[it.g].avgW * it.stack
      mx += m * (it.x + it.dx / 2 - ctx.FX / 2)
      my += m * (it.y + it.dy / 2 - ctx.FY / 2)
    }
    const key = kept.length * 10 + interlock(kept, lowerTop) - (Math.abs(mx) + Math.abs(my)) / 1e7
    if (!best || key > best.key) best = { items: kept, key }
    if (!lowerTop.length) break
  }
  if (!best || !best.items.length) return
  const used = ctx.groups.map(() => 0)
  let area = 0
  let mass = 0
  for (const it of best.items) {
    used[it.g] += it.stack
    area += it.dx * it.dy
    mass += ctx.groups[it.g].avgW * it.stack
  }
  if (used.some((u, g) => u > st.counts[g])) return
  const util = area / (ctx.FX * ctx.FY)
  const density = mass / Math.max(1, area * H) * 1e6 // kg / m²·mm → 相对值
  const score = util + (kind === 'pattern' ? 0.012 : 0) + 0.004 * Math.min(5, density) + 0.01 * interlock(best.items, lowerTop)
  out.push({ kind, height: H, items: best.items, used, score })
}

function extend(ctx: Ctx, st: LState, c: Cand): LState {
  const counts = st.counts.map((n, g) => n - c.used[g])
  let { vol, mass, mx, my, mz } = st
  for (const it of c.items) {
    const grp = ctx.groups[it.g]
    const m = grp.avgW * it.stack
    vol += grp.unitVol * it.stack
    mass += m
    mx += m * (it.x + it.dx / 2 - ctx.FX / 2)
    my += m * (it.y + it.dy / 2 - ctx.FY / 2)
    mz += m * (it.z + (it.unitH * it.stack) / 2)
  }
  return {
    layers: [...st.layers, { kind: c.kind, z: st.z, height: c.height, items: c.items }],
    counts,
    z: st.z + c.height,
    vol,
    mass,
    mx,
    my,
    mz,
    done: false,
  }
}

function capFinish(ctx: Ctx, st: LState): LState | null {
  const units: FreeUnit[] = []
  st.counts.forEach((c, g) => {
    for (let i = 0; i < c; i++) units.push({ key: g, variants: ctx.groups[g].variants })
  })
  units.sort((p, q) => ctx.groups[q.key].unitVol - ctx.groups[p.key].unitVol)
  const existing: FreeBox[] = st.layers.flatMap((l) => l.items.map((it) => ({ x: it.x, y: it.y, dx: it.dx, dy: it.dy, z: it.z, dz: it.unitH * it.stack })))
  const res = freePack(units, existing, {
    FX: ctx.FX,
    FY: ctx.FY,
    region: regionOf(ctx, st),
    maxHeight: ctx.H,
    supportMin: ctx.cons.supportRatioMin,
    tol: ctx.tol,
    preferCenter: true,
  })
  const counts = ctx.groups.map(() => 0)
  for (const k of res.unplaced) counts[k]++
  if (!res.placed.length) return { ...st, counts, done: true }
  const items: Item[] = res.placed.map((p) => ({ g: p.key, x: p.x, y: p.y, z: p.z, dx: p.dx, dy: p.dy, unitH: p.dz, stack: 1, tipped: p.tipped }))
  const zTop = Math.max(st.z, ...items.map(itemTop))
  let { vol, mass, mx, my, mz } = st
  for (const it of items) {
    const grp = ctx.groups[it.g]
    vol += grp.unitVol
    mass += grp.avgW
    mx += grp.avgW * (it.x + it.dx / 2 - ctx.FX / 2)
    my += grp.avgW * (it.y + it.dy / 2 - ctx.FY / 2)
    mz += grp.avgW * (it.z + it.unitH / 2)
  }
  const minZ = Math.min(...items.map((it) => it.z))
  return {
    layers: [...st.layers, { kind: 'cap', z: minZ, height: zTop - minZ, items }],
    counts,
    z: zTop,
    vol,
    mass,
    mx,
    my,
    mz,
    done: true,
  }
}

function freeStrategy(ctx: Ctx): LState | null {
  const orders: ((a: Group, b: Group) => number)[] = [
    (a, b) => b.variants[0].hgt - a.variants[0].hgt || b.unitVol - a.unitVol,
    (a, b) => b.unitVol - a.unitVol,
    (a, b) => b.variants[0].a * b.variants[0].b - a.variants[0].a * a.variants[0].b,
  ]
  let best: LState | null = null
  for (const ord of orders) {
    if (Date.now() > ctx.deadline + 2000) break
    const gi = ctx.groups.map((_, i) => i).sort((p, q) => ord(ctx.groups[p], ctx.groups[q]))
    const units: FreeUnit[] = []
    for (const g of gi) for (let i = 0; i < ctx.groups[g].units.length; i++) units.push({ key: g, variants: ctx.groups[g].variants })
    const res = freePack(units, [], {
      FX: ctx.FX,
      FY: ctx.FY,
      region: [0, 0, ctx.FX, ctx.FY],
      maxHeight: ctx.H,
      supportMin: ctx.cons.supportRatioMin,
      tol: ctx.tol,
      preferCenter: false,
    })
    const st = emptyState(ctx)
    st.counts = ctx.groups.map(() => 0)
    for (const k of res.unplaced) st.counts[k]++
    // 按底面高度聚类成"层"
    const items: Item[] = res.placed.map((p) => ({ g: p.key, x: p.x, y: p.y, z: p.z, dx: p.dx, dy: p.dy, unitH: p.dz, stack: 1, tipped: p.tipped }))
    const zs = [...new Set(items.map((it) => it.z))].sort((p, q) => p - q)
    const levels: number[] = []
    for (const z of zs) if (!levels.length || z - levels[levels.length - 1] > ctx.tol) levels.push(z)
    const layers: BLayer[] = levels.map((z) => ({ kind: 'free' as LayerKind, z, height: 0, items: [] as Item[] }))
    for (const it of items) {
      let li = 0
      for (let k = 0; k < levels.length; k++) if (it.z >= levels[k] - ctx.tol) li = k
      layers[li].items.push(it)
    }
    for (const l of layers) l.height = Math.max(...l.items.map(itemTop)) - l.z
    st.layers = layers.filter((l) => l.items.length)
    for (const it of items) {
      const grp = ctx.groups[it.g]
      st.vol += grp.unitVol
      st.mass += grp.avgW
      st.mx += grp.avgW * (it.x + it.dx / 2 - ctx.FX / 2)
      st.my += grp.avgW * (it.y + it.dy / 2 - ctx.FY / 2)
      st.mz += grp.avgW * (it.z + it.unitH / 2)
    }
    st.z = items.length ? Math.max(...items.map(itemTop)) : 0
    st.done = true
    if (!best || finalScore(ctx, st) > finalScore(ctx, best)) best = st
  }
  return best
}

// ───────────────────────── 评分 ─────────────────────────

function partialScore(ctx: Ctx, st: LState): number {
  if (st.z <= 0) return 0
  const fill = st.vol / (st.z * ctx.FX * ctx.FY)
  let low = 0
  for (const l of st.layers) if (layerUtil(ctx, l) < ctx.cons.utilizationMin) low++
  // 重件在下：已放货物的质量占比高于体积占比，说明先放的是密度大的货物
  const heavyFirst = ctx.totalMass > 0 ? st.mass / ctx.totalMass - st.vol / ctx.totalVol : 0
  return fill - 0.03 * low + 0.25 * heavyFirst
}

function layerUtil(ctx: Ctx, l: BLayer): number {
  let a = 0
  for (const it of l.items) a += it.dx * it.dy
  return a / (ctx.FX * ctx.FY)
}

function cogOf(ctx: Ctx, st: LState) {
  const tare = ctx.pallet.tareWeight
  const M = st.mass + tare
  const ox = st.mx / M / ctx.base
  const oy = st.my / M / ctx.base
  const czFromBottom = (st.mz + tare * (-ctx.pallet.height / 2)) / M + ctx.pallet.height
  const hr = czFromBottom / (st.z + ctx.pallet.height)
  return { ox, oy, hr }
}

/**
 * 每件的层级：平整层的件取所在层号；收尾件 = 1 + 其支撑件的最大层级
 * （嵌在下层空位里的收尾件与该层同级）。
 */
function itemLevels(ctx: Ctx, layers: BLayer[]): { it: Item; level: number }[] {
  const out: { it: Item; level: number }[] = []
  layers.forEach((l, li) => {
    if (l.kind !== 'cap') for (const it of l.items) out.push({ it, level: li })
  })
  const caps = layers.flatMap((l) => (l.kind === 'cap' ? l.items : [])).sort((a, b) => a.z - b.z)
  for (const it of caps) {
    let lv = 0
    for (const o of out) {
      if (Math.abs(itemTop(o.it) - it.z) <= ctx.tol && overlapArea(itemRect(o.it), itemRect(it)) > 0) lv = Math.max(lv, o.level + 1)
    }
    out.push({ it, level: lv })
  }
  return out
}

function levelUtils(ctx: Ctx, st: LState): number[] {
  const lv = itemLevels(ctx, st.layers)
  const n = lv.reduce((m, x) => Math.max(m, x.level + 1), 0)
  const area = new Array<number>(n).fill(0)
  for (const { it, level } of lv) area[level] += it.dx * it.dy
  return area.map((a) => a / (ctx.FX * ctx.FY))
}

function finalScore(ctx: Ctx, st: LState): number {
  const unplaced = remainingCount(st)
  let s = -1000 * unplaced
  const flat = st.layers.filter((l) => l.kind !== 'cap')
  // 按"支撑层级"统计利用率：顶层收尾区若叠成多级，每一级都单独考核（只豁免最顶一级）
  const lv = levelUtils(ctx, st)
  const nonTop = lv.slice(0, -1)
  for (const u of nonTop) if (u < ctx.cons.utilizationMin) s -= 20
  const utils = (nonTop.length ? nonTop : lv).map((u) => Math.min(1, u))
  s += 3 * (utils.length ? utils.reduce((a, b) => a + b, 0) / utils.length : 0)
  const { ox, oy, hr } = cogOf(ctx, st)
  const off = Math.max(Math.abs(ox), Math.abs(oy))
  const L = ctx.cons.cogOffsetRatioMax
  if (off > L) s -= 50 * ((off - L) / L)
  s -= 1.5 * (off / L)
  if (hr > ctx.cons.cogHeightRatioMax) s -= 50 * (hr - ctx.cons.cogHeightRatioMax) * 10
  s -= 3 * hr
  // 结构规整：平整层占比高更好；顶层收尾若叠成多级台阶则扣分
  s += 0.2 * (flat.length / Math.max(1, st.layers.length))
  for (const l of st.layers) {
    if (l.kind !== 'cap') continue
    const levels = new Set(l.items.map((it) => Math.round(it.z / 10))).size
    s -= 0.3 * (levels - 1)
  }
  return s
}

// ───────────────────────── 重心精修 ─────────────────────────

function stateMoments(ctx: Ctx, st: LState) {
  let mass = 0,
    mx = 0,
    my = 0
  for (const l of st.layers)
    for (const it of l.items) {
      const m = ctx.groups[it.g].avgW * it.stack
      mass += m
      mx += m * (it.x + it.dx / 2 - ctx.FX / 2)
      my += m * (it.y + it.dy / 2 - ctx.FY / 2)
    }
  st.mass = mass
  st.mx = mx
  st.my = my
}

function offsetScore(ctx: Ctx, st: LState): number {
  const M = st.mass + ctx.pallet.tareWeight
  return Math.max(Math.abs(st.mx / M), Math.abs(st.my / M))
}

function layerOk(ctx: Ctx, layers: BLayer[], li: number): boolean {
  const cur = layers[li]
  if (li > 0) {
    const lower = layers[li - 1]
    const all = layers.flatMap((l) => l.items)
    for (const it of cur.items) {
      if (it.z <= 0) continue
      // 支撑面 = 顶面与本件底面等高的所有件（顶层收尾件可能叠在同层件上）
      const sup = all.filter((o) => o !== it && Math.abs(itemTop(o) - it.z) <= ctx.tol).map(itemRect)
      const s = supportOf(itemRect(it), sup)
      if (s.ratio < ctx.cons.supportRatioMin - 1e-9 || !s.cogInside) return false
    }
    const [ux0, uy0, ux1, uy1] = bboxOf(cur.items.map(itemRect))
    const [lx0, ly0, lx1, ly1] = bboxOf(lower.items.map(itemRect))
    const r = ctx.cons.overhangRatioMax
    const ex = r * (lx1 - lx0) + 1e-6
    const ey = r * (ly1 - ly0) + 1e-6
    if (ux0 < lx0 - ex || ux1 > lx1 + ex || uy0 < ly0 - ey || uy1 > ly1 + ey) return false
  }
  for (const it of cur.items) if (it.x < 0 || it.y < 0 || it.x + it.dx > ctx.FX || it.y + it.dy > ctx.FY) return false
  // 与其他层的件不得三维干涉（顶层收尾件可能嵌在下层的空位里）
  for (let lj = 0; lj < layers.length; lj++) {
    if (lj === li) continue
    for (const o of layers[lj].items) {
      for (const it of cur.items) {
        if (
          it.x < o.x + o.dx - 0.5 &&
          o.x < it.x + it.dx - 0.5 &&
          it.y < o.y + o.dy - 0.5 &&
          o.y < it.y + it.dy - 0.5 &&
          it.z < itemTop(o) - 0.5 &&
          o.z < itemTop(it) - 0.5
        )
          return false
      }
    }
  }
  return true
}

/** 第 li 层及其上所有层都满足支撑、外扩、不干涉 */
function layersOkFrom(ctx: Ctx, layers: BLayer[], li: number): boolean {
  for (let k = li; k < layers.length; k++) if (!layerOk(ctx, layers, k)) return false
  return true
}

function layerDensity(ctx: Ctx, l: BLayer): number {
  let m = 0,
    v = 0
  for (const it of l.items) {
    m += ctx.groups[it.g].avgW * it.stack
    v += ctx.groups[it.g].unitVol * it.stack
  }
  return v ? m / v : 0
}

/** 重件在下：相邻平整层按密度冒泡交换，交换后支撑、外扩、不干涉仍须全部满足 */
function reorderByDensity(ctx: Ctx, st: LState) {
  const L = st.layers
  let top = L.length - 1
  while (top >= 0 && L[top].kind === 'cap') top--
  // 有收尾件时，其所依托的最上层平整层保持不动
  const last = L.length - 1 > top ? top - 1 : top
  for (let pass = 0; pass < L.length; pass++) {
    let swapped = false
    for (let i = 0; i < last; i++) {
      const a = L[i]
      const b = L[i + 1]
      if (layerDensity(ctx, b) <= layerDensity(ctx, a) * 1.05) continue
      const za = a.z
      const shiftB = -a.height
      const shiftA = b.height
      const mv = (l: BLayer, d: number) => {
        l.z += d
        l.items = l.items.map((it) => ({ ...it, z: it.z + d }))
      }
      mv(b, shiftB)
      mv(a, shiftA)
      L[i] = b
      L[i + 1] = a
      if (b.z === za && layersOkFrom(ctx, L, i)) {
        swapped = true
        continue
      }
      // 撤销
      L[i] = a
      L[i + 1] = b
      mv(a, -shiftA)
      mv(b, -shiftB)
    }
    if (!swapped) break
  }
  st.mz = 0
  for (const l of L) for (const it of l.items) st.mz += ctx.groups[it.g].avgW * it.stack * (it.z + (it.unitH * it.stack) / 2)
}

function refineBalance(ctx: Ctx, st: LState) {
  stateMoments(ctx, st)
  const L = st.layers
  for (let pass = 0; pass < 2; pass++) {
    for (let li = L.length - 1; li >= 0; li--) {
      const orig = L[li].items
      const region = bboxOf(orig.map(itemRect))
      let bestItems = orig
      let bestScore = offsetScore(ctx, st)
      // 镜像
      for (let t = 1; t < 4; t++) {
        L[li].items = transformItems(orig, region, t)
        stateMoments(ctx, st)
        const sc = offsetScore(ctx, st)
        if (sc < bestScore - 1e-6 && layersOkFrom(ctx, L, li)) {
          bestScore = sc
          bestItems = L[li].items
        }
      }
      L[li].items = bestItems
      stateMoments(ctx, st)
      // 平移（在允许范围内把整体重心拉回中心）
      const lm = bestItems.reduce((s, it) => s + ctx.groups[it.g].avgW * it.stack, 0)
      if (lm <= 0) continue
      const M = st.mass + ctx.pallet.tareWeight
      for (const f of [1, 0.5, 0.25]) {
        const sx = Math.round((-st.mx / lm) * f)
        const sy = Math.round((-st.my / lm) * f)
        if (!sx && !sy) break
        const moved = bestItems.map((it) => ({ ...it, x: it.x + sx, y: it.y + sy }))
        const prev = L[li].items
        L[li].items = moved
        stateMoments(ctx, st)
        const sc = Math.max(Math.abs(st.mx / M), Math.abs(st.my / M))
        if (sc < bestScore - 1e-6 && layersOkFrom(ctx, L, li)) {
          bestScore = sc
          break
        }
        L[li].items = prev
        stateMoments(ctx, st)
      }
    }
  }
}

// ───────────────────────── 输出 ─────────────────────────

interface Slot {
  g: number
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
  tipped: boolean
  layer: number
  unit?: Cargo
}

function toResult(ctx: Ctx, st: LState, strategy: 'layered' | 'free'): LayoutResult {
  const slots: Slot[] = []
  st.layers.forEach((l, li) => {
    for (const it of l.items)
      for (let s = 0; s < it.stack; s++)
        slots.push({ g: it.g, x: it.x, y: it.y, z: it.z + s * it.unitH, dx: it.dx, dy: it.dy, dz: it.unitH, tipped: it.tipped, layer: li })
  })
  if (strategy === 'free') assignSupportLevels(ctx, slots)
  else {
    const lv = itemLevels(ctx, st.layers)
    const levelOf = new Map(lv.map((x) => [x.it, x.level]))
    let k = 0
    st.layers.forEach((l) => {
      for (const it of l.items) {
        const level = levelOf.get(it) ?? 0
        for (let s = 0; s < it.stack; s++) slots[k++].layer = level
      }
    })
  }
  // 指派具体货物：同规格内重件放低处
  const remaining: Cargo[] = []
  ctx.groups.forEach((grp, g) => {
    const mine = slots.filter((s) => s.g === g).sort((p, q) => p.z - q.z || p.layer - q.layer)
    mine.forEach((s, i) => (s.unit = grp.units[i]))
    for (let i = mine.length; i < grp.units.length; i++) remaining.push(grp.units[i])
  })
  swapRefine(ctx, slots)

  const placements: Placement[] = slots.map((s) => ({
    cargoId: s.unit!.id,
    sku: s.unit!.sku,
    x: s.x,
    y: s.y,
    z: s.z,
    dx: s.dx,
    dy: s.dy,
    dz: s.dz,
    rotated: s.dy > s.dx,
    tipped: s.tipped,
    layer: s.layer,
    weight: s.unit!.weight,
  }))

  const nLayers = slots.reduce((m, s) => Math.max(m, s.layer + 1), 0)
  const layers: LayerInfo[] = Array.from({ length: nLayers }, (_, li) => {
    const pl = placements.filter((p) => p.layer === li)
    const rects = pl.map((p) => ({ x: p.x, y: p.y, w: p.dx, h: p.dy }))
    const z = Math.min(...pl.map((p) => p.z))
    return {
      index: li,
      z,
      height: Math.max(...pl.map((p) => p.z + p.dz)) - z,
      kind: strategy === 'free' ? 'free' : kindOfLevel(st, li, pl),
      count: pl.length,
      utilization: unionArea(rects) / (ctx.FX * ctx.FY),
      bbox: bboxOf(rects),
      weight: pl.reduce((s, p) => s + p.weight, 0),
    }
  })
  return { placements, layers, remaining, strategy }
}

function kindOfLevel(st: LState, li: number, pl: Placement[]): LayerKind {
  const flat = st.layers[li]
  if (flat && flat.kind !== 'cap' && pl.some((p) => p.z === flat.z)) return flat.kind
  return 'cap'
}

/** 自由码放没有平整层：按"支撑层级"分层，层级 = 1 + 其支撑者的最大层级（落在货盘上为 0） */
function assignSupportLevels(ctx: Ctx, slots: Slot[]) {
  const order = slots.map((_, i) => i).sort((a, b) => slots[a].z - slots[b].z)
  const level = new Array<number>(slots.length).fill(0)
  for (const j of order) {
    const b = slots[j]
    if (b.z <= ctx.tol) continue
    let lv = 0
    for (const i of order) {
      const a = slots[i]
      if (a.z >= b.z) break
      if (Math.abs(a.z + a.dz - b.z) <= ctx.tol && overlapArea({ x: a.x, y: a.y, w: a.dx, h: a.dy }, { x: b.x, y: b.y, w: b.dx, h: b.dy }) > 0)
        lv = Math.max(lv, level[i] + 1)
    }
    level[j] = lv
  }
  slots.forEach((s, i) => (s.layer = level[i]))
}

/** 同规格、同层的货物两两互换，减小水平偏心 */
function swapRefine(ctx: Ctx, slots: Slot[]) {
  const M = slots.reduce((s, x) => s + x.unit!.weight, 0) + ctx.pallet.tareWeight
  let mx = 0,
    my = 0
  for (const s of slots) {
    mx += s.unit!.weight * (s.x + s.dx / 2 - ctx.FX / 2)
    my += s.unit!.weight * (s.y + s.dy / 2 - ctx.FY / 2)
  }
  const obj = (a: number, b: number) => Math.max(Math.abs(a), Math.abs(b)) / M
  for (let pass = 0; pass < 3; pass++) {
    let improved = false
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]
        const b = slots[j]
        if (a.g !== b.g || a.layer !== b.layer) continue
        const dw = a.unit!.weight - b.unit!.weight
        if (!dw) continue
        const ax = a.x + a.dx / 2,
          bx = b.x + b.dx / 2
        const ay = a.y + a.dy / 2,
          by = b.y + b.dy / 2
        const nmx = mx + dw * (bx - ax)
        const nmy = my + dw * (by - ay)
        if (obj(nmx, nmy) < obj(mx, my) - 1e-9) {
          ;[a.unit, b.unit] = [b.unit, a.unit]
          mx = nmx
          my = nmy
          improved = true
        }
      }
    }
    if (!improved) break
  }
}
