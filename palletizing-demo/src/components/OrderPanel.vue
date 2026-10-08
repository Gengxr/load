<script setup lang="ts">
import { computed, ref } from 'vue'
import { ORDER_PRESETS, allCargos, importOrder, newOrderAndRun, order, rerollSeed, runPipeline, saveDataset, skuColors, state, toast } from '../store'
import { FIG21_PATTERNS } from '../algo/generator'
import { flattenImported, orderPayload, parseCargoJson } from '../algo/io'
import { download } from '../persist'
import { KIND_NAME, type CargoKind } from '../algo/types'
import { KIND_COLOR } from '../viz/palette'
import Icon from './Icon.vue'

/** 出库分盘 · 左侧面板：出库清单的来源（模拟生成 / 导入）与货物构成 */
const fileInput = ref<HTMLInputElement | null>(null)

function choose(key: string) {
  newOrderAndRun(key)
}
function reroll() {
  if (state.preset === 'import') return
  rerollSeed()
  newOrderAndRun()
}
function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  f.text().then((t) => {
    try {
      importOrder(f.name, flattenImported(parseCargoJson(t)))
      runPipeline()
    } catch (err) {
      state.error = '导入失败：' + (err instanceof Error ? err.message : String(err))
    }
  })
  ;(e.target as HTMLInputElement).value = ''
}
function save() {
  const ds = saveDataset()
  if (ds) toast(`已保存到数据中心：${ds.name}`)
}
function exportOrder() {
  if (order.value) download(`出库清单_${order.value.id}.json`, orderPayload(order.value.id, order.value.cargos))
}

const skuRows = computed(() => {
  const m = new Map<string, { sku: string; l: number; w: number; h: number; n: number; kg: number; kind: CargoKind; name: string; cap?: number; fragile: boolean }>()
  for (const c of allCargos.value) {
    const r = m.get(c.sku)
    if (r) {
      r.n++
      r.kg += c.weight
    } else m.set(c.sku, { sku: c.sku, l: c.length, w: c.width, h: c.height, n: 1, kg: c.weight, kind: c.kind ?? 'carton', name: c.name ?? '', cap: c.maxLoad, fragile: !!c.fragile })
  }
  return [...m.values()].sort((a, b) => b.n - a.n)
})
const kinds = computed(() =>
  (['carton', 'wood', 'case'] as CargoKind[]).map((k) => ({ k, name: KIND_NAME[k], n: allCargos.value.filter((c) => (c.kind ?? 'carton') === k).length })).filter((x) => x.n > 0),
)
const maxN = computed(() => Math.max(1, ...skuRows.value.map((r) => r.n)))
const totals = computed(() => {
  const list = allCargos.value
  return {
    n: list.length,
    skus: skuRows.value.length,
    w: list.reduce((s, c) => s + c.weight, 0),
    v: list.reduce((s, c) => s + (c.length * c.width * c.height) / 1e9, 0),
  }
})
</script>

