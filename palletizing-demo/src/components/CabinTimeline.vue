<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { cabin, loading, setCabinMode, state, track } from '../store'
import { signedPct } from '../format'
import Icon from './Icon.vue'

/** 舱内装载 · 底部时间轴：作业场景切换 + 逐步回放 + 整机重心偏差曲线（含包络带） */
const bar = ref<HTMLDivElement | null>(null)
const root = ref<HTMLDivElement | null>(null)
const W = ref(500)
const RW = ref(1100)
let ro: ResizeObserver | null = null
let raf = 0
let last = 0

const n = computed(() => track.value?.ops.length ?? 0)
const modes = computed(() => {
  const lp = loading.value
  if (!lp) return []
  const icon: Record<string, string> = { load: 'truck', unload: 'undo', tail: 'drop', side: 'door', belly: 'drop' }
  return [
    { id: 'load', name: '装载', icon: icon.load, ok: lp.tracks.load.ok },
    ...cabin.value.drops.map((d) => ({ id: d.id, name: d.name.replace(/（.*/, ''), icon: icon[d.kind], ok: lp.tracks[d.id]?.ok ?? true })),
    { id: 'unload', name: '卸载', icon: icon.unload, ok: lp.tracks.unload.ok },
  ]
})

function tick(now: number) {
  raf = requestAnimationFrame(tick)
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  if (!state.cabinPlaying) return
  const t = state.cabinT + (dt * state.speed) / 1.7
  if (t >= n.value) {
    state.cabinT = n.value
    state.cabinPlaying = false
  } else state.cabinT = t
}
function toggle() {
  if (!n.value) return
  if (!state.cabinPlaying && state.cabinT >= n.value - 1e-6) state.cabinT = 0
  state.cabinPlaying = !state.cabinPlaying
}
function goto(t: number) {
  state.cabinPlaying = false
  state.cabinT = Math.max(0, Math.min(n.value, t))
}
const stepTo = (d: number) => goto(d > 0 ? Math.floor(state.cabinT + 1e-6) + 1 : Math.ceil(state.cabinT - 1e-6) - 1)

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (state.explainOpen || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
  if (e.code === 'Space') {
    e.preventDefault()
    toggle()
  } else if (e.code === 'ArrowRight') stepTo(1)
  else if (e.code === 'ArrowLeft') stepTo(-1)
  else if (e.code === 'Home') goto(0)
  else if (e.code === 'End') goto(n.value)
}
onMounted(() => {
  ro = new ResizeObserver(() => {
    W.value = bar.value?.clientWidth || 500
    RW.value = root.value?.clientWidth || 1100
  })
  if (bar.value) ro.observe(bar.value)
  if (root.value) ro.observe(root.value)
  window.addEventListener('keydown', onKey)
  last = performance.now()
  raf = requestAnimationFrame(tick)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  cancelAnimationFrame(raf)
  window.removeEventListener('keydown', onKey)
})

const H = 40
const chart = computed(() => {
  const tr = track.value
  if (!tr || !n.value) return null
  const lo = Math.min(tr.env[0], ...tr.points.map((p) => p.devX)) * 1.18
  const hi = Math.max(tr.env[1], ...tr.points.map((p) => p.devX)) * 1.18
  const x = (t: number) => (t / n.value) * W.value
  const y = (v: number) => 3 + ((hi - v) / (hi - lo)) * (H - 6)
  let d = ''
  for (const p of tr.points) d += (d ? 'L' : 'M') + x(p.t).toFixed(1) + ',' + y(p.devX).toFixed(1)
  return {
    d,
    y0: y(0),
    envTop: y(tr.env[1]),
    envBot: y(tr.env[0]),
    marks: tr.ops.map((_, i) => x(i + 1)).slice(0, -1),
    bad: tr.points.filter((p) => !p.ok).map((p) => ({ x: x(p.t), y: y(p.devX) })),
    aft: signedPct(tr.env[1]),
    fwd: signedPct(tr.env[0]),
  }
})
const stepNo = computed(() => Math.min(n.value, Math.floor(state.cabinT + 1e-6) + (state.cabinT >= n.value ? 0 : 1)))

let dragging = false
function seek(e: PointerEvent) {
  const r = bar.value!.getBoundingClientRect()
  goto(((e.clientX - r.left) / r.width) * n.value)
}
function down(e: PointerEvent) {
  dragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  seek(e)
}
const speeds = [0.5, 1, 2, 4]
</script>

