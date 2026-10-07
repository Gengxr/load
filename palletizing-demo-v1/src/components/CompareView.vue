<script setup lang="ts">
import { computed } from 'vue'
import { result, state } from '../store'
import { goto } from '../playback'
import { pct } from '../format'
import { ACCENT, BASELINE } from '../viz/palette'
import ViewerPanel from './ViewerPanel.vue'
import BalanceChart from './BalanceChart.vue'
import Timeline from './Timeline.vue'
import Icon from './Icon.vue'

/**
 * 方案对比：右侧始终是本方案；左侧的对照对象可选
 *   · 逐层行扫描 —— 同一个垛形，只换码放顺序（自定义的对照基线）；
 *   · DBLF —— 公认的经典装箱算法，位置和顺序都由它自己生成（整体对比）。
 */
const r = computed(() => result.value)
const isDblf = computed(() => state.compareBase === 'dblf')
const bal = computed(() => r.value?.sequences.balance ?? null)
const baseSeq = computed(() => (r.value ? (isDblf.value ? r.value.dblf.sequence : r.value.sequences.baseline) : null))
const tolHalf = computed(() => state.cons.cogOffsetRatioMax * (state.cons.cogOffsetBase === 'pallet' ? state.pallet.length : state.cons.footprintX))

/** 两个雷达用同一比例尺，才能公平对比 */
const range = computed(() => {
  const a = bal.value
  const b = baseSeq.value
  if (!a || !b) return undefined
  let m = 0
  for (const s of [a, b])
    for (let i = 0; i < s.steps.cogX.length; i++)
      m = Math.max(m, Math.abs(s.steps.cogX[i] - state.cons.footprintX / 2), Math.abs(s.steps.cogY[i] - state.cons.footprintY / 2))
  return Math.min(640, Math.max(tolHalf.value * 1.9, m * 1.18))
})

const cards = computed(() => {
  const res = r.value
  const a = bal.value?.summary
  const b = baseSeq.value?.summary
  if (!res || !a || !b) return []
  const red = (x: number, y: number) => (y > 0 ? Math.round((1 - x / y) * 100) : 0)
  const lower = (x: number, y: number) => {
    const d = red(x, y)
    return { d: d > 0 ? `降低 ${d}%` : d < 0 ? `升高 ${-d}%` : '持平', good: d > 0, flat: d === 0 }
  }
  const proc = [
    { n: '过程峰值偏心', o: pct(a.peakRatio), b: pct(b.peakRatio), ...lower(a.peakRatio, b.peakRatio), note: '全过程中系统重心偏离几何中心的最大比例' },
    { n: '过程平均偏心', o: pct(a.meanRatio), b: pct(b.meanRatio), ...lower(a.meanRatio, b.meanRatio), note: '每放一件后偏心率的平均值' },
  ]
  const exceed = { n: '超出 ±10% 的步数', o: String(a.exceedSteps), b: String(b.exceedSteps), ...lower(a.exceedSteps, b.exceedSteps), note: '中间状态超出终态容差的次数' }
  if (!isDblf.value)
    return [...proc, { n: '峰值偏载力矩', o: a.peakMoment.toFixed(0) + ' N·m', b: b.peakMoment.toFixed(0) + ' N·m', ...lower(a.peakMoment, b.peakMoment), note: '重心偏移 × 总重，作用在称重台 / 托盘上的偏心力矩' }, exceed]
  // 整体对比：垛形也不同，所以把码完之后的指标一并列出
  const mo = res.metrics
  const mb = res.dblf.metrics
  const off = (m: typeof mo) => Math.max(Math.abs(m.cogOffsetRatio[0]), Math.abs(m.cogOffsetRatio[1]))
  const judged = (m: typeof mo) => m.items.filter((x) => x.source.startsWith('表'))
  const passO = judged(mo).filter((x) => x.pass).length
  const passB = judged(mb).filter((x) => x.pass).length
  const du = Math.round((mo.minLayerUtilization - mb.minLayerUtilization) * 100)
  const remO = res.layout.remaining.length
  const remB = res.dblf.layout.remaining.length
  return [
    ...proc,
    exceed,
    { n: '码完后重心偏离', o: pct(off(mo)), b: pct(off(mb)), ...lower(off(mo), off(mb)), note: '全部码完后，重心偏离货盘中心的比例（要求 ≤ ±10%）' },
    { n: '最低层利用率', o: pct(mo.minLayerUtilization, 0), b: pct(mb.minLayerUtilization, 0), d: du > 0 ? `提高 ${du} 个百分点` : du < 0 ? `降低 ${-du} 个百分点` : '持平', good: du > 0, flat: du === 0, note: '非顶层中利用率最低的一层（要求 ≥ 80%）' },
    { n: '表 2-2 指标达标', o: `${passO}/${judged(mo).length}`, b: `${passB}/${judged(mb).length}`, d: `未放入 ${remB} → ${remO} 件`, good: passO > passB || remO < remB, flat: passO === passB && remO === remB, note: '技术要求表 2-2 的六项码盘指标中达标的项数，以及放不下的件数' },
  ]
})
const marks = computed(() => {
  const res = r.value
  if (!res) return []
  const last = new Map<number, number>()
  res.sequences.balance.order.forEach((pi, k) => last.set(res.layout.placements[pi].layer, k + 1))
  return [...last.values()]
})
const DBLF_TIP =
  'DBLF（Deepest-Bottom-Left with Fill，最深-最低-最左填充）：Karabulut 与 İnceoğlu 2004 年提出，是三维装箱文献中常用的对照算法。每件货物放到最靠里的可行位置，深度相同取最低，再相同取最左。此处货物按体积从大到小放置，并与本方案受同样的垛形边界和支撑率约束。'
