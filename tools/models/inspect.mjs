// Triangle counts per .glb: node inspect.mjs a.glb b.glb …
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
for (const f of process.argv.slice(2)) {
  const root = (await io.read(f)).getRoot()
  let tris = 0
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3
  const anims = root.listAnimations().map((a) => a.getName())
  console.log(`${f.split('/').pop()}\t${tris} tris\t${root.listTextures().length} tex\t${anims.join(', ') || '-'}`)
}
