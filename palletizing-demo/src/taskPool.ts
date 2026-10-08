/**
 * 并行任务池：码盘任务在多个 Web Worker 中同时求解（表 2-3 第 9 项：多任务并行运行）
 * Worker 不可用时（个别离线打开方式）自动回退到主线程顺序执行。
 */
import { reactive } from 'vue'
import type { PlanInput, PlanResult } from './algo/types'
import { planPallet } from './algo/planner'
import PlannerWorker from './worker/planner.worker?worker&inline'

export type TaskKind = 'alloc' | 'pallet' | 'loading'
export interface Task {
  id: number
  kind: TaskKind
  title: string
  status: 'queued' | 'running' | 'done' | 'error'
  pct: number
  t0: number
  ms: number
  note: string
  worker: number
}

export const tasks = reactive<Task[]>([])
let taskSeq = 0

export function addTask(kind: TaskKind, title: string, status: Task['status'] = 'running'): Task {
  const t = reactive<Task>({ id: ++taskSeq, kind, title, status, pct: 0, t0: performance.now(), ms: 0, note: '', worker: -1 })
  tasks.unshift(t)
  if (tasks.length > 60) tasks.length = 60
  return t
}

export function finishTask(t: Task, note = '', ok = true) {
  t.status = ok ? 'done' : 'error'
  t.pct = 1
  t.ms = performance.now() - t.t0
  t.note = note
}

export const poolSize = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1))

interface Job {
  id: number
  input: PlanInput
  task: Task
  resolve: (r: PlanResult) => void
  reject: (e: Error) => void
}

const queue: Job[] = []
const workers: { w: Worker; job: Job | null; idx: number }[] = []
let broken = false
let jobSeq = 0

function spawn(): boolean {
  if (broken || workers.length >= poolSize) return false
  try {
    const slot = { w: new PlannerWorker(), job: null as Job | null, idx: workers.length }
    slot.w.onmessage = (e: MessageEvent) => {
      const d = e.data
      const job = slot.job
      if (!job || d.id !== job.id) return
      if (d.type === 'progress') job.task.pct = d.pct
      else {
        slot.job = null
        if (d.type === 'result') job.resolve(d.result as PlanResult)
        else job.reject(new Error(d.message))
        pump()
      }
    }
    slot.w.onerror = () => {
      // Worker 启动失败：改用主线程
      broken = true
      const job = slot.job
      slot.job = null
      workers.splice(workers.indexOf(slot), 1)
      if (job) queue.unshift(job)
      pump()
    }
    workers.push(slot)
    return true
  } catch {
    broken = true
    return false
  }
}

function pump() {
  while (queue.length) {
    let slot = workers.find((s) => !s.job)
    if (!slot && spawn()) slot = workers[workers.length - 1]
    if (!slot) {
      if (broken && !workers.length) runInline()
      return
    }
    const job = queue.shift()!
    slot.job = job
    job.task.status = 'running'
    job.task.t0 = performance.now()
    job.task.worker = slot.idx
    slot.w.postMessage({ id: job.id, input: job.input })
  }
}

let inlineBusy = false
function runInline() {
  if (inlineBusy) return
  const job = queue.shift()
  if (!job) return
  inlineBusy = true
  job.task.status = 'running'
  job.task.t0 = performance.now()
  job.task.worker = 0
  setTimeout(() => {
    try {
      job.resolve(planPallet(job.input, (_s, pct) => (job.task.pct = pct)))
    } catch (e) {
      job.reject(e instanceof Error ? e : new Error(String(e)))
    }
    inlineBusy = false
    runInline()
  }, 20)
}

/** 提交一个单盘码放任务 */
export function submitPlan(input: PlanInput, title: string): { task: Task; done: Promise<PlanResult> } {
  const task = addTask('pallet', title, 'queued')
  const plain = JSON.parse(JSON.stringify(input)) as PlanInput
  const done = new Promise<PlanResult>((resolve, reject) => {
    queue.push({ id: ++jobSeq, input: plain, task, resolve, reject })
  }).then(
    (r) => {
      const failed = r.metrics.items.filter((m) => m.pass === false).length
      finishTask(task, `${r.layout.placements.length} 件 · ${r.layout.layers.length} 层${failed ? ` · ${failed} 项未达标` : ' · 全部达标'}`)
      return r
    },
    (e) => {
      finishTask(task, e.message, false)
      throw e
    },
  )
  pump()
  return { task, done }
}

/** 同时规划多个货盘，全部完成后返回（顺序与输入一致） */
export function planMany(inputs: PlanInput[], titles: string[], onDone: (index: number, result: PlanResult) => void, onTask?: (index: number, task: Task) => void): Promise<PlanResult[]> {
  return Promise.all(
    inputs.map((inp, i) => {
      const { task, done } = submitPlan(inp, titles[i])
      onTask?.(i, task)
      return done.then((r) => {
        onDone(i, r)
        return r
      })
    }),
  )
}
