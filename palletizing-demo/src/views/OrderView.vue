<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { allocation, loading, pallets, palletPass, runInfo, skuColors, state, summary } from '../store'
import { selectPallet } from '../playback'
import { FleetViewer, type FleetPallet } from '../viz/FleetViewer'
import { GAP, TOP, BAR, usePanels } from '../layout'
import { pct } from '../format'
import OrderPanel from '../components/OrderPanel.vue'
import FleetPanel from '../components/FleetPanel.vue'
import Icon from '../components/Icon.vue'
const ParamsDrawer = defineAsyncComponent(() => import('../components/ParamsDrawer.vue'))

/** 出库分盘工作区：出库清单 → 多盘分配 → 各盘码放结果总览 */
const { lw, rw } = usePanels()
const host = ref<HTMLDivElement | null>(null)
const viewer = shallowRef<FleetViewer | null>(null)
const labelEls = ref<HTMLElement[]>([])

const insets = computed(() => ({
  l: GAP + lw.value + GAP,
  r: state.fleetOpen ? GAP + rw.value + GAP : GAP,
  t: TOP + 30,
  b: GAP + BAR + 20,
}))
const vars = computed(() => ({ '--il': insets.value.l + 'px', '--ir': insets.value.r + 'px' }))

function fleet(): FleetPallet[] {
  return pallets.value.map((p) => ({
    id: p.id,
    placements: p.result.layout.placements,
    colors: p.result.layout.placements.map((pl) => skuColors.value.get(pl.sku) ?? '#cbd5e1'),
    ok: palletPass(p),
  }))
}

function placeLabels() {
  const v = viewer.value
  if (!v) return
  const pos = v.labelPositions()
  labelEls.value.forEach((el, i) => {
    const p = pos[i]
    if (!el || !p) return
    el.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
    el.style.opacity = p.visible ? '1' : '0'
  })
}

onMounted(() => {
  const v = new FleetViewer(host.value!, state.settings.quality)
  viewer.value = v
  v.setViewInsets(insets.value, false)
  v.onRender = placeLabels
  v.onPick = (i) => (state.focus = i === state.focus ? -1 : i)
  v.onOpen = open
  v.setPallets(fleet(), state.cons.footprintX, state.cons.footprintY, false)
  v.setAutoRotate(state.autoRotate)
  if (state.focus >= 0) v.setFocus(state.focus)
})
onBeforeUnmount(() => viewer.value?.dispose())

watch(pallets, () => viewer.value?.setPallets(fleet(), state.cons.footprintX, state.cons.footprintY, true))
watch(insets, (ins) => {
  viewer.value?.setViewInsets(ins)
  if (state.focus < 0) setTimeout(() => state.focus < 0 && viewer.value?.resetCamera(), 60)
})
watch(
  () => state.focus,
  (i) => {
    const v = viewer.value
    if (!v) return
    if (i >= 0) v.focusOn(i)
    else {
      v.setFocus(-1)
      v.resetCamera()
    }
  },
)
watch(
  () => state.settings.quality,
  (q) => viewer.value?.setQuality(q),
)
watch(
  () => state.autoRotate,
  (on) => viewer.value?.setAutoRotate(on),
)

function open(i: number) {
  selectPallet(i)
  state.ws = 'pallet'
}
function snapshot() {
  const v = viewer.value
  if (!v) return
  const a = document.createElement('a')
  a.href = v.snapshot()
  a.download = `多盘总览_${pallets.value.length}盘.png`
  a.click()
}

