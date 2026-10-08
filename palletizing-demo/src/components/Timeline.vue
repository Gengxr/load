<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { currentSeq, result, state, totalSteps } from '../store'
import { goto, next, stepBack, toggle } from '../playback'
import Icon from './Icon.vue'

const props = withDefaults(defineProps<{ showStrategy?: boolean; series?: 'current' | 'both'; /** 第二条曲线（对照）；缺省取另一种顺序 */ baseRatio?: number[] }>(), { showStrategy: true, series: 'current' })

const bar = ref<HTMLDivElement | null>(null)
const root = ref<HTMLDivElement | null>(null)
const W = ref(600)
const RW = ref(1200)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(() => {
    W.value = bar.value?.clientWidth || 600
    RW.value = root.value?.clientWidth || 1200
  })
  if (bar.value) ro.observe(bar.value)
  if (root.value) ro.observe(root.value)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('keydown', onKey)
})

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (state.mode === 'station' || state.mode === 'robot' || state.explainOpen || tag === 'INPUT' || tag === 'SELECT') return
  if (e.code === 'Space') {
    e.preventDefault()
    toggle()
  } else if (e.code === 'ArrowRight') next()
  else if (e.code === 'ArrowLeft') stepBack()
  else if (e.code === 'Home') goto(0)
  else if (e.code === 'End') goto(totalSteps.value)
}

const H = 34
const n = computed(() => Math.max(1, totalSteps.value))
const spark = computed(() => {
  const s = currentSeq.value
  if (!s) return { d: '', base: '', area: '', tolY: -10 }
  const r = result.value!
  const other = s.strategy === 'balance' ? r.sequences.baseline : r.sequences.balance
  const otherRatio = props.baseRatio ?? other.steps.ratio
  const ymax = Math.max(0.12, ...s.steps.ratio, ...(props.series === 'both' ? otherRatio : []))
  const y = (v: number) => H - 3 - (v / ymax) * (H - 8)
  const mk = (arr: number[]) => {
    let d = ''
    const step = Math.max(1, Math.floor(arr.length / 500))
    for (let i = 0; i < arr.length; i += step) d += (d ? 'L' : 'M') + ((i / n.value) * W.value).toFixed(1) + ',' + y(arr[i]).toFixed(1)
    return d
  }
  const d = mk(s.steps.ratio)
  return { d, area: d + `L${W.value},${H}L0,${H}Z`, base: props.series === 'both' ? mk(otherRatio) : '', tolY: y(state.cons.cogOffsetRatioMax) }
})
const layerMarks = computed(() => {
  const s = currentSeq.value
  const r = result.value
  if (!s || !r) return []
  const last = new Map<number, number>()
  s.order.forEach((pi, k) => last.set(r.layout.placements[pi].layer, k + 1))
  return [...last.entries()].sort((a, b) => a[0] - b[0]).map(([l, k]) => ({ l, k }))
})
const isOurs = computed(() => currentSeq.value?.strategy !== 'layer-row')

let dragging = false
function seekAt(e: PointerEvent) {
  const r = bar.value!.getBoundingClientRect()
  goto(((e.clientX - r.left) / r.width) * n.value)
}
function down(e: PointerEvent) {
  dragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  seekAt(e)
}
function move(e: PointerEvent) {
  if (dragging) seekAt(e)
}
function up() {
  dragging = false
}

const speeds = [0.5, 1, 2, 4, 8]
</script>

