import { CABIN_CONFIGS, planLoading, type PalletUnit } from '../src/algo/cabin'
function rnd(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
const pc = (v: number) => (v * 100).toFixed(1)
for (const cfg of CABIN_CONFIGS) for (const fill of [1, 0.7]) {
  const n = Math.round(cfg.slots.length * fill)
  const agg: Record<string, number[]> = {}
  for (let s = 0; s < 20; s++) {
    const r = rnd(100 + s)
    const pallets: PalletUnit[] = Array.from({ length: n }, (_, i) => ({ id: 'P' + String(i + 1).padStart(2, '0'), rfid: '', weight: 190 + r() * 150, cog: { x: (r() - 0.5) * 60, y: (r() - 0.5) * 60, z: 500 }, size: [1219, 1219, 1150], source: 'PREDICTED' as const }))
    const plan = planLoading(cfg, pallets, { processAware: false })
    for (const [who, tr] of [['opt', plan.tracks], ['base', plan.baseline!.tracks]] as const) for (const k of Object.keys(tr)) {
      const a = (agg[who + ':' + k] ??= [0, 0, 0])
      for (const p of tr[k].points) { a[0] = Math.min(a[0], p.devX); a[1] = Math.max(a[1], p.devX); a[2] = Math.max(a[2], Math.abs(p.devY)) }
    }
  }
  console.log(`${cfg.id} ${n}盘 (静态最优, 不考虑过程)`)
  for (const k of Object.keys(agg)) console.log(`   ${k.padEnd(16)} devX [${pc(agg[k][0])}, ${pc(agg[k][1])}]  |devY| ${pc(agg[k][2])}`)
}
