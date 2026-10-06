<script setup lang="ts">
import { computed } from 'vue'
import { state } from '../store'

const stages = [
  { k: 'layout', n: '层构造与垛形优化' },
  { k: 'precedence', n: '支撑依赖图' },
  { k: 'sequence', n: '平衡优先顺序搜索' },
  { k: 'evaluate', n: '指标评估' },
]
const idx = computed(() => Math.max(0, stages.findIndex((s) => s.k === state.progress.stage)))
</script>

<template>
  <Transition name="fade">
    <div v-if="state.planning" class="ov">
      <div class="box panel">
        <div class="spinner"><i /><i /><i /></div>
        <div class="t">正在规划码放方案</div>
        <ol>
          <li v-for="(s, i) in stages" :key="s.k" :class="{ done: i < idx, on: i === idx }">
            <span class="d" />{{ s.n }}
          </li>
        </ol>
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
  background: rgba(4, 7, 13, 0.45);
  backdrop-filter: blur(3px);
  z-index: 50;
}
.box {
  padding: 24px 30px 20px;
  min-width: 300px;
  text-align: center;
}
.t {
  font-size: 15px;
  font-weight: 600;
  margin: 14px 0 12px;
}
ol {
  list-style: none;
  padding: 0;
  margin: 0;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
li {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 12.5px;
}
li.on {
  color: var(--text);
}
li.done {
  color: var(--text-2);
}
.d {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--line-2);
}
li.on .d {
  border-color: var(--accent);
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent);
}
li.done .d {
  background: var(--ok);
  border-color: var(--ok);
}
.spinner {
  display: flex;
  justify-content: center;
  gap: 6px;
  height: 34px;
  align-items: flex-end;
}
.spinner i {
  width: 16px;
  border-radius: 3px;
  background: linear-gradient(180deg, #22d3ee, #3b82f6);
  animation: stack 0.9s ease-in-out infinite;
}
.spinner i:nth-child(2) {
  animation-delay: 0.15s;
}
.spinner i:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes stack {
  0%,
  100% {
    height: 10px;
    opacity: 0.5;
  }
  50% {
    height: 32px;
    opacity: 1;
  }
}
</style>