const labels = computed(() => pallets.value.map((p, i) => ({ i, id: p.id, ok: palletPass(p), kg: p.result.metrics.grossWeight, n: p.result.layout.placements.length })))
const kpis = computed(() => {
  const s = summary.value
  const a = allocation.value
  if (!s || !a) return null
  return [
    { k: '货盘数', v: String(s.pallets), u: '盘', sub: `体积下界 ${a.stats.lowerBound}` },
    { k: '层利用率', v: pct(s.util, 0), u: '', sub: '非顶层平均' },
    { k: '垛高', v: s.hMin === s.hMax ? String(s.hMin) : `${s.hMin}–${s.hMax}`, u: 'mm', sub: `上限 ${state.cons.maxStackHeight}` },
    { k: '重量极差', v: (s.wMax - s.wMin).toFixed(0), u: 'kg', sub: `共 ${s.weight.toFixed(0)} kg` },
    { k: '生成用时', v: runInfo.value ? (runInfo.value.elapsedMs / 1000).toFixed(1) : '—', u: 's', sub: `${s.boxes} 件` },
  ]
})
const loadErr = computed(() => (loading.value ? Math.max(Math.abs(loading.value.metrics.errX), Math.abs(loading.value.metrics.errY)) : null))
</script>

<template>
  <main class="workspace" :style="vars">
    <div ref="host" class="stage3d" />

    <!-- 货盘标签 -->
    <div class="labels">
      <button
        v-for="l in labels"
        :key="l.id"
        :ref="(el) => (labelEls[l.i] = el as HTMLElement)"
        class="lab"
        :class="{ on: state.focus === l.i, bad: !l.ok }"
        @click="state.focus = state.focus === l.i ? -1 : l.i"
        @dblclick="open(l.i)"
      >
        <i class="dotc" />
        <b class="num">{{ l.id }}</b>
        <span class="num">{{ l.kg.toFixed(0) }} kg</span>
        <span v-if="state.focus === l.i" class="go" @click.stop="open(l.i)">进入码放<Icon name="arrowRight" :size="13" /></span>
      </button>
    </div>

    <div class="float-l"><OrderPanel /></div>
    <Transition name="slide">
      <ParamsDrawer v-if="state.paramsOpen" class="float-l params" />
    </Transition>

    <!-- 右上：结果摘要胶囊 / 分配明细抽屉 -->
    <Transition name="fade">
      <button v-if="summary && !state.fleetOpen" class="pill-btn glass" @click="state.fleetOpen = true">
        <span class="ring" :class="{ ok: summary.pass === summary.pallets }"><Icon :name="summary.pass === summary.pallets ? 'check' : 'alert'" :size="14" :stroke="2.6" /></span>
        <span class="pt">
          <b class="num">{{ summary.pallets }} 盘 · {{ summary.pass }}/{{ summary.pallets }} 达标</b>
          <span class="num">{{ summary.unplaced ? `${summary.unplaced} 件未放入` : '全部货物已分配' }}</span>
        </span>
        <span class="more">分配明细<Icon name="chevron" :size="14" /></span>
      </button>
    </Transition>
    <Transition name="drawer">
      <FleetPanel v-if="state.fleetOpen" class="float-r" />
    </Transition>

    <div class="tools" :class="{ shifted: state.fleetOpen }">
      <button class="tb" data-tip="复位视角" @click="((state.focus = -1), viewer?.resetCamera())"><Icon name="rotate" :size="16" /></button>
      <button class="tb" :class="{ on: state.autoRotate }" data-tip="自动旋转" @click="state.autoRotate = !state.autoRotate"><Icon name="refresh" :size="16" /></button>
      <button class="tb" data-tip="截图" @click="snapshot"><Icon name="image" :size="16" /></button>
    </div>

    <!-- 底部：分配结果摘要 + 下一步 -->
    <div v-if="kpis" class="bar glass">
      <div class="kpis">
        <div v-for="k in kpis" :key="k.k" class="kpi">
          <span class="kk">{{ k.k }}</span>
          <b class="num">{{ k.v }}<i>{{ k.u }}</i></b>
          <span class="ks num">{{ k.sub }}</span>
        </div>
      </div>
      <div class="cta">
        <button class="btn next" @click="open(state.focus >= 0 ? state.focus : 0)"><Icon name="boxes" :size="16" />查看码放过程</button>
        <button class="btn primary next" @click="state.ws = 'cabin'">
          <Icon name="plane" :size="16" />舱内装载<span v-if="loadErr !== null" class="num sub">误差 {{ pct(loadErr, 2) }}</span><Icon name="arrowRight" :size="15" />
        </button>
      </div>
    </div>
  </main>
</template>

