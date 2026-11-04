// 손맛 QA (feat/gunfeel-hold): per gun — a close look at how she holds it (town, dev close camera),
// then real mouse-down fire in the sewer at a frozen pack: a slowed frame sequence (→ GIF), FPS at
// real speed, and the feel numbers (shots, punch, muzzle light, stagger, hit-stop, slow-mo on an elite kill).
// Usage: PLAYWRIGHT=… BASE=http://localhost:5192/dream-nyang-rpg/ OUT=dir [VPS=1280x720,360x640] [TAG=after] node tools/qa/qa-feel.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-feel-out'
const TAG = process.env.TAG || 'after'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720,360x640').split(',').map((v) => v.split('x').map(Number))
const GUNS = ['gun_water', 'gun_bubble', 'gun_star', 'gun_dart']
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const report = { tag: TAG, vps: {} }
  for (const [vw, vh] of VPS) {
    const touch = vw < 700
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    const R = (report.vps[`${vw}x${vh}`] = { guns: {} })
    const setGun = (id) => p.evaluate((id) => { const s = window.__slice, sv = s.game.save, g = sv.items.find((i) => i.uid === sv.equipment.weapon); g.defId = id; g.mods = []; s.applyBuild() }, id)
    // 1) Hold portraits in town: close camera, front-right three-quarter and side.
    for (const gun of GUNS) {
      await setGun(gun)
      await p.evaluate(() => { const s = window.__slice; s.view.aimYaw = s.hero.yaw; Object.assign(s.view, { on: true, yaw: 55, pitch: 8, dist: 1.9, height: 1.15 }) })
      await p.waitForTimeout(900)
      await p.screenshot({ path: `${OUT}/${TAG}-${vw}x${vh}-hold-${gun}-34.png` })
      await p.evaluate(() => Object.assign(window.__slice.view, { yaw: 100, pitch: 4, dist: 1.6 }))
      await p.waitForTimeout(700)
      await p.screenshot({ path: `${OUT}/${TAG}-${vw}x${vh}-hold-${gun}-side.png` })
      R.guns[gun] = { hold: await p.evaluate(() => window.__slice.hero.holdStyle?.label ?? null), leftGun: await p.evaluate(() => { let n = 0; window.__slice.hero.object.traverse((o) => { if (o.name === 'gun-left' && o.visible) n++ }); return n }) }
    }
    await p.evaluate(() => { const v = window.__slice.view; v.on = false; delete v.aimYaw })
    // 2) Sewer: frozen pack 7 m ahead, real mouse-down fire.
    await p.evaluate(() => { const s = window.__slice, sv = s.game.save; sv.level = 8; sv.delve = { unlocked: 1, cleared: 0, checkpoint: null, runs: 0, open: null, ...(sv.delve || {}) }; s.applyBuild(); s.enterSewer(1, 1, 7) })
    await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 })
    await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
    await p.waitForTimeout(1500)
    const line = (n, hpMul, elite) => p.evaluate(([n, hpMul, elite]) => {
      const s = window.__slice, H = s.run.horde, P = s.hero.object.position
      const d = new P.constructor(); s.stage.camera.getWorldDirection(d); const l = Math.hypot(d.x, d.z) || 1
      const live = H.foes.filter((f) => H.hittable(f))
      live.forEach((f, i) => { if (i >= n) { f.x = 999; f.z = 999; f.hp = 0 } })
      const pick = live.slice(0, n)
      pick.forEach((f, i) => { const side = (i - (n - 1) / 2) * 0.8; f.x = P.x + (d.x / l) * 7 + (d.z / l) * side; f.z = P.z + (d.z / l) * 7 - (d.x / l) * side; f.vx = 0; f.vz = 0; f.base ??= f.maxHp; f.hp = f.maxHp = Math.round(f.base * hpMul); if (elite && i === 0) f.elite = true })
      return pick.length
    }, [n, hpMul, elite])
    if (!touch) { await p.mouse.click(vw / 2, vh / 2); await p.waitForTimeout(300) }
    const press = async (down) => {
      if (touch) await p.evaluate((down) => window.__slice.shooter && (window.__qaFire = down), down)
      if (down) await p.mouse.down(); else await p.mouse.up()
    }
    for (const gun of GUNS) {
      await setGun(gun)
      await line(5, 60, false)
      await p.mouse.move(vw / 2, vh / 2)
      // a) slowed sequence: 0.2× world speed, 10 frames from the first trigger pull.
      await p.evaluate(() => { window.__slice.view.timeScale = 0.2 })
      await press(true)
      for (let f = 0; f < 10; f++) await p.screenshot({ path: `${OUT}/${TAG}-${vw}x${vh}-seq-${gun}-${String(f).padStart(2, '0')}.png` })
      await press(false)
      await p.evaluate(() => { window.__slice.view.timeScale = 1 })
      await p.waitForTimeout(600)
      // b) real speed: FPS and feel numbers over 2.5 s of held fire.
      await line(5, 60, false)
      const t0 = await p.evaluate(() => {
        const s = window.__slice
        window.__feel = { frames: 0, punch: 0, light: 0, stun: 0, stop: 0, shake: 0 }
        const tick = () => {
          const F = window.__feel; if (!F) return; F.frames++
          F.punch = Math.max(F.punch, s.rig.punch ?? 0); F.shake = Math.max(F.shake, s.rig.shake ?? 0)
          F.light = Math.max(F.light, s.shooter.gunFx.live?.light ?? -1)
          F.stop = Math.max(F.stop, s.hitStop.left ?? 0)
          for (const f of s.run.horde.foes) F.stun = Math.max(F.stun, f.stun ?? 0)
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        return { fired: s.shooter.fired, t: performance.now() }
      })
      await press(true); await p.waitForTimeout(2500); await press(false)
      const feel = await p.evaluate((t0) => { const F = window.__feel; window.__feel = null; const dt = (performance.now() - t0.t) / 1000; return { fps: +(F.frames / dt).toFixed(1), shots: window.__slice.shooter.fired - t0.fired, punch: +F.punch.toFixed(3), shake: +F.shake.toFixed(3), light: +F.light.toFixed(2), stun: +F.stun.toFixed(2), stop: +F.stop.toFixed(3) } }, t0)
      Object.assign(R.guns[gun], feel)
      await p.screenshot({ path: `${OUT}/${TAG}-${vw}x${vh}-fire-${gun}.png` })
      await p.waitForTimeout(500)
    }
    // 3) Elite kill with the sniper: slow-mo beat and the loot fountain.
    await setGun('gun_dart')
    await line(1, 0.05, true)
    await press(true); await p.waitForTimeout(120)
    const slow = await p.evaluate(() => ({ slowLeft: window.__slice.hitStop.slowLeft ?? null }))
    await p.screenshot({ path: `${OUT}/${TAG}-${vw}x${vh}-elite-kill.png` })
    await press(false)
    R.eliteKill = slow
    R.errors = errs.slice(0, 5)
    await ctx.close()
  }
  fs.writeFileSync(`${OUT}/${TAG}-feel.json`, JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report))
  console.log('FEEL_DONE')
  await b.close()
})()
