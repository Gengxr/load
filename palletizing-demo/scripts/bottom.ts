/** 评测"大件/重件置底"效果：npx tsx scripts/bottom.ts [种子数] */
import { generateCargos, DEFAULT_GEN, type GenMode } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'

const seeds = Number(process.argv[2] ?? 20)
function corr(a: number[], b: number[]) {
  const n = a.length
  const ma = a.reduce((s, x) => s + x, 0) / n
  const mb = b.reduce((s, x) => s + x, 0) / n
  let sab = 0, saa = 0, sbb = 0
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2 }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0
}
for (const mode of ['standard', 'mixed', 'random'] as GenMode[]) {
  let cw = 0, cv = 0, low = 0, hr = 0, ok = 0, util = 0, t = 0, placed = 0
  for (let s = 0; s < seeds; s++) {
    const cargos = generateCargos({ ...DEFAULT_GEN, mode, seed: 1000 + s, ...(mode === 'random' ? { fillRatio: 0.78 } : {}) })
    const res = planPallet({ cargos, pallet: DEFAULT_PALLET, constraints: DEFAULT_CONSTRAINTS, sequence: DEFAULT_SEQUENCE })
    const pl = res.layout.placements
    const zc = pl.map((p) => p.z + p.dz / 2)
    cw += corr(zc, pl.map((p) => p.weight))
    cv += corr(zc, pl.map((p) => p.dx * p.dy * p.dz))
    const top = Math.max(...pl.map((p) => p.z + p.dz))
    const m = pl.reduce((a, p) => a + p.weight, 0)
    low += pl.filter((p) => p.z + p.dz / 2 < top / 2).reduce((a, p) => a + p.weight, 0) / m
    hr += res.metrics.cogHeightRatio
    util += res.metrics.minLayerUtilization
    t += res.timings.totalMs
    if (!res.layout.remaining.length) placed++
    if (res.metrics.items.filter((i) => i.pass === false).length === 0) ok++
  }
  const f = (v: number) => (v / seeds).toFixed(3)
  console.log(`${mode.padEnd(9)} 高度-重量相关 ${f(cw)}  高度-体积相关 ${f(cv)}  下半垛质量占比 ${f(low)}  重心高度比 ${f(hr)}  最低层利用率 ${f(util)}  全达标 ${ok}/${seeds} 全放入 ${placed}/${seeds}  ${(t / seeds).toFixed(0)}ms`)
}
