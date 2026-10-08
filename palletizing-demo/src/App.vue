<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { newOrderAndRun, order, state } from './store'
import { pause } from './playback'
import TopBar from './components/TopBar.vue'
import PlanningOverlay from './components/PlanningOverlay.vue'
import LoginView from './views/LoginView.vue'
import OrderView from './views/OrderView.vue'
const PalletView = defineAsyncComponent(() => import('./views/PalletView.vue'))
const CabinView = defineAsyncComponent(() => import('./views/CabinView.vue'))
const DataView = defineAsyncComponent(() => import('./views/DataView.vue'))
const ExplainModal = defineAsyncComponent(() => import('./components/ExplainModal.vue'))
const HelpDrawer = defineAsyncComponent(() => import('./components/HelpDrawer.vue'))

// 登录后自动跑一遍默认出库单：分盘 → 码放 → 装载
watch(
  () => state.user,
  (u) => {
    if (u && !order.value) newOrderAndRun()
  },
  { immediate: true },
)
// 切换工作区 / 视图时先暂停，避免旧视图卸载期间播放循环继续推进
watch(
  () => [state.ws, state.mode],
  () => {
    pause()
    state.cabinPlaying = false
  },
  { flush: 'sync' },
)

// ── 浮动布局：三维场景铺满全屏，面板悬浮其上 ──
const vw = ref(window.innerWidth)
const onResize = () => (vw.value = window.innerWidth)
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))
const vars = computed(() => ({
  '--lw': (vw.value < 1500 ? 292 : 318) + 'px',
  '--rw': (vw.value < 1500 ? 352 : 384) + 'px',
  '--gap': '16px',
  '--top': '72px',
  '--bar': '68px',
}))
</script>

<template>
  <LoginView v-if="!state.user" />
  <div v-else class="app" :style="vars">
    <TopBar />
    <OrderView v-if="state.ws === 'order'" />
    <PalletView v-else-if="state.ws === 'pallet'" />
    <CabinView v-else-if="state.ws === 'cabin'" />
    <DataView v-else />
    <ExplainModal v-if="state.explainOpen" />
    <Transition name="drawer"><HelpDrawer v-if="state.helpOpen" /></Transition>
    <PlanningOverlay />
    <Transition name="pop">
      <div v-if="state.toast" class="toast glass">{{ state.toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.app {
  height: 100%;
  position: relative;
  overflow: hidden;
}
.toast {
  position: fixed;
  top: 76px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 80;
  padding: 10px 18px;
  border-radius: 12px;
  font-size: 13px;
  border-color: rgba(46, 224, 240, 0.35);
}
</style>
