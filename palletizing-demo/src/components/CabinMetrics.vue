<script setup lang="ts">
import { computed } from 'vue'
import { cabin, loading, loadingBest, order, restoreLoading, setCabinMode, state, units } from '../store'
import { loadingPayload } from '../algo/io'
import { download } from '../persist'
import { pct, signedPct } from '../format'
import CabinDeck from './CabinDeck.vue'
import Icon from './Icon.vue'

/** 舱内装载 · 指标抽屉：重心误差（验收）、配载俯视图、过程重心校验、三种重心、求解信息 */
const lp = computed(() => loading.value!)
const cfg = computed(() => cabin.value)
const axes = computed(() => {
  const m = lp.value.metrics
  const b = lp.value.baseline?.metrics
  return [
    { k: '长向 X', v: m.errX, tol: cfg.value.tolX, base: b?.errX ?? null, mm: m.cargoCog.x - cfg.value.targetCog.x },
    { k: '宽向 Y', v: m.errY, tol: cfg.value.tolY, base: b?.errY ?? null, mm: m.cargoCog.y - cfg.value.targetCog.y },
  ]
})
const tracks = computed(() => {
  const order = ['load', ...cfg.value.drops.map((d) => d.id), 'unload']
  return order
    .filter((id) => lp.value.tracks[id])
    .map((id) => {
      const t = lp.value.tracks[id]
      const b = lp.value.baseline?.tracks[id]
      return { id, name: t.name.replace(/（.*/, ''), peak: t.peak, ok: t.ok, base: b?.peak ?? null, dev: Math.abs(t.peakDevX) / Math.abs(t.peakDevX >= 0 ? t.env[1] : t.env[0]) >= Math.abs(t.peakDevY) / t.envLateral ? `X ${signedPct(t.peakDevX)}` : `Y ${signedPct(t.peakDevY)}` }
    })
})
const allOk = computed(() => lp.value.metrics.pass && tracks.value.every((t) => t.ok))
const eff = computed(() => {
  const s = lp.value.solver
  const n = lp.value.assignments.length
  const best = loadingBest.value?.solver ?? s
  const perSec = n / Math.max(1e-4, best.elapsedMs / 1000)
  return { n, ms: best.elapsedMs, perSec, ok: perSec >= 4, method: best.method, evaluated: best.evaluated, space: best.space, optimal: best.optimal }
})
const manual = computed(() => lp.value.solver.method === 'manual')
function exportPlan() {
  download(`装载方案_${cfg.value.model}_${order.value?.id ?? ''}.json`, loadingPayload(order.value?.id ?? 'DEMO', cfg.value, units.value, lp.value))
}
const fmt = (v: number) => (v < 10 ? v.toFixed(2) : v.toFixed(0))
</script>

