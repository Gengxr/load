/**
 * 本方案 / 对照基线（逐层行扫描）/ 对照算法 DBLF 的批量对比：npx tsx scripts/dblf.ts [种子数]
 * 同一批货物、同样的货盘空间与支撑约束、同一个评估器。DBLF 不考虑货物承压，承压情况由评估器如实核算。
 */
import { generateCargos, DEFAULT_GEN, type GenMode } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE, ENVELOPES } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'
import { isRequired } from '../src/algo/evaluate'

const seeds = Number(process.argv[2] ?? 20)
// 单盘评测的货量取可用空间的 75% 左右，留出凑层的余量（联动流程里货量由多盘分配决定）
const modes: { mode: GenMode; label: string; extra?: object; cons?: object }[] = [
  { mode: 'standard', label: '应急救援物资(6 规格)', extra: { targetHeight: 1250 } },
  { mode: 'mixed', label: '综合保障物资(8+ 规格)', extra: { targetHeight: 1250 } },
  { mode: 'random', label: '随机尺寸(50 档)', extra: { fillRatio: 0.78, targetHeight: 1250 } },
  { mode: 'single', label: '图 2-1 单规格(1000×1000 口径)', extra: { fx: 1000, fy: 1000, targetHeight: 1100 }, cons: ENVELOPES.spec },
]
const pc = (v: number) => (v * 100).toFixed(1) + '%'
for (const m of modes) {
  const z = () => ({ placed: 0, all: 0, util: 0, vol: 0, off: 0, peak: 0, exceed: 0, ok: 0, over: 0, overCases: 0 })
  const A = z(), R = z(), B = z()
  let n = 0, boxes = 0, t = 0, tb = 0
  for (let s = 0; s < seeds; s++) {
    const cargos = generateCargos({ ...DEFAULT_GEN, mode: m.mode, seed: 1000 + s, singleIndex: s % 14, ...(m.extra ?? {}) })
    const res = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: { ...DEFAULT_CONSTRAINTS, ...(m.cons ?? {}) }, sequence: DEFAULT_SEQUENCE })
    n++; boxes += cargos.length; t += res.timings.totalMs; tb += res.dblf.elapsedMs
    const add = (X: ReturnType<typeof z>, layout: typeof res.layout, mt: typeof res.metrics, sq: typeof res.sequences.balance) => {
      X.placed += layout.placements.length / cargos.length
      if (!layout.remaining.length) X.all++
      X.util += mt.minLayerUtilization
      X.vol += mt.volumeUtilization
      X.off += Math.max(Math.abs(mt.cogOffsetRatio[0]), Math.abs(mt.cogOffsetRatio[1]))
      X.peak += sq.summary.peakRatio
      X.exceed += sq.summary.exceedSteps
      X.over += mt.overloaded
      if (mt.overloaded) X.overCases++
      if (mt.items.filter(isRequired).every((i) => i.pass) && !layout.remaining.length) X.ok++
    }
    add(A, res.layout, res.metrics, res.sequences.balance)
    add(R, res.layout, res.metrics, res.sequences.baseline)
    add(B, res.dblf.layout, res.dblf.metrics, res.dblf.sequence)
  }
  console.log(`\n■ ${m.label}  (${n} 例, 平均 ${(boxes / n).toFixed(0)} 件)   用时 本方案 ${(t / n).toFixed(0)} ms / DBLF ${(tb / n).toFixed(0)} ms`)
  const row = (name: string, X: ReturnType<typeof z>) =>
    console.log(`  ${name.padEnd(12)} 全部放入 ${X.all}/${n} (放入率 ${pc(X.placed / n)})  必达指标全达标 ${X.ok}/${n}  最低层利用率 ${pc(X.util / n)}  空间利用率 ${pc(X.vol / n)}  终态偏心 ${pc(X.off / n)}  承压超限 ${X.overCases}/${n} 例(平均 ${(X.over / n).toFixed(1)} 件)  过程峰值 ${pc(X.peak / n)}  超限步 ${(X.exceed / n).toFixed(1)}`)
  row('本方案', A)
  row('逐层行扫描', R)
  row('DBLF', B)
}
