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
        fxDemo: resolve(__dirname, 'fx-demo.html'),
      },
    },
  },
  server: {
    port: 8001,
    open: '/index.html',
  },
  worker: {
    format: 'es',
  },
})
