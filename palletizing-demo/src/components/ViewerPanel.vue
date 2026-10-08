<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { PalletViewer, type CameraPreset, type ViewerPlan } from '../viz/PalletViewer'
import { cargoById, currentSeq, result, skuColors, state } from '../store'
import { registerViewer, unregisterViewer } from '../playback'
import type { SequenceStrategy } from '../algo/types'
import { ACCENT } from '../viz/palette'
import { pct, signedPct, tail } from '../format'
import CogRadar from './CogRadar.vue'
import BoxGlyph from './BoxGlyph.vue'
import Icon from './Icon.vue'

const props = withDefaults(
  defineProps<{
    strategy?: SequenceStrategy | 'current'
    hud?: 'full' | 'compare' | 'none'
    /** fullbleed：铺满全屏、面板悬浮其上；framed：带圆角边框的独立视窗 */
    variant?: 'fullbleed' | 'framed'
    insets?: { l: number; r: number; t: number; b: number }
    compact?: boolean
    showConveyor?: boolean
    accent?: string
    camera?: CameraPreset
    radarRange?: number
  }>(),
  {
    strategy: 'current',
    hud: 'full',
    variant: 'framed',
    insets: () => ({ l: 14, r: 14, t: 14, b: 14 }),
    compact: false,
    showConveyor: true,
    accent: ACCENT,
    camera: 'iso',
  },
)

const host = ref<HTMLDivElement | null>(null)
const viewer = shallowRef<PalletViewer | null>(null)
const hoverInfo = ref<{ i: number; x: number; y: number } | null>(null)
const cam = ref<CameraPreset>(props.camera)

const seq = computed(() => {
  const r = result.value
  if (!r) return null
  if (props.strategy === 'current') return currentSeq.value
  return props.strategy === 'balance' ? r.sequences.balance : r.sequences.baseline
})

const tolHalf = computed(() => state.cons.cogOffsetRatioMax * (state.cons.cogOffsetBase === 'pallet' ? state.pallet.length : state.cons.footprintX))

function buildPlan(): ViewerPlan | null {
  const r = result.value
  const s = seq.value
  if (!r || !s) return null
  return {
    placements: r.layout.placements,
    order: s.order,
    steps: s.steps,
    supporters: r.supporters,
    colors: r.layout.placements.map((p) => skuColors.value.get(p.sku) ?? '#cbd5e1'),
    footprintX: state.cons.footprintX,
    footprintY: state.cons.footprintY,
    maxHeight: state.cons.maxStackHeight,
    pallet: state.pallet,
    tolHalf: tolHalf.value,
    tolRatio: state.cons.cogOffsetRatioMax,
  }
}

onMounted(() => {
  const v = new PalletViewer(host.value!, { compact: props.compact, showConveyor: props.showConveyor, accent: props.accent })
  viewer.value = v
  v.setCameraPreset(cam.value, false)
  if (props.variant === 'fullbleed') v.setViewInsets(props.insets, false)
  v.onHover = (i, x, y) => (hoverInfo.value = i === null ? null : { i, x, y })
  v.setLabels(state.showLabels)
  v.setCogVisible(state.showCog)
  v.setAutoRotate(state.autoRotate)
  v.setPlan(buildPlan())
  v.gotoStep(state.step)
  v.setLayerLimit(state.layerLimit)
  registerViewer(v)
})

onBeforeUnmount(() => {
  if (viewer.value) {
    unregisterViewer(viewer.value)
    viewer.value.dispose()
  }
})

watch([result, seq], () => {
  const v = viewer.value
  if (!v) return
  v.setPlan(buildPlan())
  v.gotoStep(state.step)
  v.setLayerLimit(state.layerLimit)
})
watch(
  () => props.insets,
  (ins) => props.variant === 'fullbleed' && viewer.value?.setViewInsets(ins),
  { deep: true },
)
watch(
  () => state.showLabels,
  (on) => viewer.value?.setLabels(on),
)
watch(
  () => state.showCog,
  (on) => viewer.value?.setCogVisible(on),
)
watch(
  () => state.autoRotate,
  (on) => viewer.value?.setAutoRotate(on),
)
watch(
  () => state.layerLimit,
  (l) => viewer.value?.setLayerLimit(l),
)
watch(
  () => state.selectedLayer,
  (l) => {
    const r = result.value
    if (!r || !viewer.value) return
    viewer.value.setHighlight(l === null ? [] : r.layout.placements.map((p, i) => (p.layer === l ? i : -1)).filter((i) => i >= 0))
  },
)

