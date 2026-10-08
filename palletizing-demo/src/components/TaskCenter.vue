<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { poolSize, tasks } from '../taskPool'
import Icon from './Icon.vue'

/** 任务中心：码盘任务与装载任务联动 / 独立运行的记录（表 2-3 第 9 项） */
const now = ref(performance.now())
let timer = 0
onMounted(() => (timer = window.setInterval(() => (now.value = performance.now()), 120)))
onBeforeUnmount(() => clearInterval(timer))

const list = computed(() => tasks.slice(0, 14))
const running = computed(() => tasks.filter((t) => t.status === 'running').length)
const icon = { alloc: 'split', pallet: 'boxes', loading: 'plane' } as const
const kind = { alloc: '分配', pallet: '码盘', loading: '装载' } as const
const ms = (t: (typeof tasks)[number]) => {
  const v = t.status === 'running' ? now.value - t.t0 : t.ms
  return v < 1000 ? `${v.toFixed(v < 10 ? 1 : 0)} ms` : `${(v / 1000).toFixed(2)} s`
}
</script>

<template>
  <section class="tc glass">
    <header>
      <div class="ph"><Icon name="cpu" :size="16" />任务中心</div>
      <span class="badge num">{{ running ? `${running} 个运行中` : '空闲' }} · 并行池 {{ poolSize }} 线程</span>
    </header>
    <p class="hint">码盘任务在多个线程中同时求解；装载任务可与码盘联动，也可单独重新运行。</p>
    <div v-if="!list.length" class="empty">暂无任务</div>
    <ul v-else class="scroll">
      <li v-for="t in list" :key="t.id" :class="t.status">
        <span class="ki" :class="t.kind"><Icon :name="icon[t.kind]" :size="14" /></span>
        <div class="m">
          <div class="r1">
            <span class="k">{{ kind[t.kind] }}</span>
            <span class="tt ell">{{ t.title.replace(/^.*? · /, '') }}</span>
            <span class="time num">{{ t.status === 'queued' ? '排队中' : ms(t) }}</span>
          </div>
          <div v-if="t.status === 'running' || t.status === 'queued'" class="bar"><i :style="{ width: Math.max(4, t.pct * 100) + '%' }" /></div>
          <div v-else class="note ell" :class="{ bad: t.status === 'error' }">
            <Icon :name="t.status === 'error' ? 'alert' : 'check'" :size="12" :stroke="2.4" />{{ t.note || '完成' }}
            <span v-if="t.worker >= 0 && t.kind === 'pallet'" class="w num">线程 {{ t.worker + 1 }}</span>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.tc {
  width: 400px;
  padding: 16px;
  background: var(--glass-solid);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hint {
  margin: 8px 0 12px;
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}
ul {
  list-style: none;
  margin: 0 -6px 0 0;
  padding: 0 6px 0 0;
  max-height: min(56vh, 460px);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
li {
  display: flex;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--line);
}
li.running {
  border-color: rgba(46, 224, 240, 0.3);
  background: rgba(46, 224, 240, 0.05);
}
.ki {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  flex: none;
  color: var(--accent);
  background: var(--accent-soft);
}
.ki.loading {
  color: #a5b4fc;
  background: rgba(129, 140, 248, 0.14);
}
.ki.alloc {
  color: var(--cog);
  background: rgba(255, 194, 75, 0.12);
}
.m {
  flex: 1;
  min-width: 0;
}
.r1 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12.5px;
}
.k {
  font-weight: 650;
  flex: none;
}
.tt {
  flex: 1;
  color: var(--text-2);
}
.time {
  flex: none;
  font-size: 11.5px;
  color: var(--text-3);
}
.bar {
  height: 4px;
  margin-top: 8px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: linear-gradient(90deg, #2ee0f0, #5b8cff);
  transition: width 0.25s;
}
.note {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-3);
}
.note .ic {
  color: var(--ok);
}
.note.bad,
.note.bad .ic {
  color: var(--bad);
}
.w {
  margin-left: auto;
  flex: none;
}
</style>
