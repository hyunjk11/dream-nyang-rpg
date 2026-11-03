// 화면 깨짐 감지 (검은/흰 큰 사각형): every frame, right after the game renders, sample the canvas
// (48×27) and flag a frame whose central region is near-solid black or white. Real input only:
// keys for walking and skills 1–4, xdotool for mouse look when HEADED=1 (pointer lock).
// On a dev build (window.__slice) it also scans the scene for NaN transforms / particle attributes
// and for big objects hugging the camera. Works on the deployed site too (detector only).
// Usage: PLAYWRIGHT=… BASE=http://localhost:5196/dream-nyang-rpg/ OUT=dir [SCENES=village,sewer,boss,maze,mongsil,field]
//        (dev only: SCENES=inject / inject-nan puts a 2 cm quad writing Inf / NaN in front of the camera)
//        [SECS=14] [HEADED=1 → run under xvfb-run] node tools/qa/qa-glitch.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const { execSync } = require('child_process')
const BASE = process.env.BASE || 'http://localhost:5196/dream-nyang-rpg/'
const OUT = process.env.OUT || 'qa-glitch-out'
const SCENES = (process.env.SCENES || 'village,sewer,boss,maze,mongsil,field').split(',')
const SECS = +(process.env.SECS || 14)
const SAVE = process.env.SAVE ? fs.readFileSync(process.env.SAVE, 'utf8') : null
fs.mkdirSync(OUT, { recursive: true })

// In-page detector: runs after the game's rAF callback, so the drawing buffer is still intact.
function detector() {
  window.__glitch = { frames: 0, black: 0, white: 0, maxBlack: 0, maxWhite: 0, shots: [], tag: '' }
  const S = document.createElement('canvas'); S.width = 48; S.height = 27
  const sx = S.getContext('2d', { willReadFrequently: true })
  const tick = () => {
    requestAnimationFrame(tick)
    const c = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]
    const g = window.__glitch
    if (!c || !c.width || document.body.classList.contains('travelling') || !window.__glitchOn) return
    try { sx.drawImage(c, 0, 0, 48, 27) } catch { return }
    const d = sx.getImageData(12, 5, 24, 17).data // central half width, ~60% height
    let k = 0, w = 0
    for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx < 14) k++; if (mn > 242) w++ }
    const n = d.length / 4, fk = k / n, fw = w / n
    g.frames++
    g.maxBlack = Math.max(g.maxBlack, fk); g.maxWhite = Math.max(g.maxWhite, fw)
    const bad = fk >= 0.6 ? 'black' : fw >= 0.6 ? 'white' : ''
    if (!bad) return
    g[bad]++
    if (g.shots.length < 4) {
      const F = document.createElement('canvas'); F.width = c.width; F.height = c.height
      F.getContext('2d').drawImage(c, 0, 0)
      g.shots.push({ bad, tag: g.tag, frac: +(bad === 'black' ? fk : fw).toFixed(2), url: F.toDataURL('image/png') })
    }
  }
  const start = () => requestAnimationFrame(tick)
  if (document.readyState === 'complete') setTimeout(start, 500); else addEventListener('load', () => setTimeout(start, 500))
}

// Dev only: NaN transforms, NaN particle attributes, huge things right at the camera.
function scan() {
  const s = window.__slice
  if (!s?.stage?.scene) return null
  const cam = s.stage.camera
  const cp = cam.getWorldPosition(new cam.position.constructor())
  const out = { nan: [], hug: [], cam: { near: cam.near, finite: cam.matrixWorld.elements.every(Number.isFinite) && cam.projectionMatrix.elements.every(Number.isFinite) } }
  const label = (o) => `${o.type}:${o.name || o.parent?.name || '?'}`
  s.stage.scene.traverse((o) => {
    if (!o.visible) return
    if (!o.matrixWorld.elements.every(Number.isFinite)) { if (out.nan.length < 8) out.nan.push(label(o)); return }
    const geo = o.geometry
    if (o.isPoints && geo) {
      const n = geo.drawRange.count === Infinity ? geo.attributes.position.count : geo.drawRange.count
      for (const [k, a] of Object.entries(geo.attributes)) { for (let i = 0; i < Math.min(n, a.count) * a.itemSize; i++) if (!Number.isFinite(a.array[i])) { if (out.nan.length < 8) out.nan.push(`${label(o)}.${k}[${Math.floor(i / a.itemSize)}]`); break } }
      const pos = geo.attributes.position
      for (let i = 0; i < Math.min(n, pos.count); i++) {
        const v = new cp.constructor(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld)
        const dist = v.distanceTo(cp)
        if (dist < 0.6 && out.hug.length < 8) out.hug.push(`${label(o)} point ${i} @${dist.toFixed(2)}m size ${geo.attributes.aSize ? geo.attributes.aSize.getX(i).toFixed(2) : '?'}`)
      }
      return
    }
    if (o.isMesh && geo) {
      if (!geo.boundingSphere) geo.computeBoundingSphere()
      const bs = geo.boundingSphere
      if (!bs || !Number.isFinite(bs.radius)) { if (out.nan.length < 8) out.nan.push(label(o) + ' bsphere'); return }
      const c = bs.center.clone().applyMatrix4(o.matrixWorld)
      const r = bs.radius * o.matrixWorld.getMaxScaleOnAxis()
      if (r > 200 && o.name !== 'sky') { if (out.hug.length < 8) out.hug.push(`${label(o)} radius ${r.toFixed(0)}`) }
    }
  })
  return out
}

