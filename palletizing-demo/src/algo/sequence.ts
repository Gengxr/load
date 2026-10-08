/**
 * 码放顺序规划（核心）
 *
 * 问题：在先后约束图（DAG）的全部拓扑序中，找一个使"全过程"平衡性最好的顺序。
 *   目标 = w峰 · max_k e_k + w均 · mean_k e_k + w行 · 平均行走距离 + w孔 · 封闭孔位数 + w换 · 换层次数
 *   e_k = 放完第 k 件后，货物+货盘系统重心的水平偏心率 max(|Δx|, |Δy|) / 基准长度
 * 约束：
 *   · 每件货物放下时，其下方所有投影重叠的货物都已就位（竖直下放可达 + 中间状态完整支撑）；
 *   · 层超前约束：最多允许超前最低未完成层 layerLead 层（0 = 严格逐层）。
 * 方法：束搜索（beam search）。状态 = 已放集合，按增量重心 O(1) 评估扩展，Zobrist 哈希去重。
 *
 * 对照基线：传统"逐层、由远及近、从左到右"的行扫描顺序。
 */
import type { Constraints, PalletSpec, Placement, SequenceParams, SequenceResult, SequenceStrategy, SequenceSummary, StepSeries } from './types'
import { enclosedSides, type Precedence } from './precedence'
import { supportOf } from './geometry'
import { Rng } from './rng'

interface Env {
  pl: Placement[]
  prec: Precedence
  cx: Float64Array
  cy: Float64Array
  w: Float64Array
  layer: Int32Array
  nLayers: number
  tare: number
  baseX: number
  baseY: number
}

function makeEnv(pl: Placement[], prec: Precedence, pallet: PalletSpec, cons: Constraints): Env {
  const n = pl.length
  const cx = new Float64Array(n)
  const cy = new Float64Array(n)
  const w = new Float64Array(n)
  const layer = new Int32Array(n)
  let nLayers = 0
  pl.forEach((p, i) => {
    cx[i] = p.x + p.dx / 2 - cons.footprintX / 2
    cy[i] = p.y + p.dy / 2 - cons.footprintY / 2
    w[i] = p.weight
    layer[i] = p.layer
    nLayers = Math.max(nLayers, p.layer + 1)
  })
  return {
    pl,
    prec,
    cx,
    cy,
    w,
    layer,
    nLayers,
    tare: pallet.tareWeight,
    baseX: cons.cogOffsetBase === 'pallet' ? pallet.length : cons.footprintX,
    baseY: cons.cogOffsetBase === 'pallet' ? pallet.width : cons.footprintY,
  }
}

// ───────────────────────── 基线：逐层行扫描 ─────────────────────────

export function baselineOrder(pl: Placement[], prec: Precedence): number[] {
  const key = (i: number) => {
    const p = pl[i]
    // 层 → 高度 → 由远及近（Y 大者先）→ 从左到右
    return [p.layer, p.z, -(p.y + p.dy / 2), p.x + p.dx / 2]
  }
  return stableTopo(pl.length, prec, (a, b) => {
    const ka = key(a)
    const kb = key(b)
    for (let t = 0; t < ka.length; t++) if (Math.abs(ka[t] - kb[t]) > 1e-6) return ka[t] - kb[t]
    return a - b
  })
}

/** 满足先后约束的前提下，按给定比较函数尽量排序（Kahn + 最小堆的简化版） */
function stableTopo(n: number, prec: Precedence, cmp: (a: number, b: number) => number): number[] {
  const indeg = prec.preds.map((p) => p.length)
  const ready: number[] = []
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i)
  const out: number[] = []
  while (ready.length) {
    ready.sort(cmp)
    const i = ready.shift()!
    out.push(i)
    for (const j of prec.succs[i]) if (--indeg[j] === 0) ready.push(j)
  }
  return out
}

// ───────────────────────── 平衡优先束搜索 ─────────────────────────

interface BState {
  node: number
  placed: Uint8Array
  indeg: Int32Array
  ready: number[]
  layerLeft: Int32Array
  low: number
  mass: number
  mx: number
  my: number
  peak: number
  sum: number
  holes: number
  three: number
  travel: number
  jumps: number
  last: number
  h1: number
  h2: number
}

