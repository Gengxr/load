<script setup lang="ts">
import { computed } from 'vue'
import { result, state } from '../store'
import { goto } from '../playback'
import { pct } from '../format'
import { ACCENT, BASELINE } from '../viz/palette'
import ViewerPanel from './ViewerPanel.vue'
import BalanceChart from './BalanceChart.vue'
import Timeline from './Timeline.vue'

const r = computed(() => result.value)
const bal = computed(() => r.value?.sequences.balance.summary)
const base = computed(() => r.value?.sequences.baseline.summary)
const tolHalf = computed(() => state.cons.cogOffsetRatioMax * (state.cons.cogOffsetBase === 'pallet' ? state.pallet.length : state.cons.footprintX))

/** 两个雷达用同一比例尺，才能公平对比 */
const range = computed(() => {
  const res = r.value
  if (!res) return undefined
  let m = 0
  for (const s of [res.sequences.balance, res.sequences.baseline])
    for (let i = 0; i < s.steps.cogX.length; i++)
      m = Math.max(m, Math.abs(s.steps.cogX[i] - state.cons.footprintX / 2), Math.abs(s.steps.cogY[i] - state.cons.footprintY / 2))
  return Math.min(640, Math.max(tolHalf.value * 1.9, m * 1.18))
})

const cards = computed(() => {
  const a = bal.value
  const b = base.value
  if (!a || !b) return []
  const red = (x: number, y: number) => (y > 0 ? Math.round((1 - x / y) * 100) : 0)
  return [
    { n: '过程峰值偏心', o: pct(a.peakRatio), b: pct(b.peakRatio), d: red(a.peakRatio, b.peakRatio), note: '全过程中系统重心偏离几何中心的最大比例' },
    { n: '过程平均偏心', o: pct(a.meanRatio), b: pct(b.meanRatio), d: red(a.meanRatio, b.meanRatio), note: '每放一件后偏心率的平均值' },
    { n: '峰值偏载力矩', o: a.peakMoment.toFixed(0) + ' N·m', b: b.peakMoment.toFixed(0) + ' N·m', d: red(a.peakMoment, b.peakMoment), note: '重心偏移 × 总重，作用在称重台 / 托盘上的偏心力矩' },
    { n: '超出 ±10% 的步数', o: String(a.exceedSteps), b: String(b.exceedSteps), d: b.exceedSteps ? red(a.exceedSteps, b.exceedSteps) : 0, note: '中间状态超出终态容差的次数' },
  ]
})
const marks = computed(() => {
  const res = r.value
  if (!res) return []
  const last = new Map<number, number>()
  res.sequences.balance.order.forEach((pi, k) => last.set(res.layout.placements[pi].layer, k + 1))
  return [...last.values()]
})
</script>

<template>
  <main class="cmp">
    <div class="strip">
      <div class="lead">
        <b>同一批货物、同一个码放布局</b>，只改变<b class="hl">码放顺序</b>：左右两个工位同步码放，观察重心轨迹
      </div>
      <div class="legend">
        <span><i :style="{ background: BASELINE }" />传统做法：逐层、由远及近、从左到右</span>
        <span><i :style="{ background: ACCENT }" />本方案：平衡优先的动态顺序（束搜索）</span>
      </div>
    </div>
    <div class="views">
      <ViewerPanel class="v" strategy="layer-row" hud="compare" compact :show-conveyor="false" :accent="BASELINE" :radar-range="range" />
      <ViewerPanel class="v" strategy="balance" hud="compare" compact :show-conveyor="false" :accent="ACCENT" :radar-range="range" />
    </div>
    <div v-if="r" class="bottom">
      <div class="chart panel">
        <h3 class="section-title">过程偏心率曲线<span class="tag">点击曲线可跳转到该步</span></h3>
        <BalanceChart :ours="r.sequences.balance.steps.ratio" :base="r.sequences.baseline.steps.ratio" :k="state.step" :tol="state.cons.cogOffsetRatioMax" :height="128" :marks="marks" @seek="goto" />
      </div>
      <div class="cards">
        <div v-for="c in cards" :key="c.n" class="card panel" :title="c.note">
          <div class="cn">{{ c.n }}</div>
          <div class="cv num">
            <span class="b">{{ c.b }}</span>
            <span class="arrow">→</span>
            <span class="o">{{ c.o }}</span>
          </div>
          <div class="cd num" :class="{ zero: c.d <= 0 }">{{ c.d > 0 ? `降低 ${c.d}%` : '持平' }}</div>
        </div>
      </div>
    </div>
    <Timeline :show-strategy="false" series="both" />
  </main>
</template>

<style scoped>
.cmp {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}
.strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 4px;
}
.lead {
  font-size: 14px;
  color: var(--text-2);
}
.lead b {
  color: var(--text);
}
.lead .hl {
  color: var(--accent);
}
.legend {
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: var(--text-2);
}
.legend span {
  display: flex;
  align-items: center;
  gap: 7px;
}
.legend i {
  width: 18px;
  height: 3px;
  border-radius: 2px;
}
.views {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.v {
  min-height: 0;
}
.bottom {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 560px;
  gap: 12px;
}
.chart {
  padding: 12px 14px 8px;
}
.cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.card {
  padding: 11px 14px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 3px;
}
.cn {
  font-size: 12px;
  color: var(--text-2);
}
.cv {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.cv .b {
  color: var(--base);
  font-size: 16px;
  font-weight: 600;
}
.cv .o {
  color: var(--accent);
  font-size: 22px;
  font-weight: 700;
}
.arrow {
  color: var(--text-3);
}
.cd {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ok);
}
.cd.zero {
  color: var(--text-3);
}
</style>
