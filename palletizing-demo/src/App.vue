<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { generateAndPlan, state } from './store'
import { pause } from './playback'
import TopBar from './components/TopBar.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import ViewerPanel from './components/ViewerPanel.vue'
import Timeline from './components/Timeline.vue'
import PlanningOverlay from './components/PlanningOverlay.vue'
import CogCard from './components/CogCard.vue'

const CompareView = defineAsyncComponent(() => import('./components/CompareView.vue'))
const StationView = defineAsyncComponent(() => import('./components/StationView.vue'))
const ExplainModal = defineAsyncComponent(() => import('./components/ExplainModal.vue'))
const ParamsDrawer = defineAsyncComponent(() => import('./components/ParamsDrawer.vue'))

onMounted(() => generateAndPlan())
// 切换视图时先暂停，避免旧视图卸载期间播放循环继续推进
watch(
  () => state.mode,
  () => pause(),
  { flush: 'sync' },
)

// ── 浮动布局：三维场景铺满全屏，面板悬浮其上 ──
const vw = ref(window.innerWidth)
const onResize = () => (vw.value = window.innerWidth)
function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'SELECT' || state.mode !== 'plan' || state.explainOpen) return
  if (e.code === 'KeyM') state.metricsOpen = !state.metricsOpen
}
onMounted(() => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKey)
})

const GAP = 16
const TOP = 72
const BAR = 68
const lw = computed(() => (vw.value < 1500 ? 292 : 318))
const rw = computed(() => (vw.value < 1500 ? 352 : 384))
const insets = computed(() => ({
  l: GAP + lw.value + GAP,
  r: state.metricsOpen ? GAP + rw.value + GAP : GAP,
  t: TOP,
  b: GAP + BAR + 12,
}))
const vars = computed(() => ({
  '--lw': lw.value + 'px',
  '--rw': rw.value + 'px',
  '--gap': GAP + 'px',
  '--top': TOP + 'px',
  '--bar': BAR + 'px',
  '--il': insets.value.l + 'px',
  '--ir': insets.value.r + 'px',
}))
</script>

<template>
  <div class="app">
    <TopBar />
    <main v-if="state.mode === 'plan'" class="plan" :style="vars">
      <ViewerPanel class="stage" strategy="current" variant="fullbleed" :insets="insets" />
      <div class="leftcol">
        <LeftPanel class="lpanel" />
        <CogCard v-if="state.showCog" />
      </div>
      <Transition name="drawer">
        <RightPanel v-if="state.metricsOpen" class="float right" />
      </Transition>
      <Transition name="slide">
        <ParamsDrawer v-if="state.paramsOpen" class="float params" />
      </Transition>
      <Timeline class="transport" />
    </main>
    <CompareView v-else-if="state.mode === 'compare'" />
    <StationView v-else />
    <ExplainModal v-if="state.explainOpen" />
    <PlanningOverlay />
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}
.plan {
  position: absolute;
  inset: 0;
}
.stage {
  position: absolute;
  inset: 0;
}
.float {
  position: absolute;
  top: var(--top);
  bottom: var(--gap);
  z-index: 3;
}
.leftcol {
  position: absolute;
  left: var(--gap);
  top: var(--top);
  bottom: var(--gap);
  width: var(--lw);
  z-index: 3;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 12px;
  pointer-events: none;
}
.leftcol > * {
  pointer-events: auto;
}
.lpanel {
  min-height: 0;
  flex: 0 1 auto;
}
.params {
  left: var(--gap);
  width: calc(var(--lw) + 40px);
  z-index: 4;
}
.right {
  right: var(--gap);
  width: var(--rw);
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
.drawer-enter-active,
.drawer-leave-active {
  transition:
    transform 0.42s cubic-bezier(0.2, 0.8, 0.2, 1),
    opacity 0.3s ease;
}
.drawer-enter-from,
.drawer-leave-to {
  transform: translateX(calc(100% + 24px));
  opacity: 0;
}
</style>
