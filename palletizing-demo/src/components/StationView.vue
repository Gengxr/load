<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { cargoById, result, skuColors, state, totalSteps } from '../store'
import { goto, next } from '../playback'
import { pct } from '../format'
import ViewerPanel from './ViewerPanel.vue'
import LayerView from './LayerView.vue'
import BoxGlyph from './BoxGlyph.vue'
import Icon from './Icon.vue'

/**
 * 工位引导（对应技术要求第 1 章"人工在码盘动画的提示下…配备输入设备用于确认"）
 * 输入设备为 USB 脚踏 / 按钮盒（HID 键盘）：空格 / 回车 / F9 = 确认，← / Backspace / F10 = 回退，E = 异常上报
 */

const seq = computed(() => result.value?.sequences.balance ?? null)
const cur = computed(() => {
  const r = result.value
  const s = seq.value
  if (!r || !s || state.step >= s.order.length) return null
  const i = s.order[state.step]
  const p = r.layout.placements[i]
  return { i, p, c: cargoById.value.get(p.cargoId), sup: r.supporters[i].length }
})
const colors = computed(() => result.value?.layout.placements.map((p) => skuColors.value.get(p.sku) ?? '#ccc') ?? [])
const seqOf = computed(() => {
  const r = result.value
  const s = seq.value
  if (!r || !s) return []
  const a = new Array(r.layout.placements.length).fill(0)
  s.order.forEach((pi, k) => (a[pi] = k))
  return a
})
const placed = computed(() => new Set(seq.value?.order.slice(0, state.step) ?? []))
const ratio = computed(() => seq.value?.steps.ratio[Math.min(state.step + 1, (seq.value?.steps.ratio.length ?? 1) - 1)] ?? 0)

const busy = ref(false)
const toast = ref('')
const log = ref<number[]>([])
const startedAt = ref<number | null>(null)
const now = ref(Date.now())
let timer = 0
let toastTimer = 0

function beep(freq = 880, dur = 0.09) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = freq
    g.gain.setValueAtTime(0.12, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + dur)
    setTimeout(() => ctx.close(), 300)
  } catch {
    /* 无音频设备时忽略 */
  }
}

function showToast(t: string) {
  toast.value = t
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2600)
}

let lastPress = 0
async function confirm() {
  // 脚踏防抖：500ms 内的重复触发只算一次
  if (Date.now() - lastPress < 500 || busy.value || !cur.value) return
  lastPress = Date.now()
  busy.value = true
  if (startedAt.value === null) startedAt.value = Date.now()
  log.value.push(Date.now())
  beep(988)
  await next()
  busy.value = false
  if (state.step >= totalSteps.value) {
    beep(1318, 0.18)
    showToast('本托盘码放完成，请进行网兜捆扎与重心测量')
  }
}
function rollback() {
  if (!state.step) return
  goto(state.step - 1)
  log.value.pop()
  beep(440)
  showToast(`已回退：第 ${state.step + 1} 件重新码放`)
}
function exception() {
  beep(330, 0.25)
  showToast(`已上报异常（第 ${state.step + 1} 件：缺件 / 破损 / 尺寸不符），等待规划员处理`)
}

function onKey(e: KeyboardEvent) {
  if (['Space', 'Enter', 'NumpadEnter', 'F9'].includes(e.code)) {
    e.preventDefault()
    confirm()
  } else if (['ArrowLeft', 'Backspace', 'F10'].includes(e.code)) {
    e.preventDefault()
    rollback()
  } else if (e.code === 'KeyE') exception()
}

onMounted(() => {
  state.strategy = 'balance'
  window.addEventListener('keydown', onKey)
  timer = window.setInterval(() => (now.value = Date.now()), 500)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  clearInterval(timer)
})

