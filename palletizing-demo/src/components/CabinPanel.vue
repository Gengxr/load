<script setup lang="ts">
import { computed, ref } from 'vue'
import { addConfig, cabin, clearMeasure, configs, importUnits, loading, measured, runLoading, setCabin, simulateMeasure, state, toast, units } from '../store'
import { parseCabinConfig, parsePalletUnits } from '../algo/io'
import Icon from './Icon.vue'

/** 舱内装载 · 左侧面板：机型构型选择 + 整托货物清单（预测 / 实测） */
const fileInput = ref<HTMLInputElement | null>(null)
const assignOf = computed(() => new Map(loading.value?.assignments.map((a) => [a.palletId, a]) ?? []))
const loadSeq = computed(() => new Map(loading.value?.tracks.load.order.map((id, i) => [id, i + 1]) ?? []))
const hasMeasured = computed(() => Object.keys(measured.value).length > 0)
const totals = computed(() => ({
  n: units.value.length,
  w: units.value.reduce((s, u) => s + u.weight, 0),
  slots: cabin.value.slots.length,
  empty: cabin.value.emptyWeight,
}))

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  f.text().then((t) => {
    try {
      const data = JSON.parse(t)
      if (data.slots && data.cabins) {
        addConfig(parseCabinConfig(t))
        toast('已导入舱段构型参数')
      } else {
        importUnits(parsePalletUnits(t))
        toast('已导入整托实测数据并重新规划')
      }
    } catch (err) {
      toast('导入失败：' + (err instanceof Error ? err.message : String(err)))
    }
  })
  ;(e.target as HTMLInputElement).value = ''
}
function measure() {
  if (hasMeasured.value) clearMeasure()
  else {
    simulateMeasure()
    toast('已模拟三点称重实测回传，并用实测值复核装载方案')
  }
}
</script>

<template>
  <aside class="cp glass">
    <header class="hd">
      <div class="ph"><Icon name="plane" :size="17" />舱段构型</div>
      <span class="badge num">{{ cabin.model }} · {{ cabin.version }}</span>
    </header>

    <div class="body scroll">
      <div class="cfgs">
        <button v-for="c in configs" :key="c.id" class="cfg" :class="{ on: state.cabinId === c.id, short: c.slots.length < units.length }" @click="setCabin(c.id)">
          <svg :viewBox="`-300 ${-c.width / 2 - 300} ${c.length + 600} ${c.width + 600}`" class="glyph" preserveAspectRatio="xMidYMid meet">
            <rect :x="-200" :y="-c.width / 2 - 160" :width="c.length + 400" :height="c.width + 320" :rx="c.width / 2 + 160" class="gh" />
            <rect v-for="s in c.slots" :key="s.id" :x="s.x - 520" :y="-s.y - 520" width="1040" height="1040" rx="120" class="gs" />
          </svg>
          <span class="cn">{{ c.name.replace(/ · /, '\n').split('\n')[0] }}</span>
          <span class="cd num">{{ c.name.split(' · ')[1] ?? `${c.slots.length} 位` }}</span>
        </button>
      </div>
      <p class="desc">{{ cabin.desc }}<template v-if="cabin.slots.length < units.length"> · <b class="warn">货位不足，后 {{ units.length - cabin.slots.length }} 盘无法装载</b></template></p>

      <div class="stats4">
        <div class="st"><b class="num">{{ totals.n }}</b><span>整托</span></div>
        <div class="st"><b class="num">{{ totals.w.toFixed(0) }}</b><span>kg 货物</span></div>
        <div class="st"><b class="num">{{ totals.slots }}</b><span>货位</span></div>
        <div class="st"><b class="num">{{ (totals.empty / 1000).toFixed(1) }}</b><span>t 空机</span></div>
      </div>

      <div class="lh"><span>整托货物</span><span class="badge" :class="{ meas: hasMeasured }">{{ hasMeasured ? '实测值' : '码盘预测值' }}</span></div>
      <div class="list">
        <button v-for="u in units" :key="u.id" class="row" :class="{ on: state.cabinSel === u.id }" @click="state.cabinSel = state.cabinSel === u.id ? '' : u.id">
          <span class="pid num">{{ u.id }}</span>
          <span class="mid num">
            <b>{{ u.weight.toFixed(1) }} kg</b>
            <span>重心 {{ u.cog.x >= 0 ? '+' : '' }}{{ u.cog.x.toFixed(0) }}, {{ u.cog.y >= 0 ? '+' : '' }}{{ u.cog.y.toFixed(0) }} mm · 高 {{ u.size[2] }}</span>
          </span>
          <span v-if="assignOf.get(u.id)" class="slot num">
            <b>{{ assignOf.get(u.id)!.slotId }}</b>
            <span>第 {{ loadSeq.get(u.id) }} 个装</span>
          </span>
          <span v-else class="slot none">未装载</span>
        </button>
      </div>
    </div>

    <footer class="ft">
      <button class="btn icon" data-tip="导入整托数据 / 构型参数 JSON" @click="fileInput?.click()"><Icon name="upload" :size="16" /></button>
      <button class="btn" :class="{ on: hasMeasured }" :data-tip="hasMeasured ? '恢复为码盘预测值' : '模拟三点称重实测回传'" @click="measure"><Icon name="scale" :size="16" />实测复核</button>
      <button class="btn primary grow" @click="runLoading()"><Icon name="wand" :size="16" />重新规划</button>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile" />
    </footer>
  </aside>
