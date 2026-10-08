<script setup lang="ts">
import { computed } from 'vue'
import type { Placement } from '../algo/types'

/** 分层俯视图：选中层的排布（着色、码放序号），下层轮廓虚线显示，便于看压缝 */
const props = defineProps<{
  placements: Placement[]
  layer: number
  colors: string[]
  seqOf: number[]
  fx: number
  fy: number
  /** 已码放件数（未放的件画成空框） */
  placedSet?: Set<number>
  highlight?: number | null
  size?: number
  showLower?: boolean
}>()

const items = computed(() =>
  props.placements
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.layer === props.layer)
    // 叠放列只画顶上一件
    .sort((a, b) => a.p.z - b.p.z),
)
const lower = computed(() => (props.showLower === false ? [] : props.placements.filter((p) => p.layer === props.layer - 1)))
const pad = 16
</script>

<template>
  <svg class="lv" :viewBox="`${-pad} ${-pad} ${fx + 2 * pad} ${fy + 2 * pad}`" :width="size ?? 260" :height="size ?? 260">
    <rect :x="-pad" :y="-pad" :width="fx + 2 * pad" :height="fy + 2 * pad" rx="18" fill="rgba(148,163,184,0.05)" />
    <rect x="0" y="0" :width="fx" :height="fy" fill="none" stroke="rgba(34,211,238,0.55)" stroke-width="3" stroke-dasharray="14 9" />
    <rect v-for="(p, j) in lower" :key="'l' + j" :x="p.x" :y="fy - p.y - p.dy" :width="p.dx" :height="p.dy" fill="none" stroke="rgba(148,163,184,0.35)" stroke-width="2.5" stroke-dasharray="8 7" />
    <g v-for="{ p, i } in items" :key="i">
      <rect
        :x="p.x + 3"
        :y="fy - p.y - p.dy + 3"
        :width="p.dx - 6"
        :height="p.dy - 6"
        rx="6"
        :fill="!placedSet || placedSet.has(i) ? colors[i] : 'rgba(148,163,184,0.06)'"
        :fill-opacity="!placedSet || placedSet.has(i) ? 0.92 : 1"
        :stroke="highlight === i ? '#ffffff' : !placedSet || placedSet.has(i) ? 'rgba(10,15,25,0.55)' : 'rgba(148,163,184,0.45)'"
        :stroke-width="highlight === i ? 9 : 3"
        :stroke-dasharray="!placedSet || placedSet.has(i) ? undefined : '10 8'"
      />
      <text
        v-if="Math.min(p.dx, p.dy) >= 90"
        :x="p.x + p.dx / 2"
        :y="fy - p.y - p.dy / 2 + Math.min(p.dx, p.dy) * 0.13"
        text-anchor="middle"
        :font-size="Math.min(64, Math.min(p.dx, p.dy) * 0.36)"
        font-weight="600"
        :fill="!placedSet || placedSet.has(i) ? 'rgba(10,15,25,0.78)' : 'rgba(163,175,192,0.7)'"
      >
        {{ seqOf[i] + 1 }}
      </text>
    </g>
  </svg>
</template>

<style scoped>
.lv {
  display: block;
  font-variant-numeric: tabular-nums;
}
</style>