<template>
  <div ref="root" class="tl glass" :class="{ narrow: RW < 960, tiny: RW < 780 }">
    <div class="ctrls">
      <button class="cb edge" data-tip="回到开始 Home" @click="goto(0)"><Icon name="first" :size="17" /></button>
      <button class="cb" data-tip="上一件 ←" @click="stepBack"><Icon name="prev" :size="17" /></button>
      <button class="play" :disabled="!totalSteps" :data-tip="state.playing ? '暂停 空格' : '播放 空格'" @click="toggle">
        <Icon :name="state.playing ? 'pause' : 'play'" :size="20" :stroke="2.2" />
      </button>
      <button class="cb" :disabled="state.playing" data-tip="下一件 →" @click="next"><Icon name="next" :size="17" /></button>
      <button class="cb edge" data-tip="直接看结果 End" @click="goto(totalSteps)"><Icon name="last" :size="17" /></button>
    </div>

    <div class="count num">
      <b>{{ state.step }}</b><span>/ {{ totalSteps }} 件</span>
    </div>

    <div ref="bar" class="bar" :class="{ base: !isOurs }" @pointerdown="down" @pointermove="move" @pointerup="up">
      <svg :width="W" :height="H">
        <defs>
          <linearGradient id="tl-prog" x1="0" x2="1">
            <stop offset="0" stop-color="rgba(46,224,240,0.22)" />
            <stop offset="1" stop-color="rgba(91,140,255,0.22)" />
          </linearGradient>
          <linearGradient id="tl-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" :stop-color="isOurs ? 'rgba(46,224,240,0.35)' : 'rgba(255,113,137,0.35)'" />
            <stop offset="1" stop-color="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>
        <rect :width="(state.step / n) * W" :height="H" fill="url(#tl-prog)" />
        <line x1="0" :x2="W" :y1="spark.tolY" :y2="spark.tolY" class="tol" />
        <line v-for="m in layerMarks" :key="m.l" :x1="(m.k / n) * W" :x2="(m.k / n) * W" y1="0" :y2="H" class="mark" />
        <path v-if="spark.base" :d="spark.base" class="sp other" />
        <path :d="spark.area" fill="url(#tl-area)" />
        <path :d="spark.d" class="sp" :class="isOurs ? 'ours' : 'basel'" />
      </svg>
      <div class="head" :style="{ left: (state.step / n) * 100 + '%' }" />
    </div>

    <div v-if="showStrategy" class="strat">
      <button :class="{ on: state.strategy === 'balance' }" @click="state.strategy = 'balance'"><i class="o" />本方案</button>
      <button :class="{ on: state.strategy === 'layer-row' }" title="对照基线：一层码满再码下一层，每层由远到近、从左到右" @click="state.strategy = 'layer-row'"><i class="b" />逐层行扫描</button>
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
  gap: 16px;
  padding: 0 14px 0 12px;
  border-radius: 20px;
}
.ctrls {
  display: flex;
  align-items: center;
  gap: 2px;
}
.cb {
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-2);
  display: grid;
  place-items: center;
  transition:
    background 0.15s,
    color 0.15s;
}
.cb:hover:not(:disabled) {
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
  min-width: 92px;
}
.count b {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.count span {
  font-size: 12px;
  color: var(--text-3);
}
.bar {
  position: relative;
  flex: 1;
  min-width: 120px;
  height: 34px;
  border-radius: 10px;
  overflow: visible;
  background: rgba(255, 255, 255, 0.035);
  cursor: pointer;
  touch-action: none;
}
.bar svg {
  display: block;
  position: absolute;
  inset: 0;
  border-radius: 10px;
}
.sp {
  fill: none;
  stroke-width: 1.7;
}
.sp.ours {
  stroke: var(--accent);
}
.sp.basel {
  stroke: var(--base);
}
.sp.other {
  stroke: var(--base);
  opacity: 0.75;
}
.tol {
  stroke: var(--bad);
  stroke-dasharray: 3 4;
  opacity: 0.5;
}
.mark {
  stroke: rgba(255, 255, 255, 0.1);
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
.strat {
  display: flex;
  padding: 3px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--line);
}
.strat button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  white-space: nowrap;
}
.strat button.on {
  color: var(--text);
  background: rgba(255, 255, 255, 0.11);
}
.strat i {
  width: 12px;
  height: 3px;
  border-radius: 2px;
}
.strat i.o {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent);
}
.strat i.b {
  background: var(--base);
  box-shadow: 0 0 8px var(--base);
}
.speed button {
  padding: 0 8px;
}
.narrow {
  gap: 10px;
}
.narrow .speed {
  display: none;
}
.tiny .cb.edge,
.tiny .count span {
  display: none;
}
.tiny .count {
  min-width: 0;
}
</style>
