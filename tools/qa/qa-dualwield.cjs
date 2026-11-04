// 보조 손 · 쌍권총 QA on the BUILT game (dev build). Real input: I key, right-click cells, '보조 손에 차기',
// mouse-held trigger at pinned dummies. Reads per-hand damage from shooter.handDamage over game time.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir node tools/qa/qa-dualwield.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || '.'
const SEC = +(process.env.SEC || 4)
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  for (const [vw, vh] of (process.env.VPS || '1280x720,360x640').split(',').map((v) => v.split('x').map(Number))) {
    const touch = vw < 600
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch, isMobile: touch })
    const p = await ctx.newPage()
    await p.addInitScript(() => { window.__gt = 0; let last = performance.now(); const tick = (now) => { window.__gt += Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
    const errs = []
    p.on('pageerror', (e) => errs.push(e.message))
    const V = `${vw}x${vh}`
    const wait = (ms) => p.waitForTimeout(ms)
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await wait(800); await p.keyboard.press('Escape'); await wait(1500)
    for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__slice.talk.close()); await wait(200) }
    await p.evaluate(() => { const c = window.__slice.chapters; c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; c.card = 0; window.__slice.enterArea('maze') })
    await p.waitForFunction(() => window.__slice.run?.plan.area === 'maze', null, { timeout: 90000 })
    await p.waitForFunction(() => !document.getElementById('fade')?.classList.contains('on') && !window.__slice.travelling, null, { timeout: 90000 }); await wait(1500)
    const ids = await p.evaluate(() => {
      const s = window.__slice, g = s.game.save
      let seed = 11; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const A = s.makeItem('gun_water', 'rare', rng, 6); A.affixes = []
      const B = structuredClone(A); B.uid = A.uid + '-twin'
      const C = s.makeItem('gun_water', 'epic', rng, 6); C.affixes = []; C.plus = 5
      const D = s.makeItem('gun_dart', 'rare', rng, 6)
      g.items.push(A, B, C, D); g.equipment.weapon = A.uid; delete g.equipment.offhand
      s.applyBuild()
      // Longest open line; pin 3 tough dummies down it and keep her healed.
      const r = s.run, h = s.hero.object.position
      let best = 0, by = 0
      for (let k = 0; k < 48; k++) { const y = (k / 48) * Math.PI * 2; const d = r.skillWorld.solid(h.x, 0.8, h.z, Math.sin(y), 0, Math.cos(y), 30); if (d > best + 0.01) { best = d; by = y } }
      s.shooter.view.yaw = by; s.shooter.view.pitch = 0.05
      const dist = Math.min(7, best - 1)
      for (const f of r.horde.foes) { f.x = h.x + 400; f.z = h.z + 400; f.homeX = f.x; f.homeZ = f.z; f.mode = 'home' }
      const dummies = []
      for (let i = 0; i < 3; i++) { const f = r.horde.spawn('slime', h.x + Math.sin(by) * dist, h.z + Math.cos(by) * dist); if (f) { f.ranged = false; dummies.push(f) } }
      const hx = h.x, hz = h.z
      window.__pin = setInterval(() => {
        dummies.forEach((f, i) => { f.hp = f.maxHp = 1e7; f.x = hx + Math.sin(by) * dist + (i - 1) * 0.5 * Math.cos(by); f.z = hz + Math.cos(by) * dist - (i - 1) * 0.5 * Math.sin(by); f.cooldown = 99; f.aim = 0 })
        if (window.__noheat) { s.shooter.gun.heat = 0; s.shooter.gun.overheated = false }
        s.hero.hp = s.hero.maxHp; s.hero.object.position.x = hx; s.hero.object.position.z = hz; s.shooter.view.yaw = by
      }, 30)
      return { A: A.uid, B: B.uid, C: C.uid, D: D.uid, dist }
    })
    const fire = async (tag, shotAt, noheat = true) => {
      await p.evaluate((nh) => { window.__noheat = nh; window.__hot = null; const s = window.__slice; s.shooter.handDamage.main = 0; s.shooter.handDamage.off = 0; s.shooter.fired = 0; s.shooter.landed = 0; Object.assign(s.shooter.handShots, { main: 0, off: 0, mainHit: 0, offHit: 0 }); s.shooter.gun.heat = 0; s.shooter.gun.overheated = false; window.__hotT = setInterval(() => { if (window.__hot == null && s.shooter.gun.overheated) window.__hot = window.__gt }, 20) }, noheat)
      const t0 = await p.evaluate(() => window.__gt)
      const box = await p.locator('#view').boundingBox()
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await p.mouse.down()
      await p.waitForFunction((t) => window.__gt >= t, t0 + SEC * 0.6, { timeout: 120000, polling: 50 })
      if (shotAt) await p.screenshot({ path: `${OUT}/${V}-${shotAt}.png` })
      await p.waitForFunction((t) => window.__gt >= t, t0 + SEC, { timeout: 120000, polling: 50 })
      await p.mouse.up()
      return p.evaluate(([t0, tag]) => { clearInterval(window.__hotT); const s = window.__slice, dt = window.__gt - t0, hd = s.shooter.handDamage; return { tag, sec: +dt.toFixed(2), fired: s.shooter.fired, landed: s.shooter.landed, hands: { ...s.shooter.handShots }, perHit: +((hd.main + hd.off) / Math.max(1, s.shooter.landed)).toFixed(2), main: Math.round(hd.main), off: Math.round(hd.off), dps: Math.round((hd.main + hd.off) / dt), dpsMain: Math.round(hd.main / dt), dpsOff: Math.round(hd.off / dt), hold: s.hero.holdStyle.type, pitch: +s.shooter.view.pitch.toFixed(3), heat: +s.shooter.gun.heat.toFixed(2), overheated: s.shooter.gun.overheated, overheatAt: window.__hot == null ? null : +(window.__hot - t0).toFixed(2) } }, [t0, tag])
    }
    const bag = async () => { await p.keyboard.press('KeyI'); await wait(700) }
    const close = async () => { await p.keyboard.press('Escape'); await wait(600) }
    const rows = []
    if (!touch) { rows.push(await fire('one', 'hold-one')); rows.push(await fire('one-heat', null, false)) }
    // Right-click the twin in the bag → 보조 손.
    await bag()
    await p.click(`#inv-grid .inv-cell[data-uid="${ids.B}"]`, { button: 'right' }); await wait(600)
    await p.screenshot({ path: `${OUT}/${V}-bag-twin.png` })
    const panel = await p.textContent('#inv-hands').catch(() => null)
    await close()
    if (!touch) { rows.push(await fire('twin', 'hold-twin')); rows.push(await fire('twin-heat', null, false)) }
    // Swap the off hand for the epic +5: right-click the worn off-hand (off), right-click the epic.
    await bag()
    await p.click('#inv-slots .inv-cell[data-slot="offhand"]', { button: 'right' }); await wait(400)
    await p.click(`#inv-grid .inv-cell[data-uid="${ids.C}"]`, { button: 'right' }); await wait(600)
    const panel2 = await p.textContent('#inv-hands').catch(() => null)
    await p.screenshot({ path: `${OUT}/${V}-bag-mixed.png` })
    // A two-handed gun: '보조 손에 차기' says why not.
    await p.click(`#inv-grid .inv-cell[data-uid="${ids.D}"]`); await wait(400)
    await p.click('#inv-offhand'); await wait(300)
    const toast = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).pop())
    await p.screenshot({ path: `${OUT}/${V}-twohand-refused.png` })
    await close()
    if (!touch) rows.push(await fire('mixed', 'hold-mixed-numbers'))
    else { await wait(800); await p.screenshot({ path: `${OUT}/${V}-hold-mixed.png` }) }
    const exp = await p.evaluate(() => { const s = window.__slice; return { stats: Math.round(s.dpsOf(s.stats)) } })
    console.log(V, JSON.stringify({ rows, panel, panel2, toast, exp, errs }))
    await ctx.close()
  }
  await b.close()
})()
