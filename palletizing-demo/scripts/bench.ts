/**
 * 算法批量评测：npm run bench [-- 种子数]
 * 对每种货物生成模式跑多个随机种子，统计技术指标达标率、耗时、过程平衡性（本方案 vs 基线）。
 */
import { generateCargos, DEFAULT_GEN, type GenMode } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE, ENVELOPES } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'

const seeds = Number(process.argv[2] ?? 20)
const SPEC = { fx: 1000, fy: 1000, targetHeight: 1100 }
const modes: { mode: GenMode; label: string; extra?: object; cons?: object }[] = [
  { mode: 'standard', label: '应急救援物资(6 规格)' },
  { mode: 'mixed', label: '综合保障物资(8+ 规格)' },
  { mode: 'random', label: '随机尺寸(50档)', extra: { fillRatio: 0.78 } },
  { mode: 'random', label: '随机尺寸(10档)', extra: { heightStep: 10, fillRatio: 0.75 } },
  { mode: 'single', label: '图2-1 单规格(1000×1000 口径)', extra: SPEC, cons: ENVELOPES.spec },
]

const pct = (v: number) => (v * 100).toFixed(1).padStart(5) + '%'

for (const m of modes) {
  const pass: Record<string, number> = {}
  let t = 0,
    tMax = 0,
    n = 0,
    placedAll = 0,
    boxes = 0,
    minUtil = 0,
    off = 0,
    peakOurs = 0,
    peakBase = 0,
    meanOurs = 0,
    meanBase = 0,
    gross = 0,
    grossMax = 0,
    vol = 0,
    height = 0,
    loadMax = 0,
    holes = 0,
    free = 0,
    invalid = 0
  for (let s = 0; s < seeds; s++) {
    const cargos = generateCargos({ ...DEFAULT_GEN, mode: m.mode, seed: 1000 + s, singleIndex: s % 14, ...(m.extra ?? {}) })
    const res = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: { ...DEFAULT_CONSTRAINTS, ...(m.cons ?? {}) }, sequence: DEFAULT_SEQUENCE })
    n++
    gross += res.metrics.grossWeight
    grossMax = Math.max(grossMax, res.metrics.grossWeight)
    vol += res.metrics.volumeUtilization
    height += res.metrics.stackSize[2]
    loadMax = Math.max(loadMax, res.metrics.maxLoadRatio)
    boxes += cargos.length
    t += res.timings.totalMs
    tMax = Math.max(tMax, res.timings.totalMs)
    if (!res.layout.remaining.length) placedAll++
    if (res.layout.strategy === 'free') free++
    for (const it of res.metrics.items) if (it.pass !== null) pass[it.key] = (pass[it.key] ?? 0) + (it.pass ? 1 : 0)
    minUtil += res.metrics.minLayerUtilization
    off += Math.max(Math.abs(res.metrics.cogOffsetRatio[0]), Math.abs(res.metrics.cogOffsetRatio[1]))
    peakOurs += res.sequences.balance.summary.peakRatio
    peakBase += res.sequences.baseline.summary.peakRatio
    meanOurs += res.sequences.balance.summary.meanRatio
    meanBase += res.sequences.baseline.summary.meanRatio
    holes += res.sequences.balance.summary.holes
    if (!res.sequences.balance.summary.valid || !res.sequences.baseline.summary.valid) invalid++
  }
  console.log(`\n■ ${m.label}  (${n} 例, 平均 ${(boxes / n).toFixed(0)} 件)`)
  console.log(`  全部放入 ${placedAll}/${n}   自由策略 ${free}/${n}   顺序非法 ${invalid}   耗时 平均 ${(t / n).toFixed(0)} ms / 最大 ${tMax.toFixed(0)} ms`)
  console.log('  达标率: ' + Object.entries(pass).map(([k, v]) => `${k} ${v}/${n}`).join('  '))
  console.log(`  最低层利用率均值 ${pct(minUtil / n)}   空间利用率均值 ${pct(vol / n)}   平均垛高 ${(height / n).toFixed(0)} mm   终态偏心均值 ${pct(off / n)}`)
  console.log(`  整托毛重 平均 ${(gross / n).toFixed(0)} kg / 最大 ${grossMax.toFixed(0)} kg   最大承压比 ${pct(loadMax)}`)
  console.log(`  过程峰值偏心  本方案 ${pct(peakOurs / n)}  基线 ${pct(peakBase / n)}   过程平均偏心 本方案 ${pct(meanOurs / n)} 基线 ${pct(meanBase / n)}   封闭孔位/例 ${(holes / n).toFixed(1)}`)
}
