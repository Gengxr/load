/// <reference lib="webworker" />
import { planPallet } from '../algo/planner'
import type { PlanInput } from '../algo/types'

self.onmessage = (e: MessageEvent<{ id: number; input: PlanInput }>) => {
  const { id, input } = e.data
  try {
    const result = planPallet(input, (stage, pct) => self.postMessage({ id, type: 'progress', stage, pct }))
    self.postMessage({ id, type: 'result', result })
  } catch (err) {
    self.postMessage({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
