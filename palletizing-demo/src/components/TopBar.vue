<script setup lang="ts">
import { computed } from 'vue'
import { allocation, current, loading, order, pallets, state, summary, type Workspace } from '../store'
import { tasks } from '../taskPool'
import { pct } from '../format'
import Icon from './Icon.vue'
import TaskCenter from './TaskCenter.vue'
import UserMenu from './UserMenu.vue'

const loadOk = computed(() => {
  const lp = loading.value
  return lp ? lp.metrics.pass && Object.values(lp.tracks).every((t) => t.ok) : null
})
const tabs = computed(() => {
  const s = summary.value
  const lp = loading.value
  const cur = current.value
  return [
    {
      key: 'order' as Workspace,
      name: '出库分盘',
      icon: 'split',
      sub: order.value ? `${order.value.cargos.length} 件 → ${allocation.value && pallets.value.length ? pallets.value.length + ' 盘' : '…'}` : '待生成',
      ok: s ? s.unplaced === 0 : null,
    },
    {
      key: 'pallet' as Workspace,
      name: '单盘码放',
      icon: 'boxes',
      sub: cur && s ? `${s.pass}/${s.pallets} 盘达标` : '—',
      ok: s ? s.pass === s.pallets : null,
    },
    {
      key: 'cabin' as Workspace,
      name: '舱内装载',
      icon: 'plane',
      sub: lp ? `重心误差 ${pct(Math.max(Math.abs(lp.metrics.errX), Math.abs(lp.metrics.errY)), 2)}` : '—',
      ok: loadOk.value,
    },
  ]
})
const modes = [
  { key: 'plan', name: '规划演示', icon: 'cube' },
  { key: 'compare', name: '方案对比', icon: 'compare' },
  { key: 'station', name: '人工引导', icon: 'hand' },
  { key: 'robot', name: '机械臂', icon: 'robot' },
] as const
const running = computed(() => tasks.filter((t) => t.status === 'running' || t.status === 'queued').length)
const initial = computed(() => (state.user?.name ?? '?').slice(0, 1))

function go(ws: Workspace) {
  state.ws = ws
  state.tasksOpen = state.userOpen = false
}
</script>

<template>
  <header class="top">
    <div class="brand" @click="go('order')">
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
        <div class="t1">码盘与装载方案规划系统</div>
        <div class="t2">智能物资储运模拟验证平台</div>
      </div>
    </div>

    <nav class="flow">
      <template v-for="(t, i) in tabs" :key="t.key">
        <button class="tab" :class="{ on: state.ws === t.key, ok: t.ok === true, warn: t.ok === false }" @click="go(t.key)">
          <span class="no">
            <Icon v-if="t.ok === true && state.ws !== t.key" name="check" :size="13" :stroke="2.6" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="lbl">
            <span class="n">{{ t.name }}</span>
            <span class="s num">{{ t.sub }}</span>
          </span>
        </button>
        <span v-if="i < tabs.length - 1" class="link" :class="{ done: tabs[i].ok !== null }"><Icon name="chevron" :size="14" /></span>
      </template>
    </nav>

    <div class="right">
      <div v-if="state.ws === 'pallet'" class="modes">
        <button v-for="m in modes" :key="m.key" :class="{ on: state.mode === m.key }" :title="m.name" @click="state.mode = m.key">
          <Icon :name="m.icon" :size="15" /><span>{{ m.name }}</span>
        </button>
      </div>
      <div class="tools">
        <button class="tool wide" :class="{ on: state.ws === 'data' }" @click="go('data')"><Icon name="database" :size="16" /><span>数据中心</span></button>
        <div class="anchor">
          <button class="tool" :class="{ on: state.tasksOpen }" data-tip="任务中心" @click="((state.tasksOpen = !state.tasksOpen), (state.userOpen = false))">
            <Icon name="cpu" :size="17" />
            <i v-if="running" class="dot run">{{ running }}</i>
          </button>
          <Transition name="pop"><TaskCenter v-if="state.tasksOpen" class="popover" /></Transition>
        </div>
        <button class="tool" :class="{ on: state.explainOpen }" data-tip="算法原理" @click="state.explainOpen = true"><Icon name="book" :size="17" /></button>
        <button class="tool" :class="{ on: state.helpOpen }" data-tip="使用帮助" @click="state.helpOpen = !state.helpOpen"><Icon name="help" :size="17" /></button>
        <div class="anchor">
          <button class="avatar" @click="((state.userOpen = !state.userOpen), (state.tasksOpen = false))">{{ initial }}</button>
          <Transition name="pop"><UserMenu v-if="state.userOpen" class="popover" /></Transition>
        </div>
      </div>
    </div>
    <div v-if="state.tasksOpen || state.userOpen" class="scrim" @click="state.tasksOpen = state.userOpen = false" />
  </header>
