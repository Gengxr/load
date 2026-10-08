<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { cabin, loading, loadingBest, movePallet, pallets, restoreLoading, rotatePallet, skuColors, state, track, units } from '../store'
import { trackAt } from '../algo/cabin'
import { CabinViewer, type CabinCamera, type CabinPallet } from '../viz/CabinViewer'
import { GAP, TOP, BAR, usePanels } from '../layout'
import { pct, signedPct } from '../format'
import CabinPanel from '../components/CabinPanel.vue'
import CabinMetrics from '../components/CabinMetrics.vue'
import CabinTimeline from '../components/CabinTimeline.vue'
import Icon from '../components/Icon.vue'

/** 舱内装载工作区：构型 → 货位配平 → 装载 / 投放 / 卸载过程重心回放 → 人工调整 */
const { lw, rw } = usePanels()
const host = ref<HTMLDivElement | null>(null)
const viewer = shallowRef<CabinViewer | null>(null)
const cam = ref<CabinCamera>('iso')
const palEls = new Map<string, HTMLElement>()
const doorEls = new Map<string, HTMLElement>()
const cargoEl = ref<HTMLElement | null>(null)
const sysEl = ref<HTMLElement | null>(null)
const targetEl = ref<HTMLElement | null>(null)

const insets = computed(() => ({
  l: GAP + lw.value + GAP,
  r: state.cabinPanel ? GAP + rw.value + GAP : GAP,
  t: TOP + 40,
  b: GAP + BAR + 16,
}))
const vars = computed(() => ({ '--il': insets.value.l + 'px', '--ir': insets.value.r + 'px' }))

function palletList(): CabinPallet[] {
  const byId = new Map(pallets.value.map((p) => [p.id, p]))
  return units.value.map((u) => {
    const p = byId.get(u.id)
    return {
      unit: u,
      placements: p?.result.layout.placements ?? null,
      colors: p ? p.result.layout.placements.map((pl) => skuColors.value.get(pl.sku) ?? '#cbd5e1') : [],
    }
  })
}

const place = (el: HTMLElement | null | undefined, p: { x: number; y: number; visible: boolean } | undefined, anchor = '-50%, -100%') => {
  if (!el || !p) return
  el.style.transform = `translate(${anchor}) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`
  el.style.opacity = p.visible ? '1' : '0'
}
function placeLabels() {
  const v = viewer.value
  if (!v) return
  const pos = v.labelPositions()
  for (const [id, el] of palEls) place(el, pos.pallets[id])
  for (const d of pos.doors) place(doorEls.get(d.id), d, '-50%, -50%')
  place(cargoEl.value, pos.cargo)
  place(sysEl.value, pos.system, '12px, -50%')
  place(targetEl.value, pos.target, '-50%, 14px')
}

function sync(full: boolean) {
  const v = viewer.value
  const lp = loading.value
  if (!v) return
  if (full) {
    v.setConfig(cabin.value)
    v.setPallets(palletList(), state.cons.footprintX, state.cons.footprintY)
  }
  if (lp) v.setPlan(lp.assignments, track.value)
  v.setTime(state.cabinT)
  v.setSelection(state.cabinSel)
}

onMounted(() => {
  const v = new CabinViewer(host.value!, state.settings.quality)
  viewer.value = v
  v.setViewInsets(insets.value, false)
  v.onRender = placeLabels
  v.onPick = (kind, id) => {
    if (kind === 'pallet') state.cabinSel = state.cabinSel === id ? '' : id
    else if (kind === 'slot' && state.cabinSel) {
      movePallet(state.cabinSel, id)
      state.cabinSel = ''
    } else state.cabinSel = ''
  }
  sync(true)
  v.setAutoRotate(state.autoRotate)
})
onBeforeUnmount(() => viewer.value?.dispose())

watch([cabin, units], () => sync(true))
watch([loading, track], () => sync(false))
watch(
  () => state.cabinT,
  (t) => viewer.value?.setTime(t),
)
watch(
  () => state.cabinSel,
  (id) => viewer.value?.setSelection(id),
)
watch(insets, (ins) => {
  viewer.value?.setViewInsets(ins)
  setTimeout(() => viewer.value?.refit(), 60)
})
watch(
  () => state.settings.quality,
  (q) => viewer.value?.setQuality(q),
)
watch(
  () => state.autoRotate,
  (on) => viewer.value?.setAutoRotate(on),
)

