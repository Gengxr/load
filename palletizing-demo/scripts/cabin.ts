/** 舱内装载评测：npx tsx scripts/cabin.ts [种子数] */
import { CABIN_CONFIGS, planLoading, type PalletUnit } from '../src/algo/cabin'

function rnd(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const seeds = Number(process.argv[2] ?? 10)
const pc = (v: number) => (v * 100).toFixed(2) + '%'
for (const cfg of CABIN_CONFIGS) {
  for (const fill of [1, 0.7]) {
    const n = Math.max(1, Math.round(cfg.slots.length * fill))
    let e = 0, eb = 0, pk: Record<string, number> = {}, pkb: Record<string, number> = {}, t = 0, tmax = 0, okAll = 0, okB = 0, ev = 0
    let method = ''
    for (let s = 0; s < seeds; s++) {
      const r = rnd(100 + s)
      const pallets: PalletUnit[] = Array.from({ length: n }, (_, i) => ({
        id: 'P' + String(i + 1).padStart(2, '0'), rfid: '', weight: 190 + r() * 150,
        cog: { x: (r() - 0.5) * 60, y: (r() - 0.5) * 60, z: 500 }, size: [1219, 1219, 1150], source: 'PREDICTED' as const,
      }))
      const plan = planLoading(cfg, pallets)
      method = plan.solver.method
      ev += plan.solver.evaluated
      t += plan.solver.elapsedMs; tmax = Math.max(tmax, plan.solver.elapsedMs)
      e += Math.max(Math.abs(plan.metrics.errX), Math.abs(plan.metrics.errY))
      eb += Math.max(Math.abs(plan.baseline!.metrics.errX), Math.abs(plan.baseline!.metrics.errY))
      let ok = plan.metrics.pass, okb = plan.baseline!.metrics.pass
      for (const k of Object.keys(plan.tracks)) {
        pk[k] = (pk[k] ?? 0) + plan.tracks[k].peak
        pkb[k] = (pkb[k] ?? 0) + plan.baseline!.tracks[k].peak
        ok &&= plan.tracks[k].ok; okb &&= plan.baseline!.tracks[k].ok
      }
      if (ok) okAll++
      if (okb) okB++
    }
    console.log(`${cfg.id} ${n}/${cfg.slots.length}盘 [${method}] 静态误差 ${pc(e / seeds)} (对照 ${pc(eb / seeds)})  全过程合格 ${okAll}/${seeds} (对照 ${okB}/${seeds})  耗时 ${(t / seeds).toFixed(1)}ms 最大 ${tmax.toFixed(0)}ms  评估 ${(ev / seeds).toFixed(0)}`)
    console.log('     过程峰值/包络: ' + Object.keys(pk).map((k) => `${k} ${(pk[k] / seeds).toFixed(2)} (对照 ${(pkb[k] / seeds).toFixed(2)})`).join('  '))
  }
}
