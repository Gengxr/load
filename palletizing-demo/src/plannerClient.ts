import type { PlanInput, PlanResult } from './algo/types'
import { planPallet } from './algo/planner'
import PlannerWorker from './worker/planner.worker?worker&inline'

let worker: Worker | null = null
let seq = 0

function getWorker(): Worker | null {
  if (worker) return worker
  try {
    worker = new PlannerWorker()
  } catch {
    worker = null
  }
  return worker
}

/** 在 Web Worker 中运行规划，界面不卡顿；Worker 不可用时（例如某些离线打开方式）回退到主线程 */
export function runPlan(input: PlanInput, onProgress: (stage: string, pct: number) => void): Promise<PlanResult> {
  const w = getWorker()
  const plain = JSON.parse(JSON.stringify(input)) as PlanInput
  if (!w) {
    return new Promise((resolve) => setTimeout(() => resolve(planPallet(plain, onProgress)), 30))
  }
  const id = ++seq
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      const d = e.data
      if (d.id !== id) return
      if (d.type === 'progress') onProgress(d.stage, d.pct)
      else {
        w.removeEventListener('message', handler)
        w.removeEventListener('error', onErr)
        if (d.type === 'result') resolve(d.result as PlanResult)
        else reject(new Error(d.message))
      }
    }
    const onErr = () => {
      w.removeEventListener('message', handler)
      worker = null
      resolve(planPallet(plain, onProgress))
    }
    w.addEventListener('message', handler)
    w.addEventListener('error', onErr)
    w.postMessage({ id, input: plain })
  })
}
