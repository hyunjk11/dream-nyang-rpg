// 판매 · 분해 QA (real mouse/keyboard): seed 10 commons, count clicks to sell 10 and salvage 10.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir TAG=before|after [VPS=1280x720,360x640] node tools/qa/qa-sellsalvage.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-sellsalvage'
const TAG = process.env.TAG || 'run'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720,360x640').split(',').map((v) => v.split('x').map(Number))
const seed = (p, n, rarity = 'common') => p.evaluate(([n, rarity]) => {
  const s = window.__slice, sv = s.game.save
  if (!sv.__best) {
    const best = s.makeItem('hat_beret', 'epic', Math.random, 40); sv.items.push(best)
    sv.equipment.hat = best.uid; sv.__best = 1
  }
  const ids = []
  for (let i = 0; i < n; i++) { const it = s.makeItem('hat_pin', rarity, Math.random, 1); sv.items.push(it); ids.push(it.uid) }
  s.applyBuild(); s.inventory.render(); return ids
}, [n, rarity])
const left = (p, ids) => p.evaluate((ids) => ids.filter((id) => window.__slice.game.save.items.some((i) => i.uid === id)).length, ids)
const state = (p) => p.evaluate(() => { const sv = window.__slice.game.save; return { gold: sv.gold, mats: JSON.stringify(sv.materials) } })
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const out = {}
  for (const [vw, vh] of VPS) {
    const tag = `${TAG}-${vw}x${vh}`
    const mobile = vw < 500
    const ctx = await b.newContext({ viewport: { width: vw, height: vh } })
    const p = await ctx.newPage()
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    const r = {}
    const after = await p.evaluate(() => !!document.querySelector('#inv') && typeof window.__slice.inventory.act === 'function')
    await p.keyboard.press('i'); await p.waitForTimeout(700)
    const cell = (id) => p.$(`#inv-grid .inv-cell.item[data-uid="${id}"]`)
    if (!after) {
      // Before: pick the item, press 판매 / 분해 in the detail card (2 clicks each; rare+ 3).
      for (const act of ['sell', 'dismantle']) {
        const ids = await seed(p, 10); await p.waitForTimeout(300)
        const s0 = await state(p); let clicks = 0
        for (const id of ids) {
          const c = await cell(id); if (!c) continue
          await c.click(); clicks++; await p.waitForTimeout(150)
          const btn = await p.$(`#inv-detail [data-act="${act}"]`)
          if (btn && !(await btn.isDisabled())) { await btn.click(); clicks++; await p.waitForTimeout(150) }
        }
        r[act] = { clicks, left: await left(p, ids), before: s0, after: await state(p) }
        await p.screenshot({ path: `${OUT}/${tag}-${act}.png` })
      }
      // Before: the old 잡동사니 판매 bulk (town only).
      const ids = await seed(p, 10); await p.waitForTimeout(300)
      const junk = await p.$('#inv-junk')
      if (junk && !(await junk.isDisabled())) { await junk.click(); await p.waitForTimeout(300) }
      r.junkBulk = { clicks: junk ? 1 : 0, left: await left(p, ids) }
    } else {
      // A. 판매 모드: 1 toggle + 1 click per item.
      let ids = await seed(p, 10); await p.waitForTimeout(300)
      let s0 = await state(p); let clicks = 0
      await p.click('#inv-mode-sell'); clicks++; await p.waitForTimeout(200)
      await p.screenshot({ path: `${OUT}/${tag}-sell-mode.png` })
      for (const id of ids) { const c = await cell(id); if (c) { await c.click(); clicks++; await p.waitForTimeout(120) } }
      await p.waitForTimeout(150); await p.screenshot({ path: `${OUT}/${tag}-sell-mode-popup.png` })
      r.sellMode = { clicks, left: await left(p, ids), before: s0, after: await state(p) }
      await p.click('#inv-mode-sell'); await p.waitForTimeout(200)
      // Undo ×2 with Z.
      const g1 = (await state(p)).gold
      await p.keyboard.press('z'); await p.waitForTimeout(200); await p.keyboard.press('z'); await p.waitForTimeout(300)
      r.undo = { goldBefore: g1, goldAfter: (await state(p)).gold, back: 10 - (await left(p, ids)) === 10 ? 0 : (await left(p, ids)) }
      await p.screenshot({ path: `${OUT}/${tag}-undo.png` })
      await p.evaluate((ids) => { const sv = window.__slice.game.save; sv.items = sv.items.filter((i) => !ids.includes(i.uid)); window.__slice.inventory.render() }, ids)
      if (!mobile) {
        // B. Shift+click sell, 1 click each, no mode.
        ids = await seed(p, 10); await p.waitForTimeout(300); s0 = await state(p); clicks = 0
        for (const id of ids) { const c = await cell(id); if (c) { await c.click({ modifiers: ['Shift'] }); clicks++; await p.waitForTimeout(120) } }
        r.shiftSell = { clicks, left: await left(p, ids), before: s0, after: await state(p) }
        // C. Ctrl+click salvage.
        ids = await seed(p, 10); await p.waitForTimeout(300); s0 = await state(p); clicks = 0
        for (const id of ids) { const c = await cell(id); if (c) { await c.click({ modifiers: ['Control'] }); clicks++; await p.waitForTimeout(120) } }
        r.ctrlSalvage = { clicks, left: await left(p, ids), before: s0, after: await state(p) }
        // D. Hover + X (0 clicks, 10 keys).
        ids = await seed(p, 10); await p.waitForTimeout(300); let keys = 0
        for (const id of ids) { const c = await cell(id); if (c) { await c.hover(); await p.waitForTimeout(60); await p.keyboard.press('x'); keys++; await p.waitForTimeout(120) } }
        r.hoverX = { clicks: 0, keys, left: await left(p, ids) }
        // Tooltip text on hover.
        ids = await seed(p, 1); const c = await cell(ids[0]); await c.hover(); await p.waitForTimeout(500)
        r.tip = (await c.getAttribute('data-tip')).split('\n').slice(-3)
        await p.screenshot({ path: `${OUT}/${tag}-tooltip.png` })
        await p.evaluate((ids) => { const sv = window.__slice.game.save; sv.items = sv.items.filter((i) => !ids.includes(i.uid)); window.__slice.inventory.render() }, ids)
      }
      // E. 분해 모드.
      ids = await seed(p, 10); await p.waitForTimeout(300); s0 = await state(p); clicks = 0
      await p.click('#inv-mode-salvage'); clicks++; await p.waitForTimeout(200)
      for (const id of ids) { const c = await cell(id); if (c) { await c.click(); clicks++; await p.waitForTimeout(120) } }
      await p.waitForTimeout(150); await p.screenshot({ path: `${OUT}/${tag}-salvage-mode-popup.png` })
      r.salvageMode = { clicks, left: await left(p, ids), before: s0, after: await state(p) }
      await p.click('#inv-mode-salvage'); await p.waitForTimeout(200)
      // F. Bulk: 보통 전부 분해 (1 click) and 매직 이하 전부 판매 (1 click); locked + rare + unique stay.
      ids = await seed(p, 10)
      const keep = await p.evaluate(() => {
        const s = window.__slice, sv = s.game.save
        const lock = s.makeItem('hat_pin', 'common', Math.random, 1); lock.locked = true
        const rare = s.makeItem('hat_pin', 'rare', Math.random, 1)
        sv.items.push(lock, rare); s.inventory.render(); return [lock.uid, rare.uid]
      })
      await p.waitForTimeout(300)
      const bulkLabel = await p.$eval('#inv-bulk-salvage', (e) => e.textContent)
      await p.screenshot({ path: `${OUT}/${tag}-bulk.png` })
      await p.click('#inv-bulk-salvage'); await p.waitForTimeout(300)
      r.bulkSalvage = { clicks: 1, label: bulkLabel, left: await left(p, ids), kept: await left(p, keep) }
      ids = await seed(p, 6); const mg = await seed(p, 4, 'uncommon'); await p.waitForTimeout(300)
      const sellLabel = await p.$eval('#inv-bulk-sell', (e) => e.textContent)
      await p.click('#inv-bulk-sell'); await p.waitForTimeout(300)
      r.bulkSell = { clicks: 1, label: sellLabel, left: await left(p, [...ids, ...mg]), kept: await left(p, keep) }
      // G. Rare: one press arms, second sells.
      await p.click('#inv-mode-sell'); await p.waitForTimeout(200)
      const rc = await cell(keep[1]); await rc.click(); await p.waitForTimeout(250)
      const armedLeft = await left(p, [keep[1]])
      await p.screenshot({ path: `${OUT}/${tag}-rare-armed.png` })
      await (await cell(keep[1])).click(); await p.waitForTimeout(250)
      r.rare = { afterFirst: armedLeft, afterSecond: await left(p, [keep[1]]) }
      // Locked click in mode is refused.
      await (await cell(keep[0])).click(); await p.waitForTimeout(250)
      r.locked = { left: await left(p, [keep[0]]) }
      await p.click('#inv-mode-sell'); await p.waitForTimeout(200)
      // H. Long-press menu (mobile and desktop alike).
      ids = await seed(p, 1); await p.waitForTimeout(300)
      const lc = await cell(ids[0]); const bb = await lc.boundingBox()
      await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down(); await p.waitForTimeout(650); await p.mouse.up(); await p.waitForTimeout(250)
      const menu = await p.$('#fast-menu')
      const sizes = menu ? await p.$$eval('#fast-menu button', (bs) => bs.map((b) => Math.round(b.getBoundingClientRect().height))) : null
      await p.screenshot({ path: `${OUT}/${tag}-longpress-menu.png` })
      if (menu) { await p.click('#fast-menu [data-act="salvage"]'); await p.waitForTimeout(300) }
      r.longPress = { menu: !!menu, buttonHeights: sizes, left: await left(p, ids), clicks: 1 }
      // I. Vendor opens straight into 판매 모드.
      await p.keyboard.press('Escape'); await p.waitForTimeout(400)
      await p.evaluate(() => window.__slice.openTown('shop')); await p.waitForTimeout(500)
      const sb = await p.$('#shop-fastsell')
      if (sb) { await sb.click(); await p.waitForTimeout(500) }
      r.vendor = { button: !!sb, bagOpen: await p.evaluate(() => window.__slice.inventory.isOpen && window.__slice.inventory.mode) }
      await p.screenshot({ path: `${OUT}/${tag}-vendor-to-sellmode.png` })
    }
    r.errors = errs.slice(0, 3)
    out[tag] = r
    await ctx.close()
  }
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  await b.close()
})()
