// Ranged-foe probe on the BUILT game (dev build, window.__slice for setup only).
// 1) melee/ranged ratio of what actually spawned on a maze floor and in the 몽실 field (waves, not placed);
// 2) HP lost in 10 s standing still among 5 mixed normals (same ring as qa-realplay) + a "real" layout
//    (ranged ones at their own range); 3) a real Space dash as a shot arrives; 4) screenshots + GIF frames.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir TAG=after [SCENES=maze1,field] node tools/qa/qa-ranged.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || '.'
const TAG = process.env.TAG || 'run'
const SCENES = (process.env.SCENES || 'maze1,field').split(',')
const VP = (process.env.VP || '1280x720').split('x').map(Number)
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await b.newContext({ viewport: { width: VP[0], height: VP[1] } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  const rows = []
  const log = (r) => { r.tag = TAG; rows.push(r); console.log(JSON.stringify(r)) }
  await p.addInitScript(() => {
    window.__gt = 0
    let last = performance.now()
    const tick = (now) => { window.__gt += Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  const waitGame = async (sec) => { const t = await p.evaluate(() => window.__gt); await p.waitForFunction((t) => window.__gt >= t, t + sec, { timeout: 180000, polling: 50 }) }
  const settle = async () => { await p.waitForFunction(() => !document.getElementById('fade')?.classList.contains('on') && !window.__slice.travelling, null, { timeout: 90000 }); await p.waitForTimeout(1500) }
  const fresh = async () => {
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(800); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  }
  const go = {
    maze1: async () => { await fresh(); await p.evaluate(() => { const c = window.__slice.chapters; c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; c.card = 0; window.__slice.enterArea('maze') }); await p.waitForFunction(() => window.__slice.run?.plan.area === 'maze', null, { timeout: 90000 }); await settle() },
    field: async () => { await fresh(); await p.evaluate(() => { const c = window.__slice.chapters; c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; window.__slice.dream.maze.passed = true; window.__slice.dream.maze.entered = true; window.__slice.enterField() }); await p.waitForFunction(() => window.__slice.run?.horde, null, { timeout: 90000 }); await settle() },
    d1: async () => { await fresh(); await p.evaluate(() => window.__slice.enterSewer(1, 1)); await p.waitForFunction(() => window.__slice.run?.horde && !window.__slice.run.plan.area, null, { timeout: 90000 }); await settle() },
  }
  // Longest open line from her, and face the camera down it.
  const face = () => p.evaluate(() => {
    const s = window.__slice, r = s.run, h = s.hero.object.position
    let best = 0, by = 0
    for (let k = 0; k < 48; k++) { const y = (k / 48) * Math.PI * 2; const d = r.skillWorld.solid(h.x, 0.8, h.z, Math.sin(y), 0, Math.cos(y), 30); if (d > best + 0.01) { best = d; by = y } }
    s.shooter.view.yaw = by
    return { best, yaw: by }
  })
  const park = () => p.evaluate(() => { const s = window.__slice, h = s.hero.object.position; for (const f of s.run.horde.foes) { f.x = h.x + 400; f.z = h.z + 400; f.homeX = f.x; f.homeZ = f.z; f.mode = 'home' } s.run.horde.shots?.forEach((x) => (x.alive = false)) })
  const heal = () => p.evaluate(() => { const h = window.__slice.hero; h.hp = h.maxHp; h.iframes = 0; h.sinceHit = 0 })
  const ratio = async (where) => {
    // Let the floor's own waves/packs spawn and fight her for a while (she is healed so it keeps going).
    const seen = new Map()
    for (let i = 0; i < 12; i++) {
      await heal()
      const fs2 = await p.evaluate(() => window.__slice.run.horde.foes.map((f) => [f.id, f.ranged === true, f.kind, f.elite]))
      for (const [id, r, k, e] of fs2) seen.set(id, { r, k, e })
      await waitGame(2)
    }
    const all = [...seen.values()]
    const r = all.filter((x) => x.r).length
    const byKind = {}
    for (const x of all) { byKind[x.k] = byKind[x.k] || [0, 0]; byKind[x.k][x.r ? 1 : 0]++ }
    log({ where, test: 'ratio', spawned: all.length, ranged: r, melee: all.length - r, rangedPct: +((100 * r) / Math.max(1, all.length)).toFixed(1), elites: all.filter((x) => x.e).length, byKind, share: await p.evaluate(() => window.__slice.run.horde.rangedShare ?? null) })
    await p.screenshot({ path: `${OUT}/${TAG}-${where}-pack.png` })
  }
  // 10 s still among 5 normals. layout 'ring': all at 1.3 m (as qa-realplay). layout 'real': melee at 1.3 m,
  // ranged at 8.5 m down the open line (where they choose to stand).
  const stand = async (where, layout) => {
    await park(); await face()
    const setup = await p.evaluate((layout) => {
      const s = window.__slice, h = s.hero.object.position, horde = s.run.horde, a = s.rig.aim
      const dx = a.x - h.x, dz = a.z - h.z, l = Math.hypot(dx, dz) || 1
      const kinds = ['slime', 'slime', 'bug', 'slime', 'bat']
      const pick = []
      kinds.forEach((k, i) => {
        const f = horde.spawn(k, h.x + 1, h.z + 1)
        if (!f) return
        f.age = 10
        pick.push(f)
      })
      pick.forEach((f, i) => {
        let x, z
        if (layout === 'real' && f.ranged) { const off = (i - 2) * 1.2; x = h.x + (dx / l) * 8.5 - (dz / l) * off; z = h.z + (dz / l) * 8.5 + (dx / l) * off }
        else { const an = (i / 5) * Math.PI * 2; x = h.x + Math.cos(an) * 1.3; z = h.z + Math.sin(an) * 1.3 }
        f.x = x; f.z = z; f.homeX = x; f.homeZ = z; f.mode = 'chase'; f.lost = 0
      })
      window.__pick = pick
      s.hero.hp = s.hero.maxHp; s.hero.iframes = 0
      horde.fired = 0
      return { n: pick.length, ranged: pick.filter((f) => f.ranged).length, kinds: pick.map((f) => f.kind + (f.ranged ? '*' : '')), maxHp: s.hero.maxHp, dmg: pick.map((f) => f.damage) }
    }, layout)
    const trace = []
    for (let t = 0; t <= 10; t++) {
      trace.push(await p.evaluate(() => Math.round(window.__slice.hero.hp)))
      if (t === 5) await p.screenshot({ path: `${OUT}/${TAG}-${where}-stand-${layout}.png` })
      if (t < 10) await waitGame(1)
    }
    const fired = await p.evaluate(() => window.__slice.run.horde.fired ?? null)
    log({ where, test: 'stand10s', layout, ...setup, trace, fired, lostPct: +((100 * (trace[0] - trace[10])) / setup.maxHp).toFixed(1), worstPct: +((100 * (trace[0] - Math.min(...trace))) / setup.maxHp).toFixed(1) })
    await p.evaluate(() => { for (const f of window.__pick) f.hp = 0 })
  }
  // One ranged slime at 9 m; dash (real Space key) when its shot is ~1.6 m out. Compare with not dashing.
  const dodge = async (where, doDash) => {
    await park(); const open = await face()
    const ok = await p.evaluate(() => {
      const s = window.__slice, h = s.hero.object.position, horde = s.run.horde, a = s.rig.aim
      const dx = a.x - h.x, dz = a.z - h.z, l = Math.hypot(dx, dz) || 1
      let f = null
      for (let i = 0; i < 8 && !(f && f.ranged); i++) { f = horde.spawn('slime', h.x + 300, h.z + 300); if (f && !f.ranged) f.hp = 0 }
      if (!f) return false
      f.age = 10; f.x = h.x + (dx / l) * 9; f.z = h.z + (dz / l) * 9; f.homeX = f.x; f.homeZ = f.z; f.mode = 'chase'; f.cooldown = 0
      window.__shooter = f
      s.hero.hp = s.hero.maxHp; s.hero.iframes = 0
      horde.dodged = 0; horde.fired = 0
      return true
    })
    if (!ok) return log({ where, test: 'dodge', error: 'no ranged spawn' })
    const hp0 = await p.evaluate(() => window.__slice.hero.hp)
    // One shot only: as soon as the first is in the air, the shooter rests for good.
    await p.waitForFunction(() => window.__slice.run.horde.shots.some((x) => x.alive), null, { timeout: 60000, polling: 'raf' })
    await p.evaluate(() => { const f = window.__shooter; f.cooldown = 999; f.aim = 0 })
    // wait for the shot to be close
    await p.waitForFunction(() => { const s = window.__slice, h = s.hero.object.position; return s.run.horde.shots.some((x) => x.alive && Math.hypot(x.x - h.x, x.z - h.z) < 2.6) }, null, { timeout: 60000, polling: 'raf' })
    // Press first (a screenshot takes longer than the shot's last 2 m), then capture the pass-through.
    if (doDash) await p.keyboard.press('Space')
    const dashed = await p.evaluate(() => ({ dashing: window.__slice.hero.dashing, iframes: +window.__slice.hero.iframes.toFixed(2) }))
    await p.screenshot({ path: `${OUT}/${TAG}-${where}-shot-${doDash ? 'dash' : 'stay'}.png` })
    await waitGame(0.6)
    // Stop the shooter before its next shot so only that one shot counts.
    await p.evaluate(() => { window.__shooter.hp = 0 })
    await waitGame(0.6)
    const r = await p.evaluate((hp0) => { const s = window.__slice, hz = s.run.horde; return { hpLost: Math.round(hp0 - s.hero.hp), fired: hz.fired, dodged: hz.dodged } }, hp0)
    r.afterPress = dashed
    log({ where, test: 'dodge', dash: doDash, open: +open.best.toFixed(1), ...r })
  }
  // Charge-glow + shots in flight frames for a GIF (4 ranged foes around her at range).
  const gif = async (where) => {
    await park(); await face(); await heal()
    await p.evaluate(() => {
      const s = window.__slice, h = s.hero.object.position, horde = s.run.horde, a = s.rig.aim
      const dx = a.x - h.x, dz = a.z - h.z, l = Math.hypot(dx, dz) || 1
      const want = ['slime', 'bug', 'bat', 'skeleton']
      let n = 0
      for (let i = 0; i < 16 && n < 4; i++) {
        const f = horde.spawn(want[n], h.x + 300, h.z + 300)
        if (!f) continue
        if (!f.ranged) { f.hp = 0; continue }
        const off = (n - 1.5) * 1.6
        f.age = 10; f.x = h.x + (dx / l) * 8 - (dz / l) * off; f.z = h.z + (dz / l) * 8 + (dx / l) * off; f.homeX = f.x; f.homeZ = f.z; f.mode = 'chase'; f.cooldown = n * 0.3
        n++
      }
    })
    fs.mkdirSync(`${OUT}/frames-${where}`, { recursive: true })
    for (let i = 0; i < 40; i++) {
      await p.screenshot({ path: `${OUT}/frames-${where}/${String(i).padStart(3, '0')}.png` })
      if (i % 8 === 0) await heal()
      await waitGame(0.12)
    }
    const st = await p.evaluate(() => ({ shotsDrawn: window.__slice.run.hordeView?.shotsDrawn ?? null }))
    await p.screenshot({ path: `${OUT}/${TAG}-${where}-charge-shots.png` })
    log({ where, test: 'gif', ...st })
  }
  const ONLY = process.env.ONLY
  for (const where of SCENES) {
    await go[where]()
    if (ONLY === 'dodge') { for (let i = 0; i < 3; i++) { await dodge(where, false); await dodge(where, true) } continue }
    await ratio(where)
    await stand(where, 'ring')
    await stand(where, 'real')
    if (TAG !== 'before') { await dodge(where, false); await dodge(where, true); await gif(where) }
  }
  log({ test: 'errors', errs })
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(rows, null, 1))
  await b.close()
})()
