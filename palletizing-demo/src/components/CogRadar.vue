<script setup lang="ts">
import { computed } from 'vue'
import type { StepSeries } from '../algo/types'

/** 重心雷达（俯视）：中心十字 + 同心刻度圈 + ±容差区 + 重心轨迹（渐隐）+ 当前重心 */
const props = defineProps<{
  steps: StepSeries
  k: number
  fx: number
  fy: number
  tolHalf: number
  tolRatio: number
  color: string
  size?: number
  /** 起步阶段的步数：这几步超出容差区不标红 */
  warmup?: number
  /** 与另一条轨迹共用的显示范围（对比模式左右一致） */
  range?: number
}>()

const uid = Math.random().toString(36).slice(2, 8)

const R = computed(() => {
  if (props.range) return props.range
  let m = 0
  for (let i = 0; i < props.steps.cogX.length; i++)
    m = Math.max(m, Math.abs(props.steps.cogX[i] - props.fx / 2), Math.abs(props.steps.cogY[i] - props.fy / 2))
  return Math.min(640, Math.max(props.tolHalf * 1.9, m * 1.18))
})

function clampv(v: number) {
  return Math.max(-R.value * 0.94, Math.min(R.value * 0.94, v))
}

const kk = computed(() => Math.min(props.k, props.steps.cogX.length - 1))
const pts = computed(() => {
  const out: string[] = []
  for (let i = 0; i <= kk.value; i++) out.push(`${clampv(props.steps.cogX[i] - props.fx / 2)},${clampv(-(props.steps.cogY[i] - props.fy / 2))}`)
  return out.join(' ')
})
const cur = computed(() => ({
  x: clampv(props.steps.cogX[kk.value] - props.fx / 2),
  y: clampv(-(props.steps.cogY[kk.value] - props.fy / 2)),
  bad: props.steps.ratio[kk.value] > props.tolRatio + 1e-9 && kk.value > (props.warmup ?? 0),
}))
const rings = computed(() => [0.33, 0.66, 1].map((f) => f * R.value * 0.94))
</script>

<template>
  <svg class="radar" :width="size ?? 150" :height="size ?? 150" :viewBox="`${-R} ${-R} ${2 * R} ${2 * R}`">
    <defs>
      <radialGradient :id="`bg-${uid}`">
        <stop offset="0" stop-color="rgba(46,224,240,0.10)" />
        <stop offset="0.7" stop-color="rgba(46,224,240,0.02)" />
        <stop offset="1" stop-color="rgba(46,224,240,0)" />
      </radialGradient>
      <radialGradient :id="`glow-${uid}`">
        <stop offset="0" :stop-color="cur.bad ? 'rgba(255,107,107,0.55)' : 'rgba(255,194,75,0.55)'" />
        <stop offset="1" stop-color="rgba(0,0,0,0)" />
      </radialGradient>
    </defs>
    <rect :x="-R" :y="-R" :width="2 * R" :height="2 * R" :rx="R * 0.16" fill="rgba(0,0,0,0.22)" />
    <circle cx="0" cy="0" :r="R * 0.94" :fill="`url(#bg-${uid})`" />
    <circle v-for="(rr, i) in rings" :key="i" cx="0" cy="0" :r="rr" fill="none" stroke="rgba(255,255,255,0.07)" :stroke-width="R / 160" />
    <line :x1="-R * 0.94" y1="0" :x2="R * 0.94" y2="0" stroke="rgba(255,255,255,0.09)" :stroke-width="R / 160" />
    <line x1="0" :y1="-R * 0.94" x2="0" :y2="R * 0.94" stroke="rgba(255,255,255,0.09)" :stroke-width="R / 160" />
    <rect
      :x="-tolHalf"
      :y="-tolHalf"
      :width="2 * tolHalf"
      :height="2 * tolHalf"
      :rx="tolHalf * 0.08"
      :fill="cur.bad ? 'rgba(255,107,107,0.13)' : 'rgba(61,220,151,0.09)'"
      :stroke="cur.bad ? '#ff6b6b' : '#3ddc97'"
      :stroke-width="R / 95"
      :stroke-dasharray="`${R / 20} ${R / 30}`"
    />
    <polyline :points="pts" fill="none" :stroke="color" :stroke-width="R / 55" stroke-linejoin="round" stroke-linecap="round" opacity="0.85" />
    <circle :cx="cur.x" :cy="cur.y" :r="R / 6" :fill="`url(#glow-${uid})`" />
    <circle :cx="cur.x" :cy="cur.y" :r="R / 22" :fill="cur.bad ? '#ff6b6b' : '#ffc24b'" stroke="#0b111d" :stroke-width="R / 100" />
    <text x="0" :y="-R * 0.78" text-anchor="middle" :font-size="R / 9" fill="rgba(170,182,200,0.55)">远</text>
    <text x="0" :y="R * 0.88" text-anchor="middle" :font-size="R / 9" fill="rgba(170,182,200,0.55)">操作侧</text>
  </svg>
</template>

<style scoped>
.radar {
  display: block;
}
</style>
