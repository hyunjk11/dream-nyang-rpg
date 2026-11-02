// Self-QA sweep: town, field, 챕터 2 (꿈 미로 4층 → 몽실 마을 → 달빛 둥지, CH2=0 skips), sewer floors d1-d3 incl. boss floors; errors, fps, key→door→stairs flow, boss→exit.
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
    // 챕터 2: 꿈 미로 (모찌 퀘스트 넷, 4층) → 몽실 마을 (NPC · 별문) → 달빛 둥지 보스 → 챕터 2 클리어
    if (process.env.CH2 !== '0') {
      const settle = async () => { await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 }); await p.waitForTimeout(1500) }
      const stairs = (want) => p.evaluate(async (want) => {
        const s = window.__slice, r = s.run, wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
        const st = r.stairsPortal.group.position; s.hero.object.position.set(st.x, 0, st.z); s.hero.hp = s.hero.maxHp; await wait(800)
        const at = r.portalAt; if (at === 'stairs') r.use()
        return { at, active: r.stairsPortal.active, want }
      }, want)
      const dbg = {}
      try {
        await fresh(); for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
        await p.evaluate(() => { const c = window.__slice.chapters; c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; c.card = 0; window.__slice.enterArea('maze') })
        await p.waitForFunction(() => window.__slice.run?.plan.area === 'maze', null, { timeout: 60000 }); await settle()
        await p.screenshot({ path: `${OUT}/${vw}x${vh}-maze1.png` })
        const fr = await fps()
        const q = await p.evaluate(async () => {
          const s = window.__slice, r = s.run, wait = (ms) => new Promise((ok) => setTimeout(ok, ms)), out = { steps: [] }
          const tp = (x, z) => { s.hero.object.position.set(x, 0, z); s.hero.hp = s.hero.maxHp }
          // m_kill: 12 foes down
          for (let k = 0; k < 40 && s.dream.maze.step === 0; k += 1) { const f = r.horde.foes.find((x) => x.dying <= 0 && x.hp > 0); if (!f) { await wait(500); continue } r.horde.damage(f, 1e12); await wait(120) }
          out.steps.push(s.dream.maze.step)
          await wait(400)
          for (const id of ['m_frag', 'm_rescue']) {
            const sp = r.spots.find((x) => x.id === id); out[id] = !!sp
            if (sp) { tp(sp.x, sp.z); await wait(500); out[id + 'At'] = r.portalAt; r.use(); await wait(600) }
            out.steps.push(s.dream.maze.step)
            if (id === 'm_rescue') { for (let k = 0; k < 30; k += 1) { for (const f of r.horde.foes) if (f.dying <= 0 && f.hp > 0 && Math.hypot(f.x - s.hero.object.position.x, f.z - s.hero.object.position.z) < 12) r.horde.damage(f, 1e12); await wait(100) } }
          }
          await wait(600)
          const el = r.horde.foes.find((f) => r.questFoes.get(f.id)?.id === 'm_elite'); out.elite = !!el
          if (el) { tp(el.x + 2, el.z); await wait(300); r.horde.damage(el, 1e12); await wait(1500) }
          out.steps.push(s.dream.maze.step)
          return out
        })
        await p.screenshot({ path: `${OUT}/${vw}x${vh}-maze-quests.png` })
        dbg.q = q
        const ups = []
        dbg.ups = ups
        for (let f = 1; f <= 3; f += 1) {
          ups.push(await stairs(f))
          ups.push(await p.waitForFunction((f) => window.__slice.run?.plan.areaFloor === f + 1, f, { timeout: 30000 }).then(() => 'ok', () => 'NO'))
          await settle()
        }
        await p.screenshot({ path: `${OUT}/${vw}x${vh}-maze4.png` })
        ups.push(await stairs(5))
        const town = await p.waitForFunction(() => window.__slice.run?.plan.objective === 'town' && !window.__slice.travelling, null, { timeout: 60000 }).then(() => 'ok', () => 'NO')
        dbg.town = town
        dbg.state = await p.evaluate(() => ({ obj: window.__slice.run?.plan.objective ?? null, area: window.__slice.run?.plan.area ?? null, fl: window.__slice.run?.plan.areaFloor ?? null, tr: window.__slice.travelling, dream: window.__slice.dream }))
        await settle()
        // The summary card is up after the maze: close it.
        await p.evaluate(() => document.getElementById('summary-close')?.click()); await p.waitForTimeout(800)
        await p.screenshot({ path: `${OUT}/${vw}x${vh}-mongsil.png` })
        const m = await p.evaluate(async () => {
          const s = window.__slice, r = s.run, wait = (ms) => new Promise((ok) => setTimeout(ok, ms)), out = {}
          out.spots = r.spots.map((x) => x.id).join(','); out.passed = s.dream.maze.passed; out.home = s.dream.home; out.mode = s.mode
          const go = async (id) => { const sp = r.spots.find((x) => x.id === id); s.hero.object.position.set(sp.x, 0, sp.z + 1.2); await wait(500); const at = r.portalAt; r.use(); await wait(500); return at }
          out.mongiAt = await go('mongi'); out.mongiTalk = s.talk.open
          for (let i = 0; i < 6 && s.talk.open; i += 1) { s.talk.close(); await wait(200) }
          out.story = { ...s.dream.story }
          out.boltAt = await go('bolt'); out.bolt = s.townUI.isOpen; s.townUI.close(); await wait(400)
          out.gateAt = await go('gate'); out.gateTalk = s.talk.open
          return out
        })
        dbg.m = m
        await p.screenshot({ path: `${OUT}/${vw}x${vh}-mongsil-gate.png` })
        await p.evaluate(() => { for (let i = 0; i < 4; i += 1) window.__slice.talk.close() })
        // Jump to the finale: the moth.
        await p.evaluate(() => { const d = window.__slice.dream; d.story.step = 3; d.story.state = 'active'; d.story.count = 0; window.__slice.enterArea('moon') })
        await p.waitForFunction(() => window.__slice.run?.plan.area === 'moon', null, { timeout: 60000 }); await settle()
        await p.screenshot({ path: `${OUT}/${vw}x${vh}-moon.png` })
        const moon = await p.evaluate(async () => {
          const s = window.__slice, r = s.run, m = r.maze, T = 3.4, wait = (ms) => new Promise((ok) => setTimeout(ok, ms)), out = {}
          const at = (x, y) => ({ x: (x - m.w / 2 + 0.5) * T, z: (y - m.h / 2 + 0.5) * T })
          const tp = (x, z) => { s.hero.object.position.set(x, 0, z); s.hero.hp = s.hero.maxHp }
          const c = m.bossRoom; const cc = at(c.x + 1, c.y + 1); tp(cc.x, cc.z); await wait(1500)
          out.bossHp = Math.round(r.boss.maxHp ?? r.boss.hp)
          if (r.boss.damage(1e12)) r.bossDown(); await wait(4000)
          out.bossDead = !r.boss.alive; out.story = s.dream.story.state
          const ch = r.chest.group.position; tp(ch.x, ch.z + 0.6); await wait(400); out.atChest = r.portalAt
          if (out.atChest === 'chest') r.use()
          await wait(800)
          const e = r.exitPortal.group.position; tp(e.x, e.z); await wait(400); out.atExit = r.portalAt
          if (out.atExit === 'exit') r.use()
          return out
        })
        dbg.moon = moon
        const back = await p.waitForFunction(() => window.__slice.run?.plan.objective === 'town' && !window.__slice.travelling, null, { timeout: 60000 }).then(() => 'ok', () => 'NO')
        await settle()
        await p.evaluate(() => document.getElementById('summary-close')?.click()); await p.waitForTimeout(800)
        const fin = await p.evaluate(async () => {
          const s = window.__slice, r = s.run, wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
          const sp = r.spots.find((x) => x.id === 'mongi')
          if (!sp) return { noMongi: r.spots.map((x) => x.id).join(','), obj: r.plan.objective, story: s.dream.story }
          s.hero.object.position.set(sp.x, 0, sp.z + 1.2); await wait(500); r.use(); await wait(500)
          const talk = s.talk.open
          for (let i = 0; i < 8 && s.talk.open; i += 1) { s.talk.close(); await wait(200) }
          await wait(3500)
          return { talk, cleared: s.chapters.cleared, current: s.chapters.current, done: s.dream.story.done, card: !!document.getElementById('chapter-clear-ok') }
        })
        await p.screenshot({ path: `${OUT}/${vw}x${vh}-ch2-clear.png` })
        const ok = q.steps[q.steps.length - 1] === 4 && town === 'ok' && m.spots.split(',').length >= 6 && m.mongiTalk && m.gateTalk && moon.bossDead && back === 'ok' && fin.done && fin.cleared.includes(2)
        note('chapter2', ok, { fps: fr, q, ups, town, m, moon, back, fin })
      } catch (e) { note('chapter2', false, { err: String(e).slice(0, 300), dbg }) }
    }
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
