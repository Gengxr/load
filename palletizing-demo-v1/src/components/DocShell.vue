<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'

/** 文档页外壳：全屏，左侧章节目录（随滚动高亮），右侧长文。使用手册与算法原理共用。 */
const props = defineProps<{
  title: string
  sub: string
  icon: string
  chapters: { id: string; title: string; sub?: string }[]
  /** 打开时定位到的章节 */
  start?: string
}>()
const emit = defineEmits<{ close: [] }>()

const scroller = ref<HTMLDivElement | null>(null)
const active = ref(props.chapters[0]?.id ?? '')
let io: IntersectionObserver | null = null

function go(id: string, smooth = true) {
  scroller.value?.querySelector<HTMLElement>(`[data-ch="${id}"]`)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  active.value = id
}
function onKey(e: KeyboardEvent) {
  if (e.code === 'Escape') emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKey)
  nextTick(() => {
    const root = scroller.value
    if (!root) return
    // 进入视口上方三分之一处的章节即为当前章节
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) active.value = (e.target as HTMLElement).dataset.ch ?? active.value
      },
      { root, rootMargin: '-8% 0px -70% 0px' },
    )
    root.querySelectorAll('[data-ch]').forEach((el) => io!.observe(el))
    if (props.start) go(props.start, false)
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  io?.disconnect()
})
defineExpose({ go })
</script>

<template>
  <div class="shell">
    <header class="hd">
      <div class="ttl">
        <span class="tic"><Icon :name="icon" :size="19" /></span>
        <div>
          <b>{{ title }}</b>
          <span>{{ sub }}</span>
        </div>
      </div>
      <div class="acts">
        <slot name="actions" />
        <button class="btn close" title="关闭 (Esc)" @click="emit('close')"><Icon name="x" :size="16" />关闭</button>
      </div>
    </header>
    <div class="main">
      <nav class="toc scroll">
        <div class="eyebrow">目录</div>
        <button v-for="(c, i) in chapters" :key="c.id" class="ti" :class="{ on: active === c.id }" @click="go(c.id)">
          <span class="n num">{{ i + 1 }}</span>
          <span class="tt">
            <b>{{ c.title }}</b>
            <span v-if="c.sub">{{ c.sub }}</span>
          </span>
        </button>
        <slot name="toc-foot" />
      </nav>
      <div ref="scroller" class="content scroll">
        <article class="doc">
          <slot :go="go" />
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shell {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(1100px 620px at 18% -10%, rgba(46, 224, 240, 0.09), transparent 60%),
    radial-gradient(900px 640px at 100% 110%, rgba(91, 140, 255, 0.08), transparent 60%),
    #060a13;
}
.hd {
  flex: none;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 22px;
  border-bottom: 1px solid var(--line);
  background: rgba(8, 12, 22, 0.7);
  backdrop-filter: blur(14px);
}
.ttl {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.ttl .tic {
  width: 38px;
  height: 38px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  flex: none;
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid rgba(46, 224, 240, 0.28);
}
.ttl b {
  display: block;
  font-size: 16.5px;
  font-weight: 700;
  line-height: 1.3;
}
.ttl span {
  font-size: 12px;
  color: var(--text-3);
  white-space: nowrap;
}
.acts {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.close {
  height: 36px;
}
.main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 264px minmax(0, 1fr);
  width: 100%;
  max-width: 1380px;
  margin: 0 auto;
}
.toc {
  padding: 22px 12px 22px 20px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  border-right: 1px solid var(--line);
}
.eyebrow {
  padding: 0 10px 8px;
}
.ti {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 11px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-2);
  text-align: left;
  transition:
    background 0.15s,
    color 0.15s,
    border-color 0.15s;
}
.ti:hover {
  background: rgba(255, 255, 255, 0.045);
  color: var(--text);
}
.ti.on {
  color: var(--text);
  border-color: rgba(46, 224, 240, 0.4);
  background: linear-gradient(155deg, rgba(46, 224, 240, 0.13), rgba(91, 140, 255, 0.05));
}
.ti .n {
  flex: none;
  width: 22px;
  height: 22px;
  margin-top: 1px;
  border-radius: 7px;
  display: grid;
  place-items: center;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-3);
  background: rgba(255, 255, 255, 0.06);
}
.ti.on .n {
  color: #021218;
  background: linear-gradient(135deg, #3ef0ff, #5b8cff);
}
.tt {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.4;
}
.tt b {
  font-size: 13.5px;
  font-weight: 600;
}
.tt span {
  font-size: 11.5px;
  color: var(--text-3);
}
.content {
  min-width: 0;
  padding: 26px 34px 60px 38px;
  scroll-behavior: smooth;
}
.doc {
  max-width: 980px;
}
@media (max-width: 980px) {
  .main {
    grid-template-columns: minmax(0, 1fr);
  }
  .toc {
    display: none;
  }
  .content {
    padding: 20px 20px 48px;
  }
}
</style>
