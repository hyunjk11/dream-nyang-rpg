// 특수 부품 QA (fix/mod-parts): starter 도탄 part, fitting two tricks → 조합, the trick limit, a
// stashed gun in the workshop list, the charms on the gun model and the combo VFX in the field.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5184/dream-nyang-rpg/ OUT=dir [VPS=1280x720,390x844] node tools/qa/qa-parts.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-parts-out'
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
    const starter = await p.evaluate(() => { const s = window.__slice, g = s.game.save.items.find((i) => i.uid === s.game.save.equipment.weapon); return { mods: (g.mods || []).map((m) => m.defId), star: s.stats.starShot, cloud: s.stats.cloud } })
    check('starter_star_part', starter.mods.includes('mod_trick_star') && starter.star > 0 && starter.cloud === 0, starter)
    const ids = await p.evaluate(() => {
      const s = window.__slice, sv = s.game.save
      sv.gold = 5000; sv.materials = { ...sv.materials, toy_part: 20, star_shard: 10, dream_dust: 20 }
      const gun = s.makeItem('gun_water', 'legendary', Math.random, 12); gun.affixes = []
      sv.items.push(gun); sv.equipment.weapon = gun.uid
      const parts = {}
      for (const [id, r] of [['mod_trick_star', 'rare'], ['mod_trick_cloud', 'epic'], ['mod_trick_pierce', 'uncommon'], ['mod_chip_ice', 'rare']]) { const m = s.makeMod(id, r, 12); sv.items.push(m); parts[id] = m.uid }
      const spare = s.makeItem('gun_dart', 'epic', Math.random, 9); s.townOf(sv).stash.push(spare)
      s.applyBuild()
      s.townUI.open('workshop')
      return { gun: gun.uid, parts, spare: spare.uid }
    })
    await p.waitForTimeout(500)
    await p.click(`.inv-cell[data-from="work"][data-uid="${ids.gun}"]`); await p.waitForTimeout(400)
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-parts-before.png` })
    const fit = async (defId) => { const sel = `.mod-part[data-uid="${ids.parts[defId]}"]`; await p.locator(sel).scrollIntoViewIfNeeded(); await p.click(sel); await p.waitForTimeout(400) }
    await fit('mod_trick_star')
    const gain = await p.evaluate((uid) => document.querySelector(`.mod-part[data-uid="${uid}"] .mod-gain`)?.textContent || '', ids.parts.mod_trick_cloud)
    check('combo_preview', gain.includes('통통 솜사탕'), gain)
    await fit('mod_trick_cloud')
    const st = await p.evaluate(() => { const s = window.__slice; return { combos: [...s.shooter.juice.combos], star: s.stats.starShot, cloud: s.stats.cloud, charms: s.hero.gun ? (() => { let n = 0; s.hero.gun.traverse((o) => { if (o.name === 'mod-trick') n++ }); return n })() : -1, on: document.querySelectorAll('#work-combos .mod-combo.on').length } })
    check('fluffstar_on', st.combos.includes('fluffstar') && st.on === 1 && st.star > 0 && st.cloud > 0, st)
    check('trick_charms', st.charms === 2, st.charms)
    const blocked = await p.evaluate((uid) => { const el = document.querySelector(`.mod-part[data-uid="${uid}"]`); return { dis: el?.disabled, text: el?.textContent } }, ids.parts.mod_trick_pierce)
    check('trick_limit', blocked.dis === true && /2개까지/.test(blocked.text || ''), blocked)
    await fit('mod_chip_ice')
    const frost = await p.evaluate(() => [...window.__slice.shooter.juice.combos])
    check('frostcloud_on', frost.includes('frostcloud') && frost.includes('fluffstar'), frost)
    await p.locator('#work-combos').scrollIntoViewIfNeeded()
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-parts-combos.png` })
    const inList = await p.evaluate((uid) => !!document.querySelector(`.inv-cell[data-from="work"][data-uid="${uid}"]`), ids.spare)
    check('stash_gun_listed', inList, ids.spare)
    await p.click(`.inv-cell[data-from="work"][data-uid="${ids.spare}"]`); await p.waitForTimeout(400)
    const stashUp = await p.evaluate(() => !!document.querySelector('#work-upgrade') && !!document.querySelector('#work-mods'))
    check('stash_gun_workable', stashUp, stashUp)
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-stash-gun.png` })
    const box = await p.evaluate(() => { const r = document.querySelector('#town .town-card').getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight } })
    check('panel_on_screen', box.x >= -1 && box.y >= -1 && box.r <= box.w + 1 && box.b <= box.h + 1, box)
    // In the field: frost clouds and stars that puff mini clouds.
    await p.evaluate(() => { window.__slice.townUI.close(); window.__slice.enterSewer(1, 1, 3) })
    await p.waitForTimeout(2500)
    const vfx = await p.evaluate(async () => {
      const s = window.__slice, h = s.hero.object.position, j = s.shooter.juice
      const V = h.constructor
      const d = new V(); s.stage.camera.getWorldDirection(d); d.y = 0; d.normalize()
      const fx = d.x, fz = d.z
      for (let i = 0; i < 3; i++) j.cloud(new V(h.x + fx * (4 + i * 1.5) + (i - 1) * 1.4, 1, h.z + fz * (4 + i * 1.5)), 30)
      for (let i = 0; i < 4; i++) j.star(new V(h.x + fx, 1.2, h.z + fz), new V(fx + (i - 1.5) * 0.25, 0.05, fz), 20)
      await new Promise((r) => setTimeout(r, 350))
      return j.live
    })
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-field-frost-stars.png` })
    check('field_vfx', vfx.clouds >= 3, vfx)
    check('no_errors', errs.length === 0, errs.slice(0, 5))
    await ctx.close()
  }
  await b.close()
  console.log(fails.length ? `PARTS_FAIL ${fails.join(' | ')}` : 'PARTS_OK')
})()
