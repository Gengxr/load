<script setup lang="ts">
import { computed } from 'vue'
import { exportPlan } from '../algo/io'
import { planCargos, result, skuColors, state } from '../store'
import { goto } from '../playback'
import { pct, signedPct } from '../format'
import BalanceChart from './BalanceChart.vue'
import LayerView from './LayerView.vue'
import Icon from './Icon.vue'

const r = computed(() => result.value)

interface Tile {
  key: string
  name: string
  value: string
  sub: string
  limit: string
  pass: boolean
  /** 进度条：fill 为数值位置，mark 为限值位置（0–1） */
  fill: number
  mark: number
  band?: [number, number]
  note: string
}

const tiles = computed<Tile[]>(() => {
  const res = r.value
  if (!res) return []
  const m = res.metrics
  const it = Object.fromEntries(m.items.map((x) => [x.key, x]))
  const c = state.cons
  const off = Math.max(Math.abs(m.cogOffsetRatio[0]), Math.abs(m.cogOffsetRatio[1]))
  const judged = m.layerUtilization.length > 1 ? m.layerUtilization.slice(0, -1) : m.layerUtilization
  const mean = judged.reduce((a, b) => a + b, 0) / Math.max(1, judged.length)
  const sec = res.timings.totalMs / 1000
  const low = (v: number, lim: number) => ({ fill: Math.min(1, v / (lim * 1.25)), mark: 0.8 })
  return [
    { key: 'cogHeight', name: '整托重心高度', value: pct(m.cogHeightRatio), sub: `${m.cogHeightTotal.toFixed(0)} mm`, limit: `≤ ${pct(c.cogHeightRatioMax, 0)} 总高`, pass: !!it.cogHeight?.pass, ...low(m.cogHeightRatio, c.cogHeightRatioMax), note: it.cogHeight?.note ?? '' },
    { key: 'cogOffset', name: '重心偏离中心', value: pct(off), sub: `X ${signedPct(m.cogOffsetRatio[0])} · Y ${signedPct(m.cogOffsetRatio[1])}`, limit: `≤ ±${pct(c.cogOffsetRatioMax, 0)}`, pass: !!it.cogOffset?.pass, ...low(off, c.cogOffsetRatioMax), note: it.cogOffset?.note ?? '' },
    { key: 'utilization', name: '货盘利用率', value: pct(m.minLayerUtilization), sub: `平均 ${pct(mean)}`, limit: `≥ ${pct(c.utilizationMin, 0)} · 逐层最低`, pass: !!it.utilization?.pass, fill: Math.min(1, m.minLayerUtilization), mark: c.utilizationMin, note: it.utilization?.note ?? '' },
    { key: 'envelope', name: '垛形外边界', value: `${m.stackSize[2]} mm`, sub: `${m.stackSize[0]}×${m.stackSize[1]}`, limit: `≤ ${c.footprintX}×${c.footprintY}×${c.maxStackHeight}`, pass: !!it.envelope?.pass, fill: Math.min(1, m.stackSize[2] / 1300), mark: c.maxStackHeight / 1300, band: [c.minStackHeight / 1300, c.maxStackHeight / 1300], note: it.envelope?.note ?? '' },
    { key: 'overhang', name: '码盘垛形误差', value: pct(Math.max(0, m.maxOverhangRatio)), sub: '上层最大外扩', limit: `≤ ${pct(c.overhangRatioMax, 0)}`, pass: !!it.overhang?.pass, ...low(Math.max(0, m.maxOverhangRatio), c.overhangRatioMax), note: '' },
    { key: 'time', name: '方案生成用时', value: sec < 1 ? `${res.timings.totalMs.toFixed(0)} ms` : `${sec.toFixed(2)} s`, sub: `${res.layout.placements.length} 件`, limit: '≤ 120 s / 垛', pass: !!it.time?.pass, fill: Math.max(0.012, Math.min(1, sec / 150)), mark: 0.8, note: '' },
  ]
})
const passCount = computed(() => tiles.value.filter((t) => t.pass).length)
const stability = computed(() => {
  const m = r.value?.metrics
  if (!m) return []
  return [
    { n: '最小支撑率', v: pct(m.minSupportRatio), ok: m.minSupportRatio >= state.cons.supportRatioMin - 1e-9 },
    { n: '碰撞 / 越界', v: `${m.collisions} / ${m.outOfBounds}`, ok: m.collisions + m.outOfBounds === 0 },
    { n: '层间压缝率', v: Number.isNaN(m.interlockRatio) ? '—' : pct(m.interlockRatio, 0), ok: null as boolean | null },
  ]
})

