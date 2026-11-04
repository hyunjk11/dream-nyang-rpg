const { chromium } = require(process.env.PLAYWRIGHT)
const fs = require('fs')
const SAVE = fs.readFileSync('/tmp/save-parts.json', 'utf8'); const sv = JSON.parse(SAVE)
const uid = sv.items[sv.items.length - 1].uid
const OUT = '/workspace/polish/qa/parts'
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const out = {}
  for (const [vw, vh] of [[1280, 720], [360, 640]]) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh } }); const p = await ctx.newPage()
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
    await p.goto(process.env.BASE); await p.evaluate((s) => { localStorage.clear(); localStorage.setItem('dream-nyang-rpg-3d-save-v1', s) }, SAVE); await p.goto(process.env.BASE)
    await p.waitForFunction(() => { const b = document.getElementById('btn-continue'); return b && !b.disabled }, null, { timeout: 120000 })
    await p.click('#btn-continue'); await p.waitForTimeout(1500)
    for (let i = 0; i < 25; i++) { const open = await p.evaluate(() => { const d = document.getElementById('dialog'); return !!d && !d.classList.contains('hidden') && getComputedStyle(d).display !== 'none' }); if (!open && i > 3) break; await p.keyboard.press('Enter'); await p.waitForTimeout(500) }
    await p.keyboard.press('Escape'); await p.waitForTimeout(400)
    let clicks = 0
    await p.keyboard.press('i'); await p.waitForTimeout(800)
    const badge = await p.$$eval('.plus-badge', (e) => e.map((x) => x.textContent)).catch(() => [])
    const cell = await p.$(`.inv-cell.item[data-uid="${uid}"]`)
    if (cell) { await cell.click(); clicks++; await p.waitForTimeout(400) }
    const preview = await p.$eval('#inv-fit-preview', (e) => e.textContent).catch(() => null)
    const fit = await p.$('#inv-fit'); if (fit) { await fit.click(); clicks++; await p.waitForTimeout(600) }
    await p.waitForTimeout(1500)
    const saved = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('dream-nyang-rpg-3d-save-v1')); const w = s.items.find((i) => i.uid === s.equipment.weapon); return w.mods?.length ?? 0 })
    await p.screenshot({ path: `${OUT}/prod-${vw}x${vh}-after-fit.png` })
    out[`${vw}x${vh}`] = { found: !!cell, clicks, preview, badge, modsSaved: saved, errors: errs }
    await ctx.close()
  }
  console.log(JSON.stringify(out)); await b.close()
})()
