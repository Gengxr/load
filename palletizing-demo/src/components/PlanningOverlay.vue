<script setup lang="ts">
import { computed } from 'vue'
import { allocation, pipelineTasks, state } from '../store'
import { poolSize } from '../taskPool'
import Icon from './Icon.vue'

/** 联动规划进度：多盘分配 → 各盘并行码放 → 舱内装载 */
const phases = [
  { k: 'alloc', n: '多盘分配', d: '层单元分解 · 多路划分 · 局部搜索' },
  { k: 'pallet', n: '各盘并行码放', d: '布局 · 顺序 · 指标校验，放不下自动回流' },
  { k: 'loading', n: '舱内装载', d: '货位分配 · 过程重心校验' },
]
const idx = computed(() => Math.max(0, phases.findIndex((p) => p.k === state.phase)))
const jobs = computed(() => pipelineTasks.value.slice(-12))
const done = computed(() => pipelineTasks.value.filter((t) => t.status === 'done').length)
</script>

<template>
  <Transition name="fade">
    <div v-if="state.planning" class="ov">
      <div class="box glass">
        <div class="hd">
          <div class="spinner"><i /><i /><i /></div>
          <div>
            <div class="t">正在生成码盘与装载方案</div>
            <div class="s num">
              <template v-if="allocation && state.phase !== 'alloc'">{{ allocation.stats.cargoCount }} 件货物 · {{ allocation.groups.length }} 个货盘 · {{ poolSize }} 线程并行</template>
              <template v-else>分析出库清单…</template>
            </div>
          </div>
        </div>
        <ol class="ph3">
          <li v-for="(p, i) in phases" :key="p.k" :class="{ done: i < idx, on: i === idx }">
            <span class="d"><Icon v-if="i < idx" name="check" :size="12" :stroke="3" /></span>
            <div>
              <b>{{ p.n }}</b>
              <span>{{ p.d }}</span>
            </div>
          </li>
        </ol>
        <div v-if="jobs.length" class="jobs">
          <div class="jh"><span>码盘任务<template v-if="state.round > 1"> · 第 {{ state.round }} 轮（回流重排）</template></span><span class="num">{{ done }} / {{ pipelineTasks.length }}</span></div>
          <div class="grid">
            <div v-for="(t, i) in jobs" :key="t.id" class="job" :class="t.status">
              <span class="jn num">{{ String(i + 1).padStart(2, '0') }}</span>
              <div class="bar"><i :style="{ width: (t.status === 'done' ? 100 : t.status === 'queued' ? 0 : Math.max(6, t.pct * 100)) + '%' }" /></div>
              <Icon v-if="t.status === 'done'" name="check" :size="12" :stroke="3" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ov {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(4, 7, 13, 0.5);
  backdrop-filter: blur(4px);
  z-index: 60;
}
.box {
  width: 420px;
  max-width: calc(100vw - 32px);
  padding: 22px 24px 20px;
  background: var(--glass-solid);
}
.hd {
  display: flex;
  align-items: center;
  gap: 16px;
}
.t {
  font-size: 15.5px;
  font-weight: 650;
}
.s {
  font-size: 12px;
  color: var(--text-3);
  margin-top: 2px;
}
.spinner {
  position: relative;
  width: 38px;
  height: 38px;
  flex: none;
}
.spinner i {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2.5px solid transparent;
  border-top-color: var(--accent);
  animation: spin 1s linear infinite;
}
.spinner i:nth-child(2) {
  inset: 6px;
  border-top-color: var(--accent-2);
  animation-duration: 1.4s;
  animation-direction: reverse;
}
.spinner i:nth-child(3) {
  inset: 12px;
  border-top-color: var(--cog);
  animation-duration: 0.8s;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.ph3 {
  list-style: none;
  padding: 0;
  margin: 18px 0 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ph3 li {
  display: flex;
  gap: 12px;
  color: var(--text-3);
}
.ph3 .d {
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.18);
  display: grid;
  place-items: center;
  flex: none;
}
.ph3 li.done .d {
  border-color: transparent;
  background: var(--ok);
  color: #021218;
}
.ph3 li.on .d {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px rgba(46, 224, 240, 0.15);
}
.ph3 b {
  display: block;
  font-size: 13px;
  font-weight: 600;
}
.ph3 li.on b,
.ph3 li.done b {
  color: var(--text);
}
.ph3 span {
  font-size: 11.5px;
}
.jobs {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.jh {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-3);
  margin-bottom: 9px;
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px 16px;
}
.job {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 16px;
  color: var(--ok);
}
.jn {
  font-size: 11px;
  color: var(--text-3);
  width: 16px;
}
.bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #2ee0f0, #5b8cff);
  transition: width 0.25s;
}
.job.done .bar i {
  background: var(--ok);
}
</style>
