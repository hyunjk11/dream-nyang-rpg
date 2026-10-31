// Far LOD for horde foes: weld UV seams shut, bake the texture into vertex colours, simplify.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { weld, simplify, prune, dedup } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const [src, dst, ratio] = process.argv.slice(2)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(src)
const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0]
const tex = prim.getMaterial().getBaseColorTexture()
writeFileSync('/tmp/_tex.bin', tex.getImage())
execFileSync('python3', ['-c', `
from PIL import Image
im=Image.open('/tmp/_tex.bin').convert('RGB').resize((128,128),Image.BOX)
open('/tmp/_tex.rgb','wb').write(im.tobytes())`])
const rgb = readFileSync('/tmp/_tex.rgb')
const uv = prim.getAttribute('TEXCOORD_0')
const n = uv.getCount()
const col = new Float32Array(n * 3)
const t = [0, 0]
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
for (let i = 0; i < n; i += 1) {
  uv.getElement(i, t)
  const x = Math.min(127, Math.max(0, Math.floor((((t[0] % 1) + 1) % 1) * 128)))
  const y = Math.min(127, Math.max(0, Math.floor((((t[1] % 1) + 1) % 1) * 128)))
  const k = (y * 128 + x) * 3
  col[i * 3] = lin(rgb[k]); col[i * 3 + 1] = lin(rgb[k + 1]); col[i * 3 + 2] = lin(rgb[k + 2])
}
const acc = doc.createAccessor().setType('VEC3').setArray(col).setBuffer(doc.getRoot().listBuffers()[0])
prim.setAttribute('COLOR_0', acc)
for (const s of prim.listSemantics()) if (s !== 'POSITION' && s !== 'COLOR_0') prim.setAttribute(s, null)
const mat = prim.getMaterial()
mat.setBaseColorTexture(null)
for (const tx of doc.getRoot().listTextures()) tx.dispose()
await MeshoptSimplifier.ready
await doc.transform(weld({ tolerance: 0.004 }), simplify({ simplifier: MeshoptSimplifier, ratio: Number(ratio), error: 0.04, lockBorder: false }), dedup(), prune())
for (const e of doc.getRoot().listExtensionsUsed()) e.dispose()
await io.write(dst, doc)
const p = doc.getRoot().listMeshes()[0].listPrimitives()[0]
console.log(dst, p.getAttribute('POSITION').getCount(), p.getIndices().getCount() / 3)
