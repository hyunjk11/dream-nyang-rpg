// 몽실 마을 QA (fix/mongsil-town): shots from her arrival, a side look and a high overview; walking
// distances from the arrival to each townsperson; the 별문 on screen from the arrival; frame cost.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5194/dream-nyang-rpg/ OUT=dir TAG=after [VPS=1280x720] [MAXWALK=4] node tools/qa/qa-town.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-town-out'
const TAG = process.env.TAG || 'after'
const MAXWALK = Number(process.env.MAXWALK || 0)
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720').split(',').map((v) => v.split('x').map(Number))
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const fails = []
  for (const [vw, vh] of VPS) {
    const vp = `${vw}x${vh}`
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 700 })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
    const check = (name, ok, info) => { console.log(JSON.stringify({ vp, tag: TAG, check: name, ok, info })); if (!ok) fails.push(`${vp} ${name}`) }
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    await p.evaluate(() => { const s = window.__slice, d = s.dream; d.maze.passed = true; s.game.save.flags.mongsilMet = true; s.enterMongsil(true) })
    await p.waitForFunction(() => window.__slice.run && window.__slice.delve?.town, null, { timeout: 60000 })
    await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
    await p.waitForTimeout(2500)
    await p.evaluate(() => { window.__slice.talk.close(); document.getElementById('zone-banner')?.classList.add('hidden') })
    await p.screenshot({ path: `${OUT}/${vp}-${TAG}-arrival.png` })
    const info = await p.evaluate(() => {
      const s = window.__slice, P = s.hero.object.position, cam = s.stage.camera
      const town = s.run.town, spots = town.spots
      const dist = Object.fromEntries(spots.map((t) => [t.id, +Math.hypot(t.x - P.x, t.z - P.z).toFixed(1)]))
      const gate = spots.find((t) => t.id === 'gate')
      const v = new P.constructor(gate.x, 2, gate.z).project(cam)
      const span = Math.max(...spots.map((a) => Math.max(...spots.map((b2) => Math.hypot(a.x - b2.x, a.z - b2.z)))))
      return { start: [+P.x.toFixed(1), +P.z.toFixed(1)], dist, span: +span.toFixed(1), gateOnScreen: Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && v.z < 1, gateNdc: [+v.x.toFixed(2), +v.y.toFixed(2)], speed: s.stats?.moveMul ?? 1, w: s.run.maze.w }
    })
    // Walk time at her run speed (about 6 m/s in town).
    const far = Math.max(...Object.values(info.dist))
    info.farWalkSec = +(far / 6).toFixed(1)
    check('layout', true, info)
    if (MAXWALK) check('npcs_close', info.farWalkSec <= MAXWALK, { farWalkSec: info.farWalkSec, max: MAXWALK })
    check('gate_visible_from_arrival', info.gateOnScreen, info.gateNdc)
    // Looks round the square: turn the shoulder camera, and walk her to a corner / the gate.
    const shots = [['west', null, -Math.PI / 2, 0.05], ['east', null, Math.PI / 2, 0.05], ['corner', 'corner', null, 0.18], ['from-gate', 'gate', 0, 0.12]]
    for (const [name, where, yaw, pitch] of shots) {
      await p.evaluate(([where, yaw, pitch]) => {
        const s = window.__slice, P = s.hero.object.position, town = s.run.town, sp = town.spots
        const mid = sp.find((t) => t.id === 'mongi')
        let y = yaw
        if (where === 'gate') { const g = sp.find((t) => t.id === 'gate'); P.set(g.x, 0, g.z + 2.2) }
        if (where === 'corner') { const a = sp.find((t) => t.id === 'toto'); P.set(a.x, 0, a.z + 3); y = Math.atan2(mid.x - P.x + 6, mid.z - P.z) }
        s.shooter.view.yaw = y; s.shooter.view.pitch = pitch
      }, [where, yaw, pitch])
      await p.waitForTimeout(900)
      await p.screenshot({ path: `${OUT}/${vp}-${TAG}-${name}.png` })
    }
    // Frame cost over ~6 s standing in the square.
    const perf = await p.evaluate(() => new Promise((res) => {
      const r = window.__slice.stage.renderer, t0 = performance.now(), ts = []
      let last = t0
      const tick = (t) => { ts.push(t - last); last = t; if (t - t0 < 6000) requestAnimationFrame(tick); else { ts.sort((a, b) => a - b); res({ frames: ts.length, avg: +(ts.reduce((a, b) => a + b, 0) / ts.length).toFixed(1), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(1), calls: r.info.render.calls, tris: r.info.render.triangles }) } }
      requestAnimationFrame(tick)
    }))
    check('perf', true, perf)
    check('no_errors', errs.length === 0, errs.slice(0, 5))
    await ctx.close()
  }
  await b.close()
  console.log(fails.length ? 'TOWN_FAIL ' + fails.join(', ') : 'TOWN_OK')
})()