<style scoped>
.labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
}
.lab {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 11px 0 9px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(10, 16, 28, 0.72);
  backdrop-filter: blur(10px);
  color: var(--text-2);
  font-size: 12px;
  white-space: nowrap;
  will-change: transform;
  transition:
    border-color 0.16s,
    background 0.16s,
    opacity 0.2s;
}
.lab b {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}
.lab .dotc {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 8px var(--ok);
}
.lab.bad .dotc {
  background: var(--warn);
  box-shadow: 0 0 8px var(--warn);
}
.lab:hover {
  border-color: rgba(255, 255, 255, 0.34);
}
.lab.on {
  height: 32px;
  border-color: rgba(46, 224, 240, 0.7);
  background: rgba(8, 26, 38, 0.86);
  box-shadow: 0 6px 22px rgba(46, 200, 245, 0.25);
  z-index: 1;
}
.go {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  margin: 0 -6px 0 3px;
  padding: 0 8px;
  border-radius: 11px;
  font-size: 11.5px;
  font-weight: 650;
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.float-l {
  display: flex;
  flex-direction: column;
  pointer-events: none;
}
.float-l > * {
  pointer-events: auto;
}
.params {
  width: calc(var(--lw) + 40px);
  z-index: 4;
}
.pill-btn {
  position: absolute;
  top: var(--top);
  right: var(--gap);
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 12px;
  height: 56px;
  padding: 0 14px 0 12px;
  border-radius: 16px;
  color: var(--text);
  text-align: left;
  transition: border-color 0.16s;
}
.pill-btn:hover {
  border-color: rgba(46, 224, 240, 0.45);
}
.ring {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  color: var(--warn);
  background: rgba(255, 194, 75, 0.12);
  border: 1.5px solid rgba(255, 194, 75, 0.5);
}
.ring.ok {
  color: var(--ok);
  background: var(--ok-soft);
  border-color: rgba(61, 220, 151, 0.5);
}
.pt {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
}
.pt b {
  font-size: 13.5px;
}
.pt span {
  font-size: 11.5px;
  color: var(--text-3);
}
.more {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  font-size: 12px;
  color: var(--accent);
}
.tools {
  position: absolute;
  top: calc(var(--top) + 68px);
  right: var(--gap);
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border-radius: 13px;
  background: rgba(10, 16, 28, 0.6);
  border: 1px solid var(--line);
  backdrop-filter: blur(12px);
  transition: right 0.42s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.tools.shifted {
  top: var(--top);
  right: calc(var(--gap) + var(--rw) + 12px);
}
.tb {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  display: grid;
  place-items: center;
  padding: 0;
}
.tb:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}
.tb.on {
  color: var(--accent);
  background: var(--accent-soft);
}
.tb[data-tip]:hover::after {
  top: 50%;
  left: auto;
  right: calc(100% + 8px);
  transform: translateY(-50%);
}
.bar {
  position: absolute;
  left: var(--il);
  right: var(--ir);
  bottom: var(--gap);
  min-height: var(--bar);
  z-index: 3;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 14px 0 6px;
  border-radius: 20px;
  transition: right 0.42s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.kpis {
  display: flex;
  min-width: 0;
  overflow: hidden;
}
.kpi {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 18px;
  flex: none;
  line-height: 1.25;
}
.kpi + .kpi {
  border-left: 1px solid var(--line);
}
.kk {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}
.kpi b {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
  white-space: nowrap;
}
.kpi b i {
  font-style: normal;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--text-3);
  margin-left: 3px;
}
.ks {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}
.cta {
  display: flex;
  gap: 8px;
  flex: none;
}
.next {
  height: 42px;
  border-radius: 13px;
  padding: 0 16px;
}
.next .sub {
  font-size: 11.5px;
  font-weight: 500;
  opacity: 0.75;
}
@media (max-width: 1500px) {
  .ks {
    display: none;
  }
  .kpi {
    padding: 0 13px;
  }
}
@media (max-width: 1300px) {
  .kpi:nth-child(n + 4) {
    display: none;
  }
  .next .sub {
    display: none;
  }
}
@media (max-width: 1080px) {
  .kpi:nth-child(n + 2) {
    display: none;
  }
}
</style>