function setCam(c: CabinCamera) {
  cam.value = c
  viewer.value?.setCameraPreset(c)
}
function snapshot() {
  const v = viewer.value
  if (!v) return
  const a = document.createElement('a')
  a.href = v.snapshot()
  a.download = `舱内装载_${cabin.value.model}.png`
  a.click()
}

// ── HUD 数据 ──
const now = computed(() => (track.value ? trackAt(track.value, state.cabinT) : null))
const opInfo = computed(() => {
  const tr = track.value
  const lp = loading.value
  if (!tr || !lp) return null
  const n = tr.ops.length
  const k = Math.min(n - 1, Math.floor(state.cabinT + 1e-6))
  const done = tr.kind === 'load' ? state.cabinT >= n - 1e-6 : state.cabinT <= 1e-6
  const finished = tr.kind !== 'load' && state.cabinT >= n - 1e-6
  const op = tr.ops[Math.max(0, k)]
  const u = units.value.find((x) => x.id === op?.palletId)
  return { n, k, done, finished, op, u, name: tr.name, kind: tr.kind }
})
const sysNorm = computed(() => {
  const tr = track.value
  const p = now.value
  if (!tr || !p) return 0
  return Math.max(p.devX >= 0 ? p.devX / tr.env[1] : p.devX / tr.env[0], Math.abs(p.devY) / tr.envLateral)
})
const selUnit = computed(() => units.value.find((u) => u.id === state.cabinSel) ?? null)
const selAssign = computed(() => loading.value?.assignments.find((a) => a.palletId === state.cabinSel) ?? null)
const manual = computed(() => loading.value?.solver.method === 'manual')
const maxErr = computed(() => (loading.value ? Math.max(Math.abs(loading.value.metrics.errX), Math.abs(loading.value.metrics.errY)) : 0))
const allOk = computed(() => !!loading.value && loading.value.metrics.pass && Object.values(loading.value.tracks).every((t) => t.ok))
const cams: { k: CabinCamera; n: string }[] = [
  { k: 'iso', n: '等轴' },
  { k: 'top', n: '俯视' },
  { k: 'side', n: '侧视' },
  { k: 'tail', n: '尾部' },
]
</script>

