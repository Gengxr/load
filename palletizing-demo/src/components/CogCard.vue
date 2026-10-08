<script setup lang="ts">
import { computed } from 'vue'
import { currentSeq, result, state } from '../store'
import { pct, signedPct } from '../format'
import { ACCENT, BASELINE } from '../viz/palette'
import CogRadar from './CogRadar.vue'

/** 系统重心卡片：俯视雷达（容差区 + 重心轨迹）+ 实时读数；flat = 嵌在面板内部（无独立边框） */
defineProps<{ flat?: boolean }>()
const seq = computed(() => currentSeq.value)
const tolHalf = computed(() => state.cons.cogOffsetRatioMax * (state.cons.cogOffsetBase === 'pallet' ? state.pallet.length : state.cons.footprintX))
const readout = computed(() => {
  const s = seq.value
  const r = result.value
  if (!s || !r) return null
  const k = Math.min(state.step, s.steps.ratio.length - 1)
  const fx = state.cons.footprintX
  const fy = state.cons.footprintY
  const base = state.cons.cogOffsetBase === 'pallet' ? state.pallet.length : fx
  const top = k === 0 ? 0 : Math.max(...s.order.slice(0, k).map((i) => r.layout.placements[i].z + r.layout.placements[i].dz))
  return {
    dx: (s.steps.cogX[k] - fx / 2) / base,
    dy: (s.steps.cogY[k] - fy / 2) / base,
    ratio: s.steps.ratio[k],
    // 起步阶段（盘上货物不足整盘的 20%）不计入过程峰值
    warm: k > 0 && k <= s.summary.warmupSteps,
    peak: k > s.summary.warmupSteps ? Math.max(...s.steps.ratio.slice(s.summary.warmupSteps + 1, k + 1)) : 0,
    mass: s.steps.mass[k],
    hRatio: k === 0 ? 0 : (s.steps.cogZ[k] + state.pallet.height) / (top + state.pallet.height),
  }
})
const over = computed(() => (readout.value?.ratio ?? 0) > state.cons.cogOffsetRatioMax)
const bad = computed(() => over.value && !readout.value?.warm)
const color = computed(() => (seq.value?.strategy === 'layer-row' ? BASELINE : ACCENT))
</script>

<template>
  <section v-if="readout && seq" class="cc" :class="flat ? 'flat' : 'glass'">
    <div class="hd">
      <span class="t"><span class="dotc" />系统重心</span>
      <span class="s">货物 + 货盘 · 俯视</span>
    </div>
    <div class="body">
      <CogRadar
        :steps="seq.steps"
        :k="state.step"
        :fx="state.cons.footprintX"
        :fy="state.cons.footprintY"
        :tol-half="tolHalf"
        :tol-ratio="state.cons.cogOffsetRatioMax"
        :warmup="seq.summary.warmupSteps"
        :color="color"
        :size="118"
      />
      <div class="rd">
        <div class="big num" :class="bad ? 'bad' : over ? 'warm' : 'ok'">{{ pct(readout.ratio) }}</div>
        <div class="cap" :title="readout.warm ? '起步阶段：盘上货物还不到整盘的 20%，重心对单件位置很敏感而偏载力矩很小，不计入过程峰值' : ''">{{ readout.warm ? '起步阶段 · 不计入峰值' : `当前偏心 · 容差 ±${pct(state.cons.cogOffsetRatioMax, 0)}` }}</div>
        <div class="kv num"><span>X / Y</span><b>{{ signedPct(readout.dx) }} / {{ signedPct(readout.dy) }}</b></div>
        <div class="kv num"><span>过程峰值</span><b>{{ readout.warm ? '—' : pct(readout.peak) }}</b></div>
        <div class="kv num"><span>重心高度</span><b>{{ readout.hRatio ? pct(readout.hRatio) : '—' }}</b></div>
        <div class="kv num"><span>当前总重</span><b>{{ readout.mass.toFixed(1) }} kg</b></div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cc {
  padding: 14px 16px 14px;
}
.cc.flat {
  padding: 12px 12px;
  border-radius: 13px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--line);
}
.hd {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 10px;
}
.t {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 650;
}
.s {
  font-size: 11.5px;
  color: var(--text-3);
}
.dotc {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--cog);
  box-shadow: 0 0 10px var(--cog);
}
.body {
  display: grid;
  grid-template-columns: 118px 1fr;
  gap: 14px;
  align-items: center;
}
.big {
  font-size: 30px;
  font-weight: 750;
  line-height: 1.05;
  letter-spacing: -0.02em;
}
.big.ok {
  color: var(--ok);
}
.big.warm {
  color: var(--warn);
}
.big.bad {
  color: var(--bad);
}
.cap {
  font-size: 11px;
  color: var(--text-3);
  margin: 2px 0 8px;
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text-3);
  padding: 1.5px 0;
}
.kv b {
  color: var(--text);
  font-weight: 600;
}
@media (max-height: 800px) {
  .cc {
    padding: 11px 14px;
  }
  .hd {
    margin-bottom: 6px;
  }
  .body {
    grid-template-columns: 88px 1fr;
    gap: 12px;
  }
  .body :deep(.radar) {
    width: 88px;
    height: 88px;
  }
  .big {
    font-size: 24px;
  }
  .cap {
    margin-bottom: 4px;
  }
  .kv:nth-of-type(n + 5) {
    display: none;
  }
}
</style>
