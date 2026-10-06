<script setup lang="ts">
import { computed, ref } from 'vue'
import { PRESETS, applyPreset, cargos, generateAndPlan, plan, rerollSeed, result, skuColors, state, type PresetKey } from '../store'
import { FIG21_PATTERNS } from '../algo/generator'
import { parseCargoJson, exportCargos, type ImportedSet } from '../algo/io'
import Icon from './Icon.vue'

const fileInput = ref<HTMLInputElement | null>(null)
const imported = ref<ImportedSet[]>([])
const importPick = ref(0)

const presetIcon: Record<string, string> = { standard: 'boxes', mixed: 'grid', fig21: 'grid3', random: 'shuffle' }

function choose(key: PresetKey) {
  applyPreset(key)
  imported.value = []
  generateAndPlan()
}

function reroll() {
  if (state.preset === 'import') return
  rerollSeed()
  generateAndPlan()
}

function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  f.text().then((t) => {
    try {
      const sets = parseCargoJson(t)
      imported.value = sets
      importPick.value = 0
      state.preset = 'import'
      state.importName = f.name
      cargos.value = sets[0].cargos
      plan()
    } catch (err) {
      state.error = '导入失败：' + (err instanceof Error ? err.message : String(err))
    }
  })
  ;(e.target as HTMLInputElement).value = ''
}

function pickImported() {
  cargos.value = imported.value[importPick.value].cargos
  plan()
}

