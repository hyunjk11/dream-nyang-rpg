import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/dream-nyang-rpg/',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        three: resolve(__dirname, '3d/index.html'),
      },
    },
  },
})