function setCam(p: CameraPreset) {
  cam.value = p
  viewer.value?.setCameraPreset(p)
}

function snapshot() {
  const v = viewer.value
  if (!v) return
  const a = document.createElement('a')
  a.href = v.snapshot()
  a.download = `码盘方案_${state.gen.seed}_第${state.step}件.png`
  a.click()
}

// ───────── HUD 数据 ─────────
const n = computed(() => result.value?.layout.placements.length ?? 0)
const curBox = computed(() => {
  const r = result.value
  const s = seq.value
  if (!r || !s || state.step >= s.order.length) return null
  const i = s.order[state.step]
  const p = r.layout.placements[i]
  return { p, c: cargoById.value.get(p.cargoId), sup: r.supporters[i].length }
})
const readout = computed(() => {
  const s = seq.value
  const r = result.value
  if (!s || !r) return null
  const k = Math.min(state.step, s.steps.ratio.length - 1)
  const fx = state.cons.footprintX
  const fy = state.cons.footprintY
  const base = state.cons.cogOffsetBase === 'pallet' ? state.pallet.length : fx
  const peak = Math.max(...s.steps.ratio.slice(0, k + 1))
  const top = k === 0 ? 0 : Math.max(...s.order.slice(0, k).map((i) => r.layout.placements[i].z + r.layout.placements[i].dz))
  return {
    dx: (s.steps.cogX[k] - fx / 2) / base,
    dy: (s.steps.cogY[k] - fy / 2) / base,
    ratio: s.steps.ratio[k],
    peak,
    mass: s.steps.mass[k],
    hRatio: k === 0 ? 0 : (s.steps.cogZ[k] + state.pallet.height) / (top + state.pallet.height),
    moment: s.steps.moment[k],
  }
})
const hoverBox = computed(() => {
  const h = hoverInfo.value
  const r = result.value
  const s = seq.value
  if (!h || !r || !s) return null
  const p = r.layout.placements[h.i]
  const c = cargoById.value.get(p.cargoId)
  return { ...h, p, c, seqNo: s.order.indexOf(h.i) + 1, sup: r.supporters[h.i].length }
})
const summary = computed(() => {
  const r = result.value
  if (!r) return null
  const tech = r.metrics.items.filter((m) => m.source.startsWith('表'))
  return {
    ok: tech.filter((m) => m.pass).length,
    all: tech.length,
    ours: r.sequences.balance.summary.peakRatio,
    base: r.sequences.baseline.summary.peakRatio,
  }
})
const cams: { k: CameraPreset; n: string }[] = [
  { k: 'iso', n: '等轴' },
  { k: 'front', n: '正视' },
  { k: 'side', n: '侧视' },
  { k: 'top', n: '俯视' },
  { k: 'operator', n: '工位' },
]
const layerCount = computed(() => result.value?.layout.layers.length ?? 0)
const strategyName = computed(() => (seq.value?.strategy === 'balance' ? '本方案 · 平衡优先动态顺序' : '传统 · 逐层行扫描'))
const hudStyle = computed(() =>
  props.variant === 'fullbleed'
    ? { left: props.insets.l + 'px', right: props.insets.r + 'px', top: props.insets.t + 'px', bottom: props.insets.b + 'px' }
    : { left: '14px', right: '14px', top: '14px', bottom: '14px' },
)

defineExpose({ viewer })
</script>