const elapsed = computed(() => {
  if (startedAt.value === null) return '00:00'
  const s = Math.floor((now.value - startedAt.value) / 1000)
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
})
const avg = computed(() => {
  const l = log.value
  if (l.length < 2) return '—'
  return ((l[l.length - 1] - l[0]) / 1000 / (l.length - 1)).toFixed(1) + ' s/件'
})
const progress = computed(() => (totalSteps.value ? state.step / totalSteps.value : 0))
</script>

<template>
  <main class="station">
    <ViewerPanel class="v" strategy="balance" hud="none" camera="operator" />
    <aside class="card panel">
      <div class="head">
        <span class="tag">码盘工位 01</span>
        <span class="num prog">{{ Math.round(progress * 100) }}%</span>
      </div>
      <div class="bar"><i :style="{ width: progress * 100 + '%' }" /></div>

      <!-- 中部信息可滚动；确认按钮固定在底部，任何屏幕高度下都可见 -->
      <div class="mid">
      <template v-if="cur">
        <div class="steprow">
          <div class="stepno num">
            第 <b>{{ state.step + 1 }}</b> <span>/ {{ totalSteps }} 件</span>
          </div>
          <BoxGlyph :dx="cur.p.dx" :dy="cur.p.dy" :dz="cur.p.dz" :color="skuColors.get(cur.p.sku) ?? '#ccc'" :size="72" />
        </div>
        <div class="rfid">
          <span>RFID 末 6 位</span>
          <b class="num">{{ cur.c?.rfid.slice(-6) }}</b>
        </div>
        <div class="grid2">
          <div class="cell">
            <span>规格</span>
            <b class="num">{{ cur.p.dx }}×{{ cur.p.dy }}×{{ cur.p.dz }}</b>
          </div>
          <div class="cell">
            <span>重量</span>
            <b class="num">{{ cur.p.weight.toFixed(1) }} kg</b>
          </div>
          <div class="cell">
            <span>层号</span>
            <b class="num">第 {{ cur.p.layer + 1 }} 层</b>
          </div>
          <div class="cell">
            <span>朝向</span>
            <b>{{ cur.p.rotated ? '长边朝前后' : '长边朝左右' }}</b>
          </div>
        </div>
        <div class="where">
          <LayerView
            :placements="result!.layout.placements"
            :layer="cur.p.layer"
            :colors="colors"
            :seq-of="seqOf"
            :fx="state.cons.footprintX"
            :fy="state.cons.footprintY"
            :placed-set="placed"
            :highlight="cur.i"
            :show-lower="false"
            :size="236"
          />
          <div class="where-t">
            <div class="chipline"><i :style="{ background: skuColors.get(cur.p.sku) }" />{{ cur.c?.id }}</div>
            <div>俯视图白框为本件位置（下方为操作侧）</div>
            <div>{{ cur.sup ? `压在 ${cur.sup} 件货物上，放稳后确认` : '直接放在货盘上，对齐边线' }}</div>
            <div class="bal num">放下后重心偏心 <b :class="ratio > state.cons.cogOffsetRatioMax ? 'bad' : 'ok'">{{ pct(ratio) }}</b></div>
          </div>
        </div>
      </template>
      <div v-else class="done">
        <Icon name="check" :size="36" />
        <b>本托盘码放完成</b>
        <span>请进行网兜捆扎，然后在测量台完成整托重量、重心测量</span>
      </div>
      </div>

      <div class="actions">
        <button class="btn primary big" :disabled="!cur || busy" @click="confirm">
          <Icon name="check" :size="20" />确认放置
          <kbd>空格</kbd><kbd>F9</kbd><kbd>脚踏</kbd>
        </button>
        <div class="row">
          <button class="btn" :disabled="!state.step" @click="rollback"><Icon name="undo" :size="15" />回退 <kbd>←</kbd></button>
          <button class="btn warn" @click="exception"><Icon name="alert" :size="15" />异常上报 <kbd>E</kbd></button>
        </div>
      </div>
      <div class="stats num">
        <span>作业用时 <b>{{ elapsed }}</b></span>
        <span>平均节拍 <b>{{ avg }}</b></span>
        <span>已确认 <b>{{ log.length }}</b> 件</span>
      </div>
    </aside>
    <Transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </main>
