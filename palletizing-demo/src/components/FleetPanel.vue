<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { allocation, pallets, palletPass, runInfo, skuColors, state, summary } from '../store'
import { selectPallet } from '../playback'
import { pct } from '../format'
import Icon from './Icon.vue'

/** 出库分盘 · 分配明细：分配过程摘要、各盘卡片、规格 × 货盘分配矩阵 */
const listEl = ref<HTMLElement | null>(null)

const cards = computed(() =>
  pallets.value.map((p, i) => {
    const mt = p.result.metrics
    const comp = new Map<string, number>()
    for (const pl of p.result.layout.placements) comp.set(pl.sku, (comp.get(pl.sku) ?? 0) + pl.dx * pl.dy * pl.dz)
    const total = [...comp.values()].reduce((a, b) => a + b, 0) || 1
    const util = mt.layerUtilization.length > 1 ? mt.layerUtilization.slice(0, -1) : mt.layerUtilization
    return {
      i,
      id: p.id,
      ok: palletPass(p),
      n: p.result.layout.placements.length,
      layers: p.result.layout.layers.length,
      weight: mt.grossWeight,
      height: mt.stackSize[2],
      util: util.length ? Math.min(...util) : 0,
      off: Math.max(Math.abs(mt.cogOffsetRatio[0]), Math.abs(mt.cogOffsetRatio[1])),
      remaining: p.result.layout.remaining.length,
      failed: mt.items.filter((m) => m.pass === false).map((m) => m.name),
      comp: [...comp.entries()].sort((a, b) => b[1] - a[1]).map(([sku, v]) => ({ sku, f: v / total, color: skuColors.value.get(sku) ?? '#cbd5e1' })),
    }
  }),
)

const matrix = computed(() => {
  const skus = new Map<string, { sku: string; dims: string; total: number; row: number[] }>()
  pallets.value.forEach((p, k) => {
    for (const c of p.cargos) {
      let r = skus.get(c.sku)
      if (!r) skus.set(c.sku, (r = { sku: c.sku, dims: `${c.length}×${c.width}×${c.height}`, total: 0, row: pallets.value.map(() => 0) }))
      r.row[k]++
      r.total++
    }
  })
  const rows = [...skus.values()].sort((a, b) => b.total - a.total)
  return { rows, max: Math.max(1, ...rows.flatMap((r) => r.row)) }
})

