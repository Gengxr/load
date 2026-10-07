/**
 * 本方案 vs 对照算法 DBLF 的批量对比：npx tsx scripts/dblf.ts [种子数]
 * 同一批货物、同样的硬约束、同一个评估器。
 */
import { generateCargos, DEFAULT_GEN, type GenMode } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'

const seeds = Number(process.argv[2] ?? 20)
const modes: { mode: GenMode; label: string; extra?: object }[] = [
  { mode: 'standard', label: '标准规格(5)' },
  { mode: 'mixed', label: '混合规格(8+)' },
  { mode: 'single', label: '图2-1 单规格' },
  { mode: 'random', label: '随机尺寸(50档)', extra: { fillRatio: 0.78 } },
]
const pc = (v: number) => (v * 100).toFixed(1) + '%'
for (const m of modes) {
  const acc = { n: 0, boxes: 0, t: 0, tMax: 0 }
  const z = () => ({ placed: 0, all: 0, util: 0, off: 0, hr: 0, peak: 0, mean: 0, exceed: 0, ok6: 0, utilOk: 0, offOk: 0, hrOk: 0, ovOk: 0, supOk: 0, invalid: 0 })
  const A = z(), B = z(), R = z()
  for (let s = 0; s < seeds; s++) {
    const cargos = generateCargos({ ...DEFAULT_GEN, mode: m.mode, seed: 1000 + s, singleIndex: s % 14, ...(m.extra ?? {}) })
    const res = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: DEFAULT_CONSTRAINTS, sequence: DEFAULT_SEQUENCE })
    acc.n++; acc.boxes += cargos.length; acc.t += res.dblf.elapsedMs; acc.tMax = Math.max(acc.tMax, res.dblf.elapsedMs)
    const add = (X: ReturnType<typeof z>, layout: typeof res.layout, mt: typeof res.metrics, sq: typeof res.sequences.balance) => {
      X.placed += layout.placements.length / cargos.length
      if (!layout.remaining.length) X.all++
      X.util += mt.minLayerUtilization
      X.off += Math.max(Math.abs(mt.cogOffsetRatio[0]), Math.abs(mt.cogOffsetRatio[1]))
      X.hr += mt.cogHeightRatio
      X.peak += sq.summary.peakRatio; X.mean += sq.summary.meanRatio; X.exceed += sq.summary.exceedSteps
      const it = Object.fromEntries(mt.items.map((i) => [i.key, i.pass]))
      if (it.utilization) X.utilOk++
      if (it.cogOffset) X.offOk++
      if (it.cogHeight) X.hrOk++
      if (it.overhang) X.ovOk++
      if (it.support) X.supOk++
      if (mt.items.filter((i) => i.source.startsWith('表')).every((i) => i.pass) && !layout.remaining.length) X.ok6++
      if (!sq.summary.valid) X.invalid++
    }
    add(A, res.layout, res.metrics, res.sequences.balance)
    add(R, res.layout, res.metrics, res.sequences.baseline)
    add(B, res.dblf.layout, res.dblf.metrics, res.dblf.sequence)
  }
  const n = acc.n
  console.log(`\n■ ${m.label}  (${n} 例, 平均 ${(acc.boxes / n).toFixed(0)} 件)   DBLF 用时 平均 ${(acc.t / n).toFixed(0)} ms / 最大 ${acc.tMax.toFixed(0)} ms`)
  const row = (name: string, X: ReturnType<typeof z>) =>
    console.log(`  ${name.padEnd(14)} 全部放入 ${X.all}/${n} (放入率 ${pc(X.placed / n)})  表2-2全达标 ${X.ok6}/${n}  利用率达标 ${X.utilOk}/${n} (最低层均值 ${pc(X.util / n)})  终态偏心 ${pc(X.off / n)} 达标 ${X.offOk}/${n}  重心高 ${pc(X.hr / n)} 达标 ${X.hrOk}/${n}  外扩达标 ${X.ovOk}/${n}  支撑达标 ${X.supOk}/${n}  过程峰值 ${pc(X.peak / n)} 平均 ${pc(X.mean / n)} 超限步 ${(X.exceed / n).toFixed(1)}  顺序非法 ${X.invalid}`)
  row('本方案', A)
  row('逐层行扫描(同垛形)', R)
  row('DBLF', B)
}
