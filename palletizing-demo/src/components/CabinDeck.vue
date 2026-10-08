<script setup lang="ts">
import { computed } from 'vue'
import { cabin, loading, movePallet, state, units } from '../store'
import { rotateOffset, trackAt } from '../algo/cabin'

/** 配载俯视图：货位、整托、理论重心与允许区、当前货物 / 整机重心；点选托盘后再点货位即可移动或互换 */
const cfg = computed(() => cabin.value)
const vb = computed(() => {
  const c = cfg.value
  const mx = 900
  const my = 420
  return { x: -mx, y: -c.width / 2 - my, w: c.length + mx * 2, h: c.width + my * 2 }
})
const unitOf = computed(() => new Map(units.value.map((u) => [u.id, u])))
const wRange = computed(() => {
  const ws = units.value.map((u) => u.weight)
  return { lo: Math.min(...ws), hi: Math.max(...ws) }
})
const slots = computed(() => {
  const lp = loading.value
  const bySlot = new Map(lp?.assignments.map((a) => [a.slotId, a]) ?? [])
  return cfg.value.slots.map((s) => {
    const a = bySlot.get(s.id)
    const u = a ? unitOf.value.get(a.palletId) : undefined
    const f = u ? (u.weight - wRange.value.lo) / Math.max(1, wRange.value.hi - wRange.value.lo) : 0
    const o = u && a ? rotateOffset(u.cog, a.yaw) : { x: 0, y: 0 }
    return { s, a, u, f, cx: s.x + o.x, cy: s.y + o.y }
  })
})
const now = computed(() => {
  const lp = loading.value
  const tr = lp?.tracks[state.cabinMode]
  return tr ? trackAt(tr, state.cabinT) : null
})
function click(slotId: string, palletId?: string) {
  if (state.cabinSel && state.cabinSel !== palletId) {
    movePallet(state.cabinSel, slotId)
    state.cabinSel = ''
  } else state.cabinSel = palletId && state.cabinSel !== palletId ? palletId : ''
}
const heat = (f: number) => `rgb(${Math.round(60 + 30 * f)}, ${Math.round(120 + 70 * f)}, ${Math.round(170 + 70 * f)})`
</script>

<template>
  <svg class="deck" :viewBox="`${vb.x} ${vb.y} ${vb.w} ${vb.h}`" preserveAspectRatio="xMidYMid meet">
    <!-- 机身轮廓 -->
    <rect :x="-700" :y="-cfg.width / 2 - 180" :width="cfg.length + 1400" :height="cfg.width + 360" :rx="cfg.width / 2 + 180" class="hull" />
    <rect v-for="c in cfg.cabins" :key="c.id" :x="c.x0" :y="-c.width / 2" :width="c.x1 - c.x0" :height="c.width" rx="60" class="cab" />
    <text :x="-640" y="60" class="dir">机头</text>
    <text :x="cfg.length + 640" y="60" class="dir" text-anchor="end">机尾</text>
    <!-- 允许区与理论重心 -->
    <rect :x="cfg.targetCog.x - cfg.tolX * cfg.length" :y="-cfg.targetCog.y - cfg.tolY * cfg.width" :width="2 * cfg.tolX * cfg.length" :height="2 * cfg.tolY * cfg.width" rx="40" class="tol" />
    <!-- 舱门 -->
    <g v-for="d in cfg.doors" :key="d.id">
      <line v-if="d.kind === 'tail'" :x1="d.x" :x2="d.x" :y1="-cfg.width / 2 + 120" :y2="cfg.width / 2 - 120" class="door" />
      <line v-else-if="d.kind === 'side'" :x1="d.x - 700" :x2="d.x + 700" :y1="-d.y" :y2="-d.y" class="door" />
      <rect v-else :x="d.x - 520" :y="-d.y - 520" width="1040" height="1040" rx="60" class="hatch" />
    </g>
    <!-- 货位与托盘（画布 y 向下 = 机体左侧；与三维默认视角一致） -->
    <g v-for="it in slots" :key="it.s.id" class="slot" :class="{ sel: it.a && state.cabinSel === it.a.palletId, target: !!state.cabinSel }" @click="click(it.s.id, it.a?.palletId)">
      <rect :x="it.s.x - 640" :y="-it.s.y - 640" width="1280" height="1280" rx="70" class="frame" />
      <template v-if="it.u && it.a">
        <rect :x="it.s.x - 580" :y="-it.s.y - 580" width="1160" height="1160" rx="70" class="pal" :style="{ fill: heat(it.f) }" />
        <text :x="it.s.x" :y="-it.s.y - 60" class="pid">{{ it.u.id }}</text>
        <text :x="it.s.x" :y="-it.s.y + 330" class="pw">{{ it.u.weight.toFixed(0) }}kg</text>
      </template>
      <text v-else :x="it.s.x" :y="-it.s.y + 110" class="sid">{{ it.s.id }}</text>
    </g>
    <!-- 重心标记 -->
    <g :transform="`translate(${cfg.targetCog.x} ${-cfg.targetCog.y})`" class="target">
      <circle r="150" />
      <path d="M-260 0H260M0 -260V260" />
    </g>
    <template v-if="now">
      <g :transform="`translate(${now.system.x} ${-now.system.y})`"><path d="M0 -150L150 0L0 150L-150 0Z" class="sys" :class="{ bad: !now.ok }" /></g>
      <circle v-if="now.cargo" :cx="now.cargo.x" :cy="-now.cargo.y" r="125" class="cargo" />
    </template>
  </svg>