</template>

<style scoped>
.station {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 460px;
  gap: 12px;
  padding: 12px;
  position: relative;
}
.v {
  min-height: 0;
}
.card {
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}
.mid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin: 0 -6px;
  padding: 0 6px;
  scrollbar-width: thin;
}
.mid > * {
  flex: none;
}
.actions,
.stats,
.head,
.bar {
  flex: none;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tag {
  font-size: 13px;
  color: var(--text-2);
  font-weight: 600;
  letter-spacing: 0.05em;
}
.prog {
  font-size: 13px;
  color: var(--accent);
  font-weight: 700;
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.14);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #22d3ee, #3b82f6);
  transition: width 0.4s;
}
.stepno {
  font-size: 22px;
  color: var(--text-2);
}
.stepno b {
  font-size: 56px;
  color: var(--text);
  line-height: 1;
}
.stepno span {
  font-size: 20px;
}
.rfid {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgba(34, 211, 238, 0.08);
  border: 1px solid rgba(34, 211, 238, 0.3);
}
.rfid span {
  font-size: 13px;
  color: var(--text-2);
}
.rfid b {
  font-family: var(--mono);
  font-size: 40px;
  letter-spacing: 0.08em;
  color: var(--accent);
}
.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.cell {
  padding: 10px 12px;
  border-radius: 11px;
  background: rgba(148, 163, 184, 0.06);
  display: flex;
  flex-direction: column;
}
.cell span {
  font-size: 12px;
  color: var(--text-3);
}
.cell b {
  font-size: 22px;
  font-weight: 650;
}
.steprow {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.where {
  display: grid;
  grid-template-columns: 236px 1fr;
  gap: 14px;
  align-items: center;
}
.where-t {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12.5px;
  color: var(--text-2);
}
.chipline {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--text);
  font-size: 14px;
}
.chipline i {
  width: 14px;
  height: 14px;
  border-radius: 4px;
}
.bal b.ok {
  color: var(--ok);
}
.bal b.bad {
  color: var(--bad);
}
.done {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--ok);
  text-align: center;
}
.done b {
  font-size: 26px;
}
.done span {
  color: var(--text-2);
  font-size: 14px;
  max-width: 300px;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.btn.big {
  height: 64px;
  font-size: 20px;
  border-radius: 14px;
  gap: 10px;
}
.btn.big kbd {
  background: rgba(4, 18, 26, 0.18);
  color: #04121a;
  border-color: rgba(4, 18, 26, 0.25);
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.row .btn {
  height: 46px;
  font-size: 15px;
}
.btn.warn {
  color: #fcd34d;
  border-color: rgba(251, 191, 36, 0.35);
}
.stats {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-3);
}
.stats b {
  color: var(--text);
}
.toast {
  position: absolute;
  left: calc((100% - 460px) / 2);
  transform: translateX(-50%);
  top: 26px;
  padding: 12px 20px;
  border-radius: 12px;
  background: rgba(8, 12, 20, 0.92);
  border: 1px solid rgba(251, 191, 36, 0.45);
  color: #fde68a;
  font-size: 15px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  z-index: 5;
}
@media (max-height: 820px) {
  .card {
    padding: 16px 18px;
    gap: 10px;
  }
  .mid {
    gap: 10px;
  }
  .stepno b {
    font-size: 42px;
  }
  .stepno span {
    font-size: 16px;
  }
  .rfid {
    padding: 8px 12px;
  }
  .rfid b {
    font-size: 30px;
  }
  .cell {
    padding: 7px 10px;
  }
  .cell b {
    font-size: 18px;
  }
  .where {
    grid-template-columns: 170px 1fr;
  }
  .where :deep(.lv) {
    width: 170px;
    height: 170px;
  }
  .btn.big {
    height: 52px;
    font-size: 18px;
  }
  .row .btn {
    height: 40px;
  }
}
</style>
