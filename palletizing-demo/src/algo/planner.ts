import type { PlanInput, PlanResult, ProgressFn } from './types'
import { buildLayout } from './layout'
import { buildPrecedence } from './precedence'
import { planSequence } from './sequence'
import { evaluateLayout } from './evaluate'

/** 单盘规划主流程：空间布局 → 先后约束图 → 码放顺序（本方案 + 基线）→ 指标评估 */
export function planPallet(input: PlanInput, onProgress: ProgressFn = () => {}): PlanResult {
  const t0 = performance.now()
  onProgress('layout', 0.05)
  const layout = buildLayout(input.cargos, input.pallet, input.constraints)
  const t1 = performance.now()
  onProgress('precedence', 0.55)
  const prec = buildPrecedence(layout.placements, input.constraints.heightTolerance)
  onProgress('sequence', 0.65)
  const balance = planSequence('balance', layout.placements, prec, input.pallet, input.constraints, input.sequence)
  const baseline = planSequence('layer-row', layout.placements, prec, input.pallet, input.constraints, input.sequence)
  const t2 = performance.now()
  onProgress('evaluate', 0.95)
  const metrics = evaluateLayout(layout, input.pallet, input.constraints, t2 - t0)
  onProgress('done', 1)
  return {
    layout,
    supporters: prec.supporters,
    sequences: { balance, baseline },
    metrics,
    timings: { layoutMs: t1 - t0, sequenceMs: t2 - t1, totalMs: performance.now() - t0 },
  }
}