const ROW_TIP = '逐层行扫描：一层码满再码下一层，每层由远到近、从左到右。它反映常见的人工习惯，是本系统自定义的对照基线，不是某项标准。'
</script>

<template>
  <main class="cmp">
    <div class="strip">
      <div class="pick seg">
        <button :class="{ on: !isDblf }" :title="ROW_TIP" @click="state.compareBase = 'layer-row'">只比顺序<em>对照基线 · 逐层行扫描</em></button>
        <button :class="{ on: isDblf }" :title="DBLF_TIP" @click="state.compareBase = 'dblf'">整体对比<em>经典算法 · DBLF</em></button>
      </div>
      <div class="lead">
        <template v-if="!isDblf"><b>同一批货物、同一个垛形</b>，只改变<b class="hl">码放顺序</b>：左侧一层码满再码下一层</template>
        <template v-else><b>同一批货物</b>：左侧的<b class="hl">位置和顺序</b>都由公认的经典装箱算法 DBLF 生成</template>
        <span class="q" :title="isDblf ? DBLF_TIP : ROW_TIP"><Icon name="info" :size="14" /></span>
      </div>
      <div class="legend">
        <span><i :style="{ background: BASELINE }" />{{ isDblf ? '对照算法 DBLF' : '对照基线' }}</span>
        <span><i :style="{ background: ACCENT }" />本方案</span>
      </div>
    </div>
    <div class="views">
      <ViewerPanel class="v" :strategy="state.compareBase" hud="compare" compact :show-conveyor="false" :accent="BASELINE" :radar-range="range" />
      <ViewerPanel class="v" strategy="balance" hud="compare" compact :show-conveyor="false" :accent="ACCENT" :radar-range="range" />
    </div>
    <div v-if="r && bal && baseSeq" class="bottom" :class="{ six: cards.length > 4 }">
      <div class="chart panel">
        <h3 class="section-title">过程偏心率曲线<span class="tag">点击曲线可跳转到该步</span></h3>
        <BalanceChart :ours="bal.steps.ratio" :base="baseSeq.steps.ratio" :base-label="isDblf ? 'DBLF' : '对照'" :k="state.step" :tol="state.cons.cogOffsetRatioMax" :height="128" :marks="marks" @seek="goto" />
      </div>
      <div class="cards">
        <div v-for="c in cards" :key="c.n" class="card panel" :title="c.note">
          <div class="cn">{{ c.n }}</div>
          <div class="cv num">
            <span class="b">{{ c.b }}</span>
            <span class="arrow">→</span>
            <span class="o">{{ c.o }}</span>
          </div>
          <div class="cd num" :class="{ zero: c.flat, worse: !c.good && !c.flat }">{{ c.d }}</div>
        </div>
      </div>
    </div>
    <Timeline :show-strategy="false" series="both" :base-ratio="baseSeq?.steps.ratio" />
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
.pick {
  flex: none;
}
.pick button {
  height: 34px;
  padding: 0 14px;
  font-size: 13px;
  font-weight: 600;
}
.pick em {
  font-style: normal;
  font-weight: 400;
  font-size: 11.5px;
  margin-left: 4px;
  color: var(--text-3);
}
.pick button.on em {
  color: var(--text-2);
}
.lead {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0 2px;
  font-size: 13.5px;
  color: var(--text-2);
}
.q {
  display: inline-grid;
  place-items: center;
  margin-left: 6px;
  color: var(--text-3);
  cursor: help;
}
.lead b {
  color: var(--text);
}
.lead .hl {
  color: var(--accent);
}
.legend {
  flex: none;
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
.cd.worse {
  color: var(--warn);
}
.bottom.six {
  grid-template-columns: minmax(0, 1fr) 640px;
}
.bottom.six .cards {
  grid-template-columns: 1fr 1fr 1fr;
}
.bottom.six .card {
  padding: 9px 12px;
}
.bottom.six .cv .o {
  font-size: 19px;
}
.bottom.six .cv .b {
  font-size: 14.5px;
}
.bottom.six .cv {
  gap: 6px;
}
@media (max-width: 1320px) {
  .lead {
    display: none;
  }
  .bottom.six {
    grid-template-columns: minmax(0, 1fr) 540px;
  }
}
</style>
