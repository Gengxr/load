import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:single` 生成单个 HTML 文件，可直接双击打开（离线演示用）
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [vue(), viteSingleFile()] : [vue()],
  worker: { format: 'es' },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 2000,
  },
  test: { include: ['tests/**/*.test.ts'] },
}))
