// Self-QA sweep: town, field, sewer floors d1-d3 incl. boss floors; errors, fps, key→door→stairs flow, boss→exit.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5181/dream-nyang-rpg/ OUT=dir [FLOORS=1:1,1:4] [VPS=1280x720] node tools/qa/qa-sweep.cjs (dev build: needs window.__slice)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-sweep-out'
const FLOORS = (process.env.FLOORS || '1:1,1:2,1:3,1:4,2:1,2:3,2:4,3:1,3:3,3:4').split(',').map((s) => s.split(':').map(Number))
const VPS = (process.env.VPS || '1280x720,390x844').split(',').map((s) => s.split('x').map(Number))
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const report = []
  for (const [vw, vh] of VPS) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 700, isMobile: false })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ' ' + m.text().slice(0, 200)) })
    const note = (where, ok, info) => { const r = { vp: `${vw}x${vh}`, where, ok, info, errs: errs.splice(0) }; report.push(r); console.log(JSON.stringify(r)) }
    const fps = () => p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(+(n / 2).toFixed(1)) }; requestAnimationFrame(f) }))
    const fresh = async () => {
      await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
      await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
      await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(2000)
    }
    await fresh()
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-town-talk.png` })
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(300) }
    await p.waitForTimeout(1500)
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-town.png` })
    note('town', true, { fps: await fps(), guide: await p.evaluate(() => window.__slice.guideView) })
    // Chapter 2 field
    try {
      await p.evaluate(() => { const c = window.__slice.chapters; c.current = 2; window.__slice.enterField() })
      await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 })
      await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
      await p.waitForTimeout(3000)
      const box = await p.locator('canvas').first().boundingBox()
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.waitForTimeout(3000); await p.mouse.up()
      await p.screenshot({ path: `${OUT}/${vw}x${vh}-field.png` })
      note('field', true, { plan: await p.evaluate(() => window.__slice.run.plan.objective), fps: await fps(), hero: await p.evaluate(() => window.__slice.hero.hp) })
    } catch (e) { note('field', false, String(e).slice(0, 200)) }
    for (const [d, f] of FLOORS) {
      try {
        await fresh(); for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
        await p.evaluate(([d, f]) => { const sv = window.__slice.game.save; sv.delve = { unlocked: 1, cleared: 0, checkpoint: null, runs: 0, open: null, ...(sv.delve || {}) }; sv.delve.unlocked = Math.max(sv.delve.unlocked, d); window.__slice.hero.hp = window.__slice.hero.maxHp; window.__slice.enterSewer(d, f, 3) }, [d, f])
        await p.waitForFunction(([d, f]) => window.__slice.run && window.__slice.run.plan.depth === d && window.__slice.run.plan.floor === f, [d, f], { timeout: 60000 })
        await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
        await p.waitForTimeout(2000)
        const tag = `${vw}x${vh}-d${d}f${f}`
        await p.screenshot({ path: `${OUT}/${tag}.png` })
        const fr = await fps()
        const info = await p.evaluate(async () => {
          const s = window.__slice, r = s.run, m = r.maze, T = 3.4, wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
          const at = (x, y) => ({ x: (x - m.w / 2 + 0.5) * T, z: (y - m.h / 2 + 0.5) * T })
          const tp = (x, z) => { s.hero.object.position.set(x, 0, z); s.hero.hp = s.hero.maxHp }
          const out = { objective: r.plan.objective, foes: r.horde.foes.length }
          if (r.plan.objective === 'boss') {
            out.bossHp = Math.round(r.boss.maxHp ?? r.boss.hp)
            const c = r.maze.bossRoom; const cc = at(c.x + 1, c.y + 1); tp(cc.x, cc.z); await wait(1500)
            if (r.boss.damage(1e12)) r.bossDown(); await wait(4000)
            out.bossDead = !r.boss.alive
            out.chestVisible = r.chest?.group.visible ?? false
            const ch = r.chest.group.position; tp(ch.x, ch.z + 0.6); await wait(400); out.atChest = r.portalAt
            if (out.atChest === 'chest') r.use()
            await wait(800); out.chestOpened = !!r.chest.opened
            const e = r.exitPortal.group.position; out.exitVisible = r.exitPortal.group.visible; tp(e.x, e.z); await wait(400); out.atExit = r.portalAt
            if (out.atExit === 'exit') { r.use(); await wait(2500); out.leftRun = !window.__slice.run }
            return out
          }
          const L = r.layout
          out.needsKey = L.needsKey; out.chests = L.chests.length; out.packs = L.packs.length
          if (L.needsKey) {
            const k = r.explore.keyHolder; out.keyHolder = !!k
            if (k) { r.horde.damage(k, 1e12); await wait(1500) }
            out.hasKey = r.explore.hasKey
            const dr = L.doors[0]; const outside = [[1,0],[-1,0],[0,1],[0,-1]].map(([a, b]) => ({ x: dr.x + a, y: dr.y + b })).find((t) => m.tiles[t.y * m.w + t.x] !== 0 && !(t.x >= L.exit.x && t.y >= L.exit.y && t.x < L.exit.x + L.exit.w && t.y < L.exit.y + L.exit.h))
            const o = at(outside.x, outside.y); tp(o.x, o.z); await wait(300); const dd = at(dr.x, dr.y); tp((o.x + dd.x) / 2, (o.z + dd.z) / 2); await wait(1500)
            out.doorsOpen = r.explore.doorsOpen
          }
          out.stairsActive = r.stairsPortal.active
          const st = r.stairsPortal.group.position; tp(st.x, st.z); await wait(800)
          out.stairsVisible = r.stairsPortal.group.visible
          out.atStairs = r.portalAt
          return out
        })
        let next = null
        if (info.atStairs === 'stairs') {
          await p.evaluate(() => window.__slice.run.use())
          next = await p.waitForFunction(([d, f]) => window.__slice.run && window.__slice.run.plan.floor === f + 1, [d, f], { timeout: 30000 }).then(() => 'next-floor-ok', () => 'NO-NEXT-FLOOR')
        }
        await p.screenshot({ path: `${OUT}/${tag}-end.png` })
        const ok = info.objective === 'boss' ? info.bossDead && info.chestOpened && info.atExit === 'exit' && info.leftRun : info.atStairs === 'stairs' && next === 'next-floor-ok' && (!info.needsKey || (info.hasKey && info.doorsOpen))
        note(`d${d}f${f}`, ok, { ...info, next, fps: fr })
      } catch (e) { note(`d${d}f${f}`, false, String(e).slice(0, 300)) }
    }
    await ctx.close()
  }
  require('fs').writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1))
  await b.close()
})()