</template>

<style scoped>
.cp {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
  min-height: 0;
  max-height: 100%;
  overflow: hidden;
}
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
}
.body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 -8px;
  padding: 0 8px;
  overflow-y: auto;
}
.body > * {
  flex: none;
}
.cfgs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}
.cfg {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px 9px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  text-align: left;
  min-width: 0;
  transition:
    border-color 0.18s,
    background 0.18s;
}
.cfg:hover {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.055);
}
.cfg.on {
  border-color: rgba(46, 224, 240, 0.55);
  background: linear-gradient(155deg, rgba(46, 224, 240, 0.16), rgba(91, 140, 255, 0.06));
  box-shadow: 0 0 0 3px rgba(46, 224, 240, 0.08);
}
.cfg.short {
  opacity: 0.55;
}
.glyph {
  width: 100%;
  height: 30px;
  margin-bottom: 4px;
}
.gh {
  fill: rgba(111, 220, 245, 0.06);
  stroke: rgba(111, 220, 245, 0.45);
  stroke-width: 60;
}
.gs {
  fill: rgba(255, 255, 255, 0.22);
}
.cfg.on .gs {
  fill: var(--accent);
}
.cn {
  font-size: 13px;
  font-weight: 650;
}
.cd {
  font-size: 11px;
  color: var(--text-3);
}
.desc {
  margin: -4px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
  line-height: 1.5;
}
.warn {
  color: var(--warn);
  font-weight: 500;
}
.lh {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
  margin-bottom: -4px;
}
.badge.meas {
  color: var(--cog);
  background: rgba(255, 194, 75, 0.12);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border-radius: 11px;
  border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.025);
  color: var(--text);
  text-align: left;
  transition: all 0.15s;
}
.row:hover {
  background: rgba(255, 255, 255, 0.055);
}
.row.on {
  border-color: rgba(46, 224, 240, 0.55);
  background: var(--accent-soft);
}
.pid {
  width: 38px;
  height: 30px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  flex: none;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-soft);
}
.mid {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.mid b {
  font-size: 13px;
  font-weight: 650;
}
.mid span {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.slot {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.3;
  flex: none;
}
.slot b {
  font-size: 13px;
}
.slot span,
.slot.none {
  font-size: 10.5px;
  color: var(--text-3);
}
.ft {
  display: flex;
  gap: 8px;
  flex: none;
}
@media (max-height: 800px) {
  .cp {
    padding: 13px 14px;
    gap: 10px;
  }
  .glyph {
    height: 22px;
  }
}
</style>
