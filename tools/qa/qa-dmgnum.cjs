// 데미지 숫자 크기 QA: skills (real keys 1–4) on a point-blank pack with an elite, then on the boss,
// at each viewport. Samples every visible damage number's on-screen box and keeps the widest.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir TAG=before [VPS=1280x720,360x640] [PROD=1 SAVE=file] node tools/qa/qa-dmgnum.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-dmgnum'
const TAG = process.env.TAG || 'run'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720,360x640').split(',').map((v) => v.split('x').map(Number))
const SAVE = process.env.SAVE ? fs.readFileSync(process.env.SAVE, 'utf8') : ''
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const report = {}
  for (const [vw, vh] of VPS) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 700 })
    if (SAVE) await ctx.addInitScript((save) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('dream-nyang-rpg-3d-save-v1', save); sessionStorage.setItem('seeded', '1') } }, SAVE)
    await ctx.addInitScript(() => {
      window.__num = { w: 0, h: 0, text: '', cls: '', count: 0, maxLive: 0 }
      const tick = () => {
        requestAnimationFrame(tick)
        const N = window.__num
        let live = 0
        for (const e of document.querySelectorAll('.dmg, #floats span')) {
          if (e.style.display === 'none' || !e.isConnected) continue
          const r = e.getBoundingClientRect()
          if (!r.width) continue
          live++
          N.count++
          if (r.width > N.w) { N.w = Math.round(r.width); N.h = Math.round(r.height); N.text = e.textContent.slice(0, 40); N.cls = e.className; N.x = Math.round(r.left); N.tf = e.style.transform; N.ow = e.offsetWidth; N.oh = e.offsetHeight; N.fs = getComputedStyle(e).fontSize; N.ls = getComputedStyle(e).letterSpacing }
          N.hMax = Math.max(N.hMax || 0, Math.round(r.height))
        }
        N.maxLive = Math.max(N.maxLive, live)
      }
      requestAnimationFrame(tick)
    })
    const p = await ctx.newPage()
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)))
    await p.goto(process.env.BASE)
    if (!SAVE) { await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE) }
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    const R = (report[`${vw}x${vh}`] = {})
    const reset = () => p.evaluate(() => Object.assign(window.__num, { w: 0, h: 0, hMax: 0, text: '', cls: '', count: 0, maxLive: 0 }))
    const read = () => p.evaluate(() => ({ ...window.__num }))
    if (!process.env.PROD) {
      await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
      for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
      const line = (n, d, elite) => p.evaluate(([n, d, elite]) => {
        const s = window.__slice, H = s.run.horde, P = s.hero.object.position
        const v = new P.constructor(); s.stage.camera.getWorldDirection(v); const l = Math.hypot(v.x, v.z) || 1
        const live = H.foes.filter((f) => H.hittable(f))
        live.forEach((f, i) => { if (i >= n) { f.x = 999; f.z = 999; f.hp = 0 } })
        live.slice(0, n).forEach((f, i) => { const side = (i - (n - 1) / 2) * 0.7; f.x = P.x + (v.x / l) * d + (v.z / l) * side; f.z = P.z + (v.z / l) * d - (v.x / l) * side; f.vx = 0; f.vz = 0; f.hp = f.maxHp = f.maxHp * 30; if (elite && i === 0) f.elite = true })
      }, [n, d, elite])
      const cast = async (name) => {
        await reset()
        for (const k of ['1', '2', '3', '4']) { await p.keyboard.press(k); await p.waitForTimeout(160); if (k === '2') await p.screenshot({ path: `${OUT}/${TAG}-${vw}x${vh}-${name}-a.png` }) }
        let best = await read()
        for (let i = 0; i < 6; i++) { await p.waitForTimeout(150); const r = await read(); if (r.w >= best.w && i < 3) await p.screenshot({ path: `${OUT}/${TAG}-${vw}x${vh}-${name}-b.png` }); best = r }
        R[name] = best
        await p.waitForTimeout(1800)
      }
      await p.evaluate(() => { const s = window.__slice, sv = s.game.save; sv.level = 30; sv.build = { points: 0, ranks: { bubble_bomb: 5, mochi_rush: 5, overdrive: 5, candy_aura: 5 } }; sv.delve = { unlocked: 4, cleared: 3, checkpoint: null, runs: 0, open: null, ...(sv.delve || {}) }; s.applyBuild(); s.enterSewer(1, 1, 7) })
      await p.waitForFunction(() => window.__slice.run && !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
      await p.waitForTimeout(1500)
      await line(6, 1.6, true); await cast('pack-pointblank')
      await line(1, 1.2, true); await cast('elite-pointblank')
      await p.evaluate(() => window.__slice.enterSewer(1, 4))
      await p.waitForFunction(() => window.__slice.run?.boss && !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 }).catch(() => {})
      await p.waitForTimeout(2500)
      await p.evaluate(() => { const s = window.__slice, B = s.run.boss, P = s.hero.object.position; if (!B) return; const v = new P.constructor(); s.stage.camera.getWorldDirection(v); const l = Math.hypot(v.x, v.z) || 1; const o = B.object ?? B.root ?? B.group; if (o) { o.position.x = P.x + (v.x / l) * 2.5; o.position.z = P.z + (v.z / l) * 2.5 } if ('x' in B) { B.x = P.x + (v.x / l) * 2.5; B.z = P.z + (v.z / l) * 2.5 } })
      await cast('boss')
    } else {
      await p.click('#btn-continue'); await p.waitForTimeout(2500)
      for (let i = 0; i < 40; i++) { const open = await p.evaluate(() => { const d = document.getElementById('dialog'); return !!d && !d.classList.contains('hidden') && getComputedStyle(d).display !== 'none' }); if (!open) break; await p.keyboard.press('Enter'); await p.waitForTimeout(300) }
      await p.mouse.click(vw / 2, vh / 2); await p.waitForTimeout(600)
      await reset(); await p.mouse.down()
      for (const k of ['1', '2', '3', '4']) { await p.keyboard.press(k); await p.waitForTimeout(500) }
      await p.screenshot({ path: `${OUT}/${TAG}-${vw}x${vh}-prod-skills.png` })
      await p.mouse.up()
      R.prod = await read()
    }
    R.errors = errs.slice(0, 4)
    await ctx.close()
  }
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(report, null, 1))
  console.log(JSON.stringify(report))
  await b.close()
})()
