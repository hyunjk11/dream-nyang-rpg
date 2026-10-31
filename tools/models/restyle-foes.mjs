// Dream restyle for Kenney-style rigged foes: keep one walk clip, prune, pastel-recolour the atlas
// (dreamtex.py) and write *_mobile.glb.
//   node restyle-foes.mjs <source models dir> [out dir = ../../public/models/3d]
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune } from '@gltf-transform/functions'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const [srcDir, outArg] = process.argv.slice(2)
if (!srcDir) {
  console.error('usage: node restyle-foes.mjs <source models dir> [out dir]')
  process.exit(1)
}
const outDir = outArg ?? fileURLToPath(new URL('../../public/models/3d/', import.meta.url))
await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const tmp = mkdtempSync(join(tmpdir(), 'dreamtex-'))
const dreamtex = fileURLToPath(new URL('./dreamtex.py', import.meta.url))
/** Source file → output name, and which clips to keep (others are dropped). */
const JOBS = [
  ['sk_minion', 'kk_skel_minion', ['Walking_D_Skeletons']],
  ['sk_warrior', 'kk_skel_warrior', []],
  ['sk_rogue', 'kk_skel_rogue', []],
  ['sk_mage', 'kk_skel_mage', []],
  ['lich_meshy', 'hd_lich', ['Walk']],
]
for (const [name, out, keep] of JOBS) {
  const doc = await io.read(join(srcDir, `${name}.glb`))
  for (const a of doc.getRoot().listAnimations()) if (!keep.includes(a.getName())) a.dispose()
  await doc.transform(prune())
  for (const t of doc.getRoot().listTextures()) {
    const fmt = t.getMimeType() === 'image/webp' ? 'webp' : 'png'
    writeFileSync(join(tmp, 'in'), t.getImage())
    execFileSync('python3', [dreamtex, join(tmp, 'in'), join(tmp, 'out'), fmt])
    t.setImage(new Uint8Array(readFileSync(join(tmp, 'out'))))
  }
  await io.write(join(outDir, `${out}_mobile.glb`), doc)
  console.log('wrote', `${out}_mobile.glb`)
}
