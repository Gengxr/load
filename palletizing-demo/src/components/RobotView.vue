<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { cargos, current, result, robotPose, skuColors, state, toast, totalSteps } from '../store'
import { goto, next, toggle } from '../playback'
import { KIND_NAME } from '../algo/types'
import { buildRobotJob, robotJobCsv } from '../algo/robot'
import ViewerPanel from './ViewerPanel.vue'
import BoxGlyph from './BoxGlyph.vue'
import Icon from './Icon.vue'

/**
 * 机械臂执行：把同一份码放方案展开成逐件的取放指令，由码垛机械臂直接执行。
 * 指令里的位姿用货盘坐标系 / 取料坐标系下的工具中心点表示，与具体设备无关；
 * 左侧的机械臂只是把这份指令演示出来。
 */
const seq = computed(() => result.value?.sequences.balance ?? null)
const job = computed(() => {
  const r = result.value
  const s = seq.value
  const p = current.value
  return r && s && p ? buildRobotJob(p.id, r, s, cargos.value, state.cons) : null
})
const task = computed(() => job.value?.tasks[state.step] ?? null)
const queue = computed(() => job.value?.tasks.slice(state.step + 1, state.step + 4) ?? [])
const progress = computed(() => (totalSteps.value ? state.step / totalSteps.value : 0))
const doneSeconds = computed(() => job.value?.tasks.slice(0, state.step).reduce((s, t) => s + t.seconds, 0) ?? 0)
const mmss = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.round(s % 60)).padStart(2, '0')
const status = computed(() => (state.step >= totalSteps.value ? 'done' : state.playing ? 'run' : robotPose.value?.gripping ? 'step' : 'idle'))
const joints = computed(() => {
  const j = robotPose.value?.joints ?? [0, 0, 0, 0]
  return [
    { n: 'J1', t: '底座回转', v: j[0], lo: -180, hi: 180 },
    { n: 'J2', t: '大臂', v: j[1], lo: -30, hi: 150 },
    { n: 'J3', t: '小臂', v: j[2], lo: -120, hi: 60 },
    { n: 'J4', t: '末端回转', v: j[3], lo: -180, hi: 180 },
  ]
})
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

