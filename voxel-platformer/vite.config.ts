import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
  },
  server: {
    port: 8001,
    open: '/index.html',
  },
  worker: {
    format: 'es',
  },
})
