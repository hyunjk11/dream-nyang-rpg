// UI 다듬기 QA (fix/ui-polish): the control hint as key chips (island / sewer / 몽실 — no "T 귀환" there),
// the bag's gun card + stat chips, the bag's 도감 button (opens the codex, pauses a run), settings toggles.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5193/dream-nyang-rpg/ OUT=dir [VPS=1280x720,360x640] node tools/qa/qa-ui.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-ui-out'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720,360x640').split(',').map((v) => v.split('x').map(Number))
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const fails = []
  for (const [vw, vh] of VPS) {
    const tag = `${vw}x${vh}`
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 700 })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
    const check = (name, ok, info) => { console.log(JSON.stringify({ vp: tag, check: name, ok, info })); if (!ok) fails.push(`${tag} ${name}`) }
    const settle = async () => { await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 }); await p.waitForTimeout(1200) }
    const hint = () => p.evaluate(() => { const h = document.getElementById('hint'); const r = h.getBoundingClientRect(); return { text: h.textContent, chips: h.querySelectorAll('.hk').length, keys: h.querySelectorAll('kbd').length, h: Math.round(r.height), shown: getComputedStyle(h).display !== 'none' } })
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    const isl = await hint()
    if (vw >= 700) check('island_hint_chips', isl.chips >= 6 && isl.keys >= 6 && !/T\u00a0귀환|T 귀환/.test(isl.text) && isl.h <= 40, isl)
    // Bag: gun card + stat chips, 도감 button.
    await p.evaluate(() => window.__slice.inventory.open('bag')); await p.waitForTimeout(500)
    await p.screenshot({ path: `${OUT}/${tag}-bag.png` })
    const bag = await p.evaluate(() => ({ gun: document.querySelector('.inv-gun b')?.textContent, chips: document.querySelectorAll('.inv-gun-stats span').length, codexBtn: !!document.getElementById('inv-codex')?.offsetParent }))
    check('bag_gun_card', !!bag.gun && bag.chips >= 4 && bag.codexBtn, bag)
    await p.click('#inv-codex'); await p.waitForTimeout(600)
    const cx = await p.evaluate(() => ({ bag: window.__slice.inventory.isOpen, panel: window.__slice.townUI.panel ?? null, open: window.__slice.townUI.isOpen, cards: document.querySelectorAll('.codex-card').length }))
    await p.screenshot({ path: `${OUT}/${tag}-bag-codex.png` })
    check('bag_codex_island', !cx.bag && cx.open && cx.cards === 7, cx)
    await p.keyboard.press('Escape'); await p.waitForTimeout(400)
    // Settings toggles.
    await p.click('#gear'); await p.waitForTimeout(400)
    await p.screenshot({ path: `${OUT}/${tag}-settings.png` })
    const st = await p.evaluate(() => { const on = document.querySelector('#auto-candy'); return { onBg: getComputedStyle(on).backgroundColor, offBg: getComputedStyle(document.querySelector('#auto-sell')).backgroundColor } })
    check('settings_on_off_differ', st.onBg !== st.offBg, st)
    await p.click('#gear'); await p.waitForTimeout(300)
    // Sewer: hint keeps T 귀환, bag 도감 holds the frame.
    await p.evaluate(() => { const s = window.__slice; s.game.save.delve = { unlocked: 1, cleared: 0, checkpoint: null, runs: 0, open: null, ...(s.game.save.delve || {}) }; s.enterSewer(1, 1, 7) })
    await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 }); await settle()
    const sw = await hint()
    await p.screenshot({ path: `${OUT}/${tag}-sewer-hint.png` })
    if (vw >= 700) check('sewer_hint_recall', /T\u00a0?귀환|T귀환/.test(sw.text.replace(/\s/g, '')) && sw.h <= 40, sw)
    await p.evaluate(() => window.__slice.inventory.open('bag')); await p.waitForTimeout(400)
    await p.click('#inv-codex'); await p.waitForTimeout(500)
    const sc = await p.evaluate(() => ({ mode: window.__slice.mode, open: window.__slice.townUI.isOpen }))
    await p.keyboard.press('Escape'); await p.waitForTimeout(400)
    const sc2 = await p.evaluate(() => ({ mode: window.__slice.mode, open: window.__slice.townUI.isOpen }))
    check('sewer_codex_pauses', sc.open && sc.mode === 'menu' && !sc2.open && sc2.mode === 'play', { sc, sc2 })
    // 몽실 마을: no T 귀환.
    await p.evaluate(() => { const s = window.__slice; s.leaveSewer?.() })
    await p.waitForTimeout(2500)
    if (await p.isVisible('#summary-close')) await p.click('#summary-close')
    await p.waitForFunction(() => !window.__slice.run, null, { timeout: 30000 }); await settle()
    await p.evaluate(() => { const s = window.__slice, d = s.dream; d.maze.passed = true; s.game.save.flags.mongsilMet = true; s.enterMongsil(true) })
    await p.waitForFunction(() => window.__slice.run && window.__slice.delve?.town, null, { timeout: 60000 }); await settle()
    await p.evaluate(() => window.__slice.talk.close())
    const ms = await hint()
    await p.screenshot({ path: `${OUT}/${tag}-mongsil-hint.png` })
    if (vw >= 700) check('mongsil_hint_no_recall', !/T\s?귀환/.test(ms.text.replace(/\u00a0/g, ' ')) && /별문/.test(ms.text), ms)
    check('no_errors', errs.length === 0, errs.slice(0, 5))
    await ctx.close()
  }
  await b.close()
  console.log(fails.length ? 'UI_FAIL ' + fails.join(', ') : 'UI_OK')
})()