<template>
  <aside class="op glass">
    <header class="hd">
      <div class="ph"><Icon name="package" :size="17" />出库清单</div>
      <span class="badge num" :title="order?.source">{{ order?.id ?? '—' }}</span>
    </header>

    <div class="body scroll">
      <div class="presets">
        <button v-for="p in ORDER_PRESETS" :key="p.key" class="preset" :class="{ on: state.preset === p.key }" :disabled="state.planning" @click="choose(p.key)">
          <span class="pi"><Icon :name="p.icon" :size="17" /></span>
          <span class="pt">
            <span class="pn">{{ p.name }}</span>
            <span class="pd">{{ p.desc }}</span>
          </span>
        </button>
        <button class="preset" :class="{ on: state.preset === 'import' }" :disabled="state.planning" @click="fileInput?.click()">
          <span class="pi"><Icon name="upload" :size="17" /></span>
          <span class="pt">
            <span class="pn">导入清单</span>
            <span class="pd ell">{{ state.preset === 'import' ? state.importName : '仓储系统 JSON' }}</span>
          </span>
        </button>
      </div>
      <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile" />

      <div v-if="state.preset === 'fig21'" class="fig">
        <select v-model.number="state.gen.singleIndex" @change="newOrderAndRun()">
          <option v-for="(f, i) in FIG21_PATTERNS" :key="i" :value="i">{{ f.l }}×{{ f.w }} · 每层 {{ f.n }} 件</option>
        </select>
        <select v-model.number="state.gen.singleHeight" @change="newOrderAndRun()">
          <option v-for="h in [100, 150, 200, 250, 300]" :key="h" :value="h">高 {{ h }}</option>
        </select>
      </div>

      <div class="stats4">
        <div class="st"><b class="num">{{ totals.n }}</b><span>件货物</span></div>
        <div class="st"><b class="num">{{ totals.skus }}</b><span>种规格</span></div>
        <div class="st"><b class="num">{{ totals.w.toFixed(0) }}</b><span>kg</span></div>
        <div class="st"><b class="num">{{ totals.v.toFixed(2) }}</b><span>m³</span></div>
      </div>

      <div v-if="kinds.length" class="kinds num" title="货物包装类型：决定外观、承压能力和机械臂的抓取方式">
        <span v-for="x in kinds" :key="x.k"><i :style="{ background: KIND_COLOR[x.k] }" />{{ x.name }} <b>{{ x.n }}</b></span>
      </div>

      <div class="list">
        <div v-for="r in skuRows" :key="r.sku" class="sku" :title="`${KIND_NAME[r.kind]}${r.name ? ' · ' + r.name : ''}：单件承压上限 ${r.cap ?? '不限'} kg${r.fragile ? '（怕压）' : ''}`">
          <i class="sw" :style="{ background: skuColors.get(r.sku) }" />
          <div class="sk-m">
            <div class="sk-n"><b>{{ r.name || KIND_NAME[r.kind] }}</b><em :class="r.kind">{{ r.kind === 'case' ? '特种箱' : KIND_NAME[r.kind] }}</em><em v-if="r.fragile" class="frag">怕压</em></div>
            <div class="sk-d num">{{ r.l }} × {{ r.w }} × {{ r.h }}<span v-if="r.cap !== undefined"> · 承压 {{ r.cap }} kg</span></div>
            <div class="sk-bar"><span :style="{ width: (r.n / maxN) * 100 + '%', background: skuColors.get(r.sku) }" /></div>
          </div>
          <div class="sk-r num">
            <b>×{{ r.n }}</b>
            <span>{{ r.kg.toFixed(0) }} kg</span>
          </div>
        </div>
      </div>
      <div v-if="state.error" class="error"><Icon name="alert" :size="15" />{{ state.error }}</div>
    </div>

    <footer class="ft">
      <button class="btn icon" data-tip="保存为数据集" :disabled="!order" @click="save"><Icon name="save" :size="16" /></button>
      <button class="btn icon" data-tip="导出出库清单 JSON" :disabled="!order" @click="exportOrder"><Icon name="download" :size="16" /></button>
      <button class="btn icon" :class="{ on: state.paramsOpen }" data-tip="参数设置" @click="state.paramsOpen = !state.paramsOpen"><Icon name="sliders" :size="16" /></button>
      <button class="btn primary grow" :disabled="state.planning || state.preset === 'import'" @click="reroll"><Icon name="dice" :size="16" />换一批货物</button>
    </footer>
  </aside>
</template>

<style scoped>
.op {
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
.presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
}
.preset {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 8px 9px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  text-align: left;
  transition:
    border-color 0.18s,
    background 0.18s;
}
.preset:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.055);
}
.preset.on {
  border-color: rgba(46, 224, 240, 0.55);
  background: linear-gradient(155deg, rgba(46, 224, 240, 0.16), rgba(91, 140, 255, 0.06));
  box-shadow: 0 0 0 3px rgba(46, 224, 240, 0.08);
}
.preset:disabled {
  opacity: 0.7;
}
.pi {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  flex: none;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.06);
}
.preset.on .pi {
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.pt {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.3;
}
.pn {
  font-size: 13px;
  font-weight: 650;
  white-space: nowrap;
}
.pd {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fig {
  display: grid;
  grid-template-columns: 1fr 96px;
  gap: 8px;
}
.fig select {
  min-width: 0;
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
  padding: 6px 4px;
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
.kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 12px;
  color: var(--text-2);
  padding: 0 2px;
}
.kinds span {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kinds i {
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
.kinds b {
  color: var(--text);
  font-weight: 650;
}
.sk-n {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  min-width: 0;
}
.sk-n b {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sk-n em {
  flex: none;
  font-style: normal;
  font-size: 10.5px;
  padding: 0 6px;
  border-radius: 5px;
  color: #e9d3b4;
  background: rgba(216, 180, 138, 0.16);
}
.sk-n em.wood {
  color: #e2b07c;
  background: rgba(185, 130, 77, 0.22);
}
.sk-n em.case {
  color: #b7c99a;
  background: rgba(111, 130, 86, 0.28);
}
.sk-n em.frag {
  color: #ffc24b;
  background: rgba(255, 194, 75, 0.14);
}
.sk-d {
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 1px;
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
.error {
  display: flex;
  gap: 9px;
  padding: 10px 12px;
  border-radius: 11px;
  font-size: 12.5px;
  color: var(--bad);
  background: var(--bad-soft);
  border: 1px solid rgba(255, 107, 107, 0.25);
}
.ft {
  display: flex;
  gap: 8px;
  flex: none;
}
@media (max-height: 800px) {
  .op {
    padding: 13px 14px;
    gap: 10px;
  }
  .pd {
    display: none;
  }
  .preset {
    padding: 6px 8px;
  }
  .pi {
    width: 26px;
    height: 26px;
  }
}
</style>
