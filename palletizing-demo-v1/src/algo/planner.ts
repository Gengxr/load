import type { PlanInput, PlanResult, ProgressFn } from './types'
import { buildLayout } from './layout'
import { buildPrecedence } from './precedence'
import { evalOrder, planSequence } from './sequence'
import { evaluateLayout } from './evaluate'
import { dblfLayout } from './dblf'
import type { BaselinePlan, PlanInput as In } from './types'

/** 对照算法 DBLF：在同一批货物、同样的硬约束下独立生成位置与顺序，并用同一个评估器核算 */
export function planDblf(input: In): BaselinePlan {
  const t0 = performance.now()
  const { layout, supporters } = dblfLayout(input.cargos, input.constraints)
  const prec = buildPrecedence(layout.placements, input.constraints.heightTolerance)
  const sequence = evalOrder('dblf', layout.placements.map((_, i) => i), layout.placements, prec, input.pallet, input.constraints)
  const elapsedMs = performance.now() - t0
  return { layout, supporters, sequence, metrics: evaluateLayout(layout, input.pallet, input.constraints, elapsedMs), elapsedMs }
}

/** 单盘规划主流程：空间布局 → 先后约束图 → 码放顺序（本方案 + 对照基线）→ 指标评估 → 对照算法 */
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
  const dblf = planDblf(input)
  onProgress('done', 1)
  return {
    layout,
    supporters: prec.supporters,
    sequences: { balance, baseline },
    metrics,
    dblf,
    timings: { layoutMs: t1 - t0, sequenceMs: t2 - t1, totalMs: performance.now() - t0 },
  }
}
