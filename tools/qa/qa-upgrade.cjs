// 확률 강화 QA on the BUILT game (dev build): real clicks in 키키 공방 (+9 → +10 with real rolls).
// Usage: PLAYWRIGHT=… BASE=… OUT=dir node tools/qa/qa-upgrade.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || '.'
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  for (const [vw, vh] of [[1280, 720], [360, 640]]) {
    const touch = vw < 600
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch, isMobile: touch })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push(e.message))
    const V = `${vw}x${vh}`
    const wait = (ms) => p.waitForTimeout(ms)
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await wait(800); await p.keyboard.press('Escape'); await wait(1500)
    for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__slice.talk.close()); await wait(200) }
    await p.evaluate(() => {
      const s = window.__slice, g = s.game.save
      s.chapters.guide.done = true
      g.gold = 60000; g.materials.dream_dust = 600; g.materials.star_shard = 60
      const gun = g.items.find((i) => i.uid === g.equipment.weapon); gun.plus = 9; gun.upFails = 0
      let seed = 3; const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const max = s.makeItem('gun_star', 'legendary', rng, 12); max.plus = 10; g.items.push(max)
      const six = s.makeItem('gun_dart', 'rare', rng, 8); six.plus = 5; g.items.push(six)
      s.game.changed?.()
      s.openTown('workshop')
    })
    await wait(800)
    await p.click('#town .inv-cell >> nth=0'); await wait(400)
    await p.screenshot({ path: `${OUT}/${V}-odds-25.png` })
    const log = []
    for (let k = 0; k < 12; k++) {
      const odds = await p.textContent('#work-odds').catch(() => null)
      if (!odds) break
      await p.click('#work-upgrade'); await wait(250)
      if (k === 0) await p.screenshot({ path: `${OUT}/${V}-sparkle.png` })
      await wait(500)
      const toast = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).pop())
      const plus = await p.evaluate(() => { const g = window.__slice.game.save; const i = g.items.find((x) => x.uid === g.equipment.weapon); return [i.plus, i.upFails] })
      log.push({ odds: odds.trim(), toast, plus })
      if (k === 0 || (plus[0] === 10 && !log.done)) { await p.screenshot({ path: `${OUT}/${V}-result-${k}.png` }); }
      if (plus[0] === 10) break
      await wait(300)
    }
    await wait(800)
    await p.screenshot({ path: `${OUT}/${V}-plus10-glow.png` })
    const glow = await p.evaluate(() => document.querySelectorAll('#town .inv-cell.plus-max').length)
    console.log(V, JSON.stringify({ log, glow, errs }, null, 0))
    await ctx.close()
  }
  await b.close()
})()
