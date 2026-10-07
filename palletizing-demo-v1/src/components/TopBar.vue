<script setup lang="ts">
import { computed } from 'vue'
import { cargos, result, state, totalSteps } from '../store'
import Icon from './Icon.vue'

const passCount = computed(() => {
  const r = result.value
  if (!r) return null
  const judged = r.metrics.items.filter((m) => m.source.startsWith('表'))
  return { ok: judged.filter((m) => m.pass).length, all: judged.length }
})

const stages = computed(() => {
  const r = result.value
  const skus = new Set(cargos.value.map((c) => c.sku)).size
  const n = totalSteps.value
  return [
    { icon: 'package', name: '货物生成', sub: cargos.value.length ? `${cargos.value.length} 件 · ${skus} 规格` : '—', done: cargos.value.length > 0 },
    { icon: 'network', name: '多盘分配', sub: '外部接口', done: cargos.value.length > 0, external: true },
    { icon: 'grid3', name: '单盘布局', sub: r ? `${r.layout.layers.length} 层` : '—', done: !!r },
    { icon: 'order', name: '顺序规划', sub: r ? `${r.timings.sequenceMs.toFixed(0)} ms` : '—', done: !!r },
    { icon: 'play', name: '动态码放', sub: r ? `${state.step} / ${n}` : '—', done: !!r && state.step >= n && n > 0, active: !!r && state.step > 0 && state.step < n, progress: n ? state.step / n : 0 },
    { icon: 'gauge', name: '指标验证', sub: passCount.value ? `${passCount.value.ok}/${passCount.value.all} 达标` : '—', done: !!r && state.step >= n && n > 0 },
  ]
})

const modes = [
  { key: 'plan', name: '规划演示', icon: 'cube' },
  { key: 'compare', name: '方案对比', icon: 'compare' },
  { key: 'station', name: '工位引导', icon: 'station' },
] as const
</script>

<template>
  <header class="top">
    <div class="brand">
      <div class="logo">
        <svg viewBox="0 0 32 32" width="22" height="22">
          <defs>
            <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#3ef0ff" />
              <stop offset="1" stop-color="#5b8cff" />
            </linearGradient>
          </defs>
          <path d="M16 3 27 9v13L16 28 5 22V9z" fill="none" stroke="url(#lg1)" stroke-width="2.2" stroke-linejoin="round" />
          <path d="M5 9l11 6 11-6M16 15v13" fill="none" stroke="url(#lg1)" stroke-width="2.2" stroke-linejoin="round" />
          <circle cx="16" cy="15" r="2.6" fill="#ffc24b" />
        </svg>
      </div>
      <div class="titles">
        <div class="t1">单盘动态码放规划</div>
        <div class="t2">智能物资储运模拟验证平台 · 码盘与装载方案规划模块</div>
      </div>
    </div>

    <nav class="pipeline">
      <template v-for="(s, i) in stages" :key="s.name">
        <div class="stage" :class="{ done: s.done, active: s.active, external: s.external }">
          <div class="node">
            <svg v-if="s.active" class="prog" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" :stroke-dasharray="`${(s.progress ?? 0) * 100.5} 100.5`" transform="rotate(-90 18 18)" />
            </svg>
            <Icon :name="s.done && !s.active ? 'check' : s.icon" :size="14" :stroke="2.2" />
          </div>
          <div class="lbl">
            <div class="n">{{ s.name }}</div>
            <div class="s num">{{ s.sub }}</div>
          </div>
        </div>
        <div v-if="i < stages.length - 1" class="link" :class="{ done: stages[i + 1].done || stages[i + 1].active }" />
      </template>
    </nav>

    <div class="right">
      <div class="modes">
        <button v-for="m in modes" :key="m.key" :class="{ on: state.mode === m.key }" @click="state.mode = m.key">
          <Icon :name="m.icon" :size="15" />{{ m.name }}
        </button>
      </div>
      <button class="btn explain" title="使用手册" @click="state.guideOpen = true"><Icon name="help" :size="15" /><span>使用手册</span></button>
      <button class="btn explain" title="算法原理" @click="state.explainOpen = true"><Icon name="book" :size="15" /><span>算法原理</span></button>
    </div>
  </header>
</template>

<style scoped>
.top {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 0 20px;
  position: relative;
  z-index: 5;
  background: linear-gradient(180deg, rgba(5, 9, 17, 0.92) 0%, rgba(5, 9, 17, 0.6) 60%, rgba(5, 9, 17, 0) 100%);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: linear-gradient(145deg, rgba(46, 224, 240, 0.16), rgba(91, 140, 255, 0.08));
  border: 1px solid rgba(46, 224, 240, 0.28);
  box-shadow: 0 0 24px rgba(46, 224, 240, 0.15);
}
.t1 {
  font-size: 16.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
}
.t2 {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
}
.pipeline {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}
.stage {
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text-3);
  transition: color 0.3s;
}
.stage.done,
.stage.active {
  color: var(--text);
}
.node {
  position: relative;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  border: 1.5px solid rgba(255, 255, 255, 0.14);
  color: var(--text-3);
  flex: none;
  transition: all 0.3s;
}
.stage.done .node {
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
  border-color: transparent;
  color: #021218;
  box-shadow: 0 0 14px rgba(46, 224, 240, 0.35);
}
.stage.external .node {
  border-style: dashed;
}
.stage.external.done .node {
  background: transparent;
  border-color: rgba(46, 224, 240, 0.6);
  color: var(--accent);
  box-shadow: none;
}
.stage.active .node {
  border-color: rgba(46, 224, 240, 0.25);
  color: var(--accent);
  box-shadow: 0 0 18px rgba(46, 224, 240, 0.3);
}
.prog {
  position: absolute;
  inset: -3px;
  width: 34px;
  height: 34px;
  color: var(--accent);
}
.lbl .n {
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}
.lbl .s {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}
.link {
  flex: 0 1 40px;
  min-width: 12px;
  height: 2px;
  margin: 0 10px;
  border-radius: 1px;
  background: rgba(255, 255, 255, 0.1);
}
.link.done {
  background: linear-gradient(90deg, rgba(46, 224, 240, 0.9), rgba(91, 140, 255, 0.6));
}
.right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.modes {
  display: flex;
  padding: 4px;
  gap: 2px;
  border-radius: 13px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--line);
  backdrop-filter: blur(12px);
}
.modes button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-2);
  font-size: 13px;
  font-weight: 550;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s;
}
.modes button:hover {
  color: var(--text);
}
.modes button.on {
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
  box-shadow: 0 4px 14px rgba(46, 200, 245, 0.3);
}
.explain {
  height: 40px;
  border-radius: 12px;
}
@media (max-width: 1600px) {
  .lbl .s,
  .t2 {
    display: none;
  }
  .link {
    margin: 0 6px;
  }
}
@media (max-width: 1500px) {
  .explain span {
    display: none;
  }
  .explain {
    width: 40px;
    padding: 0;
  }
}
@media (max-width: 1320px) {
  .lbl {
    display: none;
  }
}
</style>
