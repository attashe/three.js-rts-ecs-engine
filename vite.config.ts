import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        game: resolve(__dirname, 'index.html'),
        editor: resolve(__dirname, 'editor.html'),
        uiDemo: resolve(__dirname, 'ui-demo.html'),
      },
    },
  },
  server: {
    port: 8000,
    open: '/index.html',
  },
  worker: {
    format: 'es',
  },
})