<template>
  <main v-if="!pallets.length" class="workspace none">
    <div class="empty"><Icon name="plane" :size="34" />还没有整托货物，请先在「出库分盘」生成码盘方案<button class="btn primary" @click="state.ws = 'order'">前往出库分盘</button></div>
  </main>
  <main v-else class="workspace" :style="vars">
    <div ref="host" class="stage3d" />

    <!-- 三维标签 -->
    <div class="labels">
      <span v-for="d in cabin.doors" :key="d.id" :ref="(el) => (el ? doorEls.set(d.id, el as HTMLElement) : doorEls.delete(d.id))" class="door">{{ d.name }}</span>
      <button
        v-for="u in units"
        :key="u.id"
        :ref="(el) => (el ? palEls.set(u.id, el as HTMLElement) : palEls.delete(u.id))"
        class="lab"
        :class="{ on: state.cabinSel === u.id }"
        @click="state.cabinSel = state.cabinSel === u.id ? '' : u.id"
      >
        <b class="num">{{ u.id }}</b><span class="num">{{ u.weight.toFixed(0) }} kg</span>
      </button>
      <span ref="targetEl" class="mk target">理论重心</span>
      <span ref="sysEl" class="mk sys" :class="{ bad: now && !now.ok }">整机重心</span>
      <span ref="cargoEl" class="mk cargo">货物重心</span>
    </div>

    <div class="float-l"><CabinPanel /></div>

    <!-- 左上：当前作业步骤 -->
    <div v-if="opInfo && now" class="hud glass">
      <div class="h1">
        <span class="tag">{{ opInfo.name }}</span>
        <template v-if="opInfo.done && opInfo.kind === 'load'"><b>装载完成</b><span class="num">共 {{ opInfo.n }} 盘</span></template>
        <template v-else-if="opInfo.finished"><b>{{ opInfo.kind === 'drop' ? '投放完成' : '卸载完成' }}</b><span class="num">共 {{ opInfo.n }} 盘</span></template>
        <template v-else-if="opInfo.done"><b>满载待命</b><span class="num">按播放开始</span></template>
        <template v-else>
          <b class="num">第 {{ opInfo.k + 1 }} / {{ opInfo.n }} 盘</b>
          <span class="num">{{ opInfo.op.palletId }} · {{ opInfo.u?.weight.toFixed(0) }} kg {{ opInfo.op.dir === 'in' ? '→' : '←' }} {{ opInfo.op.slotId }}</span>
        </template>
      </div>
      <div class="h2">
        <div class="rd">
          <span>整机重心偏差</span>
          <b class="num" :class="now.ok ? 'ok' : 'bad'">X {{ signedPct(now.devX) }}<i>Y {{ signedPct(now.devY) }}</i></b>
          <div class="envbar"><i :class="{ bad: sysNorm > 1 }" :style="{ width: Math.min(100, sysNorm * 100) + '%' }" /></div>
          <em class="num">占包络 {{ pct(sysNorm, 0) }}</em>
        </div>
        <div class="rd">
          <span>机上货物</span>
          <b class="num">{{ now.cargoMass.toFixed(0) }}<i>kg</i></b>
          <em>{{ now.label }}</em>
        </div>
      </div>
    </div>

    <!-- 右上：摘要胶囊 / 指标抽屉 -->
    <Transition name="fade">
      <button v-if="loading && !state.cabinPanel" class="pill-btn glass" @click="state.cabinPanel = true">
        <span class="ring" :class="{ ok: allOk }"><Icon :name="allOk ? 'check' : 'alert'" :size="14" :stroke="2.6" /></span>
        <span class="pt">
          <b class="num">重心误差 {{ pct(maxErr, 2) }}</b>
          <span>{{ allOk ? '装载与全过程均达标' : '存在超限项' }}</span>
        </span>
        <span class="more">指标<Icon name="chevron" :size="14" /></span>
      </button>
    </Transition>
    <Transition name="drawer">
      <CabinMetrics v-if="state.cabinPanel" class="float-r" />
    </Transition>

    <div class="tools" :class="{ shifted: state.cabinPanel }">
      <button v-for="c in cams" :key="c.k" class="tb txt" :class="{ on: cam === c.k }" @click="setCam(c.k)">{{ c.n }}</button>
      <i class="sep" />
      <button class="tb" :class="{ on: state.autoRotate }" data-tip="自动旋转" @click="state.autoRotate = !state.autoRotate"><Icon name="refresh" :size="16" /></button>
      <button class="tb" data-tip="截图" @click="snapshot"><Icon name="image" :size="16" /></button>
    </div>

    <!-- 人工调整提示条 -->
    <Transition name="pop">
      <div v-if="selUnit && selAssign" class="adjust glass">
        <span class="pid num">{{ selUnit.id }}</span>
        <span class="txt">在 <b class="num">{{ selAssign.slotId }}</b> · {{ selUnit.weight.toFixed(0) }} kg · 点击任意货位可<b>移动 / 互换</b></span>
        <button class="btn sm" @click="rotatePallet(selUnit.id)"><Icon name="rotateCw" :size="13" />旋转 90°</button>
        <button class="btn sm ghost" @click="state.cabinSel = ''">取消</button>
      </div>
      <div v-else-if="manual && loadingBest" class="adjust glass warn">
        <Icon name="click" :size="15" />
        <span class="txt">已人工调整：重心误差 <b class="num">{{ pct(Math.max(Math.abs(loadingBest.metrics.errX), Math.abs(loadingBest.metrics.errY)), 2) }}</b> → <b class="num" :class="loading!.metrics.pass ? '' : 'bad'">{{ pct(maxErr, 2) }}</b></span>
        <button class="btn sm" @click="restoreLoading"><Icon name="undo" :size="13" />恢复最优方案</button>
      </div>
    </Transition>

    <CabinTimeline class="transport" />
  </main>
</template>

