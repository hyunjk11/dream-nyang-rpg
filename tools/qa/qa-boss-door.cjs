// 잠든 보스를 방 밖(문간)에서 총알·거품 폭탄으로 맞혀 본다: 예전 빌드는 0 피해, 고친 빌드는 피해 + 깨어남.
// BASE=http://localhost:5196/dream-nyang-rpg/ PLAYWRIGHT=... node tools/qa/qa-boss-door.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const p = await (await b.newContext({ viewport: { width: 1024, height: 576 } })).newPage()
  const BASE = process.env.BASE
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(800); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  for (let i = 0; i < 4; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  await p.evaluate(() => { const c = window.__slice.chapters; c.guide.done = true; c.cleared.push(1); c.current = 2; c.card = 0; window.__slice.enterSewer(1, 4) })
  await p.waitForFunction(() => window.__slice.run?.boss && !window.__slice.travelling, null, { timeout: 90000 }); await p.waitForTimeout(2500)
  const spot = await p.evaluate(() => {
    const s = window.__slice, r = s.run, m = r.maze, bo = r.boss, T = 3.4
    for (const id of ['bubble_bomb', 'overdrive', 'mochi_rush', 'candy_aura']) s.game.save.build.ranks[id] = 1
    let best = null
    for (let ty = 0; ty < m.h; ty++) for (let tx = 0; tx < m.w; tx++) {
      if (m.tiles[ty * m.w + tx] === 0) continue
      const x = (tx - m.w / 2 + 0.5) * T, z = (ty - m.h / 2 + 0.5) * T
      if (bo.inRoom(x, z)) continue
      const d = Math.hypot(bo.x - x, bo.z - z), dx = (bo.x - x) / d, dz = (bo.z - z) / d
      if (d > 15) continue
      const wl = r.skillWorld.solid(x, 0.8, z, dx, 0, dz, d); if (wl < d - 1.3) continue
      if (!best || d < best.d) best = { x, z, d }
    }
    if (!best) return null
    for (const f of r.horde.foes) { f.x = 400; f.z = 400 }
    s.hero.object.position.set(best.x, 0, best.z)
    return best
  })
  if (!spot) { console.log('no spot'); await b.close(); return }
  const rows = []
  for (const [k, key] of [['bullet', null], ['bomb', 'Digit1']]) {
    await p.evaluate(async () => { const s = window.__slice, bo = s.run.boss, h = s.hero.object.position; for (let i = 0; i < 6; i++) { s.shooter.view.yaw = Math.atan2(bo.x - h.x, bo.z - h.z); s.shooter.view.pitch = 0.05; await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))) } })
    const pre = await p.evaluate(() => { const s = window.__slice, bo = s.run.boss, h = s.hero.object.position; return { hp: bo.hp, awake: bo.awake, inRoom: bo.inRoom(h.x, h.z), aimOnBoss: +Math.hypot(s.rig.aim.x - bo.x, s.rig.aim.z - bo.z).toFixed(2) } })
    if (key) await p.keyboard.press(key)
    else { const bx = await p.locator('canvas').first().boundingBox(); await p.mouse.move(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(400); await p.mouse.down(); await p.waitForTimeout(900); await p.mouse.up() }
    await p.waitForTimeout(2500)
    const post = await p.evaluate(() => { const bo = window.__slice.run.boss; return { hp: bo.hp, awake: bo.awake } })
    rows.push({ k, spotD: +spot.d.toFixed(1), ...pre, lost: pre.hp - post.hp, awakeAfter: post.awake })
  }
  console.log(JSON.stringify(rows))
  await b.close()
})()