<template>
  <aside v-if="loading" class="cm scroll">
    <section class="card glass">
      <div class="ph">
        <Icon name="gauge" :size="16" />装载后货物重心
        <span class="pill" :class="lp.metrics.pass ? 'ok' : 'bad'">{{ lp.metrics.pass ? '达标' : '超差' }}</span>
        <button class="btn icon ghost sm close" data-tip="收起" @click="state.cabinPanel = false"><Icon name="x" :size="16" /></button>
      </div>
      <div class="axes">
        <div v-for="a in axes" :key="a.k" class="axis">
          <div class="al">
            <span>{{ a.k }}</span>
            <b class="num" :class="Math.abs(a.v) <= a.tol ? 'ok' : 'bad'">{{ signedPct(a.v, 2) }}</b>
          </div>
          <div class="gauge">
            <i class="zone" />
            <i class="mid" />
            <i v-if="a.base !== null" class="mk base" :style="{ left: 50 + Math.max(-50, Math.min(50, (a.base / a.tol) * 33.3)) + '%' }" />
            <i class="mk" :class="{ bad: Math.abs(a.v) > a.tol }" :style="{ left: 50 + Math.max(-50, Math.min(50, (a.v / a.tol) * 33.3)) + '%' }" />
          </div>
          <div class="as num">
            <span>偏 {{ a.mm >= 0 ? '+' : '−' }}{{ Math.abs(a.mm).toFixed(0) }} mm · 允许 ±{{ pct(a.tol, 0) }}</span>
            <span v-if="a.base !== null" class="bs">按顺序装 {{ signedPct(a.base) }}</span>
          </div>
        </div>
      </div>
      <p class="src">表 2-2 第 6 项：货物合成重心相对数模理论重心，长、宽方向 ≤ ±10%</p>
      <div v-if="manual" class="manual">
        <Icon name="click" :size="14" />已人工调整（最优方案为 {{ signedPct(loadingBest!.metrics.errX, 2) }} / {{ signedPct(loadingBest!.metrics.errY, 2) }}）
        <button class="btn sm" @click="restoreLoading"><Icon name="undo" :size="13" />恢复最优</button>
      </div>
      <div v-for="v in lp.metrics.violations" :key="v.message" class="viol"><Icon name="alert" :size="13" />{{ v.message }}</div>
    </section>

    <section class="card glass">
      <div class="ph"><Icon name="grid" :size="16" />配载俯视图<span class="aside">点选托盘，再点货位可移动 / 互换</span></div>
      <CabinDeck class="deckv" />
      <div class="legend">
        <span><i class="lg t" />理论重心</span>
        <span><i class="lg c" />货物重心</span>
        <span><i class="lg s" />整机重心</span>
        <span><i class="lg z" />允许区 ±10%</span>
      </div>
    </section>

    <section class="card glass">
      <div class="ph"><Icon name="activity" :size="16" />过程重心校验<span class="pill" :class="allOk ? 'ok' : 'bad'">{{ allOk ? '全程在包络内' : '有超限' }}</span></div>
      <div class="trs">
        <button v-for="t in tracks" :key="t.id" class="tr" :class="{ on: state.cabinMode === t.id }" @click="setCabinMode(t.id)">
          <span class="tn">{{ t.name }}</span>
          <span class="tb"><i :class="{ bad: !t.ok }" :style="{ width: Math.min(100, t.peak * 100) + '%' }" /><em v-if="t.base !== null" :style="{ left: Math.min(100, t.base * 100) + '%' }" /></span>
          <b class="num" :class="t.ok ? 'ok' : 'bad'">{{ pct(t.peak, 0) }}</b>
          <span class="td num">{{ t.dev }}</span>
        </button>
      </div>
      <p class="src">整机重心（含空机）沿作业路径逐点校核，数值为峰值占包络的比例；竖线为"按出库顺序依次装入"的对照。</p>
    </section>

    <section class="card glass">
      <div class="ph">
        <Icon name="zap" :size="16" />求解与输出
        <button class="btn icon ghost sm close" data-tip="导出装载方案 JSON" @click="exportPlan"><Icon name="download" :size="15" /></button>
      </div>
      <div class="kvs">
        <div><span>方案生成效率</span><b class="num" :class="eff.ok ? 'ok' : 'bad'">{{ eff.n }} 盘 / {{ fmt(eff.ms) }} ms</b></div>
        <div><span>折合</span><b class="num">{{ Math.round(eff.perSec).toLocaleString() }} 盘/秒 <em>（要求 ≥ 4）</em></b></div>
        <div>
          <span>求解方式</span>
          <b class="num">{{ eff.method === 'enumeration' ? `全枚举 ${eff.evaluated.toLocaleString()} 种 · 最优` : `模拟退火 · 评估 ${eff.evaluated.toLocaleString()} 次` }}</b>
        </div>
      </div>
      <table class="cogs num">
        <thead>
          <tr><th>重心</th><th>X mm</th><th>Y mm</th><th>重量 kg</th></tr>
        </thead>
        <tbody>
          <tr class="hl"><td><i class="lg c" />货物合成<em>验收</em></td><td>{{ lp.metrics.cargoCog.x.toFixed(0) }}</td><td>{{ lp.metrics.cargoCog.y.toFixed(0) }}</td><td>{{ lp.metrics.cargoWeight.toFixed(0) }}</td></tr>
          <tr v-for="c in lp.metrics.cabinCogs.length > 1 ? lp.metrics.cabinCogs : []" :key="c.cabin">
            <td>　{{ c.name }}</td><td>{{ c.cog ? c.cog.x.toFixed(0) : '—' }}</td><td>{{ c.cog ? c.cog.y.toFixed(0) : '—' }}</td><td :class="{ bad: !c.ok }">{{ c.weight.toFixed(0) }} / {{ c.limit }}</td>
          </tr>
          <tr><td><i class="lg s" />含空机系统</td><td>{{ lp.metrics.systemCog.x.toFixed(0) }}</td><td>{{ lp.metrics.systemCog.y.toFixed(0) }}</td><td>{{ lp.metrics.totalWeight.toFixed(0) }}</td></tr>
          <tr><td><i class="lg t" />理论重心</td><td>{{ cfg.targetCog.x }}</td><td>{{ cfg.targetCog.y }}</td><td>—</td></tr>
        </tbody>
      </table>
    </section>
  </aside>