<style scoped>
.none {
  display: grid;
  place-items: center;
}
.labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
}
.labels > * {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
  white-space: nowrap;
  transition: opacity 0.2s;
}
.lab {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 9px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(10, 16, 28, 0.72);
  backdrop-filter: blur(8px);
  color: var(--text-2);
  font-size: 11px;
}
.lab b {
  color: var(--text);
  font-size: 12px;
  font-weight: 700;
}
.lab:hover {
  border-color: rgba(255, 255, 255, 0.36);
}
.lab.on {
  border-color: rgba(46, 224, 240, 0.8);
  background: rgba(8, 26, 38, 0.9);
  box-shadow: 0 4px 18px rgba(46, 200, 245, 0.3);
}
.door {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--cog);
  padding: 2px 8px;
  border-radius: 8px;
  background: rgba(30, 22, 6, 0.6);
  border: 1px solid rgba(255, 194, 75, 0.35);
}
.mk {
  font-size: 11px;
  font-weight: 650;
  padding: 2px 8px;
  border-radius: 8px;
}
.mk.cargo {
  color: #1c1300;
  background: var(--cog);
  box-shadow: 0 2px 12px rgba(255, 194, 75, 0.45);
}
.mk.sys {
  color: var(--accent);
  background: rgba(6, 22, 30, 0.75);
  border: 1px solid rgba(46, 224, 240, 0.4);
}
.mk.sys.bad {
  color: var(--bad);
  border-color: rgba(255, 107, 107, 0.5);
}
.mk.target {
  color: rgba(255, 255, 255, 0.85);
  background: rgba(10, 16, 28, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.float-l {
  display: flex;
  flex-direction: column;
  pointer-events: none;
}
.float-l > * {
  pointer-events: auto;
}
.hud {
  position: absolute;
  top: var(--top);
  left: var(--il);
  z-index: 3;
  padding: 12px 16px 12px;
  border-radius: 16px;
  min-width: 300px;
}
.h1 {
  display: flex;
  align-items: baseline;
  gap: 10px;
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
}
.h1 b {
  font-size: 15px;
  color: var(--text);
}
.tag {
  align-self: center;
  height: 20px;
  padding: 0 8px;
  border-radius: 6px;
  display: inline-grid;
  place-items: center;
  font-size: 11px;
  font-weight: 650;
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.h2 {
  display: flex;
  gap: 22px;
  margin-top: 10px;
}
.rd {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.rd > span {
  font-size: 11px;
  color: var(--text-3);
}
.rd b {
  font-size: 20px;
  font-weight: 750;
  letter-spacing: -0.02em;
  line-height: 1.25;
  white-space: nowrap;
}
.rd b i {
  font-style: normal;
  font-size: 12px;
  font-weight: 550;
  color: var(--text-3);
  margin-left: 8px;
}
.rd em {
  font-style: normal;
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}
.ok {
  color: var(--ok);
}
.bad {
  color: var(--bad);
}
.envbar {
  height: 4px;
  width: 150px;
  margin: 4px 0 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.envbar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #2ee0f0, #5b8cff);
  transition: width 0.12s linear;
}
.envbar i.bad {
  background: var(--bad);
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
  width: 34px;
  height: 30px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  display: grid;
  place-items: center;
  padding: 0;
}
.tb.txt {
  font-size: 11.5px;
  font-weight: 550;
}
.tb:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}
.tb.on {
  color: var(--accent);
  background: var(--accent-soft);
}
.sep {
  height: 1px;
  margin: 3px 4px;
  background: var(--line-2);
}
.tb[data-tip]:hover::after {
  top: 50%;
  left: auto;
  right: calc(100% + 8px);
  transform: translateY(-50%);
}
.adjust {
  position: absolute;
  left: calc(var(--il) + (100% - var(--il) - var(--ir)) / 2);
  bottom: calc(var(--gap) + var(--bar) + 12px);
  transform: translateX(-50%);
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding: 0 10px 0 12px;
  border-radius: 14px;
  font-size: 12.5px;
  color: var(--text-2);
  white-space: nowrap;
  border-color: rgba(46, 224, 240, 0.4);
  background: var(--glass-solid);
  max-width: calc(100% - var(--il) - var(--ir) - 8px);
}
.adjust .txt {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.adjust > * {
  flex: none;
}
.adjust > .txt {
  flex: 0 1 auto;
}
.adjust.warn {
  border-color: rgba(255, 194, 75, 0.4);
  color: var(--warn);
}
.adjust .txt b {
  color: var(--text);
}
.adjust .txt b.bad {
  color: var(--bad);
}
.adjust .pid {
  height: 26px;
  padding: 0 9px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  font-weight: 700;
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.transport {
  position: absolute;
  left: var(--il);
  right: var(--ir);
  bottom: var(--gap);
  height: var(--bar);
  z-index: 3;
  transition: right 0.42s cubic-bezier(0.2, 0.8, 0.2, 1);
}
@media (max-width: 1280px) {
  .hud {
    min-width: 0;
  }
  .rd:nth-child(2) {
    display: none;
  }
}
</style>
