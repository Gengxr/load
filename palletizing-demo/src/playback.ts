import { state, totalSteps } from './store'
import type { PalletViewer } from './viz/PalletViewer'

/** 播放控制：可同时驱动多个视图（对比模式下左右两个场景同步码放） */
const viewers = new Set<PalletViewer>()
let token = 0

export function registerViewer(v: PalletViewer) {
  viewers.add(v)
}
export function unregisterViewer(v: PalletViewer) {
  viewers.delete(v)
}

function duration() {
  const n = totalSteps.value
  // 件数多时默认更快，保证一垛在一两分钟内演示完
  const base = n > 250 ? 520 : n > 140 ? 760 : 1050
  return base / state.speed
}

/** 码放下一件（所有视图同步动画）；没有可用视图时返回 false，不推进步数 */
export async function stepForward(): Promise<boolean> {
  if (state.step >= totalSteps.value) return false
  const vs = [...viewers]
  if (!vs.length) return false
  await Promise.all(vs.map((v) => v.animateNext(duration())))
  state.step = Math.min(...vs.map((v) => v.currentStep))
  return true
}

export async function play() {
  if (state.playing) return
  if (state.step >= totalSteps.value) goto(0)
  state.playing = true
  const my = ++token
  while (state.playing && my === token && state.step < totalSteps.value) {
    if (!(await stepForward())) break
  }
  if (my === token) state.playing = false
}

export function pause() {
  state.playing = false
  token++
}

export function toggle() {
  if (state.playing) pause()
  else play()
}

export function goto(k: number) {
  pause()
  const n = totalSteps.value
  state.step = Math.max(0, Math.min(n, Math.round(k)))
  for (const v of viewers) v.gotoStep(state.step)
}

export function stepBack() {
  goto(state.step - 1)
}

export async function next(): Promise<void> {
  if (state.playing) return
  await stepForward()
}
