import { readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve('dist/models/3d')
let names = []
try {
  names = readdirSync(dir)
} catch {
  process.exit(0)
}
for (const name of names) {
  if (name.endsWith('.glb') && !name.endsWith('_mobile.glb')) rmSync(resolve(dir, name))
}