export function balanceOrder(env: Env, params: SequenceParams): number[] {
  const { pl, prec } = env
  const n = pl.length
  if (!n) return []
  const B = n > 500 ? Math.min(params.beamWidth, 32) : n > 250 ? Math.min(params.beamWidth, 64) : params.beamWidth
  const rng = new Rng(0xbada55)
  const z1 = new Uint32Array(n).map(() => rng.u32())
  const z2 = new Uint32Array(n).map(() => rng.u32())

  // 节点池：回溯出完整顺序
  const parent: number[] = []
  const nodeIdx: number[] = []

  const init: BState = {
    node: -1,
    placed: new Uint8Array(n),
    indeg: Int32Array.from(prec.preds.map((p) => p.length)),
    ready: [],
    layerLeft: new Int32Array(env.nLayers),
    low: 0,
    mass: 0,
    mx: 0,
    my: 0,
    peak: 0,
    sum: 0,
    holes: 0,
    three: 0,
    travel: 0,
    jumps: 0,
    last: -1,
    h1: 0,
    h2: 0,
  }
  for (let i = 0; i < n; i++) {
    if (!init.indeg[i]) init.ready.push(i)
    init.layerLeft[env.layer[i]]++
  }
  while (init.low < env.nLayers && init.layerLeft[init.low] === 0) init.low++

  let beam: BState[] = [init]
  interface Child {
    s: BState
    i: number
    cost: number
    peak: number
    sum: number
    holes: number
    three: number
    travel: number
    jump: number
  }

  for (let step = 0; step < n; step++) {
    const children: Child[] = []
    const k = step + 1
    for (const s of beam) {
      const isPlaced = (j: number) => s.placed[j] === 1
      for (const i of s.ready) {
        if (env.layer[i] > s.low + params.layerLead) continue
        const M = s.mass + env.w[i] + env.tare
        const ex = Math.abs((s.mx + env.w[i] * env.cx[i]) / M) / env.baseX
        const ey = Math.abs((s.my + env.w[i] * env.cy[i]) / M) / env.baseY
        const e = Math.max(ex, ey)
        const peak = Math.max(s.peak, e)
        const sum = s.sum + e
        const enc = enclosedSides(i, pl, prec, isPlaced)
        // 前瞻：放下 i 之后，是否把某个尚未放置的邻居围成四面封闭的"孔位"
        let created = 0
        s.placed[i] = 1
        for (const nb of prec.neighbors[i]) if (!s.placed[nb.j] && enclosedSides(nb.j, pl, prec, isPlaced) >= 4) created++
        s.placed[i] = 0
        const holes = s.holes + created
        const three = s.three + (enc === 3 ? 1 : 0)
        const travel = s.travel + (s.last >= 0 ? Math.hypot(env.cx[i] - env.cx[s.last], env.cy[i] - env.cy[s.last]) / 1000 : 0)
        // 换层：与上一件不在同一层（工人需要换到另一层操作）
        const jump = s.jumps + (s.last >= 0 && env.layer[i] !== env.layer[s.last] ? 1 : 0)
        const cost =
          params.wPeak * peak +
          params.wMean * (sum / k) +
          params.wTravel * (travel / k) +
          params.wLayerJump * jump +
          params.wHole * (holes + 0.2 * three)
        children.push({ s, i, cost, peak, sum, holes, three, travel, jump })
      }
    }
    if (!children.length) {
      // 理论上不会发生（最低未完成层总有可放件）；兜底：放开层超前约束
      for (const s of beam) for (const i of s.ready) children.push({ s, i, cost: 0, peak: s.peak, sum: s.sum, holes: s.holes, three: s.three, travel: s.travel, jump: s.jumps })
    }
    children.sort((a, b) => a.cost - b.cost || a.i - b.i)
    const next: BState[] = []
    const seen = new Set<string>()
    for (const c of children) {
      if (next.length >= B) break
      const h1 = (c.s.h1 ^ z1[c.i]) >>> 0
      const h2 = (c.s.h2 ^ z2[c.i]) >>> 0
      const hk = h1 + ':' + h2
      if (seen.has(hk)) continue
      seen.add(hk)
      const s = c.s
      const placed = s.placed.slice()
      placed[c.i] = 1
      const indeg = s.indeg.slice()
      const ready = s.ready.filter((j) => j !== c.i)
      for (const j of prec.succs[c.i]) if (--indeg[j] === 0) ready.push(j)
      const layerLeft = s.layerLeft.slice()
      layerLeft[env.layer[c.i]]--
      let low = s.low
      while (low < env.nLayers && layerLeft[low] === 0) low++
      parent.push(s.node)
      nodeIdx.push(c.i)
      next.push({
        node: parent.length - 1,
        placed,
        indeg,
        ready,
        layerLeft,
        low,
        mass: s.mass + env.w[c.i],
        mx: s.mx + env.w[c.i] * env.cx[c.i],
        my: s.my + env.w[c.i] * env.cy[c.i],
        peak: c.peak,
        sum: c.sum,
        holes: c.holes,
        three: c.three,
        travel: c.travel,
        jumps: c.jump,
        last: c.i,
        h1,
        h2,
      })
    }
    beam = next
  }
  const order: number[] = []
  for (let node = beam[0].node; node >= 0; node = parent[node]) order.push(nodeIdx[node])
  return order.reverse()
}