function open(i: number) {
  selectPallet(i)
  state.ws = 'pallet'
}
function focus(i: number) {
  state.focus = state.focus === i ? -1 : i
}
watch(
  () => state.focus,
  (i) => {
    if (i < 0 || state.fleetTab !== 'pallets') return
    nextTick(() => listEl.value?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  },
)
const st = computed(() => allocation.value?.stats)
</script>

<template>
  <aside class="fp scroll">
    <section v-if="st && summary" class="card glass">
      <div class="ph">
        <Icon name="split" :size="16" />分配过程
        <button class="btn icon ghost sm close" data-tip="收起" @click="state.fleetOpen = false"><Icon name="x" :size="16" /></button>
      </div>
      <ol class="flow">
        <li>
          <span class="n">1</span>
          <div>
            <b>层单元分解</b>
            <p class="num">同规格凑整层 <em>{{ st.fullLayers }}</em> 个，零头拼混合层 <em>{{ st.mixedLayers }}</em> 个，余 <em>{{ st.looseCount }}</em> 件散件</p>
          </div>
        </li>
        <li>
          <span class="n">2</span>
          <div>
            <b>多路划分 + 局部搜索</b>
            <p class="num">
              体积下界 <em>{{ st.lowerBound }}</em> 盘，实际 <em>{{ summary.pallets }}</em> 盘；改进 <em>{{ st.moves }}</em> 次，重量极差
              {{ st.weightSpread[0].toFixed(0) }} → <em>{{ st.weightSpread[1].toFixed(0) }}</em> kg
            </p>
          </div>
        </li>
        <li>
          <span class="n">3</span>
          <div>
            <b>逐盘码放验证</b>
            <p class="num">
              <template v-if="runInfo">{{ runInfo.rounds }} 轮并行求解，回流 <em>{{ runInfo.rerouted }}</em> 件，未放入 <em :class="{ bad: runInfo.unplaced > 0 }">{{ runInfo.unplaced }}</em> 件</template>
            </p>
          </div>
        </li>
      </ol>
    </section>

    <section class="card glass grow">
      <div class="tabs seg">
        <button :class="{ on: state.fleetTab === 'pallets' }" @click="state.fleetTab = 'pallets'"><Icon name="boxes" :size="14" />各盘结果</button>
        <button :class="{ on: state.fleetTab === 'matrix' }" @click="state.fleetTab = 'matrix'"><Icon name="grid3" :size="14" />分配矩阵</button>
      </div>

      <div v-if="state.fleetTab === 'pallets'" ref="listEl" class="cards">
        <div v-for="c in cards" :key="c.id" class="pc" :class="{ on: state.focus === c.i, bad: !c.ok }" :data-i="c.i" @click="focus(c.i)" @dblclick="open(c.i)">
          <div class="r1">
            <span class="pid num">{{ c.id }}</span>
            <span class="pill" :class="c.ok ? 'ok' : 'bad'"><Icon :name="c.ok ? 'check' : 'alert'" :size="11" :stroke="2.6" />{{ c.ok ? '全部达标' : c.remaining ? `${c.remaining} 件未放入` : `${c.failed.length} 项未达标` }}</span>
            <button class="enter" data-tip="进入码放过程" @click.stop="open(c.i)"><Icon name="arrowRight" :size="15" /></button>
          </div>
          <div class="comp">
            <i v-for="s in c.comp" :key="s.sku" :style="{ flex: s.f, background: s.color }" :title="s.sku" />
          </div>
          <div class="kv num">
            <div><b>{{ c.n }}</b><span>件 · {{ c.layers }} 层</span></div>
            <div><b>{{ c.weight.toFixed(0) }}</b><span>kg</span></div>
            <div><b>{{ c.height }}</b><span>mm</span></div>
            <div><b>{{ pct(c.util, 0) }}</b><span>利用率</span></div>
            <div><b>{{ pct(c.off) }}</b><span>偏心</span></div>
          </div>
          <div v-if="c.failed.length" class="fail">未达标：{{ c.failed.join('、') }}</div>
        </div>
      </div>

      <div v-else class="mx">
        <table>
          <thead>
            <tr>
              <th>规格 mm</th>
              <th v-for="p in pallets" :key="p.id" class="num" :class="{ on: state.focus === p.no - 1 }" @click="focus(p.no - 1)">{{ p.id }}</th>
              <th class="num">合计</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in matrix.rows" :key="r.sku">
              <td class="dim num"><i :style="{ background: skuColors.get(r.sku) }" />{{ r.dims }}</td>
              <td v-for="(v, k) in r.row" :key="k" class="cell num" :class="{ on: state.focus === k }">
                <span v-if="v" :style="{ background: skuColors.get(r.sku), opacity: 0.25 + 0.75 * (v / matrix.max) }" />
                <b v-if="v">{{ v }}</b>
              </td>
              <td class="num tot">{{ r.total }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>件数</td>
              <td v-for="p in pallets" :key="p.id" class="num">{{ p.cargos.length }}</td>
              <td class="num tot">{{ summary?.boxes }}</td>
            </tr>
          </tfoot>
        </table>
        <p class="hint">每一行是一种规格，每一列是一个货盘；颜色越深表示该规格在这个盘上越多。同规格被集中到少数货盘，便于凑成整层。</p>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.fp {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  padding-right: 2px;
}
.card {
  padding: 15px 16px;
  flex: none;
}
.card.grow {
  flex: 1 0 auto;
}
.close {
  margin-left: auto;
  margin-right: -6px;
}
.flow {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 11px;
}
.flow li {
  display: flex;
  gap: 11px;
}
.flow .n {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-soft);
}
.flow b {
  font-size: 13px;
}
.flow p {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-3);
}
.flow em {
  font-style: normal;
  font-weight: 650;
  color: var(--text);
}
.flow em.bad {
  color: var(--bad);
}
.tabs {
  display: flex;
  width: 100%;
  margin-bottom: 12px;
}
.tabs button {
  flex: 1;
  height: 30px;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pc {
  padding: 11px 12px 10px;
  border-radius: 13px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.025);
  cursor: pointer;
  transition:
    border-color 0.16s,
    background 0.16s;
}
.pc:hover {
  border-color: rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.045);
}
.pc.on {
  border-color: rgba(46, 224, 240, 0.6);
  background: linear-gradient(155deg, rgba(46, 224, 240, 0.12), rgba(91, 140, 255, 0.04));
  box-shadow: 0 0 0 3px rgba(46, 224, 240, 0.07);
}
.r1 {
  display: flex;
  align-items: center;
  gap: 9px;
}
.pid {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.enter {
  margin-left: auto;
  width: 28px;
  height: 28px;
  border-radius: 9px;
  border: 1px solid var(--line-2);
  background: rgba(255, 255, 255, 0.05);
  color: var(--text-2);
  display: grid;
  place-items: center;
  padding: 0;
  transition: all 0.15s;
}
.enter:hover {
  color: #021218;
  border-color: transparent;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.comp {
  display: flex;
  gap: 2px;
  height: 6px;
  margin: 10px 0 9px;
  border-radius: 3px;
  overflow: hidden;
}
.comp i {
  min-width: 2px;
  border-radius: 1px;
}
.kv {
  display: grid;
  grid-template-columns: 1.25fr 1fr 1fr 1fr 1fr;
  gap: 4px;
}
.kv div {
  min-width: 0;
  line-height: 1.25;
}
.kv b {
  display: block;
  font-size: 13.5px;
  font-weight: 650;
}
.kv span {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}
.fail {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--warn);
}
.mx {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 3px;
  font-size: 12px;
}
th {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  padding: 2px 0 6px;
  text-align: center;
  cursor: pointer;
}
th:first-child {
  text-align: left;
  cursor: default;
}
th.on {
  color: var(--accent);
}
.dim {
  white-space: nowrap;
  padding-right: 6px;
  font-size: 11.5px;
}
.dim i {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 3px;
  margin-right: 7px;
}
.cell {
  position: relative;
  min-width: 26px;
  height: 26px;
  text-align: center;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.025);
  overflow: hidden;
}
.cell.on {
  box-shadow: 0 0 0 1px rgba(46, 224, 240, 0.6) inset;
}
.cell span {
  position: absolute;
  inset: 0;
}
.cell b {
  position: relative;
  font-size: 11.5px;
  font-weight: 650;
  color: #0a1220;
}
.tot {
  text-align: right;
  color: var(--text-2);
  font-weight: 600;
  padding-left: 6px;
}
tfoot td {
  padding-top: 6px;
  text-align: center;
  color: var(--text-3);
  font-size: 11.5px;
}
tfoot td:first-child {
  text-align: left;
}
.hint {
  margin: 12px 0 0;
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--text-3);
}
</style>
