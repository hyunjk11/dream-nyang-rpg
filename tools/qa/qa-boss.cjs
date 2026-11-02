// 보스층 QA: 깊이 1-3 보스층, 달빛 둥지, 꿈 미로 4층. Stands at the start a while (waves would pour
// on the old boss floor), hurts every foe (hp bars), walks into the boss room facing the boss,
// screenshots and measures: foes alive, wave text, bars (count / on-screen size), foes or boss
// hugging the camera, boss screen size.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir [VPS=1024x532,1280x720,390x844] [WAIT=20000] [SCENES=d1,d2,d3,moon,maze4] node tools/qa/qa-boss.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-boss-out'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1024x532,1280x720,390x844').split(',').map((v) => v.split('x').map(Number))
const WAIT = Number(process.env.WAIT || 20000)
const SCENES = (process.env.SCENES || 'd1,d2,d3,moon,maze4').split(',')
const STRICT = process.env.STRICT === '1'
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const fails = []
  for (const [vw, vh] of VPS) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 700 })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
    const fresh = async () => {
      await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
      await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
      await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
      for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    }
    const settle = async () => { await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 }); await p.waitForTimeout(1500) }
    for (const scene of SCENES) {
      try {
        await fresh()
        await p.evaluate((scene) => {
          const s = window.__slice, sv = s.game.save
          sv.delve = { unlocked: 3, cleared: 2, checkpoint: null, runs: 0, open: null, ...(sv.delve || {}), unlocked: 3 }
          s.hero.hp = s.hero.maxHp
          window.__god = setInterval(() => { s.hero.hp = s.hero.maxHp }, 100)
          if (scene[0] === 'd') s.enterSewer(Number(scene[1]), 4, 7)
          else {
            const c = s.chapters; c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; c.card = 0
            if (scene === 'moon') { const d = s.dream; d.maze.passed = true; d.story.step = 3; d.story.state = 'active'; d.story.count = 0; s.enterMongsil(true) }
            else s.enterArea('maze')
          }
        }, scene)
        await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 }); await settle()
        if (scene === 'moon') {
          await p.waitForFunction(() => window.__slice.run?.plan.objective === 'town' && !window.__slice.travelling, null, { timeout: 60000 }); await settle()
          await p.evaluate(() => window.__slice.enterArea('moon'))
          await p.waitForFunction(() => window.__slice.run?.plan.area === 'moon' && !window.__slice.travelling, null, { timeout: 60000 }); await settle()
        }
        if (scene === 'maze4') {
          for (let f = 1; f <= 3; f += 1) {
            await p.evaluate(async () => { const s = window.__slice, r = s.run; const st = r.stairsPortal.group.position; s.hero.object.position.set(st.x, 0, st.z); await new Promise((ok) => setTimeout(ok, 700)); if (r.portalAt === 'stairs') r.use(); else s.nextFloor() })
            await p.waitForFunction((f) => window.__slice.run?.plan.areaFloor === f + 1 && !window.__slice.travelling, f, { timeout: 30000 }); await settle()
          }
          await p.evaluate(() => window.__slice.placeMazeQuest?.(false))
        }
        // Stand at the start (old boss floors: waves pour meanwhile), then hurt everything.
        await p.waitForTimeout(WAIT)
        const info = await p.evaluate(async () => {
          const s = window.__slice, r = s.run, m = r.maze, T = 3.4, wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
          const at = (x, y) => ({ x: (x - m.w / 2 + 0.5) * T, z: (y - m.h / 2 + 0.5) * T })
          const before = { alive: r.horde.alive, wave: r.director.wave }
          // Boss room entrance → face the boss (or the quest elite on maze 4).
          const el = r.horde.foes.find((f) => r.questFoes?.get(f.id)?.id === 'm_elite' && f.dying <= 0)
          const target = r.boss ? { x: r.boss.x, z: r.boss.z } : el ? { x: el.x, z: el.z } : null
          if (target) {
            const c = m.bossRoom
            const door = at(c.x + Math.floor(c.w / 2), c.y + c.h - 1)
            let hx = door.x, hz = door.z
            if (!r.boss) { hx = target.x + 4; hz = target.z }
            s.hero.object.position.set(hx, 0, hz)
            const yaw = Math.atan2(target.x - hx, target.z - hz); s.hero.yaw = yaw; if (r.view) { r.view.yaw = yaw; r.view.pitch = 0.08 }
          }
          await wait(2500)
          // Bars: hurt every foe a little; pull a few foes right up to the camera (crowd behind her).
          for (const f of r.horde.foes) if (f.dying <= 0 && f.hp > 0) f.hp = Math.max(1, f.hp * 0.7)
          const cam = r.host.camera
          const hp = s.hero.object.position
          const near = r.horde.foes.filter((f) => f.dying <= 0 && f.hp > 0).slice(0, 4)
          near.forEach((f, i) => { f.x = cam.position.x + (hp.x - cam.position.x) * (0.15 + 0.12 * i) + (i - 1.5) * 0.3; f.z = cam.position.z + (hp.z - cam.position.z) * (0.15 + 0.12 * i) })
          await wait(60)
          if (r.boss && r.boss.alive) { r.boss.x = hp.x + (hp.x - cam.position.x) * 0.4; r.boss.z = hp.z + (hp.z - cam.position.z) * 0.4 }
          await wait(400)
          cam.updateMatrixWorld()
          const v = r.hordeView
          // On-screen bar size: project each bar instance's ends.
          const THREE = { }
          const proj = (x, y, z) => { const e = cam.matrixWorldInverse.elements, pm = cam.projectionMatrix.elements
            const vx = e[0]*x+e[4]*y+e[8]*z+e[12], vy = e[1]*x+e[5]*y+e[9]*z+e[13], vz = e[2]*x+e[6]*y+e[10]*z+e[14]
            const cx = pm[0]*vx+pm[4]*vy+pm[8]*vz+pm[12], cy = pm[1]*vx+pm[5]*vy+pm[9]*vz+pm[13], cw = pm[3]*vx+pm[7]*vy+pm[11]*vz+pm[15]
            return { x: cx / cw, y: cy / cw, w: cw } }
          let maxBar = 0
          const mt = v.bars.instanceMatrix.array
          for (let i = 0; i < v.bars.count; i += 1) {
            const o = i * 16, sx = Math.hypot(mt[o], mt[o + 1], mt[o + 2])
            const cxw = mt[o + 12], cyw = mt[o + 13], czw = mt[o + 14]
            const a = proj(cxw - mt[o] / 2, cyw - mt[o + 1] / 2, czw - mt[o + 2] / 2), bb = proj(cxw + mt[o] / 2, cyw + mt[o + 1] / 2, czw + mt[o + 2] / 2)
            if (a.w <= 0 || bb.w <= 0) { maxBar = Math.max(maxBar, 9); continue }
            maxBar = Math.max(maxBar, Math.abs(a.x - bb.x) / 2)
            void sx
          }
          const camNear = r.horde.foes.filter((f) => f.dying <= 0 && Math.hypot(f.x - cam.position.x, f.z - cam.position.z) < 1.6).length
          let bossScreen = 0, bossCam = null, bossVis = null
          if (r.boss) {
            bossCam = Math.round(Math.hypot(r.bossBody.position.x - cam.position.x, r.bossBody.position.z - cam.position.z) * 100) / 100
            const box = new (r.bossBody.position.constructor)(); void box
            const top = proj(r.bossBody.position.x, 5, r.bossBody.position.z), bot = proj(r.bossBody.position.x, 0, r.bossBody.position.z)
            bossScreen = top.w > 0 && bot.w > 0 ? Math.round(Math.abs(top.y - bot.y) / 2 * 100) / 100 : 9
            let op = 1; r.bossBody.traverse((o) => { if (o.material && o.material.opacity !== undefined) op = Math.min(op, o.material.transparent ? o.material.opacity : 1) })
            bossVis = { visible: r.bossBody.visible, opacity: Math.round(op * 100) / 100 }
          }
          return { before, alive: r.horde.alive, foes: r.horde.foes.length, wave: document.getElementById('wave')?.textContent ?? '', bars: v.barsDrawn, maxBar: Math.round(maxBar * 100) / 100, camNear, nearDrawn: v.nearDrawn, drawn: v.drawn, bossCam, bossScreen, bossVis, tiles: m.w + 'x' + m.h, rooms: (m.chambers || []).length, plan: r.plan.objective, area: r.plan.area ?? null, label: document.getElementById('delve')?.textContent?.slice(0, 60) }
        })
        await p.screenshot({ path: `${OUT}/${vw}x${vh}-${scene}.png` })
        const ok = !info.wave.includes('웨이브') && info.alive <= 24 && info.maxBar < 0.25 && (info.bossScreen ?? 0) < 1.6
        console.log(JSON.stringify({ vp: `${vw}x${vh}`, scene, ok, info }))
        if (!ok) fails.push(`${vw}x${vh} ${scene}`)
      } catch (e) { console.log(JSON.stringify({ vp: `${vw}x${vh}`, scene, ok: false, err: String(e).slice(0, 300) })); fails.push(`${vw}x${vh} ${scene} ERR`) }
      await p.evaluate(() => clearInterval(window.__god)).catch(() => {})
    }
    if (errs.length) { console.log(JSON.stringify({ vp: `${vw}x${vh}`, errs: errs.slice(0, 5) })); fails.push(`${vw}x${vh} errors`) }
    await ctx.close()
  }
  await b.close()
  console.log(fails.length ? 'BOSS_FAIL ' + fails.join('; ') : 'BOSS_OK')
  process.exit(STRICT && fails.length ? 1 : 0)
})()