// ───────────────────────── 逐步状态 ─────────────────────────

export function computeSteps(env: Env, order: number[], cons: Constraints, palletHeight: number): { steps: StepSeries; summary: SequenceSummary } {
  const { pl, prec } = env
  const n = order.length
  const steps: StepSeries = {
    cogX: [cons.footprintX / 2],
    cogY: [cons.footprintY / 2],
    cogZ: [-palletHeight / 2],
    mass: [env.tare],
    ratio: [0],
    moment: [0],
    support: [1],
    enclosed: [0],
    layerJump: [false],
  }
  const placed = new Uint8Array(pl.length)
  const layerLeft = new Int32Array(env.nLayers)
  for (let i = 0; i < pl.length; i++) layerLeft[env.layer[i]]++
  let low = 0
  while (low < env.nLayers && layerLeft[low] === 0) low++
  let M = env.tare
  let mx = 0,
    my = 0,
    mz = env.tare * (-palletHeight / 2)
  let valid = n === pl.length
  let travel = 0
  let holes = 0
  let jumps = 0
  for (let k = 0; k < n; k++) {
    const i = order[k]
    const p = pl[i]
    if (prec.preds[i].some((j) => !placed[j])) valid = false
    const enc = enclosedSides(i, pl, prec, (j) => placed[j] === 1)
    const jump = k > 0 && env.layer[i] !== env.layer[order[k - 1]]
    const sup = p.z <= cons.heightTolerance ? 1 : supportOf({ x: p.x, y: p.y, w: p.dx, h: p.dy }, prec.supporters[i].filter((j) => placed[j]).map((j) => ({ x: pl[j].x, y: pl[j].y, w: pl[j].dx, h: pl[j].dy }))).ratio
    placed[i] = 1
    layerLeft[env.layer[i]]--
    while (low < env.nLayers && layerLeft[low] === 0) low++
    M += p.weight
    mx += p.weight * env.cx[i]
    my += p.weight * env.cy[i]
    mz += p.weight * (p.z + p.dz / 2)
    const dx = mx / M
    const dy = my / M
    steps.cogX.push(cons.footprintX / 2 + dx)
    steps.cogY.push(cons.footprintY / 2 + dy)
    steps.cogZ.push(mz / M)
    steps.mass.push(M)
    steps.ratio.push(Math.max(Math.abs(dx) / env.baseX, Math.abs(dy) / env.baseY))
    steps.moment.push((9.81 * M * Math.hypot(dx, dy)) / 1000)
    steps.support.push(sup)
    steps.enclosed.push(enc)
    steps.layerJump.push(jump)
    if (k > 0) travel += Math.hypot(env.cx[i] - env.cx[order[k - 1]], env.cy[i] - env.cy[order[k - 1]]) / 1000
    if (enc >= 4) holes++
    if (jump) jumps++
  }
  const r = steps.ratio.slice(1)
  let peakStep = 0
  r.forEach((v, k) => {
    if (v > r[peakStep]) peakStep = k
  })
  const summary: SequenceSummary = {
    peakRatio: r.length ? Math.max(...r) : 0,
    meanRatio: r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0,
    peakStep: peakStep + 1,
    peakMoment: Math.max(0, ...steps.moment),
    exceedSteps: r.filter((v) => v > cons.cogOffsetRatioMax + 1e-9).length,
    holes,
    travel,
    layerJumps: jumps,
    valid,
  }
  return { steps, summary }
}

export function planSequence(
  strategy: SequenceStrategy,
  pl: Placement[],
  prec: Precedence,
  pallet: PalletSpec,
  cons: Constraints,
  params: SequenceParams,
): SequenceResult {
  const t0 = performance.now()
  const env = makeEnv(pl, prec, pallet, cons)
  const order = strategy === 'balance' ? balanceOrder(env, params) : baselineOrder(pl, prec)
  const { steps, summary } = computeSteps(env, order, cons, pallet.height)
  return { strategy, order, steps, summary, elapsedMs: performance.now() - t0 }
}
