<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** 过程平衡性曲线：每放一件后的系统重心偏心率（本方案 vs 基线），含容差线与当前步游标 */
const props = defineProps<{
  ours: number[]
  base?: number[]
  k: number
  tol: number
  height?: number
  /** 层边界（步号） */
  marks?: number[]
  /** 对照曲线的名称 */
  baseLabel?: string
  /** 起步阶段的步数：这一段不计入过程峰值，用底色标出 */
  warmup?: number
}>()
const emit = defineEmits<{ seek: [k: number] }>()

const el = ref<HTMLDivElement | null>(null)
const W = ref(320)
const H = computed(() => props.height ?? 150)
let ro: ResizeObserver | null = null
onMounted(() => {
  ro = new ResizeObserver(() => (W.value = el.value?.clientWidth || 320))
  if (el.value) ro.observe(el.value)
})
onBeforeUnmount(() => ro?.disconnect())

const pad = { l: 34, r: 10, t: 12, b: 20 }
const n = computed(() => Math.max(1, props.ours.length - 1))
const ymax = computed(() => {
  const m = Math.max(...props.ours, ...(props.base ?? []), props.tol)
  return Math.ceil((m * 1.15) / 0.02) * 0.02
})
const x = (i: number) => pad.l + (i / n.value) * (W.value - pad.l - pad.r)
const y = (v: number) => pad.t + (1 - v / ymax.value) * (H.value - pad.t - pad.b)

function path(arr: number[]) {
  let d = ''
  const step = Math.max(1, Math.floor(arr.length / 400))
  for (let i = 0; i < arr.length; i += step) d += (d ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(arr[i]).toFixed(1)
  const last = arr.length - 1
  d += 'L' + x(last).toFixed(1) + ',' + y(arr[last]).toFixed(1)
  return d
}
const oursPath = computed(() => path(props.ours))
const oursArea = computed(() => oursPath.value + `L${x(props.ours.length - 1)},${y(0)}L${x(0)},${y(0)}Z`)
const basePath = computed(() => (props.base ? path(props.base) : ''))
const ticks = computed(() => {
  const out: number[] = []
  for (let v = 0; v <= ymax.value + 1e-9; v += ymax.value > 0.16 ? 0.05 : 0.04) out.push(v)
  return out
})

const hover = ref<number | null>(null)
function onMove(e: MouseEvent) {
  const r = (e.currentTarget as SVGElement).getBoundingClientRect()
  const i = Math.round(((e.clientX - r.left - pad.l) / (W.value - pad.l - pad.r)) * n.value)
  hover.value = Math.max(0, Math.min(n.value, i))
}
const cursor = computed(() => Math.min(props.k, n.value))
const show = computed(() => hover.value ?? cursor.value)
</script>

<template>
  <div ref="el" class="chart">
    <svg :width="W" :height="H" @mousemove="onMove" @mouseleave="hover = null" @click="hover !== null && emit('seek', hover)">
      <defs>
        <linearGradient id="bc-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="rgba(34,211,238,0.28)" />
          <stop offset="1" stop-color="rgba(34,211,238,0)" />
        </linearGradient>
      </defs>
      <g class="grid">
        <template v-for="t in ticks" :key="t">
          <line :x1="pad.l" :x2="W - pad.r" :y1="y(t)" :y2="y(t)" />
          <text :x="pad.l - 6" :y="y(t) + 3.5" text-anchor="end">{{ (t * 100).toFixed(0) }}%</text>
        </template>
      </g>
      <g v-if="warmup" class="warm">
        <title>起步阶段：盘上货物还不到整盘的 20%，重心对单件位置很敏感而偏载力矩很小，不计入过程峰值</title>
        <rect :x="pad.l" :y="pad.t" :width="Math.max(0, x(warmup) - pad.l)" :height="H - pad.t - pad.b" />
        <text v-if="x(warmup) - pad.l > 26" :x="pad.l + 4" :y="pad.t + 10">起步</text>
      </g>
      <g v-if="marks" class="marks">
        <line v-for="m in marks" :key="m" :x1="x(m)" :x2="x(m)" :y1="pad.t" :y2="H - pad.b" />
      </g>
      <line class="tol" :x1="pad.l" :x2="W - pad.r" :y1="y(tol)" :y2="y(tol)" />
      <text class="tol-t" :x="W - pad.r - 2" :y="y(tol) - 5" text-anchor="end">容差 ±{{ (tol * 100).toFixed(0) }}%</text>
      <path v-if="base" :d="basePath" class="base" />
      <path :d="oursArea" fill="url(#bc-area)" />
      <path :d="oursPath" class="ours" />
      <line class="cursor" :x1="x(show)" :x2="x(show)" :y1="pad.t" :y2="H - pad.b" />
      <circle v-if="base" :cx="x(show)" :cy="y(base[show] ?? 0)" r="3.5" class="dot-base" />
      <circle :cx="x(show)" :cy="y(ours[show] ?? 0)" r="3.5" class="dot-ours" />
      <text class="axis" :x="pad.l" :y="H - 5">0</text>
      <text class="axis" :x="W - pad.r" :y="H - 5" text-anchor="end">{{ n }} 件</text>
    </svg>
    <div class="tip num">
      第 {{ show }} 件
      <span class="o">本方案 {{ ((ours[show] ?? 0) * 100).toFixed(1) }}%</span>
      <span v-if="base" class="b">{{ baseLabel ?? '对照' }} {{ ((base[show] ?? 0) * 100).toFixed(1) }}%</span>
    </div>
  </div>
</template>

<style scoped>
.chart {
  position: relative;
  width: 100%;
  padding-top: 18px;
}
svg {
  display: block;
  cursor: crosshair;
}
.warm rect {
  fill: rgba(251, 191, 36, 0.09);
}
.warm text {
  fill: rgba(251, 191, 36, 0.75);
  font-size: 9.5px;
}
.grid line {
  stroke: rgba(148, 163, 184, 0.09);
}
.grid text,
.axis {
  fill: var(--text-3);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.marks line {
  stroke: rgba(148, 163, 184, 0.1);
  stroke-dasharray: 2 3;
}
.tol {
  stroke: var(--bad);
  stroke-dasharray: 5 4;
  stroke-width: 1.2;
  opacity: 0.8;
}
.tol-t {
  fill: var(--bad);
  font-size: 10px;
  opacity: 0.9;
}
.ours {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2;
  stroke-linejoin: round;
}
.base {
  fill: none;
  stroke: var(--base);
  stroke-width: 1.6;
  stroke-linejoin: round;
  opacity: 0.9;
}
.cursor {
  stroke: rgba(226, 232, 240, 0.45);
  stroke-width: 1;
}
.dot-ours {
  fill: var(--accent);
  stroke: #0b111d;
  stroke-width: 1.5;
}
.dot-base {
  fill: var(--base);
  stroke: #0b111d;
  stroke-width: 1.5;
}
.tip {
  position: absolute;
  left: 34px;
  top: 0;
  pointer-events: none;
  font-size: 10.5px;
  color: var(--text-2);
  display: flex;
  gap: 8px;
  white-space: nowrap;
}
.tip .o {
  color: var(--accent);
}
.tip .b {
  color: var(--base);
}
</style>