;(async () => {
  const b = await chromium.launch({ headless: !process.env.HEADED, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await b.newContext({ viewport: { width: 1024, height: 576 } })
  await ctx.addInitScript(detector)
  // Software GL is treated as a phone (no bloom composer). Hide the GPU name so the desktop path
  // (HalfFloat target → bloom → OutputPass) is the one under test, as on the player's real GPU. DESKTOP=0 skips.
  if (process.env.DESKTOP !== '0') await ctx.addInitScript(() => {
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue
      const get = C.prototype.getExtension
      C.prototype.getExtension = function (name) { return name === 'WEBGL_debug_renderer_info' ? null : get.call(this, name) }
    }
  })
  if (SAVE) await ctx.addInitScript((save) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('dream-nyang-rpg-3d-save-v1', save); sessionStorage.setItem('seeded', '1') } }, SAVE)
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(BASE)
  if (!SAVE) await p.evaluate(() => localStorage.clear()), await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click(SAVE ? '#btn-continue' : '#btn-new'); await p.waitForTimeout(800); await p.keyboard.press('Escape'); await p.waitForTimeout(1200)
  for (let i = 0; i < 12 && await p.evaluate(() => document.body.classList.contains('talking')); i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(300) }
  const dev = await p.evaluate(() => !!window.__slice)
  if (dev) await p.evaluate(() => { const s = window.__slice; for (let i = 0; i < 40 && s.game.save.level < 13; i++) s.giveXp(200); for (const id of ['bubble_bomb', 'overdrive', 'mochi_rush', 'candy_aura']) s.game.save.build.ranks[id] = 3; s.applyBuild?.() })
  // A real GPU at 100 FPS keeps the top tier (bloom on); software GL would drop to a no-bloom tier and hide the bug.
  if (dev) await p.evaluate(() => window.__slice.quality.setEnabled(false))
  const box = await p.locator('canvas').first().boundingBox()
  const look = (dx, dy) => { if (process.env.HEADED) try { execSync(`xdotool mousemove_relative -- ${dx} ${dy}`) } catch {} }
  const rows = []
  for (const where of SCENES) {
    if (dev) {
      const go = await p.evaluate(async (where) => {
        const s = window.__slice, c = s.chapters
        const wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
        const settle = async () => { for (let i = 0; i < 400 && s.travelling; i++) await wait(100); await wait(1500) }
        const inTown = () => s.run?.plan?.objective === 'town'
        if (s.run && !(where === 'field' || where === 'mongsil' || where.startsWith('inject'))) { if (inTown()) s.mongsilToIsland?.(); else s.leaveSewer?.('recall'); await settle() }
        c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = Math.max(c.current, 2); c.card = 0
        if (where === 'village') { if (s.game.zone !== 'village') s.enterZone('village', { x: 0, z: 0 }) }
        else if (where === 'mongsil') { s.dream.maze.passed = true; s.enterMongsil(true) }
        else if (where === 'field') { if (!inTown()) { s.dream.maze.passed = true; s.enterMongsil(true); await settle() } s.enterField() }
        else if (where === 'maze') s.enterArea('maze')
        else if (where === 'sewer') s.enterSewer(1, 1)
        else if (where === 'boss') s.enterSewer(1, 4)
        else if (where.startsWith('inject')) {
          // A 2 cm quad 3 m ahead that writes Inf (or NaN) into the HDR buffer: what a bad shader pixel does.
          const st = s.stage, any = []
          st.scene.traverse((o) => { if (o.isMesh && o.geometry && !o.isInstancedMesh) any.push(o) })
          const src = any[0], Shader = s.vfx.glowPts.material.constructor
          const nan = where === 'inject-nan'
          const mat = new Shader({ uniforms: { uV: { value: nan ? 0 : 1e30 } }, vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: nan ? 'uniform float uV; void main(){ float n = uV / uV; gl_FragColor = vec4(n, n, n, 1.0); }' : 'uniform float uV; void main(){ gl_FragColor = vec4(uV, uV, uV, 1.0); }' })
          const m = new src.constructor(src.geometry, mat)
          m.scale.setScalar(0.02 / Math.max(0.01, (src.geometry.boundingSphere ?? (src.geometry.computeBoundingSphere(), src.geometry.boundingSphere)).radius))
          m.position.set(0, 0, -3); m.frustumCulled = false; m.renderOrder = 99; m.name = 'qa-inject'
          if (!st.camera.parent) st.scene.add(st.camera)
          st.camera.children.filter((c) => c.name === 'qa-inject').forEach((c) => c.removeFromParent())
          st.camera.add(m)
        }
        await settle()
        for (let i = 0; i < 12 && document.body.classList.contains('talking'); i++) { s.talk.close?.(); await wait(200) }
        return { zone: s.game.zone, run: !!s.run, obj: s.run?.plan?.objective ?? null }
      }, where)
      console.log(where, JSON.stringify(go))
    }
    await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(300) // takes the pointer lock
    await p.evaluate((t) => { window.__glitch.tag = t; window.__glitchOn = true }, where)
    const g0 = await p.evaluate(() => ({ ...window.__glitch, shots: window.__glitch.shots.length }))
    const scans = []
    const near = []
    const t0 = Date.now()
    let step = 0
    while (Date.now() - t0 < SECS * 1000) {
      const mv = ['KeyW', 'KeyA', 'KeyD', 'KeyS'][step % 4]
      await p.keyboard.down(mv)
      look(step % 2 ? -90 : 120, step % 3 === 0 ? 40 : -30)
      if (dev) await p.evaluate(() => { const s = window.__slice.skills; for (const id of Object.keys(s.cooldown ?? {})) s.cooldown[id] = 0 })
      // one at a time, then all four at once
      if (step % 2 === 0) { for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) { await p.keyboard.press(k); await p.waitForTimeout(250) } }
      else { for (const k of ['Digit4', 'Digit2', 'Digit1', 'Digit3']) await p.keyboard.press(k) }
      await p.waitForTimeout(500)
      await p.keyboard.up(mv)
      if (dev) { const sc = await p.evaluate(scan); if (sc && (sc.nan.length || !sc.cam.finite)) scans.push(sc); if (sc?.hug.length) near.push(...sc.hug) }
      step++
    }
    await p.evaluate(() => { window.__glitchOn = false })
    const g = await p.evaluate(() => window.__glitch)
    const row = { where, frames: g.frames - g0.frames, black: g.black - g0.black, white: g.white - g0.white, maxBlack: +g.maxBlack.toFixed(2), maxWhite: +g.maxWhite.toFixed(2), scans: scans.slice(0, 3), nearCamera: near.slice(0, 3) }
    for (const [i, s] of g.shots.slice(g0.shots).entries()) fs.writeFileSync(`${OUT}/${s.tag}-${s.bad}-${i}.png`, Buffer.from(s.url.split(',')[1], 'base64'))
    await p.screenshot({ path: `${OUT}/${where}-end.png` })
    rows.push(row)
    console.log(JSON.stringify(row))
    await p.evaluate(() => { const g = window.__glitch; g.maxBlack = 0; g.maxWhite = 0 })
  }
  const bad = rows.reduce((n, r) => n + r.black + r.white + r.scans.length, 0)
  console.log(bad ? `GLITCH_FAIL ${bad}` : 'GLITCH_OK', JSON.stringify({ errs: errs.slice(0, 3) }))
  fs.writeFileSync(`${OUT}/glitch.json`, JSON.stringify({ rows, errs }, null, 1))
  await b.close()
  process.exit(bad ? 1 : 0)
})()