<template>
  <div class="vp" :class="[variant, { compact }]">
    <div ref="host" class="host" />
    <div class="vignette" />

    <div v-if="hud === 'full'" class="hud" :style="hudStyle">
      <!-- 当前货物 -->
      <div v-if="curBox" class="cur glass">
        <BoxGlyph :dx="curBox.p.dx" :dy="curBox.p.dy" :dz="curBox.p.dz" :color="skuColors.get(curBox.p.sku) ?? '#ccc'" :size="58" />
        <div class="cur-main">
          <div class="cur-top">
            <span class="eyebrow">当前货物</span>
            <span class="num cnt"><b>{{ state.step + 1 }}</b> / {{ n }}</span>
          </div>
          <div class="num dims">{{ curBox.p.dx }}<i>×</i>{{ curBox.p.dy }}<i>×</i>{{ curBox.p.dz }}<small>mm</small></div>
          <div class="chips num">
            <span>第 {{ curBox.p.layer + 1 }} 层</span>
            <span>{{ curBox.p.weight.toFixed(1) }} kg</span>
            <span>{{ curBox.p.rotated ? '长边沿前后' : '长边沿左右' }}</span>
            <span class="mono">{{ curBox.c ? tail(curBox.c.rfid, 6) : '' }}</span>
          </div>
        </div>
      </div>
      <div v-else-if="n" class="cur glass done">
        <Icon name="checkCircle" :size="20" />
        <span>全部 {{ n }} 件码放完成</span>
      </div>

      <!-- 指标摘要（右侧面板收起时） -->
      <Transition name="fade">
        <button v-if="summary && !state.metricsOpen" class="metrics glass" title="展开技术指标面板 (M)" @click="state.metricsOpen = true">
          <span class="ring" :class="{ ok: summary.ok === summary.all }">
            <svg viewBox="0 0 36 36" width="34" height="34">
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3" />
              <circle
                cx="18"
                cy="18"
                r="15"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                :stroke-dasharray="`${(summary.ok / summary.all) * 94.2} 94.2`"
                transform="rotate(-90 18 18)"
              />
            </svg>
            <b class="num">{{ summary.ok }}</b>
          </span>
          <span class="m-txt">
            <span class="m-t">技术指标 {{ summary.ok }}/{{ summary.all }} 达标</span>
            <span class="m-s num">过程峰值偏心 <b class="o">{{ pct(summary.ours) }}</b> · 传统 <b class="b">{{ pct(summary.base) }}</b></span>
          </span>
          <Icon name="chevron" :size="16" class="m-chev" />
        </button>
      </Transition>

      <!-- 右侧竖向工具栏 -->
      <div class="rail">
        <div class="toolbar glass">
          <button v-for="c in cams" :key="c.k" class="tb" :class="{ on: cam === c.k }" @click="setCam(c.k)">{{ c.n }}</button>
          <div class="sep" />
          <button class="tb ic" :class="{ on: state.showCog }" data-tip="重心显示" @click="state.showCog = !state.showCog"><Icon name="target" :size="16" /></button>
          <button class="tb ic" :class="{ on: state.showLabels }" data-tip="码放序号" @click="state.showLabels = !state.showLabels"><Icon name="hash" :size="16" /></button>
          <button class="tb ic" :class="{ on: state.autoRotate }" data-tip="自动旋转" @click="state.autoRotate = !state.autoRotate"><Icon name="rotate" :size="16" /></button>
          <button class="tb ic" data-tip="截图" @click="snapshot"><Icon name="image" :size="16" /></button>
        </div>
        <div v-if="layerCount > 1" class="elevator glass">
          <span class="ev-t">层</span>
          <button
            v-for="l in layerCount"
            :key="l"
            class="ev"
            :class="{ on: state.layerLimit === layerCount - l }"
            :data-tip="`只显示到第 ${layerCount - l + 1} 层`"
            @click="state.layerLimit = layerCount - l"
          >
            {{ layerCount - l + 1 }}
          </button>
          <button class="ev all" :class="{ on: state.layerLimit === null }" @click="state.layerLimit = null">全</button>
        </div>
      </div>

      <!-- 重心（全屏模式下由左栏的重心卡片显示） -->
      <div v-if="readout && state.showCog && seq && variant !== 'fullbleed'" class="cog glass">
        <CogRadar
          :steps="seq.steps"
          :k="state.step"
          :fx="state.cons.footprintX"
          :fy="state.cons.footprintY"
          :tol-half="tolHalf"
          :tol-ratio="state.cons.cogOffsetRatioMax"
          :color="accent"
          :size="128"
          :range="radarRange"
        />
        <div class="cog-r">
          <div class="cog-t"><span class="dotc" />系统重心 · 货物+货盘</div>
          <div class="cog-big num" :class="readout.ratio > state.cons.cogOffsetRatioMax ? 'bad' : 'ok'">
            {{ pct(readout.ratio) }}<small>当前偏心</small>
          </div>
          <div class="kv num"><span>X / Y</span><b>{{ signedPct(readout.dx) }} / {{ signedPct(readout.dy) }}</b></div>
          <div class="kv num"><span>过程峰值</span><b>{{ pct(readout.peak) }}</b></div>
          <div class="kv num"><span>重心高度</span><b>{{ readout.hRatio ? pct(readout.hRatio) : '—' }}</b></div>
          <div class="kv num"><span>总重</span><b>{{ readout.mass.toFixed(1) }} kg</b></div>
        </div>
      </div>
    </div>

    <div v-else-if="hud === 'compare' && readout && seq" class="hud" :style="hudStyle">
      <div class="cmp-h" :style="{ '--c': accent }">
        <span class="cmp-dot" />
        <span class="cmp-n">{{ strategyName }}</span>
      </div>
      <div class="cmp-stats">
        <div class="st">
          <span>当前偏心</span>
          <b class="num" :class="readout.ratio > state.cons.cogOffsetRatioMax ? 'bad' : ''">{{ pct(readout.ratio) }}</b>
        </div>
        <div class="st">
          <span>过程峰值</span>
          <b class="num" :class="readout.peak > state.cons.cogOffsetRatioMax ? 'bad' : ''">{{ pct(readout.peak) }}</b>
        </div>
        <div class="st">
          <span>偏载力矩</span>
          <b class="num">{{ readout.moment.toFixed(0) }}<small> N·m</small></b>
        </div>
      </div>
      <div class="cog glass small">
        <CogRadar
          :steps="seq.steps"
          :k="state.step"
          :fx="state.cons.footprintX"
          :fy="state.cons.footprintY"
          :tol-half="tolHalf"
          :tol-ratio="state.cons.cogOffsetRatioMax"
          :color="accent"
          :size="168"
          :range="radarRange"
        />
      </div>
    </div>

    <div v-if="hoverBox" class="tip" :style="{ left: hoverBox.x + 16 + 'px', top: hoverBox.y + 16 + 'px' }">
      <div class="tip-h"><i :style="{ background: skuColors.get(hoverBox.p.sku) }" />{{ hoverBox.c?.id }}<span>第 {{ hoverBox.seqNo }} 件</span></div>
      <div class="num">{{ hoverBox.p.dx }}×{{ hoverBox.p.dy }}×{{ hoverBox.p.dz }} mm · {{ hoverBox.p.weight.toFixed(2) }} kg</div>
      <div class="num">第 {{ hoverBox.p.layer + 1 }} 层 · 底面高 {{ hoverBox.p.z }} mm</div>
      <div class="num mono">RFID {{ hoverBox.c?.rfid }}</div>
      <div class="tip-s">{{ hoverBox.sup ? `由 ${hoverBox.sup} 件货物托住（青色高亮）` : '直接落在货盘上' }}</div>
    </div>
  </div>
