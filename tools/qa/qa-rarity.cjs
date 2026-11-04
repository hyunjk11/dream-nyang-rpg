// 희귀도 색 QA: one item of each rarity + a 유니크 in the bag (I key) and as beams on the sewer floor.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir [VPS=1280x720,360x640] node tools/qa/qa-rarity.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-rarity'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720,360x640').split(',').map((v) => v.split('x').map(Number))
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const out = {}
  for (const [vw, vh] of VPS) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh } })
    const p = await ctx.newPage()
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    await p.evaluate(() => { window.__slice.enterSewer(1, 1, 7) })
    await p.waitForFunction(() => window.__slice.run && !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
    await p.waitForTimeout(1200)
    const tag = `${vw}x${vh}`
    // Ground beams: clear foes, spill one of each 4–6 m ahead of the camera.
    await p.evaluate(() => {
      const s = window.__slice, H = s.run.horde, P = s.hero.object.position
      for (const f of H.foes) { f.x = 999; f.z = 999; f.hp = 0 }
      const v = new P.constructor(); s.stage.camera.getWorldDirection(v); const l = Math.hypot(v.x, v.z) || 1
      const rng = Math.random
      const items = ['common', 'uncommon', 'rare', 'epic', 'legendary'].map((r) => s.makeItem('gun_water', r, rng, 10))
      items.push(s.makeLegend('leg_dunbar', 10))
      items.forEach((it, i) => { const side = (i - 2.5) * 1.1; s.run.loot.spill([{ kind: 'item', item: it }], P.x + (v.x / l) * 5 + (v.z / l) * side, P.z + (v.z / l) * 5 - (v.x / l) * side, 0.01) })
    })
    await p.waitForTimeout(1500)
    await p.screenshot({ path: `${OUT}/beams-${tag}.png` })
    // Bag: one of each rarity + the 유니크.
    await p.evaluate(() => {
      const s = window.__slice, sv = s.game.save, rng = Math.random
      for (const r of ['common', 'uncommon', 'rare', 'epic', 'legendary']) sv.items.push(s.makeItem('gun_dart', r, rng, 10))
      sv.items.push(s.makeLegend('leg_dunbar', 10))
    })
    await p.keyboard.press('i'); await p.waitForTimeout(900)
    await p.screenshot({ path: `${OUT}/bag-${tag}.png` })
    const cells = await p.evaluate(() => [...document.querySelectorAll('.inv-cell.item')].map((c) => ({ r: c.dataset.rarity, u: !!c.dataset.unique, rar: c.style.getPropertyValue('--rar'), title: (c.title || '').split('\n').slice(0, 2).join(' / ') })).filter((c) => c.r !== 'common' || c.title))
    const uniq = await p.$('.inv-cell.item[data-unique]')
    if (uniq) { await uniq.hover(); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/bag-unique-tip-${tag}.png` }) }
    out[tag] = { cells: cells.slice(-8), errors: errs.slice(0, 3) }
    await ctx.close()
  }
  fs.writeFileSync(`${OUT}/rarity.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out))
  await b.close()
})()
