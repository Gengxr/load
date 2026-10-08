/** 多盘分配评测：npx tsx scripts/alloc.ts [种子数] [盘数] */
import { generateCargos, DEFAULT_GEN, type GenMode } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'
import { planOrder, type PlanMany } from '../src/algo/pipeline'

const seeds = Number(process.argv[2] ?? 5)
const K = Number(process.argv[3] ?? 6)
const verbose = process.argv[4] === 'v'
const planMany: PlanMany = async (inputs, onDone) => inputs.map((inp, i) => { const r = planPallet(inp); onDone(i, r); return r })
const main = async () => {
  for (const [mode, skuCount] of [['standard', 6], ['standard', 10], ['mixed', 12]] as [GenMode, number][]) {
    let pal = 0, lb = 0, okP = 0, allP = 0, unpl = 0, t = 0, rer = 0, hs = 0, ws = 0, boxes = 0, minU = 0
    for (let s = 0; s < seeds; s++) {
      const cargos = generateCargos({ ...DEFAULT_GEN, mode, skuCount, seed: 2000 + s, pallets: K, fillRatio: 0.86 })
      const t0 = performance.now()
      const res = await planOrder(cargos, DEFAULT_PALLET, DEFAULT_CONSTRAINTS, DEFAULT_SEQUENCE, {}, planMany)
      t += performance.now() - t0
      boxes += cargos.length
      pal += res.pallets.length
      lb += res.allocation.stats.lowerBound
      unpl += res.unplaced.length
      rer += res.rerouted
      const hsv = res.pallets.map((p) => p.result.metrics.stackSize[2])
      const wsv = res.pallets.map((p) => p.result.metrics.cargoWeight)
      hs += Math.max(...hsv) - Math.min(...hsv)
      ws += Math.max(...wsv) - Math.min(...wsv)
      for (const p of res.pallets) {
        allP++
        minU += p.result.metrics.minLayerUtilization
        if (p.result.metrics.items.every((i) => i.pass !== false)) okP++
        else if (verbose) console.log('   ✗', s, p.id, p.cargos.length, p.result.metrics.items.filter((i) => i.pass === false).map((i) => i.key + ':' + i.display).join(' | '))
      }
      if (verbose) console.log(`  seed ${s}: ${cargos.length}件 → ${res.pallets.length}盘 H[${hsv.join(',')}] W[${wsv.map((w) => w.toFixed(0)).join(',')}] 回流${res.rerouted} 未放${res.unplaced.length} st=${JSON.stringify(res.allocation.stats.heightSpread)} full=${res.allocation.stats.fullLayers} mixed=${res.allocation.stats.mixedLayers} loose=${res.allocation.stats.looseCount} moves=${res.allocation.stats.moves}`)
    }
    console.log(`${mode}/${skuCount}规格  平均 ${(boxes / seeds).toFixed(0)} 件 → ${(pal / seeds).toFixed(1)} 盘 (体积下界 ${(lb / seeds).toFixed(1)})  单盘全达标 ${okP}/${allP}  最低层利用率 ${(minU / allP * 100).toFixed(1)}%  未放入 ${unpl}  回流 ${rer}  高度极差 ${(hs / seeds).toFixed(0)}mm  重量极差 ${(ws / seeds).toFixed(0)}kg  总耗时 ${(t / seeds / 1000).toFixed(1)}s`)
  }
}
main()