</template>

<style scoped>
.vp {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(1100px 640px at 50% 42%, rgba(48, 110, 190, 0.2), transparent 70%),
    radial-gradient(1600px 900px at 50% 120%, rgba(46, 224, 240, 0.06), transparent 60%),
    linear-gradient(180deg, #0b1424 0%, #060a12 100%);
}
.vp.framed {
  border-radius: var(--r-lg);
  border: 1px solid var(--glass-border);
}
.host {
  position: absolute;
  inset: 0;
}
.vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(2, 4, 9, 0.55) 100%);
}
.framed .vignette {
  background: radial-gradient(ellipse at 50% 45%, transparent 60%, rgba(2, 4, 9, 0.4) 100%);
}
.hud {
  position: absolute;
  pointer-events: none;
  transition: right 0.42s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.hud > * {
  pointer-events: auto;
}
.glass {
  border-radius: 16px;
}

/* 当前货物 */
.cur {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 18px 12px 14px;
  min-width: 300px;
}
.cur.done {
  min-width: 0;
  gap: 9px;
  color: var(--ok);
  font-weight: 650;
  padding: 12px 16px;
}
.cur-top {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.cnt {
  font-size: 12px;
  color: var(--text-3);
}
.cnt b {
  font-size: 14px;
  color: var(--accent);
  font-weight: 700;
}
.dims {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.25;
}
.dims i {
  font-style: normal;
  color: var(--text-3);
  font-weight: 400;
  margin: 0 3px;
  font-size: 16px;
}
.dims small {
  font-size: 12px;
  color: var(--text-3);
  font-weight: 500;
  margin-left: 5px;
}
.chips {
  display: flex;
  gap: 5px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.chips span {
  font-size: 11.5px;
  color: var(--text-2);
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 2px 7px;
}
.mono {
  font-family: var(--mono);
}

/* 指标摘要 */
.metrics {
  position: absolute;
  right: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--glass-border);
  color: var(--text);
  text-align: left;
  transition:
    transform 0.15s,
    border-color 0.2s;
}
.metrics:hover {
  border-color: rgba(46, 224, 240, 0.4);
  transform: translateY(-1px);
}
.ring {
  position: relative;
  width: 34px;
  height: 34px;
  color: var(--warn);
  flex: none;
}
.ring.ok {
  color: var(--ok);
}
.ring svg {
  position: absolute;
  inset: 0;
}
.ring b {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 13px;
  color: var(--text);
}
.m-txt {
  display: flex;
  flex-direction: column;
}
.m-t {
  font-size: 13px;
  font-weight: 650;
}
.m-s {
  font-size: 11.5px;
  color: var(--text-3);
}
.m-s .o {
  color: var(--accent);
}
.m-s .b {
  color: var(--base);
}
.m-chev {
  color: var(--text-3);
}

/* 竖向工具栏 */
.rail {
  position: absolute;
  right: 0;
  top: 76px;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: space-between;
  pointer-events: none;
}
.rail > * {
  pointer-events: auto;
}
.toolbar,
.elevator {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px;
  border-radius: 14px;
}
.tb {
  width: 46px;
  height: 30px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  display: grid;
  place-items: center;
  transition:
    background 0.15s,
    color 0.15s;
}
.tb:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.06);
}
.tb.on {
  color: var(--text);
  background: rgba(255, 255, 255, 0.12);
}
.tb.ic.on {
  color: var(--accent);
}
.tb[data-tip]:hover::after,
.ev[data-tip]:hover::after {
  top: 50%;
  left: auto;
  right: calc(100% + 10px);
  transform: translateY(-50%);
}
/* 高度不足时工具栏与分层选择并排，避免上下相撞或压到播放条 */
@media (max-height: 820px) {
  .rail {
    flex-direction: row-reverse;
    align-items: flex-start;
    justify-content: flex-start;
    gap: 8px;
  }
}
@media (max-height: 820px) {
  .cog.small :deep(.radar) {
    width: 118px;
    height: 118px;
  }
  .st b {
    font-size: 22px;
  }
}
@media (max-height: 700px) {
  .tb {
    height: 26px;
  }
  .ev {
    height: 22px;
  }
}
.sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--line-2);
}
.ev-t {
  font-size: 10.5px;
  color: var(--text-3);
  text-align: center;
  padding: 2px 0 3px;
}
.ev {
  width: 46px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.ev:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
}
.ev.on {
  background: linear-gradient(135deg, rgba(46, 224, 240, 0.28), rgba(91, 140, 255, 0.22));
  color: var(--text);
}
.ev.all {
  margin-top: 2px;
}