</template>

<style scoped>
.cm {
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
.ph .pill {
  margin-left: 2px;
}
.close {
  margin-left: auto;
  margin-right: -6px;
}
.axes {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 14px;
}
.al {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--text-2);
}
.al b {
  font-size: 24px;
  font-weight: 750;
  letter-spacing: -0.02em;
}
.ok {
  color: var(--ok);
}
.bad {
  color: var(--bad);
}
.gauge {
  position: relative;
  height: 8px;
  margin: 6px 0 6px;
  border-radius: 4px;
  background: rgba(255, 107, 107, 0.16);
}
.zone {
  position: absolute;
  left: 16.7%;
  right: 16.7%;
  top: 0;
  bottom: 0;
  background: rgba(61, 220, 151, 0.3);
}
.mid {
  position: absolute;
  left: 50%;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: rgba(255, 255, 255, 0.5);
}
.mk {
  position: absolute;
  top: -4px;
  width: 4px;
  height: 16px;
  margin-left: -2px;
  border-radius: 2px;
  background: #f2fdff;
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.7);
  transition: left 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.mk.bad {
  background: var(--bad);
}
.mk.base {
  width: 2px;
  margin-left: -1px;
  background: var(--base);
  box-shadow: none;
  opacity: 0.85;
}
.as {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-3);
}
.bs {
  color: var(--base);
}
.src {
  margin: 12px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-3);
}
.manual {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  color: var(--warn);
  background: rgba(255, 194, 75, 0.08);
  border: 1px solid rgba(255, 194, 75, 0.22);
}
.manual .btn {
  margin-left: auto;
  flex: none;
}
.viol {
  display: flex;
  gap: 7px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--bad);
}
.deckv {
  margin: 10px -4px 4px;
  width: calc(100% + 8px);
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  font-size: 11px;
  color: var(--text-3);
}
.lg {
  display: inline-block;
  width: 9px;
  height: 9px;
  margin-right: 6px;
  vertical-align: -1px;
}
.lg.t {
  border-radius: 50%;
  border: 1.5px solid #fff;
}
.lg.c {
  border-radius: 50%;
  background: var(--cog);
}
.lg.s {
  background: var(--accent);
  transform: rotate(45deg) scale(0.85);
}
.lg.z {
  border: 1.5px dashed var(--ok);
  border-radius: 2px;
}
.trs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.tr {
  display: grid;
  grid-template-columns: 44px 1fr 42px 64px;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 8px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  text-align: left;
}
.tr:hover {
  background: rgba(255, 255, 255, 0.04);
}
.tr.on {
  border-color: rgba(46, 224, 240, 0.4);
  background: var(--accent-soft);
  color: var(--text);
}
.tb {
  position: relative;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.07);
}
.tb i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #2ee0f0, #5b8cff);
}
.tb i.bad {
  background: var(--bad);
}
.tb em {
  position: absolute;
  top: -3px;
  width: 2px;
  height: 12px;
  margin-left: -1px;
  background: var(--base);
  border-radius: 1px;
}
.tr b {
  text-align: right;
  font-size: 13px;
}
.td {
  text-align: right;
  font-size: 11px;
  color: var(--text-3);
}
.kvs {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  font-size: 12.5px;
}
.kvs div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}
.kvs span {
  color: var(--text-3);
  flex: none;
}
.kvs b {
  font-weight: 600;
  text-align: right;
}
.kvs em {
  font-style: normal;
  font-weight: 400;
  color: var(--text-3);
}
.cogs {
  width: 100%;
  margin-top: 14px;
  border-collapse: collapse;
  font-size: 12px;
}
.cogs th {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
  text-align: right;
  padding: 0 0 6px;
}
.cogs th:first-child,
.cogs td:first-child {
  text-align: left;
}
.cogs td {
  text-align: right;
  padding: 6px 0;
  border-top: 1px solid var(--line);
}
.cogs tr.hl td {
  font-weight: 650;
}
.cogs em {
  font-style: normal;
  font-size: 10px;
  margin-left: 6px;
  padding: 1px 5px;
  border-radius: 5px;
  color: var(--ok);
  background: var(--ok-soft);
}
.cogs td.bad {
  color: var(--bad);
}
</style>