function downloadCargos() {
  const blob = new Blob([exportCargos(cargos.value)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `货物集合_${state.gen.seed}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

function onFig() {
  generateAndPlan()
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
  const w = cargos.value.reduce((s, c) => s + c.weight, 0)
  const v = cargos.value.reduce((s, c) => s + (c.length * c.width * c.height) / 1e9, 0)
  return { n: cargos.value.length, skus: skuRows.value.length, w, v }
})
const remaining = computed(() => result.value?.layout.remaining ?? [])
</script>

<template>
  <aside class="lp glass">
    <header class="hd">
      <div class="hd-t"><Icon name="package" :size="17" />场景与货物</div>
      <span class="seed num" title="随机种子：同一种子生成同一批货物、同一方案">#{{ state.preset === 'import' ? '导入' : state.gen.seed }}</span>
    </header>

    <!-- 中部可滚动：空间不足时只滚动这里，页脚按钮始终可见，不会溢出到下方卡片 -->
    <div class="body scroll">
    <div class="presets">
      <button v-for="p in PRESETS" :key="p.key" class="preset" :class="{ on: state.preset === p.key }" @click="choose(p.key)">
        <span class="pi"><Icon :name="presetIcon[p.key]" :size="18" /></span>
        <span class="pn">{{ p.name }}</span>
        <span class="pd">{{ p.desc }}</span>
      </button>
    </div>

    <div v-if="state.preset === 'fig21'" class="fig">
      <select v-model.number="state.gen.singleIndex" @change="onFig">
        <option v-for="(f, i) in FIG21_PATTERNS" :key="i" :value="i">{{ f.l }}×{{ f.w }} · 每层 {{ f.n }} 件</option>
      </select>
      <select v-model.number="state.gen.singleHeight" @change="onFig">
        <option v-for="h in [100, 150, 200, 250, 300]" :key="h" :value="h">高 {{ h }}</option>
      </select>
    </div>

    <button class="import" :class="{ on: state.preset === 'import' }" @click="fileInput?.click()">
      <Icon name="upload" :size="15" />
      <span v-if="state.preset === 'import'" class="ell">已导入 {{ state.importName }}</span>
      <span v-else>导入多盘分配结果（JSON）</span>
    </button>
    <input ref="fileInput" type="file" accept=".json,application/json" hidden @change="onFile" />
    <select v-if="imported.length > 1" v-model.number="importPick" class="pick" @change="pickImported">
      <option v-for="(s, i) in imported" :key="i" :value="i">第 {{ s.palletNo }} 盘 · {{ s.cargos.length }} 件</option>
    </select>

    <div class="stats">
      <div class="st"><b class="num">{{ totals.n }}</b><span>件货物</span></div>
      <div class="st"><b class="num">{{ totals.skus }}</b><span>种规格</span></div>
      <div class="st"><b class="num">{{ totals.w.toFixed(0) }}</b><span>kg</span></div>
      <div class="st"><b class="num">{{ totals.v.toFixed(2) }}</b><span>m³</span></div>
    </div>

    <div class="list">
      <div v-for="r in skuRows" :key="r.sku" class="sku">
        <i class="chip" :style="{ background: skuColors.get(r.sku) }" />
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
    </div>

    <footer class="ft">
      <button class="btn icon" title="导出货物集合 JSON" @click="downloadCargos"><Icon name="download" :size="16" /></button>
      <button class="btn" :class="{ on: state.paramsOpen }" @click="state.paramsOpen = !state.paramsOpen"><Icon name="sliders" :size="16" />参数</button>
      <button class="btn primary grow" :disabled="state.planning || state.preset === 'import'" @click="reroll"><Icon name="dice" :size="16" />换一批货物</button>
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
.body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 -8px;
  padding: 0 8px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.body > * {
  flex: none;
}
.hd {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hd-t {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 650;
}
.hd-t .ic {
  color: var(--accent);
}
.seed {
  font-size: 11.5px;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 8px;
  border-radius: 999px;
}
.presets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.preset {
  position: relative;
  text-align: left;
  padding: 11px 11px 10px;
  border-radius: 13px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition:
    border-color 0.18s,
    background 0.18s,
    transform 0.12s;
}
.preset:hover {
  border-color: rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.055);
}
.preset.on {
  border-color: rgba(46, 224, 240, 0.55);
  background: linear-gradient(155deg, rgba(46, 224, 240, 0.16), rgba(91, 140, 255, 0.06));
  box-shadow: 0 0 0 3px rgba(46, 224, 240, 0.08);
}
.pi {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  display: grid;
  place-items: center;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.06);
  margin-bottom: 4px;
}
.preset.on .pi {
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.pn {
  font-size: 13.5px;
  font-weight: 650;
}
.pd {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.4;
}
.fig {
  display: grid;
  grid-template-columns: 1fr 86px;
  gap: 8px;
}
.import {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 12px;
  border-radius: 11px;
  border: 1px dashed rgba(255, 255, 255, 0.16);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  transition:
    border-color 0.18s,
    color 0.18s;
}
.import:hover,
.import.on {
  border-color: rgba(46, 224, 240, 0.55);
  color: var(--text);
}
.ell {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.pick {
  width: 100%;
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 12px 4px 10px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.st {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.st + .st {
  border-left: 1px solid var(--line);
}
.st b {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.st span {
  font-size: 11px;
  color: var(--text-3);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 -6px;
  padding: 0 6px;
}
.sku {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  align-items: center;
  gap: 10px;
  padding: 7px 4px;
}
.chip {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35) inset;
}
.sk-d {
  font-size: 13px;
  font-weight: 550;
}
.sk-bar {
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  margin-top: 5px;
  overflow: hidden;
}
.sk-bar span {
  display: block;
  height: 100%;
  border-radius: 2px;
  opacity: 0.85;
}
.sk-r {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.sk-r b {
  font-size: 13px;
  font-weight: 650;
}
.sk-r span {
  font-size: 10.5px;
  color: var(--text-3);
}
.remain,
.error {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 12px;
}
.remain {
  color: #ffd27a;
  background: rgba(255, 194, 75, 0.1);
}
.error {
  color: var(--bad);
  background: var(--bad-soft);
}
.rl {
  color: var(--text-3);
  font-size: 11px;
  margin-top: 2px;
}
.ft {
  display: flex;
  gap: 8px;
  flex: none;
}

/* 屏幕较矮时（常见笔记本 1366×768、1920×1080@125% 缩放）自动紧凑 */
@media (max-height: 920px) {
  .preset {
    flex-direction: row;
    align-items: center;
    gap: 9px;
    padding: 9px 10px;
  }
  .pi {
    width: 28px;
    height: 28px;
    margin-bottom: 0;
  }
  .pd {
    display: none;
  }
}
@media (max-height: 760px) {
  .lp {
    padding: 14px;
    gap: 10px;
  }
  .body {
    gap: 10px;
  }
  .stats {
    padding: 8px 4px 6px;
  }
  .st b {
    font-size: 17px;
  }
  .sku {
    padding: 5px 4px;
  }
  .ft .btn {
    height: 36px;
  }
  .ft .btn.icon {
    width: 36px;
  }
}
.ft .btn {
  height: 40px;
}
.ft .btn.icon {
  width: 40px;
}
.ft .btn.on {
  border-color: rgba(46, 224, 240, 0.55);
  color: var(--accent);
}
.grow {
  flex: 1;
}
</style>