const bal = computed(() => r.value?.sequences.balance.summary)
const base = computed(() => r.value?.sequences.baseline.summary)
const reduce = computed(() => (bal.value && base.value && base.value.peakRatio > 0 ? 1 - bal.value.peakRatio / base.value.peakRatio : 0))

const colors = computed(() => r.value?.layout.placements.map((p) => skuColors.value.get(p.sku) ?? '#ccc') ?? [])
const curSeq = computed(() => (r.value ? (state.strategy === 'balance' ? r.value.sequences.balance : r.value.sequences.baseline) : null))
const seqOf = computed(() => {
  const res = r.value
  const s = curSeq.value
  if (!res || !s) return []
  const a = new Array(res.layout.placements.length).fill(0)
  s.order.forEach((pi, k) => (a[pi] = k))
  return a
})
const placedSet = computed(() => new Set(curSeq.value?.order.slice(0, state.step) ?? []))
const layerSel = computed(() => {
  const res = r.value
  const s = curSeq.value
  if (!res || !s) return 0
  if (state.selectedLayer !== null) return state.selectedLayer
  const k = Math.min(state.step, s.order.length - 1)
  return res.layout.placements[s.order[k]]?.layer ?? 0
})
const kindName: Record<string, string> = { pattern: '同规格图案', mixed: '混合装填', cap: '顶层收尾', free: '自由码放' }

function pickLayer(l: number) {
  state.selectedLayer = state.selectedLayer === l ? null : l
}