</template>

<style scoped>
.top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 16px 0 20px;
  z-index: 20;
  background: linear-gradient(180deg, rgba(5, 9, 17, 0.94) 0%, rgba(5, 9, 17, 0.66) 62%, rgba(5, 9, 17, 0) 100%);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  cursor: pointer;
  flex: 0 1 auto;
}
.logo {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  flex: none;
  background: linear-gradient(145deg, rgba(46, 224, 240, 0.16), rgba(91, 140, 255, 0.08));
  border: 1px solid rgba(46, 224, 240, 0.28);
  box-shadow: 0 0 24px rgba(46, 224, 240, 0.15);
}
.t1 {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.t2 {
  font-size: 11.5px;
  color: var(--text-3);
  white-space: nowrap;
}
.flow {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid var(--line);
  backdrop-filter: blur(14px);
  flex: none;
  margin: 0 auto;
}
.tab {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 42px;
  padding: 0 16px 0 8px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  transition:
    background 0.18s,
    border-color 0.18s,
    color 0.18s;
}
.tab:hover {
  background: rgba(255, 255, 255, 0.05);
  color: var(--text);
}
.tab.on {
  color: var(--text);
  background: linear-gradient(135deg, rgba(46, 224, 240, 0.2), rgba(91, 140, 255, 0.12));
  border-color: rgba(46, 224, 240, 0.4);
  box-shadow: 0 6px 20px rgba(46, 200, 245, 0.12);
}
.no {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: none;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-3);
  border: 1.5px solid rgba(255, 255, 255, 0.16);
  transition: all 0.2s;
}
.tab.ok .no {
  color: var(--ok);
  border-color: rgba(61, 220, 151, 0.5);
  background: var(--ok-soft);
}
.tab.warn .no {
  color: var(--warn);
  border-color: rgba(255, 194, 75, 0.5);
  background: rgba(255, 194, 75, 0.1);
}
.tab.on .no {
  color: #021218;
  border-color: transparent;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
  box-shadow: 0 0 14px rgba(46, 224, 240, 0.4);
}
.lbl {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.lbl .n {
  font-size: 13.5px;
  font-weight: 650;
  white-space: nowrap;
}
.lbl .s {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}
.tab.on .lbl .s {
  color: var(--text-2);
}
.link {
  color: rgba(255, 255, 255, 0.18);
  display: grid;
  place-items: center;
  width: 16px;
}
.link.done {
  color: rgba(46, 224, 240, 0.7);
}
.right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  flex: none;
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
  padding: 0 12px;
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
.tools {
  display: flex;
  align-items: center;
  gap: 6px;
}
.tool {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 38px;
  min-width: 38px;
  padding: 0;
  border-radius: 11px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 550;
  white-space: nowrap;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.tool.wide {
  padding: 0 13px;
}
.tool:hover {
  color: var(--text);
  background: rgba(255, 255, 255, 0.08);
}
.tool.on {
  color: var(--accent);
  border-color: rgba(46, 224, 240, 0.45);
  background: var(--accent-soft);
}
.dot {
  position: absolute;
  top: -5px;
  right: -5px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  font-style: normal;
  font-size: 10.5px;
  font-weight: 700;
  display: grid;
  place-items: center;
  color: #021218;
  background: var(--accent);
  box-shadow: 0 0 10px rgba(46, 224, 240, 0.7);
}
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  background: linear-gradient(135deg, #2a3a5c, #1b2740);
  color: var(--text);
  font-size: 14px;
  font-weight: 700;
  display: grid;
  place-items: center;
  transition: border-color 0.15s;
}
.avatar:hover {
  border-color: rgba(46, 224, 240, 0.6);
}
.anchor {
  position: relative;
}
.popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  z-index: 30;
}
.scrim {
  position: fixed;
  inset: 0;
  z-index: 19;
}
.anchor,
.tool,
.modes {
  z-index: 21;
}
@media (max-width: 1640px) {
  .t2,
  .lbl .s {
    display: none;
  }
  .tab {
    height: 38px;
  }
}
@media (max-width: 1400px) {
  .modes button span,
  .tool.wide span {
    display: none;
  }
  .tool.wide {
    padding: 0;
  }
  .modes button {
    padding: 0 10px;
  }
}
@media (max-width: 1120px) {
  .t1 {
    display: none;
  }
  .tab {
    padding: 0 12px 0 6px;
  }
}
</style>