</template>

<style scoped>
.deck {
  display: block;
  width: 100%;
  user-select: none;
}
.hull {
  fill: rgba(111, 220, 245, 0.04);
  stroke: rgba(111, 220, 245, 0.28);
  stroke-width: 26;
}
.cab {
  fill: rgba(0, 0, 0, 0.25);
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 18;
}
.dir {
  font-size: 250px;
  fill: var(--text-3);
  dominant-baseline: middle;
}
.tol {
  fill: rgba(61, 220, 151, 0.1);
  stroke: var(--ok);
  stroke-width: 22;
  stroke-dasharray: 90 70;
}
.door {
  stroke: var(--cog);
  stroke-width: 70;
  stroke-linecap: round;
}
.hatch {
  fill: none;
  stroke: var(--cog);
  stroke-width: 30;
  stroke-dasharray: 110 80;
}
.slot {
  cursor: pointer;
}
.frame {
  fill: transparent;
  stroke: rgba(255, 255, 255, 0.2);
  stroke-width: 16;
  stroke-dasharray: 80 60;
}
.slot.target .frame {
  stroke: rgba(46, 224, 240, 0.7);
  fill: rgba(46, 224, 240, 0.06);
}
.slot:hover .frame {
  fill: rgba(255, 255, 255, 0.08);
}
.pal {
  stroke: rgba(8, 14, 24, 0.6);
  stroke-width: 20;
  opacity: 0.92;
}
.slot.sel .pal {
  stroke: #f2fdff;
  stroke-width: 50;
}
.pid {
  font-size: 380px;
  font-weight: 700;
  fill: #06101c;
  text-anchor: middle;
  dominant-baseline: middle;
}
.pw {
  font-size: 250px;
  font-weight: 600;
  fill: rgba(6, 16, 28, 0.75);
  text-anchor: middle;
  dominant-baseline: middle;
}
.sid {
  font-size: 340px;
  font-weight: 600;
  fill: rgba(255, 255, 255, 0.22);
  text-anchor: middle;
}
.target circle {
  fill: none;
  stroke: #fff;
  stroke-width: 34;
}
.target path {
  stroke: #fff;
  stroke-width: 26;
}
.sys {
  fill: var(--accent);
  stroke: #06101c;
  stroke-width: 24;
}
.sys.bad {
  fill: var(--bad);
}
.cargo {
  fill: var(--cog);
  stroke: #06101c;
  stroke-width: 24;
}
</style>
