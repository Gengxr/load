import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

/** 浮动面板的像素尺寸（与 App.vue 中的 CSS 变量一致），用于告诉三维场景哪些区域被遮挡 */
export const GAP = 16
export const TOP = 72
export const BAR = 68

export function usePanels() {
  const vw = ref(window.innerWidth)
  const vh = ref(window.innerHeight)
  const on = () => {
    vw.value = window.innerWidth
    vh.value = window.innerHeight
  }
  onMounted(() => window.addEventListener('resize', on))
  onBeforeUnmount(() => window.removeEventListener('resize', on))
  const lw = computed(() => (vw.value < 1500 ? 292 : 318))
  const rw = computed(() => (vw.value < 1500 ? 352 : 384))
  return { vw, vh, lw, rw }
}
