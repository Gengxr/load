<script setup lang="ts">
import { computed } from 'vue'

/** 等轴测纸箱小图：按真实长宽高比例绘制，三个可见面明暗不同，顶面一道封箱胶带 */
const props = withDefaults(defineProps<{ dx: number; dy: number; dz: number; color: string; size?: number }>(), { size: 56 })

const C = Math.cos(Math.PI / 6)
const S = Math.sin(Math.PI / 6)
const P = (x: number, y: number, z: number): [number, number] => [(x - y) * C, (x + y) * S - z]

function shade(hex: string, f: number) {
  const n = parseInt(hex.replace('#', ''), 16)
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))))
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`
}

const g = computed(() => {
  const m = Math.max(props.dx, props.dy, props.dz)
  const x = props.dx / m
  const y = props.dy / m
  const z = props.dz / m
  const top = [P(0, 0, z), P(x, 0, z), P(x, y, z), P(0, y, z)]
  const right = [P(x, 0, 0), P(x, y, 0), P(x, y, z), P(x, 0, z)]
  const left = [P(0, y, 0), P(x, y, 0), P(x, y, z), P(0, y, z)]
  const all = [...top, ...right, ...left]
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const pad = 0.06
  const vb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + 2 * pad, Math.max(...ys) - Math.min(...ys) + 2 * pad]
  const pts = (a: [number, number][]) => a.map((p) => p.join(',')).join(' ')
  // 胶带沿长边居中
  const along = x >= y
  const tw = 0.09 * Math.min(x, y)
  const tape = along
    ? [P(0, y / 2 - tw, z), P(x, y / 2 - tw, z), P(x, y / 2 + tw, z), P(0, y / 2 + tw, z)]
    : [P(x / 2 - tw, 0, z), P(x / 2 + tw, 0, z), P(x / 2 + tw, y, z), P(x / 2 - tw, y, z)]
  return { vb: vb.join(' '), top: pts(top), right: pts(right), left: pts(left), tape: pts(tape) }
})
</script>

<template>
  <svg :width="size" :height="size" :viewBox="g.vb" class="glyph">
    <polygon :points="g.left" :fill="shade(color, -0.32)" />
    <polygon :points="g.right" :fill="shade(color, -0.12)" />
    <polygon :points="g.top" :fill="shade(color, 0.12)" />
    <polygon :points="g.tape" fill="rgba(255,255,255,0.28)" />
    <polygon :points="g.top" fill="none" stroke="rgba(0,0,0,0.25)" stroke-width="0.012" />
  </svg>
</template>

<style scoped>
.glyph {
  display: block;
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.35));
}
</style>
