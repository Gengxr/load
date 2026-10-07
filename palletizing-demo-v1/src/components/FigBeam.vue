<script setup lang="ts">
/** 束搜索示意：每一步只保留评分最好的若干条"半成品"，其余剪掉 */
defineProps<{ rows: string[]; keep: string }>()
const lv = [24, 78, 132, 186]
const edges: [number, number, number, number, boolean][] = [
  [180, 0, 60, 1, false],
  [180, 0, 140, 1, true],
  [180, 0, 220, 1, true],
  [180, 0, 300, 1, false],
  [140, 1, 100, 2, false],
  [140, 1, 160, 2, true],
  [220, 1, 200, 2, true],
  [220, 1, 262, 2, false],
  [160, 2, 128, 3, false],
  [160, 2, 178, 3, true],
  [200, 2, 214, 3, false],
  [200, 2, 258, 3, false],
]
const nodes: [number, number, 'keep' | 'cut' | 'best' | 'root'][] = [
  [180, 0, 'root'],
  [60, 1, 'cut'],
  [140, 1, 'keep'],
  [220, 1, 'keep'],
  [300, 1, 'cut'],
  [100, 2, 'cut'],
  [160, 2, 'keep'],
  [200, 2, 'keep'],
  [262, 2, 'cut'],
  [128, 3, 'cut'],
  [178, 3, 'best'],
  [214, 3, 'cut'],
  [258, 3, 'cut'],
]
</script>

<template>
  <svg viewBox="0 0 380 238">
    <g v-for="(e, i) in edges" :key="'e' + i">
      <line :x1="e[0] + 34" :y1="lv[e[1]] + 9" :x2="e[2] + 34" :y2="lv[e[3]] - 9" :stroke="e[4] ? '#2ee0f0' : '#4b586c'" :stroke-width="e[4] ? 2 : 1.2" :stroke-dasharray="e[4] ? '' : '4 4'" />
    </g>
    <g v-for="(n, i) in nodes" :key="'n' + i">
      <circle :cx="n[0] + 34" :cy="lv[n[1]]" r="9" :fill="n[2] === 'cut' ? '#1a2333' : n[2] === 'best' ? '#ffc24b' : '#2ee0f0'" :stroke="n[2] === 'cut' ? '#4b586c' : 'none'" stroke-width="1.2" />
      <path v-if="n[2] === 'cut'" :d="`M${n[0] + 30} ${lv[n[1]] - 4}l8 8m0 -8l-8 8`" stroke="#6b7a90" stroke-width="1.4" />
    </g>
    <g font-size="11" fill="#74829a">
      <text v-for="(t, i) in rows" :key="t" x="0" :y="lv[i] + 4">{{ t }}</text>
    </g>
    <g font-size="11">
      <circle cx="62" cy="224" r="5" fill="#2ee0f0" /><text x="72" y="228" fill="#aab6c8">{{ keep }}</text>
      <circle cx="212" cy="224" r="5" fill="#1a2333" stroke="#4b586c" /><text x="222" y="228" fill="#74829a">淘汰</text>
      <circle cx="282" cy="224" r="5" fill="#ffc24b" /><text x="292" y="228" fill="#aab6c8">最终选中</text>
    </g>
  </svg>
</template>