function download() {
  const res = r.value
  if (!res) return
  const blob = new Blob([exportPlan(res, planCargos.value, state.pallet, state.cons)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `码盘方案_${state.gen.seed}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <aside class="rp scroll">
    <template v-if="r">
      <section class="glass card">
        <header class="hd">
          <div class="hd-t">
            <Icon name="gauge" :size="17" />
            <span>技术指标自动报告</span>
          </div>
          <span class="score num" :class="{ ok: passCount === tiles.length }">{{ passCount }}/{{ tiles.length }} 达标</span>
          <button class="btn icon ghost close" title="收起 (M)" @click="state.metricsOpen = false"><Icon name="x" :size="16" /></button>
        </header>
        <div class="src">依据《技术要求》表 2-2，软件自动计算并判定</div>
        <div class="tiles">
          <div v-for="t in tiles" :key="t.key" class="tile" :class="{ bad: !t.pass }" :title="t.note">
            <div class="t-n">
              <span>{{ t.name }}</span>
              <i class="dot" :class="t.pass ? 'ok' : 'bad'" />
            </div>
            <div class="t-v num">{{ t.value }}</div>
            <div class="bar">
              <span v-if="t.band" class="band" :style="{ left: t.band[0] * 100 + '%', width: (t.band[1] - t.band[0]) * 100 + '%' }" />
              <span class="fill" :style="{ width: t.fill * 100 + '%' }" />
              <span class="mark" :style="{ left: t.mark * 100 + '%' }" />
            </div>
            <div class="t-l num"><span>{{ t.sub }}</span><span>{{ t.limit }}</span></div>
          </div>
        </div>
        <div class="stab">
          <div v-for="s in stability" :key="s.n" class="sb">
            <span>{{ s.n }}</span>
            <b class="num">{{ s.v }}</b>
            <i class="dot" :class="s.ok === null ? 'ref' : s.ok ? 'ok' : 'bad'" />
          </div>
        </div>
      </section>

      <section class="glass card">
        <header class="hd">
          <div class="hd-t">
            <Icon name="activity" :size="17" />
            <span>码放过程平衡性</span>
          </div>
          <span class="aside">每放一件后的重心偏心率</span>
        </header>
        <div class="vs">
          <div class="vs-c o">
            <span>本方案 · 过程峰值</span>
            <b class="num">{{ pct(bal!.peakRatio) }}</b>
          </div>
          <div class="vs-mid">
            <b class="num">↓{{ (reduce * 100).toFixed(0) }}%</b>
          </div>
          <div class="vs-c b">
            <span>对照 · 逐层行扫描</span>
            <b class="num">{{ pct(base!.peakRatio) }}</b>
          </div>
        </div>
        <BalanceChart
          :ours="r.sequences.balance.steps.ratio"
          :base="r.sequences.baseline.steps.ratio"
          :k="state.step"
          :tol="state.cons.cogOffsetRatioMax"
          :height="112"
          @seek="goto"
        />
        <div class="sum num">
          <span>超限步数 <b>{{ bal!.exceedSteps }}</b> / <em>{{ base!.exceedSteps }}</em></span>
          <span>平均偏心 <b>{{ pct(bal!.meanRatio) }}</b> / <em>{{ pct(base!.meanRatio) }}</em></span>
          <span>换层 <b>{{ bal!.layerJumps }}</b> 次</span>
        </div>
        <button class="dblf num" title="与公认的经典装箱算法 DBLF 做整体对比（位置和顺序都由它生成）" @click="((state.compareBase = 'dblf'), (state.mode = 'compare'))">
          <span>经典算法 DBLF</span>
          <span>过程峰值 <em>{{ pct(r.dblf.sequence.summary.peakRatio) }}</em></span>
          <span>最低层利用率 <em>{{ pct(r.dblf.metrics.minLayerUtilization, 0) }}</em></span>
          <span class="go">对比 ›</span>
        </button>
      </section>

      <section class="glass card">
        <header class="hd">
          <div class="hd-t">
            <Icon name="layers" :size="17" />
            <span>分层方案</span>
          </div>
          <span class="aside num">{{ r.layout.layers.length }} 层 · {{ r.layout.strategy === 'layered' ? '层构造' : '自由码放' }}</span>
          <button class="btn icon ghost dl" title="导出方案 JSON" @click="download"><Icon name="download" :size="15" /></button>
        </header>
        <div class="lwrap">
          <LayerView
            :placements="r.layout.placements"
            :layer="layerSel"
            :colors="colors"
            :seq-of="seqOf"
            :fx="state.cons.footprintX"
            :fy="state.cons.footprintY"
            :placed-set="placedSet"
            :size="140"
          />
          <div class="llist">
            <button
              v-for="l in [...r.layout.layers].reverse()"
              :key="l.index"
              class="lrow"
              :class="{ on: layerSel === l.index, pinned: state.selectedLayer === l.index }"
              @click="pickLayer(l.index)"
            >
              <span class="ln num">L{{ l.index + 1 }}</span>
              <span class="lk">{{ kindName[l.kind] }}</span>
              <span class="lu"><i :style="{ width: Math.min(100, l.utilization * 100) + '%' }" :class="{ low: l.utilization < state.cons.utilizationMin && l.index < r.layout.layers.length - 1 }" /></span>
              <span class="lp num">{{ pct(l.utilization, 0) }}</span>
            </button>
          </div>
        </div>
      </section>
    </template>
  </aside>
</template>

<style scoped>
.rp {
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: none;
}
.rp::-webkit-scrollbar {
  display: none;
}
.card {
  padding: 16px 16px 14px;
  flex: none;
}
.hd {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
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
.aside {
  margin-left: auto;
  font-size: 11.5px;
  color: var(--text-3);
}
.score {
  margin-left: auto;
  font-size: 12px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--warn);
  background: rgba(255, 194, 75, 0.12);
}
.score.ok {
  color: var(--ok);
  background: var(--ok-soft);
}
.close {
  width: 28px;
  height: 28px;
  margin-right: -6px;
}
.src {
  font-size: 11.5px;
  color: var(--text-3);
  margin: -4px 0 12px;
}
.tiles {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
}
.tile {
  min-width: 0;
  padding: 10px 11px 9px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
.tile.bad {
  border-color: rgba(255, 107, 107, 0.35);
  background: rgba(255, 107, 107, 0.06);
}
.t-n {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--text-2);
}
.dot.ok {
  background: var(--ok);
  box-shadow: 0 0 8px rgba(61, 220, 151, 0.6);
}
.dot.bad {
  background: var(--bad);
  box-shadow: 0 0 8px rgba(255, 107, 107, 0.6);
}
.dot.ref {
  background: var(--text-3);
}
.t-v {
  font-size: 21px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.25;
  margin-top: 3px;
}
.t-s {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.bar {
  position: relative;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  margin: 8px 0 5px;
}
.fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 3px;
  background: linear-gradient(90deg, #2ee0f0, #5b8cff);
}
.tile.bad .fill {
  background: var(--bad);
}
.band {
  position: absolute;
  top: -2px;
  bottom: -2px;
  border-radius: 3px;
  background: rgba(61, 220, 151, 0.18);
}
.mark {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  margin-left: -1px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.55);
}
.t-l {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}
.t-l span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.stab {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 10px;
}
.sb {
  min-width: 0;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  align-items: center;
  padding: 7px 9px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.025);
}
.sb span {
  font-size: 10.5px;
  color: var(--text-3);
  grid-column: 1 / span 2;
}
.sb b {
  font-size: 13.5px;
  font-weight: 650;
}
.vs {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}
.vs-c {
  display: flex;
  flex-direction: column;
  padding: 9px 12px;
  border-radius: 12px;
}
.vs-c span {
  font-size: 11px;
  color: var(--text-2);
}
.vs-c b {
  font-size: 26px;
  font-weight: 750;
  line-height: 1.15;
  letter-spacing: -0.02em;
}
.vs-c.o {
  background: linear-gradient(135deg, rgba(46, 224, 240, 0.16), rgba(46, 224, 240, 0.04));
}
.vs-c.o b {
  color: var(--accent);
}
.vs-c.b {
  background: linear-gradient(225deg, rgba(255, 113, 137, 0.16), rgba(255, 113, 137, 0.04));
  text-align: right;
}
.vs-c.b b {
  color: var(--base);
}
.vs-mid b {
  font-size: 13px;
  color: var(--ok);
  background: var(--ok-soft);
  padding: 4px 8px;
  border-radius: 999px;
}
.sum {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-3);
  margin-top: 4px;
}
.sum b {
  color: var(--accent);
  font-weight: 650;
}
.sum em {
  font-style: normal;
  color: var(--base);
  font-weight: 650;
}
.lwrap {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 12px;
  align-items: start;
}
.llist {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 140px;
  overflow: auto;
  scrollbar-width: none;
}
.lrow {
  display: grid;
  grid-template-columns: 26px 1fr 44px 30px;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 7px;
  border: none;
  border-radius: 7px;
  background: transparent;
  font-size: 11.5px;
  color: var(--text-2);
  text-align: left;
  flex: none;
}
.lrow:hover {
  background: rgba(255, 255, 255, 0.05);
}
.lrow.on {
  background: rgba(46, 224, 240, 0.1);
  color: var(--text);
}
.lrow.pinned {
  box-shadow: 0 0 0 1px rgba(46, 224, 240, 0.5) inset;
}
.ln {
  font-weight: 650;
}
.lk {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-3);
}
.lu {
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.lu i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #2ee0f0, #5b8cff);
}
.lu i.low {
  background: var(--warn);
}
.lp {
  text-align: right;
}
.dl {
  width: 28px;
  height: 28px;
  margin: -4px -6px -4px 0;
}
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-3);
}
.dblf {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  margin-top: 10px;
  padding: 7px 10px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
}
.dblf:hover {
  border-color: rgba(255, 113, 137, 0.4);
  background: var(--base-soft);
}
.dblf span:first-child {
  color: var(--text-2);
  font-weight: 600;
}
.dblf em {
  font-style: normal;
  font-weight: 600;
  color: var(--base);
}
.dblf .go {
  color: var(--accent);
}
</style>