<template>
  <div ref="root" class="tl glass" :class="{ narrow: RW < 1060, tiny: RW < 860 }">
    <div class="modes">
      <button v-for="m in modes" :key="m.id" :class="{ on: state.cabinMode === m.id, bad: !m.ok }" :title="m.name" @click="setCabinMode(m.id)">
        <Icon :name="m.icon" :size="14" /><span>{{ m.name }}</span>
      </button>
    </div>

    <div class="ctrls">
      <button class="cb edge" data-tip="回到开始 Home" @click="goto(0)"><Icon name="first" :size="17" /></button>
      <button class="cb" data-tip="上一步 ←" @click="stepTo(-1)"><Icon name="prev" :size="17" /></button>
      <button class="play" :disabled="!n" :data-tip="state.cabinPlaying ? '暂停 空格' : '播放 空格'" @click="toggle">
        <Icon :name="state.cabinPlaying ? 'pause' : 'play'" :size="20" :stroke="2.2" />
      </button>
      <button class="cb" data-tip="下一步 →" @click="stepTo(1)"><Icon name="next" :size="17" /></button>
      <button class="cb edge" data-tip="直接看结果 End" @click="goto(n)"><Icon name="last" :size="17" /></button>
    </div>

    <div class="count num"><b>{{ stepNo }}</b><span>/ {{ n }} 盘</span></div>

    <div ref="bar" class="bar" @pointerdown="down" @pointermove="(e) => dragging && seek(e)" @pointerup="dragging = false">
      <svg v-if="chart" :width="W" :height="H">
        <rect x="0" :y="chart.envTop" :width="W" :height="Math.max(1, chart.envBot - chart.envTop)" class="env" />
        <line x1="0" :x2="W" :y1="chart.envTop" :y2="chart.envTop" class="lim" />
        <line x1="0" :x2="W" :y1="chart.envBot" :y2="chart.envBot" class="lim" />
        <line x1="0" :x2="W" :y1="chart.y0" :y2="chart.y0" class="zero" />
        <rect :width="(state.cabinT / Math.max(1, n)) * W" :height="H" class="prog" />
        <line v-for="(m, i) in chart.marks" :key="i" :x1="m" :x2="m" y1="0" :y2="H" class="mark" />
        <path :d="chart.d" class="sp" />
        <circle v-for="(b, i) in chart.bad" :key="i" :cx="b.x" :cy="b.y" r="2.6" class="badpt" />
      </svg>
      <span v-if="chart" class="cap top num">后限 {{ chart.aft }}</span>
      <span v-if="chart" class="cap bot num">前限 {{ chart.fwd }}</span>
      <div class="head" :style="{ left: (state.cabinT / Math.max(1, n)) * 100 + '%' }" />
    </div>

    <div class="speed seg">
      <button v-for="s in speeds" :key="s" :class="{ on: state.speed === s }" @click="state.speed = s">{{ s }}×</button>
    </div>
  </div>
</template>

<style scoped>
.tl {
  height: 68px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 14px 0 10px;
  border-radius: 20px;
}
.modes {
  display: flex;
  padding: 3px;
  gap: 2px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
  flex: none;
}
.modes button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 11px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 550;
  white-space: nowrap;
}
.modes button:hover {
  color: var(--text);
}
.modes button.bad {
  color: var(--warn);
}
.modes button.on {
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
  box-shadow: 0 4px 14px rgba(46, 200, 245, 0.28);
}
.ctrls {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: none;
}
.cb {
  width: 32px;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-2);
  display: grid;
  place-items: center;
  padding: 0;
}
.cb:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--text);
}
.play {
  width: 46px;
  height: 46px;
  margin: 0 4px;
  border-radius: 50%;
  border: none;
  display: grid;
  place-items: center;
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff 0%, #2ec8f5 45%, #5b8cff 100%);
  box-shadow:
    0 8px 22px rgba(46, 200, 245, 0.35),
    0 1px 0 rgba(255, 255, 255, 0.4) inset;
  transition:
    transform 0.12s,
    filter 0.15s;
}
.play:hover:not(:disabled) {
  filter: brightness(1.08);
  transform: scale(1.04);
}
.count {
  display: flex;
  align-items: baseline;
  gap: 5px;
  flex: none;
}
.count b {
  font-size: 22px;
  font-weight: 700;
}
.count span {
  font-size: 12px;
  color: var(--text-3);
}
.bar {
  position: relative;
  flex: 1;
  min-width: 100px;
  height: 40px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  touch-action: none;
}
.bar svg {
  display: block;
  position: absolute;
  inset: 0;
  border-radius: 10px;
}
.env {
  fill: rgba(46, 224, 240, 0.08);
}
.lim {
  stroke: rgba(46, 224, 240, 0.5);
  stroke-dasharray: 3 4;
}
.zero {
  stroke: rgba(255, 255, 255, 0.16);
}
.prog {
  fill: rgba(91, 140, 255, 0.12);
}
.mark {
  stroke: rgba(255, 255, 255, 0.08);
}
.sp {
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.8;
  stroke-linejoin: round;
}
.badpt {
  fill: var(--bad);
}
.cap {
  position: absolute;
  right: 6px;
  font-size: 9.5px;
  color: rgba(46, 224, 240, 0.75);
  pointer-events: none;
  line-height: 1;
}
.cap.top {
  top: 2px;
}
.cap.bot {
  bottom: 2px;
}
.head {
  position: absolute;
  top: -5px;
  bottom: -5px;
  width: 3px;
  margin-left: -1.5px;
  border-radius: 2px;
  background: #f2fdff;
  box-shadow: 0 0 12px rgba(46, 224, 240, 0.9);
  pointer-events: none;
}
.speed {
  flex: none;
}
.speed button {
  padding: 0 8px;
}
.narrow .speed,
.narrow .cb.edge {
  display: none;
}
.narrow {
  gap: 10px;
}
.tiny .count span,
.tiny .modes button span {
  display: none;
}
</style>
