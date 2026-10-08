import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'
import interLatin from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'

// 拉丁字母与数字用 Inter（只打包 latin 子集，约 48 KB），中文仍用系统字体
try {
  const face = new FontFace('Inter Var', `url(${interLatin})`, { weight: '100 900', display: 'swap' })
  face.load().then((f) => document.fonts.add(f)).catch(() => {})
} catch {
  /* 不支持 FontFace 时使用系统字体 */
}

createApp(App).mount('#app')

// 开发调试钩子（截图、自动化检查用）
if (import.meta.env.DEV) {
  Promise.all([import('./store'), import('./playback')]).then(([store, pb]) => {
    ;(window as unknown as Record<string, unknown>).__demo = { store, pb }
  })
}
