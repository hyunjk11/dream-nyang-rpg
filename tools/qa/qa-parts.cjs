// 부품 장착 QA (real mouse): a part in the bag, the worn gun at +3. Counts clicks to fit it from the bag.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir TAG=after [VPS=…] node tools/qa/qa-parts.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-parts'
const TAG = process.env.TAG || 'run'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720,360x640').split(',').map((v) => v.split('x').map(Number))
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const out = {}
  for (const [vw, vh] of VPS) {
    const tag = `${TAG}-${vw}x${vh}`
    const ctx = await b.newContext({ viewport: { width: vw, height: vh } })
    const p = await ctx.newPage()
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    const uid = await p.evaluate(() => {
      const s = window.__slice, sv = s.game.save
      sv.gold = 5000
      const gun = sv.items.find((i) => i.uid === sv.equipment.weapon); gun.plus = 3; gun.itemLevel = 20; gun.rarity = 'epic'
      const m = s.makeMod('mod_barrel', 'rare', 10)
      sv.items.push(m); s.applyBuild(); return m.uid
    })
    const before = await p.evaluate(() => { const sv = window.__slice.game.save; return sv.items.find((i) => i.uid === sv.equipment.weapon).mods?.length ?? 0 })
    let clicks = 0
    await p.keyboard.press('i'); await p.waitForTimeout(700)
    const cell = await p.$(`.inv-cell.item[data-uid="${uid}"]`)
    if (cell) { await cell.click(); clicks++ ; await p.waitForTimeout(400) }
    await p.screenshot({ path: `${OUT}/${tag}-bag-part-picked.png` })
    const preview = await p.$eval('#inv-fit-preview', (e) => e.textContent).catch(() => null)
    const fitBtn = await p.$('#inv-fit')
    if (fitBtn) { await fitBtn.click(); clicks++; await p.waitForTimeout(500) }
    const after = await p.evaluate(() => { const sv = window.__slice.game.save; return sv.items.find((i) => i.uid === sv.equipment.weapon).mods?.length ?? 0 })
    await p.screenshot({ path: `${OUT}/${tag}-bag-gun-after-fit.png` })
    // Hover the worn gun for its tooltip (+N, next upgrade).
    const gunCell = await p.$('.inv-cell.item[data-uid]:has(.plus-badge)')
    let tip = null
    if (gunCell) { await gunCell.hover(); await p.waitForTimeout(500); tip = await gunCell.getAttribute('data-tip'); await p.screenshot({ path: `${OUT}/${tag}-gun-tooltip.png` }) }
    const name = await p.$eval('#inv h3.item-title', (e) => e.textContent).catch(() => null)
    out[tag] = { uid: !!uid, clicks, fitted: after > before, modsBefore: before, modsAfter: after, preview, name, tip: tip && tip.split('\n').slice(0, 5), errors: errs.slice(0, 3) }
    await ctx.close()
  }
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out))
  await b.close()
})()