function save(name: string, text: string, type: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
function exportJson() {
  if (!job.value) return
  save(`机械臂作业指令_${job.value.palletId}.json`, JSON.stringify(job.value, null, 2), 'application/json')
  toast(`已导出 ${job.value.tasks.length} 条取放指令（JSON）`)
}
function exportCsv() {
  if (!job.value) return
  save(`机械臂作业指令_${job.value.palletId}.csv`, '﻿' + robotJobCsv(job.value), 'text/csv')
  toast(`已导出 ${job.value.tasks.length} 条取放指令（CSV）`)
}

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || state.explainOpen) return
  if (e.code === 'Space') {
    e.preventDefault()
    toggle()
  } else if (e.code === 'ArrowRight') next()
  else if (e.code === 'ArrowLeft') goto(state.step - 1)
  else if (e.code === 'Home') goto(0)
}
onMounted(() => {
  state.strategy = 'balance'
  // 从"已码完"的状态进来时回到第一条指令，直接可以开始演示
  if (state.step >= totalSteps.value) goto(0)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <main class="robot">
    <ViewerPanel class="v" strategy="balance" hud="none" camera="robot" robot />
    <aside v-if="job" class="card panel">
      <div class="head">
        <span class="tag"><Icon name="robot" :size="16" />机械臂码垛单元 · {{ job.palletId }}</span>
        <span class="rpill" :class="status"><i />{{ status === 'done' ? '已完成' : status === 'run' ? '自动运行' : status === 'step' ? '单步执行' : '待机' }}</span>
      </div>
      <div class="bar"><i :style="{ width: progress * 100 + '%' }" /></div>

      <div class="mid">
        <template v-if="task">
          <div class="steprow">
            <div>
              <div class="stepno num">
                第 <b>{{ task.seq }}</b> <span>/ {{ totalSteps }} 件</span>
              </div>
              <div class="what num">
                <span class="kind" :class="task.kind">{{ KIND_NAME[task.kind] }}</span>{{ task.name }} · {{ task.size.join('×') }} · {{ task.weight.toFixed(1) }} kg
              </div>
            </div>
            <BoxGlyph :dx="task.size[0]" :dy="task.size[1]" :dz="task.size[2]" :color="skuColors.get(result!.layout.placements[seq!.order[state.step]].sku) ?? '#ccc'" :size="66" />
          </div>

          <table class="pose num">
            <thead>
              <tr>
                <th>位姿（TCP）</th>
                <th>X</th>
                <th>Y</th>
                <th>Z</th>
                <th>Rz</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><b>取料</b><small>取料坐标系</small></td>
                <td>{{ fmt(task.pick.x) }}</td>
                <td>{{ fmt(task.pick.y) }}</td>
                <td>{{ fmt(task.pick.z) }}</td>
                <td>{{ task.pick.rz }}°</td>
              </tr>
              <tr class="hl">
                <td><b>放置</b><small>货盘坐标系</small></td>
                <td>{{ fmt(task.place.x) }}</td>
                <td>{{ fmt(task.place.y) }}</td>
                <td>{{ fmt(task.place.z) }}</td>
                <td>{{ task.place.rz }}°</td>
              </tr>
            </tbody>
          </table>
          <div class="grid3 num">
            <div class="cell"><span>平移高度</span><b>{{ fmt(task.transferZ) }}</b></div>
            <div class="cell"><span>进入高度</span><b>{{ fmt(task.approachZ) }}</b></div>
            <div class="cell"><span>速度</span><b>{{ Math.round(task.speed * 100) }}%</b></div>
            <div class="cell"><span>末端工具</span><b>{{ task.gripper.type === 'vacuum' ? `吸盘 ${task.gripper.value} 区` : `夹抱 ${task.gripper.value}` }}</b></div>
            <div class="cell" :title="task.after.length ? `放下之前，第 ${task.after.join('、')} 件必须已经就位（它们托住本件）` : ''"><span>先决条件</span><b>{{ task.after.length ? `第 ${task.after.join('、')} 件已就位` : '落在货盘上' }}</b></div>
            <div class="cell"><span>估算用时</span><b>{{ task.seconds.toFixed(1) }} s</b></div>
          </div>
        </template>
        <div v-else class="done">
          <Icon name="check" :size="34" />
          <b>本托盘码放完成</b>
          <span>{{ job.tasks.length }} 条指令全部执行，等待整托称重与重心测量</span>
        </div>

        <div class="sec">
          <div class="sec-t">关节状态<span class="grip" :class="{ on: robotPose?.gripping }"><i />{{ robotPose?.gripping ? '已抓取' : '已释放' }}</span></div>
          <div class="joints num">
            <div v-for="j in joints" :key="j.n" class="jt">
              <span class="jn">{{ j.n }}<small>{{ j.t }}</small></span>
              <span class="jbar"><i :style="{ left: Math.max(0, Math.min(100, ((j.v - j.lo) / (j.hi - j.lo)) * 100)) + '%' }" /></span>
              <b>{{ j.v.toFixed(1) }}°</b>
            </div>
          </div>
        </div>

        <div v-if="queue.length" class="sec">
          <div class="sec-t">后续指令</div>
          <div class="queue num">
            <div v-for="t in queue" :key="t.seq" class="q">
              <span class="qn">{{ t.seq }}</span>
              <span class="qk" :class="t.kind" />
              <span class="qs">{{ t.size.join('×') }}</span>
              <span class="qp">→ ({{ fmt(t.place.x) }}, {{ fmt(t.place.y) }}, {{ fmt(t.place.z) }}) {{ t.place.rz ? '转 90°' : '' }}</span>
            </div>
          </div>
        </div>

        <div class="sec">
          <div class="sec-t">选型核对<span class="hint">指令与设备无关，按此核对机械臂即可</span></div>
          <div class="req num">
            <span>最大负载 <b>{{ job.requirement.payload.toFixed(1) }} kg</b></span>
            <span>作业高度 <b>{{ fmt(job.requirement.z[0]) }}–{{ fmt(job.requirement.z[1]) }} mm</b></span>
            <span>货盘范围 <b>{{ job.envelope.x }}×{{ job.envelope.y }}×{{ job.envelope.z }}</b></span>
          </div>
        </div>
      </div>

      <div class="actions">
        <div class="row main">
          <button class="btn primary big" @click="toggle()">
            <Icon :name="state.playing ? 'pause' : 'play'" :size="18" />{{ state.playing ? '暂停' : status === 'done' ? '重新运行' : '自动运行' }}<kbd>空格</kbd>
          </button>
          <button class="btn big" :disabled="state.playing || status === 'done'" title="执行下一条指令" @click="next()"><Icon name="next" :size="17" />单步</button>
          <button class="btn big" :disabled="!state.step" title="回到第一条指令" @click="goto(0)"><Icon name="first" :size="17" /></button>
        </div>
        <div class="row">
          <button class="btn" @click="exportJson"><Icon name="download" :size="15" />作业指令 JSON</button>
          <button class="btn" @click="exportCsv"><Icon name="download" :size="15" />路径点表 CSV</button>
        </div>
      </div>
      <div class="stats num">
        <span>已执行 <b>{{ state.step }}</b> / {{ totalSteps }}</span>
        <span>估算用时 <b>{{ mmss(doneSeconds) }}</b> / {{ mmss(job.summary.seconds) }}</span>
        <span>节拍 <b>{{ job.summary.perHour }}</b> 件/时</span>
      </div>
    </aside>
  </main>
</template>

<style scoped>
.robot {
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
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.tag {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-2);
  font-weight: 600;
  letter-spacing: 0.04em;
}
.rpill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  color: var(--text-2);
  background: rgba(148, 163, 184, 0.12);
}
.rpill i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
}
.rpill.run,
.rpill.step {
  color: var(--accent);
  background: rgba(34, 211, 238, 0.12);
}
.rpill.run i {
  animation: blink 1s infinite;
}
.rpill.done {
  color: var(--ok);
  background: rgba(52, 211, 153, 0.12);
}
@keyframes blink {
  50% {
    opacity: 0.25;
  }
}
.bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.14);
  overflow: hidden;
  flex: none;
}
.bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #22d3ee, #3b82f6);
  transition: width 0.4s;
}
.mid {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0 -6px;
  padding: 0 6px;
  scrollbar-width: thin;
}
.mid > * {
  flex: none;
}
.steprow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.stepno {
  font-size: 20px;
  color: var(--text-2);
}
.stepno b {
  font-size: 46px;
  color: var(--text);
  line-height: 1;
}
.stepno span {
  font-size: 18px;
}
.what {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--text-2);
}
.kind {
  display: inline-block;
  margin-right: 7px;
  padding: 1px 8px;
  border-radius: 6px;
  font-weight: 600;
  color: #1a1206;
  background: #d8b48a;
}
.kind.wood {
  background: #c08a55;
}
.kind.case {
  background: #8fa372;
}
.pose {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  border: 1px solid var(--line-2);
  border-radius: 12px;
  overflow: hidden;
}
.pose th {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
  text-align: right;
  padding: 7px 12px 5px;
  background: rgba(148, 163, 184, 0.05);
}
.pose th:first-child,
.pose td:first-child {
  text-align: left;
}
.pose td {
  text-align: right;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
  font-family: var(--mono);
  font-size: 14px;
}
.pose td:first-child {
  font-family: inherit;
  font-size: 13px;
}
.pose td small {
  display: block;
  font-size: 10.5px;
  color: var(--text-3);
  font-weight: 400;
}
.pose tr.hl td {
  background: rgba(34, 211, 238, 0.07);
  color: var(--text);
}
.pose tr.hl td:not(:first-child) {
  color: var(--accent);
  font-weight: 600;
}
.grid3 {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.cell {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(148, 163, 184, 0.06);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.cell span {
  font-size: 11px;
  color: var(--text-3);
}
.cell b {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sec-t {
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 650;
  color: var(--text-2);
  letter-spacing: 0.04em;
  margin-bottom: 7px;
}
.sec-t .hint {
  margin-left: auto;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--text-3);
  font-size: 11px;
}
.grip {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  letter-spacing: 0;
  color: var(--text-3);
}
.grip i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(148, 163, 184, 0.5);
}
.grip.on {
  color: var(--ok);
}
.grip.on i {
  background: var(--ok);
  box-shadow: 0 0 8px var(--ok);
}
.joints {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px 16px;
}
.jt {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 54px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.jn {
  font-weight: 650;
  color: var(--text);
}
.jn small {
  margin-left: 5px;
  font-weight: 400;
  color: var(--text-3);
  font-size: 10.5px;
}
.jbar {
  position: relative;
  height: 4px;
  border-radius: 2px;
  background: rgba(148, 163, 184, 0.16);
}
.jbar i {
  position: absolute;
  top: -3px;
  width: 4px;
  height: 10px;
  margin-left: -2px;
  border-radius: 2px;
  background: var(--accent);
}
.jt b {
  text-align: right;
  font-family: var(--mono);
  font-weight: 500;
  color: var(--text-2);
}
.queue {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.q {
  display: grid;
  grid-template-columns: 30px 10px 104px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(148, 163, 184, 0.05);
  font-size: 12px;
  color: var(--text-2);
}
.qn {
  color: var(--text-3);
  font-weight: 600;
}
.qk {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: #d8b48a;
}
.qk.wood {
  background: #b9824d;
}
.qk.case {
  background: #6f8256;
}
.qp {
  font-family: var(--mono);
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.req {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  font-size: 12px;
  color: var(--text-3);
}
.req b {
  color: var(--text-2);
  font-weight: 600;
}
.done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 26px 0 18px;
  color: var(--ok);
  text-align: center;
}
.done b {
  font-size: 20px;
}
.done span {
  font-size: 12.5px;
  color: var(--text-2);
}
.actions {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.row.main {
  grid-template-columns: minmax(0, 1fr) auto auto;
}
.big {
  height: 46px;
  font-size: 15px;
  font-weight: 650;
  justify-content: center;
  gap: 8px;
}
.row .btn {
  justify-content: center;
}
kbd {
  font-family: var(--mono);
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.22);
  margin-left: 4px;
}
.stats {
  flex: none;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-3);
  padding-top: 10px;
  border-top: 1px solid var(--line);
}
.stats b {
  color: var(--text);
  font-weight: 650;
}
@media (max-width: 1320px) {
  .robot {
    grid-template-columns: minmax(0, 1fr) 400px;
  }
}
@media (max-height: 760px) {
  .card {
    padding: 14px 16px;
    gap: 10px;
  }
  .stepno b {
    font-size: 36px;
  }
  .big {
    height: 40px;
  }
}
</style>
