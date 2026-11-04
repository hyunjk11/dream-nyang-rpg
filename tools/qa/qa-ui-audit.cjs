// UI audit capture on the BUILT game (dev build; window.__slice only to reach each screen).
// For every screen at each viewport: a screenshot + automatic checks (touch targets < 40 px, text cut off /
// overflowing its box, elements past the viewport edge, low-contrast text).
// Usage: PLAYWRIGHT=… BASE=… OUT=dir TAG=before|after node tools/qa/qa-ui-audit.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || '.'
const TAG = process.env.TAG || 'run'
const VPS = (process.env.VPS || '1280x720,360x640').split(',').map((v) => v.split('x').map(Number))
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const all = {}
  for (const [vw, vh] of VPS) {
    const touch = vw < 600
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch, isMobile: touch })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push(e.message))
    const V = `${vw}x${vh}`
    const rows = {}
    const shot = async (name) => {
      const r = await p.evaluate(() => {
        const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity < 0.05) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('.hidden') }
        const label = (e) => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + ` "${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 24)}"`
        const small = []
        for (const e of document.querySelectorAll('button, [role=button], a[href], input, select, .inv-cell, [data-tab], .qtab, summary')) {
          if (!vis(e)) continue
          const r = e.getBoundingClientRect()
          if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
          if (Math.min(r.width, r.height) < 40) small.push(`${label(e)} ${Math.round(r.width)}x${Math.round(r.height)}`)
        }
        const cut = []
        const off = []
        for (const e of document.querySelectorAll('#ui *, #hud *, body > div *')) {
          if (!vis(e) || !e.childNodes.length) continue
          const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
          if (!hasText) continue
          const s = getComputedStyle(e)
          const r = e.getBoundingClientRect()
          if (e.scrollWidth > e.clientWidth + 2 && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis' && s.overflowX !== 'auto' && s.overflowX !== 'scroll') cut.push(`${label(e)} ${e.scrollWidth}>${e.clientWidth}`)
          else if (s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 2) cut.push(`… ${label(e)}`)
          if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1) if (!e.closest('[style*="overflow"], .qlist, .inv-grid, .town-body, .scroll')) off.push(`${label(e)} [${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}]`)
        }
        // contrast: text colour vs nearest opaque background
        const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b] = m.slice(0, 3).map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return { l: 0.2126 * r + 0.7152 * g + 0.0722 * b, a: m[3] === undefined ? 1 : +m[3] } }
        const low = []
        for (const e of document.querySelectorAll('#ui *, #hud *, body > div *')) {
          if (!vis(e)) continue
          const hasText = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
          if (!hasText) continue
          const s = getComputedStyle(e)
          const fg = lum(s.color)
          let bg = null
          for (let a = e; a; a = a.parentElement) { const c = lum(getComputedStyle(a).backgroundColor); if (c && c.a > 0.6) { bg = c; break } }
          if (!fg || !bg) continue
          const ratio = (Math.max(fg.l, bg.l) + 0.05) / (Math.min(fg.l, bg.l) + 0.05)
          const size = parseFloat(s.fontSize)
          if (ratio < (size >= 18 ? 3 : 4.5) * 0.78) low.push(`${label(e)} ${ratio.toFixed(2)} ${size}px`)
        }
        return { small: [...new Set(small)], cut: [...new Set(cut)], off: [...new Set(off)].slice(0, 30), low: [...new Set(low)].slice(0, 30) }
      })
      rows[name] = r
      await p.screenshot({ path: `${OUT}/${TAG}-${V}-${name}.png` })
    }
    const wait = (ms) => p.waitForTimeout(ms)
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await shot('title')
    await p.click('#btn-new'); await wait(800); await p.keyboard.press('Escape'); await wait(1500)
    for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__slice.talk.close()); await wait(200) }
    // A ch2 player: guide done, maze passed, 몽실 open, a bag of mixed loot, gold, 2 contracts + 1 field quest.
    await p.evaluate(() => {
      const s = window.__slice, g = s.game.save, c = s.chapters
      c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; c.card = 0
      const d = s.dream; d.maze.passed = true; d.maze.entered = true
      g.gold = 2400; g.level = 12
      g.materials.dream_dust = 40; g.materials.star_shard = 6; g.materials.toy_part = 12
      let seed = 1; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const defs = ['gun_water', 'gun_dart', 'hat_pin', 'gun_star', 'gun_bubble', 'outfit_cape', 'shoes_boots', 'acc_ring']
      const rar = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'rare', 'uncommon', 'epic']
      for (let i = 0; i < 14; i++) { try { g.items.push(s.makeItem(defs[i % defs.length], rar[i % rar.length], rng, 8)) } catch (e) {} }
      s.townOf(g)
      s.game.persist?.()
    })
    await wait(800)
    await p.evaluate(() => window.__slice.toast('🔁 반복 의뢰 완료! 마을 게시판에서 보상을 받아.', 'quest'))
    await wait(300)
    await shot('hud-island')
    // bag + tooltip
    await p.evaluate(() => window.__slice.inventory.open('bag')); await wait(700)
    await shot('bag')
    const cell = await p.$('.inv-cell.item')
    if (cell) { const bb = await cell.boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await wait(600); await shot('tooltip'); if (touch) { await cell.tap?.().catch(() => {}); await wait(500); await shot('tooltip-tap') } }
    await p.keyboard.press('Escape'); await wait(400)
    await p.evaluate(() => window.__slice.inventory.close?.()); await wait(300)
    for (const panel of ['shop', 'workshop', 'board']) {
      await p.evaluate((panel) => window.__slice.openTown(panel), panel); await wait(800)
      if (panel === 'board') {
        const take = await p.$('#board-take-0'); if (take) { await take.click(); await wait(300) }
        const take2 = await p.$('#board-take-1'); if (take2) { await take2.click(); await wait(300) }
        await shot('board')
      } else await shot(panel)
      await p.evaluate(() => window.__slice.townUI.close()); await wait(300)
    }
    for (const tab of ['main', 'bounty', 'repeat']) {
      await p.evaluate((t) => window.__slice.questLog(t), tab); await wait(600)
      await shot(`questlog-${tab}`)
      await p.keyboard.press('Escape'); await wait(300)
    }
    await shot('hud-tracker')
    await p.evaluate(() => window.__slice.talk.start(window.__slice.gateTalk())); await wait(800)
    await shot('portal')
    for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__slice.talk.close()); await wait(150) }
    await p.click('#gear').catch(() => {}); await wait(600)
    await shot('settings')
    await p.keyboard.press('Escape'); await wait(300)
    if (await p.$('#settings:not(.hidden)')) { await p.click('#gear').catch(() => {}); await wait(300) }
    // a sewer run: HUD with minimap, then the summary, then the down screen
    await p.evaluate(() => window.__slice.enterSewer(1, 1)); await p.waitForFunction(() => window.__slice.run?.horde, null, { timeout: 90000 }); await wait(4000)
    await p.evaluate(() => window.__slice.toast('정예 처치! 상자가 열렸어.', 'quest'))
    await wait(300)
    await shot('hud-run')
    await p.evaluate(() => window.__slice.leaveSewer('recall')); await wait(3500)
    await shot('summary')
    const sc = await p.$('#summary-close'); if (sc) { await sc.click().catch(() => {}); await wait(2500) }
    await p.evaluate(() => window.__slice.enterSewer(1, 1)); await p.waitForFunction(() => window.__slice.run?.horde, null, { timeout: 90000 }); await wait(3000)
    // Down: the run's own hurt path (same as a foe's hit), with HP at 1.
    await p.evaluate(() => { const s = window.__slice, h = s.hero; h.hp = 1; h.iframes = 0; h.guard = 0; s.run.host.hurt(9999, h.object.position.clone()) })
    await p.waitForFunction(() => !document.getElementById('down')?.classList.contains('hidden'), null, { timeout: 30000 }).catch(() => {})
    await wait(1200)
    await shot('down')
    all[V] = { rows, errs }
    await ctx.close()
  }
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(all, null, 1))
  for (const [v, { rows, errs }] of Object.entries(all)) {
    console.log(`== ${v} errors ${errs.length}`)
    for (const [n, r] of Object.entries(rows)) console.log(`${n}: small ${r.small.length} cut ${r.cut.length} off ${r.off.length} low ${r.low.length}`)
  }
  await b.close()
})()
