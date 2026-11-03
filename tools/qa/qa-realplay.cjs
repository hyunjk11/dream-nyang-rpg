// Real-play probe on the BUILT game (dev build for window.__slice setup only): HP over 10 s standing in a
// pack (no input), and damage of one bullet (real mouse click) vs each skill (real keys 1-4) on normals, an elite, the boss.
// Setup (which floor, where foes stand, skill ranks, cooldown reset) goes through __slice; the damage itself
// comes only from the game's own loop: foe AI swings, the gun, the skill runner.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir TAG=before [SCENES=guide,maze1,maze3,d1,d2,d3,boss1,field,loft] node tools/qa/qa-realplay.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || '.'
const TAG = process.env.TAG || 'run'
const SCENES = (process.env.SCENES || 'guide,maze1,maze3,d1,d2,d3,boss1,field,loft').split(',')
const VP = (process.env.VP || '1280x720').split('x').map(Number)
const fs = require('fs')
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await b.newContext({ viewport: { width: VP[0], height: VP[1] } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  const rows = []
  const log = (r) => { r.tag = TAG; rows.push(r); console.log(JSON.stringify(r)) }
  const settle = async () => { await p.waitForFunction(() => !document.getElementById('fade')?.classList.contains('on') && !window.__slice.travelling, null, { timeout: 90000 }); await p.waitForTimeout(1500) }
  const fresh = async () => {
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(800); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  }
  const box = async () => p.locator('canvas').first().boundingBox()
  // In-page helpers: foes of this world (horde or town), placement along the view.
  // Game clock: the game steps min(0.1 s, frame) per frame, so headless at ~5 fps runs at half speed.
  // Every wait below is in GAME seconds (window.__gt), not wall time.
  await p.addInitScript(() => {
    window.__gt = 0
    let last = performance.now()
    const tick = (now) => { window.__gt += Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
  })
  const waitGame = async (sec) => { const t = await p.evaluate(() => window.__gt); await p.waitForFunction((t) => window.__gt >= t, t + sec, { timeout: 120000, polling: 50 }) }
  await p.addInitScript(() => {
    window.__rp = {
      world() {
        const s = window.__slice
        if (s.run && s.run.horde) return 'run'
        return 'town'
      },
      foes() {
        const s = window.__slice
        if (s.run?.horde) return s.run.horde.foes.filter((f) => f.dying === 0 && f.hp > 0).map((f) => ({ f, get x() { return f.x }, get hp() { return f.hp }, maxHp: f.maxHp, elite: f.elite, dmg: f.damage, kind: f.kind, set(x, z) { f.x = x; f.z = z; f.homeX = x; f.homeZ = z; f.lost = 0; f.vx = 0; f.vz = 0; f.mode = 'chase'; f.age = Math.max(f.age, 5) } }))
        return s.combat.foes.filter((f) => f.alive).map((f) => ({ f, get hp() { return f.hp }, maxHp: f.maxHp, elite: !!f.elite, dmg: f.damage ?? f.spec?.damage, kind: f.kind, set(x, z) { f.object.position.x = x; f.object.position.z = z; if ('state' in f) f.state = 'chase'; if ('awake' in f) f.awake = true } }))
      },
      // Along the crosshair: from her toward the gun's aim point (d = 0: the aim point itself).
      fwd(d) {
        const s = window.__slice, p = s.hero.object.position, a = s.rig.aim
        const dx = a.x - p.x, dz = a.z - p.z, l = Math.hypot(dx, dz) || 1
        const open = s.run?.skillWorld ? s.run.skillWorld.solid(p.x, 0.8, p.z, dx / l, 0, dz / l, 30) : 30
        if (!d) d = Math.min(l, open - 0.8)
        d = Math.min(d, open - 0.8)
        return { x: p.x + (dx / l) * d, z: p.z + (dz / l) * d }
      },
      // Turn the view (as the mouse would) down the longest open line, so targets are not in a wall.
      face() {
        const s = window.__slice, r = s.run, p = s.hero.object.position
        if (!r?.skillWorld) return 0
        let best = 0, by = s.view.yaw
        for (let k = 0; k < 48; k++) { const y = (k / 48) * Math.PI * 2; const d = r.skillWorld.solid(p.x, 0.8, p.z, Math.sin(y), 0, Math.cos(y), 30); if (d > best + 0.01) { best = d; by = y } }
        // the camera looks along -forward of yaw in this rig; try both and keep the one whose aim runs down the open line
        s.view.yaw = by
        return best
      },
      // Park every foe far off so a test sees only what it places.
      parkAll() { const s = window.__slice, p = s.hero.object.position; for (const f of this.foes()) f.set(p.x + 400, p.z + 400) },
    }
  })
  const heal = () => p.evaluate(() => { const h = window.__slice.hero; h.hp = h.maxHp; h.iframes = 0 })
  // Stand still among n normals for 10 s: HP trace and every hurt float.
  const standIn = async (where, n = 5) => {
    const setup = await p.evaluate((n) => {
      const r = window.__rp, s = window.__slice, hp = s.hero.object.position
      let foes = r.foes().filter((f) => !f.elite)
      if (r.world() === 'run' && foes.length < n) {
        const kind = foes[0]?.kind ?? 'slime'
        for (let i = foes.length; i < n; i++) s.run.horde.spawn(kind, hp.x + 1, hp.z + 1)
        foes = r.foes().filter((f) => !f.elite)
      }
      r.parkAll()
      const pick = foes.slice(0, n)
      pick.forEach((f, i) => { const a = (i / n) * Math.PI * 2; f.set(hp.x + Math.cos(a) * 1.3, hp.z + Math.sin(a) * 1.3) })
      const h = s.hero; h.hp = h.maxHp; h.iframes = 0
      window.__hurt = []
      const fl = document.getElementById('floats')
      window.__obs?.disconnect()
      window.__obs = new MutationObserver((ms) => { for (const m of ms) for (const nd of m.addedNodes) if (nd.textContent?.startsWith('-')) window.__hurt.push(Number(nd.textContent.slice(1))) })
      if (fl) window.__obs.observe(fl, { childList: true })
      return { n: pick.length, dmg: pick.map((f) => f.dmg), kind: pick[0]?.kind, maxHp: h.maxHp, guard: h.guard, regenDelay: h.regenDelay }
    }, n)
    const trace = []
    for (let t = 0; t <= 10; t += 1) {
      trace.push(await p.evaluate(() => Math.round(window.__slice.hero.hp)))
      // keep the pack on her (they get knocked back), no input from her
      await p.evaluate(() => { const r = window.__rp, hp = window.__slice.hero.object.position; r.foes().filter((f) => !f.elite).slice(0, 6).forEach((f, i) => { if (Math.hypot(f.f.x ?? f.f.object.position.x - hp.x, 0) > 1e9) return }) })
      if (t < 10) await waitGame(1)
    }
    const hurt = await p.evaluate(() => window.__hurt)
    const lost = trace[0] - Math.min(...trace)
    log({ where, test: 'stand10s', ...setup, trace, hits: hurt.length, hurt: hurt.slice(0, 12), lostPct: +((100 * (trace[0] - trace[trace.length - 1])) / setup.maxHp).toFixed(1), worstPct: +((100 * lost) / setup.maxHp).toFixed(1) })
    await p.screenshot({ path: `${OUT}/${TAG}-${where}-stand.png` })
  }
  // One target set at distance d ahead; returns handles' hp before.
  const place = (what, d) => p.evaluate(({ what, d }) => {
    const r = window.__rp, s = window.__slice
    r.parkAll()
    const at = r.fwd(d)
    let foes = r.foes()
    const want = what === 'pack' ? 5 : 1
    let pick = foes.filter((f) => (what === 'elite' ? f.elite : !f.elite)).slice(0, want)
    // In a run every test gets fresh, full-HP targets (a reused foe may be hurt, or run home and heal).
    if (r.world() === 'run') pick = []
    if (r.world() === 'run' && pick.length < want) {
      const kind = foes.find((f) => !f.elite)?.kind ?? 'slime'
      for (let i = pick.length; i < want; i++) { const f = s.run.horde.spawn(kind, at.x, at.z, what === 'elite'); if (f) f.age = 5 }
      foes = r.foes(); pick = foes.filter((f) => (what === 'elite' ? f.elite : !f.elite) && Math.hypot(f.f.x - at.x, f.f.z - at.z) < 0.5 && f.hp >= f.maxHp).slice(0, want)
    }
    pick.forEach((f, i) => { const a = (i / want) * Math.PI * 2; const rr = want > 1 ? 0.9 : 0; f.set(at.x + Math.cos(a) * rr, at.z + Math.sin(a) * rr) })
    window.__tgt = pick
    window.__dmgs = []
    window.__dobs?.disconnect()
    // DOM damage numbers (what the player reads): every new .dmg element's text and kind class.
    // (hudfx pools its .dmg elements: watch their text being replaced, read the class a tick later.)
    window.__dobs = new MutationObserver((ms) => { for (const m of ms) { const el = m.target; if (m.type !== 'childList' || el.nodeType !== 1 || !el.classList.contains('dmg') || el.classList.contains('tally')) continue; queueMicrotask(() => window.__dmgs.push((el.className.replace('dmg', '').trim() || 'hit') + ':' + el.textContent.trim())) } })
    window.__dobs.observe(document.getElementById('hud') || document.body, { childList: true, subtree: true })
    const s0 = s.hero; s0.hp = s0.maxHp
    return pick.map((f) => ({ hp: Math.round(f.hp), max: f.maxHp }))
  }, { what, d })
  const readTargets = () => p.evaluate(() => (window.__tgt || []).map((f) => ({ hp: Math.max(0, Math.round(f.f.hp)), max: f.maxHp, dead: f.f.hp <= 0 || f.f.dying > 0 || f.f.alive === false })))
  const placeBoss = (d) => p.evaluate((d) => {
    const s = window.__slice, r = window.__rp, b = s.run?.boss
    if (!b) return null
    r.parkAll()
    const at = r.fwd(d); b.awake = true; b.x = at.x; b.z = at.z
    window.__tgt = [{ f: b, maxHp: b.maxHp }]
    s.hero.hp = s.hero.maxHp
    return [{ hp: Math.round(b.hp), max: b.maxHp, awake: b.awake }]
  }, d)
  const frac = (before, after) => before.map((t, i) => +(((t.hp - (after[i]?.hp ?? 0)) / t.max) * 100).toFixed(1))
  const shoot = async () => { const bx = await box(); await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.mouse.down(); await p.waitForTimeout(60); await p.mouse.up(); await p.waitForTimeout(500) }
  const KEYS = { bomb: 'Digit1', overdrive: 'Digit2', rush: 'Digit3', aura: 'Digit4' }
  const damageTests = async (where, tones) => {
    const learned = await p.evaluate(() => { const s = window.__slice, b = s.game.save.build; const before = { ...(b?.ranks || {}) }; return before })
    // Skills: rank 1 each (what a player has once learned), cooldowns cleared between casts.
    await p.evaluate(() => { const s = window.__slice; s.game.save.build ??= { points: 0, ranks: {} }; for (const id of ['bubble_bomb', 'overdrive', 'mochi_rush', 'candy_aura']) s.game.save.build.ranks[id] = Math.max(1, s.game.save.build.ranks[id] || 0) })
    const open = await p.evaluate(() => window.__rp.face()); await p.waitForTimeout(700)
    const aimLen = await p.evaluate(() => { const s = window.__slice, p = s.hero.object.position; const dx = s.rig.aim.x - p.x, dz = s.rig.aim.z - p.z, l = Math.hypot(dx, dz) || 1; return { aim: +l.toFixed(1), open: s.run?.skillWorld ? +s.run.skillWorld.solid(p.x, 0.8, p.z, dx / l, 0, dz / l, 30).toFixed(1) : 30 } })
    const out = { where, test: 'damage', learnedBefore: learned, open: +open.toFixed(1), aimLen }
    for (const tone of tones) {
      const t = {}
      const pl = tone === 'boss' ? () => placeBoss(6) : (d) => place(tone, d)
      // one bullet
      let before = tone === 'boss' ? await placeBoss(5) : await place(tone, 5)
      if (!before || !before.length) { out[tone] = 'no target'; continue }
      await p.waitForTimeout(200)
      before = await readTargets()
      await p.evaluate(() => { window.__dmgs = [] })
      await shoot()
      t.bullet = frac(before, await readTargets())[0]
      t.bulletNums = await p.evaluate(() => window.__dmgs.slice(0, 6))
      t.maxHp = before[0].max
      for (const [k, key] of Object.entries(KEYS)) {
        await heal()
        await p.evaluate(() => { const s = window.__slice.skills; for (const id of Object.keys(s.cooldown)) s.cooldown[id] = 0; s.aura = 0 })
        const d = k === 'bomb' ? 0 : k === 'rush' ? 4 : 2.2
        before = tone === 'boss' ? await pl(d) : await pl(d)
        await p.waitForTimeout(150)
        before = await readTargets()
        await p.evaluate(() => { window.__dmgs = [] })
        const used0 = await p.evaluate(() => ({ ...window.__slice.skills.used }))
        await p.keyboard.press(key)
        // keep the aura's targets inside its ring while it burns
        await waitGame(k === 'aura' ? 6.5 : 1.2)
        const used1 = await p.evaluate(() => ({ ...window.__slice.skills.used }))
        const after = await readTargets()
        const fr = frac(before, after)
        t[k] = tone === 'pack' ? { killed: after.filter((x) => x.dead).length + '/' + after.length, pct: fr } : fr[0]
        t[k + 'Nums'] = await p.evaluate(() => window.__dmgs.slice(0, 6))
        if (Object.values(used1).reduce((a, x) => a + x, 0) === Object.values(used0).reduce((a, x) => a + x, 0)) t[k] = 'NOT CAST'
      }
      out[tone] = t
      await p.screenshot({ path: `${OUT}/${TAG}-${where}-${tone}.png` })
    }
    log(out)
  }
  const go = {
    guide: async () => { await fresh(); await p.waitForTimeout(1500) },
    maze1: async () => { await fresh(); await p.evaluate(() => { const c = window.__slice.chapters; c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; c.card = 0; window.__slice.enterArea('maze') }); await p.waitForFunction(() => window.__slice.run?.plan.area === 'maze', null, { timeout: 90000 }); await settle() },
    maze3: async () => { await go.maze1(); await p.evaluate(async () => { const s = window.__slice; for (let i = 0; i < 2; i++) { s.nextFloor(); await new Promise((r) => setTimeout(r, 4500)) } }); await settle() },
    d1: async () => { await fresh(); await p.evaluate(() => window.__slice.enterSewer(1, 1)); await p.waitForFunction(() => window.__slice.run?.horde && !window.__slice.run.plan.area, null, { timeout: 90000 }); await settle() },
    d2: async () => { await fresh(); await p.evaluate(() => { window.__slice.game.save.delve = { ...(window.__slice.game.save.delve || {}), unlocked: 3, best: 3 } ; window.__slice.enterSewer(2, 2) }); await p.waitForFunction(() => window.__slice.run?.horde, null, { timeout: 90000 }); await settle() },
    d3: async () => { await fresh(); await p.evaluate(() => { window.__slice.game.save.delve = { ...(window.__slice.game.save.delve || {}), unlocked: 3, best: 3 }; window.__slice.enterSewer(3, 2) }); await p.waitForFunction(() => window.__slice.run?.horde, null, { timeout: 90000 }); await settle() },
    boss1: async () => { await fresh(); await p.evaluate(() => window.__slice.enterSewer(1, 4)); await p.waitForFunction(() => window.__slice.run?.boss, null, { timeout: 90000 }); await settle(); await p.evaluate(async () => { const s = window.__slice, m = s.run.maze, T = 3.4; let sx = 0, sy = 0, n = 0; for (let i = 0; i < m.tiles.length; i++) { if (m.tiles[i] !== 4) continue; sx += i % m.w; sy += Math.floor(i / m.w); n++ } const tx = Math.round(sx / n), ty = Math.round(sy / n) + 1; s.hero.object.position.set((tx - m.w / 2 + 0.5) * T, 0, (ty - m.h / 2 + 0.5) * T); await new Promise((ok) => setTimeout(ok, 1500)) }) },
    field: async () => { await fresh(); await p.evaluate(() => { const c = window.__slice.chapters; c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; window.__slice.dream.maze.passed = true; window.__slice.dream.maze.entered = true; window.__slice.enterField() }); await p.waitForFunction(() => window.__slice.run?.horde, null, { timeout: 90000 }); await settle() },
    loft: async () => { await fresh(); await p.evaluate(() => { const c = window.__slice.chapters; c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; const d = window.__slice.dream; d.maze.passed = true; d.maze.entered = true; d.story.step = 1; d.story.state = 'active'; window.__slice.enterArea('loft') }); await p.waitForFunction(() => window.__slice.run?.plan.area === 'loft', null, { timeout: 90000 }); await settle() },
  }
  for (const sc of SCENES) {
    try {
      await go[sc]()
      const info = await p.evaluate(() => { const s = window.__slice, r = s.run; return { mode: s.mode, plan: r ? { d: r.plan.depth, f: r.plan.floor, area: r.plan.area, obj: r.plan.objective, scale: r.plan.scale } : null, foes: window.__rp.foes().length } })
      log({ where: sc, test: 'info', ...info })
      await standIn(sc)
      await damageTests(sc, sc === 'boss1' ? ['boss'] : ['pack', 'elite'])
    } catch (e) { log({ where: sc, error: String(e).slice(0, 300) }) }
  }
  log({ where: 'all', errors: errs.slice(0, 5) })
  fs.writeFileSync(`${OUT}/${TAG}-realplay.json`, JSON.stringify(rows, null, 1))
  await b.close()
})()
