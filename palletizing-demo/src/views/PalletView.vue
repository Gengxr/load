<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue'
import { pallets, state } from '../store'
import { GAP, TOP, BAR, usePanels } from '../layout'
import LeftPanel from '../components/LeftPanel.vue'
import RightPanel from '../components/RightPanel.vue'
import ViewerPanel from '../components/ViewerPanel.vue'
import Timeline from '../components/Timeline.vue'
import CogCard from '../components/CogCard.vue'
import Icon from '../components/Icon.vue'
const CompareView = defineAsyncComponent(() => import('../components/CompareView.vue'))
const StationView = defineAsyncComponent(() => import('../components/StationView.vue'))
const ParamsDrawer = defineAsyncComponent(() => import('../components/ParamsDrawer.vue'))

/** 单盘码放工作区：规划演示 / 顺序对比 / 工位引导 */
const { lw, rw, vh } = usePanels()

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || state.mode !== 'plan' || state.explainOpen) return
  if (e.code === 'KeyM') state.metricsOpen = !state.metricsOpen
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const insets = computed(() => ({
  l: GAP + lw.value + GAP,
  r: state.metricsOpen ? GAP + rw.value + GAP : GAP,
  t: TOP,
  b: GAP + BAR + 12,
}))
// 窗口较矮时，重心卡片收进左侧面板内部，避免与面板底部按钮挤在一起
const cogInline = computed(() => vh.value < 860)
const vars = computed(() => ({ '--il': insets.value.l + 'px', '--ir': insets.value.r + 'px' }))
</script>

<template>
  <main v-if="!pallets.length" class="workspace empty-ws">
    <div class="empty"><Icon name="boxes" :size="34" />还没有码盘方案，请先在「出库分盘」生成<button class="btn primary" @click="state.ws = 'order'">前往出库分盘</button></div>
  </main>
  <main v-else-if="state.mode === 'plan'" class="workspace" :style="vars">
    <ViewerPanel class="stage3d" strategy="current" variant="fullbleed" :insets="insets" />
    <div class="leftcol">
      <LeftPanel class="lpanel" :show-cog="cogInline && state.showCog" />
      <CogCard v-if="state.showCog && !cogInline" class="cog" />
    </div>
    <Transition name="drawer">
      <RightPanel v-if="state.metricsOpen" class="float-r" />
    </Transition>
    <Transition name="slide">
      <ParamsDrawer v-if="state.paramsOpen" class="float-l params" />
    </Transition>
    <Timeline class="transport" />
  </main>
  <div v-else class="sub">
    <CompareView v-if="state.mode === 'compare'" />
    <StationView v-else />
  </div>
</template>

<style scoped>
.workspace > .stage3d {
  position: absolute;
  inset: 0;
}
.empty-ws {
  display: grid;
  place-items: center;
}
/* 左列：上方面板可压缩（内部滚动），下方重心卡片固定高度，二者永不重叠 */
.leftcol {
  position: absolute;
  left: var(--gap);
  top: var(--top);
  bottom: var(--gap);
  width: var(--lw);
  z-index: 3;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 12px;
  pointer-events: none;
}
.leftcol > * {
  pointer-events: auto;
  min-height: 0;
}
.lpanel {
  align-self: start;
  max-height: 100%;
}
.params {
  width: calc(var(--lw) + 40px);
  z-index: 4;
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
.sub {
  position: absolute;
  inset: 64px 0 0;
  display: flex;
  flex-direction: column;
}
</style>
