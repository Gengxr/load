/** 检查各出库单预设（默认种子）的端到端结果：npx tsx scripts/presets.ts [key] [seed...] */
import { generateCargos, DEFAULT_GEN } from '../src/algo/generator'
import { DEFAULT_CONSTRAINTS, DEFAULT_PALLET, DEFAULT_SEQUENCE, ENVELOPES } from '../src/algo/defaults'
import { planPallet } from '../src/algo/planner'
import { planOrder, toPalletUnit, type PlanMany } from '../src/algo/pipeline'
import { CABIN_CONFIGS, planLoading } from '../src/algo/cabin'

const PRESETS: Record<string, { gen: object; alloc: object; seed: number; cons?: object }> = {
  standard: { gen: { mode: 'standard', skuCount: 8, pallets: 6, fillRatio: 0.86 }, alloc: {}, seed: 20261006 },
  mixed: { gen: { mode: 'mixed', skuCount: 12, pallets: 5, fillRatio: 0.85 }, alloc: {}, seed: 20261003 },
  bulk: { gen: { mode: 'standard', skuCount: 10, pallets: 8, fillRatio: 0.86 }, alloc: {}, seed: 20261008 },
  fig21: { gen: { mode: 'single', singleIndex: 3, singleHeight: 200, pallets: 1, fx: 1000, fy: 1000, targetHeight: 1100 }, alloc: { fixedPallets: 1 }, seed: 20261052, cons: ENVELOPES.spec },
  random: { gen: { mode: 'random', fillRatio: 0.76, heightStep: 50, pallets: 1 }, alloc: { fixedPallets: 1 }, seed: 20261052 },
}
const planMany: PlanMany = async (inputs, onDone) => inputs.map((inp, i) => { const r = planPallet(inp); onDone(i, r); return r })
const only = process.argv[2]
const seeds = process.argv.slice(3).map(Number)
const main = async () => {
  for (const [key, p] of Object.entries(PRESETS)) {
    if (only && only !== 'all' && only !== key) continue
    for (const seed of seeds.length ? seeds : [p.seed]) {
      const cargos = generateCargos({ ...DEFAULT_GEN, ...(p.gen as object), seed } as never)
      const cons = { ...DEFAULT_CONSTRAINTS, ...(p.cons ?? {}) }
      // 与界面一致：单盘货重不超过货位限重 700 kg（扣除货盘自重）
      const res = await planOrder(cargos, DEFAULT_PALLET, cons, DEFAULT_SEQUENCE, { maxPalletWeight: 700 - DEFAULT_PALLET.tareWeight, ...p.alloc }, planMany)
      const ok = res.pallets.filter((x) => x.result.metrics.items.every((i) => i.pass !== false) && !x.result.layout.remaining.length).length
      const units = res.pallets.map((x) => toPalletUnit(x, DEFAULT_PALLET, cons))
      const cfg = [...CABIN_CONFIGS].sort((a, b) => a.slots.length - b.slots.length).find((c) => c.slots.length >= units.length) ?? CABIN_CONFIGS[0]
      const lp = planLoading(cfg, units)
      const lok = lp.metrics.pass && Object.values(lp.tracks).every((t) => t.ok)
      const hs = res.pallets.map((x) => x.result.metrics.stackSize[2])
      const ws = res.pallets.map((x) => Math.round(x.result.metrics.grossWeight))
      const kinds = ['carton', 'wood', 'case'].map((k) => cargos.filter((c) => (c.kind ?? 'carton') === k).length).join('/')
      const peak = Math.max(...res.pallets.map((x) => x.result.sequences.balance.summary.peakRatio))
      const br = Math.max(...res.pallets.map((x) => x.result.metrics.maxLoadRatio))
      const fails = res.pallets.flatMap((x) => x.result.metrics.items.filter((i) => i.pass === false).map((i) => `${x.id}:${i.key}`))
      console.log(`${key.padEnd(9)} seed ${seed}: ${cargos.length} 件 → ${res.pallets.length} 盘, 达标 ${ok}/${res.pallets.length}, 未放 ${res.unplaced.length}, 回流 ${res.rerouted}, 垛高 ${Math.min(...hs)}–${Math.max(...hs)}, 毛重 ${Math.min(...ws)}–${Math.max(...ws)} kg, 纸/木/特 ${kinds}, 承压 ${(br * 100).toFixed(0)}%, 过程峰值 ${(peak * 100).toFixed(1)}%, ${(res.elapsedMs / 1000).toFixed(1)}s | ${cfg.id} 误差 ${(lp.metrics.errX * 100).toFixed(2)}%/${(lp.metrics.errY * 100).toFixed(2)}% 对照 ${(lp.baseline!.metrics.errX * 100).toFixed(2)}% 过程${lok ? '✓' : '✗'} ${fails.join(' ')}`)
    }
  }
}
main()
