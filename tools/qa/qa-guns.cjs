// 총 개성 + 스킬 한 방 QA (fix/gun-identity): each gun fires at a lined-up pack (screenshot, shots/s,
// damage numbers, the sniper's 탕! word and huge number), then a rank-1 bubble bomb on a mixed pack
// with an elite: every normal drops, the elite loses 30–40%.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5192/dream-nyang-rpg/ OUT=dir [VPS=1280x720] node tools/qa/qa-guns.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-guns-out'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720').split(',').map((v) => v.split('x').map(Number))
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const fails = []
  for (const [vw, vh] of VPS) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 700 })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
    const check = (name, ok, info) => { console.log(JSON.stringify({ vp: `${vw}x${vh}`, check: name, ok, info })); if (!ok) fails.push(`${vw}x${vh} ${name}`) }
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    await p.evaluate(() => { const s = window.__slice, sv = s.game.save; sv.level = 8; sv.build = { points: 0, ranks: { bubble_bomb: 1, mochi_rush: 1, overdrive: 1, candy_aura: 1 } }; sv.delve = { unlocked: 1, cleared: 0, checkpoint: null, runs: 0, open: null, ...(sv.delve || {}) }; s.applyBuild(); s.enterSewer(1, 1, 7) })
    await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 })
    await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
    await p.waitForTimeout(1500)
    // Line a pack up 7 m in front of the crosshair, frozen in place.
    const line = (n, hpMul, elite) => p.evaluate(([n, hpMul, elite]) => {
      const s = window.__slice, H = s.run.horde, P = s.hero.object.position
      const d = new P.constructor(); s.stage.camera.getWorldDirection(d); const l = Math.hypot(d.x, d.z) || 1
      const live = H.foes.filter((f) => H.hittable(f))
      live.forEach((f, i) => { if (i >= n) { f.x = 999; f.z = 999; f.hp = 0 } })
      const pick = live.slice(0, n)
      pick.forEach((f, i) => { const side = (i - (n - 1) / 2) * 0.8; f.x = P.x + (d.x / l) * 7 + (d.z / l) * side; f.z = P.z + (d.z / l) * 7 - (d.x / l) * side; f.vx = 0; f.vz = 0; f.speed = 0; f.base ??= f.maxHp; f.hp = f.maxHp = Math.round(f.base * hpMul); if (elite && i === 0) f.elite = true })
      return pick.map((f) => f.id)
    }, [n, hpMul, elite])
    await p.mouse.click(vw / 2, vh / 2); await p.waitForTimeout(300)
    const results = {}
    for (const gun of ['gun_water', 'gun_bubble', 'gun_star', 'gun_dart']) {
      await p.evaluate((id) => { const s = window.__slice, sv = s.game.save, g = sv.items.find((i) => i.uid === sv.equipment.weapon); g.defId = id; g.mods = []; s.applyBuild() }, gun)
      const ids = await line(5, 40, false)
      const before = await p.evaluate(() => {
        // Collect every damage number / word that shows while the trigger is held.
        const seen = (window.__seen = [])
        window.__obs?.disconnect()
        window.__obs = new MutationObserver(() => { for (const e of document.querySelectorAll('.dmg')) if (e.style.display === 'block' && !e.classList.contains('tally')) { const k = e.className + '|' + e.textContent; if (!seen.some((x) => x.k === k)) seen.push({ k, c: e.className, t: e.textContent, fs: parseFloat(getComputedStyle(e).fontSize) }) } })
        window.__obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] })
        return { fired: window.__slice.shooter.fired, game: performance.now() }
      })
      await p.mouse.move(vw / 2, vh / 2); await p.mouse.down()
      await p.waitForTimeout(1700)
      await p.screenshot({ path: `${OUT}/${vw}x${vh}-${gun}.png` })
      await p.waitForTimeout(1300)
      await p.mouse.up()
      const mid = await p.evaluate(() => ({ nums: window.__seen.slice(0, 12) }))
      const after = await p.evaluate(() => ({ fired: window.__slice.shooter.fired, stat: document.querySelector('.inv-gun-stats')?.textContent || null }))
      results[gun] = { shots: after.fired - before.fired, nums: mid.nums.slice(0, 6), ids: ids.length }
    }
    console.log(JSON.stringify(results))
    check('water_fastest', results.gun_water.shots > results.gun_star.shots && results.gun_star.shots > results.gun_dart.shots, Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.shots])))
    check('dart_word_and_big_number', results.gun_dart.nums.some((n) => n.c.includes('word') && n.t === '탕!') && results.gun_dart.nums.some((n) => n.c.includes('snipe') && n.fs >= 40), results.gun_dart.nums)
    // Skill: rank-1 bubble bomb on 4 normals + 1 elite at real hp.
    await p.evaluate(() => { const s = window.__slice, sv = s.game.save, g = sv.items.find((i) => i.uid === sv.equipment.weapon); g.defId = 'gun_water'; s.applyBuild() })
    await line(5, 1, true)
    const pre = await p.evaluate(() => window.__slice.run.horde.foes.filter((f) => f.hp > 0 && f.x < 900).map((f) => ({ id: f.id, hp: f.hp, max: f.maxHp, elite: f.elite })))
    await p.keyboard.press('1')
    await p.waitForTimeout(450)
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-skill-bomb.png` })
    await p.waitForTimeout(400)
    const post = await p.evaluate((ids) => ids.map((id) => { const f = window.__slice.run.horde.foes.find((x) => x.id === id); return f ? { hp: Math.max(0, f.hp), dying: f.dying > 0 } : { hp: 0, dying: true } }), pre.map((f) => f.id))
    const normals = pre.map((f, i) => ({ ...f, after: post[i] })).filter((f) => !f.elite)
    const elite = pre.map((f, i) => ({ ...f, after: post[i] })).find((f) => f.elite)
    const bite = elite ? 1 - elite.after.hp / elite.max : 0
    check('bomb_wipes_normals', normals.length > 0 && normals.every((f) => f.after.hp <= 0), normals.map((f) => [f.hp, f.after.hp]))
    check('bomb_bites_elite', bite >= 0.25 && bite <= 0.45, { bite: Math.round(bite * 100) + '%', elite })
    await p.keyboard.press('i'); await p.waitForTimeout(500)
    const stat = await p.evaluate(() => document.querySelector('.inv-gun-stats')?.title || '')
    check('bag_stat_line', /초당 .*발 · 한 발/.test(stat), stat)
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-bag-gunline.png` })
    check('no_errors', errs.length === 0, errs.slice(0, 5))
    await ctx.close()
  }
  console.log(fails.length ? 'GUNS_FAIL ' + fails.join(', ') : 'GUNS_OK')
  await b.close()
})()
