import { readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

function omitFullResModels(): Plugin {
  return {
    name: 'omit-full-res-models',
    closeBundle() {
      const dir = resolve(__dirname, 'dist/models/3d')
      let names: string[] = []
      try {
        names = readdirSync(dir)
      } catch {
        return
      }
      for (const name of names) {
        if (name.endsWith('.glb') && !name.endsWith('_mobile.glb')) rmSync(resolve(dir, name))
      }
    },
  }
}

export default defineConfig({
  base: '/dream-nyang-rpg/',
  plugins: [omitFullResModels()],
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
