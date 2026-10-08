<script setup lang="ts">
import { computed } from 'vue'
import { cargos, current, pallets, palletPass, replanPallet, result, skuColors, state } from '../store'
import { selectPallet } from '../playback'
import { exportPlan } from '../algo/io'
import { download } from '../persist'
import CogCard from './CogCard.vue'
import Icon from './Icon.vue'

/** 单盘码放 · 左侧面板：货盘切换 + 本盘货物清单 */
defineProps<{ showCog?: boolean }>()

function exportPallet() {
  const p = current.value
  if (!p) return
  download(`码盘方案_${p.id}.json`, exportPlan(p.result, p.cargos, state.pallet, state.cons))
}

const skuRows = computed(() => {
  const m = new Map<string, { sku: string; l: number; w: number; h: number; n: number; wmin: number; wmax: number }>()
  for (const c of cargos.value) {
    const r = m.get(c.sku)
    if (r) {
      r.n++
      r.wmin = Math.min(r.wmin, c.weight)
      r.wmax = Math.max(r.wmax, c.weight)
    } else m.set(c.sku, { sku: c.sku, l: c.length, w: c.width, h: c.height, n: 1, wmin: c.weight, wmax: c.weight })
  }
  return [...m.values()].sort((a, b) => b.n - a.n)
})
const maxN = computed(() => Math.max(1, ...skuRows.value.map((r) => r.n)))
const totals = computed(() => {
  const r = result.value
  return {
    n: cargos.value.length,
    layers: r?.layout.layers.length ?? 0,
    w: r?.metrics.grossWeight ?? 0,
    h: r?.metrics.stackSize[2] ?? 0,
  }
})
const remaining = computed(() => result.value?.layout.remaining ?? [])
</script>

<template>
  <aside class="lp glass">
    <header class="hd">
      <div class="ph"><Icon name="boxes" :size="17" />当前货盘</div>
      <div class="nav">
        <button class="nb" :disabled="pallets.length < 2" data-tip="上一盘" @click="selectPallet(state.sel - 1)"><Icon name="chevronLeft" :size="16" /></button>
        <span class="num"><b>{{ current?.id }}</b> / {{ pallets.length }}</span>
        <button class="nb" :disabled="pallets.length < 2" data-tip="下一盘" @click="selectPallet(state.sel + 1)"><Icon name="chevron" :size="16" /></button>
      </div>
    </header>

    <div v-if="pallets.length > 1" class="chips">
      <button v-for="(p, i) in pallets" :key="p.id" class="chip num" :class="{ on: i === state.sel, bad: !palletPass(p) }" @click="selectPallet(i)">{{ p.no }}</button>
    </div>

    <!-- 中部可滚动：空间不足时只滚动这里，页脚按钮始终可见 -->
    <div class="body scroll">
      <div class="stats4">
        <div class="st"><b class="num">{{ totals.n }}</b><span>件货物</span></div>
        <div class="st"><b class="num">{{ totals.layers }}</b><span>层</span></div>
        <div class="st"><b class="num">{{ totals.w.toFixed(0) }}</b><span>kg 毛重</span></div>
        <div class="st"><b class="num">{{ totals.h }}</b><span>mm 垛高</span></div>
      </div>

      <div class="list">
        <div v-for="r in skuRows" :key="r.sku" class="sku">
          <i class="sw" :style="{ background: skuColors.get(r.sku) }" />
          <div class="sk-m">
            <div class="sk-d num">{{ r.l }} × {{ r.w }} × {{ r.h }}</div>
            <div class="sk-bar"><span :style="{ width: (r.n / maxN) * 100 + '%', background: skuColors.get(r.sku) }" /></div>
          </div>
          <div class="sk-r num">
            <b>×{{ r.n }}</b>
            <span>{{ r.wmin.toFixed(1) }}{{ r.wmax - r.wmin > 0.05 ? '–' + r.wmax.toFixed(1) : '' }} kg</span>
          </div>
        </div>
      </div>

      <div v-if="remaining.length" class="remain">
        <Icon name="alert" :size="15" />
        <div>
          <b>{{ remaining.length }} 件未放入</b> · 已列入人工处理清单
          <div class="rl num">{{ remaining.slice(0, 6).map((c) => c.id).join('、') }}{{ remaining.length > 6 ? ' …' : '' }}</div>
        </div>
      </div>
      <div v-if="state.error" class="error"><Icon name="alert" :size="15" />{{ state.error }}</div>
      <CogCard v-if="showCog" class="inline-cog" flat />
    </div>

    <footer class="ft">
      <button class="btn icon" data-tip="导出本盘方案 JSON" @click="exportPallet"><Icon name="download" :size="16" /></button>
      <button class="btn" :class="{ on: state.paramsOpen }" @click="state.paramsOpen = !state.paramsOpen"><Icon name="sliders" :size="16" />参数</button>
      <button class="btn primary grow" :disabled="state.planning" @click="replanPallet()"><Icon name="refresh" :size="16" />重新规划本盘</button>
    </footer>
  </aside>
</template>

<style scoped>
.lp {
  display: flex;
  flex-direction: column;
  padding: 16px;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
}
.nav {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  color: var(--text-3);
}
.nav b {
  color: var(--text);
  font-size: 14px;
}
.nb {
  width: 26px;
  height: 26px;
  border-radius: 8px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-2);
  display: grid;
  place-items: center;
  padding: 0;
}
.nb:hover:not(:disabled) {
  color: var(--text);
  background: rgba(255, 255, 255, 0.09);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: none;
}
.chip {
  min-width: 32px;
  height: 28px;
  padding: 0 8px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.035);
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 600;
  transition: all 0.15s;
}
.chip:hover {
  color: var(--text);
  border-color: rgba(255, 255, 255, 0.2);
}
.chip.bad {
  color: var(--warn);
}
.chip.on {
  color: #021218;
  border-color: transparent;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
  box-shadow: 0 4px 12px rgba(46, 200, 245, 0.28);
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
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sku {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 4px;
  border-radius: 9px;
}
.sku:hover {
  background: rgba(255, 255, 255, 0.035);
}
.sw {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  flex: none;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12) inset;
}
.sk-m {
  flex: 1;
  min-width: 0;
}
.sk-d {
  font-size: 12.5px;
  font-weight: 550;
}
.sk-bar {
  height: 3px;
  margin-top: 5px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
}
.sk-bar span {
  display: block;
  height: 100%;
  border-radius: 2px;
  opacity: 0.85;
}
.sk-r {
  text-align: right;
  line-height: 1.3;
}
.sk-r b {
  display: block;
  font-size: 13px;
}
.sk-r span {
  font-size: 11px;
  color: var(--text-3);
}
.remain,
.error {
  display: flex;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 11px;
  font-size: 12.5px;
  color: var(--warn);
  background: rgba(255, 194, 75, 0.08);
  border: 1px solid rgba(255, 194, 75, 0.22);
}
.error {
  color: var(--bad);
  background: var(--bad-soft);
  border-color: rgba(255, 107, 107, 0.25);
}
.rl {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-3);
}
.inline-cog {
  margin-top: 2px;
}
.ft {
  display: flex;
  gap: 8px;
  flex: none;
}
@media (max-height: 760px) {
  .lp {
    padding: 13px 14px;
    gap: 10px;
  }
}
</style>
