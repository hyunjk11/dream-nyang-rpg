// 총 개조 QA: the gunsmith panel (tap fit, drag onto a slot, Alt+click pull, part upgrade), stats and the gun model.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5184/dream-nyang-rpg/ OUT=dir [VPS=1280x720,390x844] node tools/qa/qa-mods.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-mods-out'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720,390x844').split(',').map((v) => v.split('x').map(Number))
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
    const base = await p.evaluate(() => {
      const s = window.__slice, sv = s.game.save
      sv.gold = 5000; sv.materials = { ...sv.materials, toy_part: 20, star_shard: 10, dream_dust: 20 }
      const gun = s.makeItem('gun_water', 'legendary', Math.random, 6); gun.affixes = []
      sv.items.push(gun); sv.equipment.weapon = gun.uid
      for (const [id, r] of [['mod_scope', 'rare'], ['mod_barrel', 'epic'], ['mod_chip_candy', 'uncommon'], ['mod_mag', 'common']]) sv.items.push(s.makeMod(id, r, 6))
      s.applyBuild()
      s.townUI.open('workshop')
      return { dmg: s.stats.damageMul, gun: gun.uid }
    })
    await p.waitForTimeout(600)
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-workshop.png` })
    const mods = () => p.evaluate(() => { const s = window.__slice, g = s.game.save.items.find((i) => i.uid === s.game.save.equipment.weapon); return (g.mods || []).map((m) => `${m.defId}:${m.rarity}`) })
    // Tap: fit the first part (the scope).
    await p.click('#work-mod-part-0')
    await p.waitForTimeout(400)
    let m = await mods(); check('tap_fit', m.length === 1, m)
    // Drag: the barrel onto slot 1.
    const src = p.locator('#work-mod-part-0'), dst = p.locator('.mod-slot[data-slot="1"]')
    await src.scrollIntoViewIfNeeded()
    await src.dragTo(dst)
    await p.waitForTimeout(400)
    m = await mods(); check('drag_fit', m.length === 2 && m.some((x) => x.startsWith('mod_barrel')), m)
    // Tap the chip too, then look at the gun.
    await p.click('#work-mod-part-0'); await p.waitForTimeout(400)
    m = await mods()
    const after = await p.evaluate(() => ({ dmg: window.__slice.stats.damageMul, candy: window.__slice.stats.candy, crit: window.__slice.stats.critChance, parts: ['mod-scope', 'mod-mag', 'mod-chip'].filter((n) => window.__slice.hero.gun?.getObjectByName(n)) }))
    check('stats_and_model', m.length === 3 && after.dmg > base.dmg && after.candy > 0 && after.parts.includes('mod-scope') && after.parts.includes('mod-chip'), { m, after, base: base.dmg })
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-workshop-fitted.png` })
    // Upgrade the first fitted part with salvage.
    const r0 = (await mods())[0]
    await p.locator('#work-mod-up-0').scrollIntoViewIfNeeded(); await p.click('#work-mod-up-0'); await p.waitForTimeout(400)
    const r1 = (await mods())[0]
    check('part_upgrade', r0 !== r1 && r1.split(':')[0] === r0.split(':')[0], { r0, r1 })
    // Alt+click pulls a part back to the bag.
    await p.locator('.mod-slot[data-slot="0"]').scrollIntoViewIfNeeded()
    await p.click('.mod-slot[data-slot="0"]', { modifiers: ['Alt'], position: { x: 6, y: 6 } }); await p.waitForTimeout(400)
    m = await mods(); check('alt_pull', m.length === 2, m)
    // Panel fits the screen.
    const box = await p.evaluate(() => { const r = document.querySelector('#town .town-card').getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight } })
    check('panel_on_screen', box.x >= -1 && box.y >= -1 && box.r <= box.w + 1 && box.b <= box.h + 1, box)
    // Close and look at the gun up close.
    await p.evaluate(() => { window.__slice.townUI.close(); Object.assign(window.__slice.view, { on: true, yaw: 80, pitch: 5, dist: 0.9, height: 1.1 }) })
    await p.waitForTimeout(1200)
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-gun-closeup.png` })
    await p.evaluate(() => { window.__slice.view.on = false })
    check('no_errors', errs.length === 0, errs.slice(0, 5))
    await ctx.close()
  }
  await b.close()
  console.log(fails.length ? `MODS_FAIL ${fails.join(' | ')}` : 'MODS_OK')
})()