/* 重心 */
.cog {
  position: absolute;
  left: 0;
  bottom: 0;
  padding: 12px 16px 12px 12px;
  display: flex;
  gap: 14px;
  align-items: center;
}
.cog.small {
  padding: 8px;
}
.cog-r {
  min-width: 170px;
}
.cog-t {
  font-size: 11.5px;
  color: var(--text-2);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 7px;
}
.dotc {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cog);
  box-shadow: 0 0 10px var(--cog);
}
.cog-big {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
  margin: 3px 0 6px;
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.cog-big small {
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3);
}
.cog-big.ok {
  color: var(--ok);
}
.cog-big.bad {
  color: var(--bad);
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  font-size: 12px;
  color: var(--text-3);
  padding: 1px 0;
}
.kv b {
  color: var(--text);
  font-weight: 600;
}

/* 悬停提示 */
.tip {
  position: absolute;
  pointer-events: none;
  z-index: 6;
  background: rgba(6, 10, 18, 0.94);
  border: 1px solid var(--line-2);
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.65;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(10px);
}
.tip-h {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text);
  font-weight: 650;
  font-size: 13px;
  margin-bottom: 2px;
}
.tip-h span {
  font-weight: 500;
  color: var(--text-3);
  font-size: 12px;
}
.tip-h i {
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.tip-s {
  color: var(--accent);
  margin-top: 2px;
}

/* 对比模式 */
.cmp-h {
  position: absolute;
  left: 4px;
  top: 2px;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
  font-weight: 700;
}
.cmp-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--c);
  box-shadow: 0 0 14px var(--c);
}
.cmp-stats {
  position: absolute;
  right: 4px;
  top: 0;
  display: flex;
  gap: 22px;
}
.st {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}
.st span {
  font-size: 11.5px;
  color: var(--text-3);
}
.st b {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.01em;
}
.st b.bad {
  color: var(--bad);
}
.st small {
  font-size: 12px;
  color: var(--text-3);
  font-weight: 500;
}
</style>
