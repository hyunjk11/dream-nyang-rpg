// Chapter-1 area foe HP check with real input: hold the left mouse button with the starter gun on a foe
// pinned 7 m out on the crosshair ray and time the kill. Time = shots fired × the gun's gap (game time;
// swiftshader runs at 5–11 FPS, so wall time would overstate it). Dev build. ZONES=forest,vale,altar
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-shots/hp'
require('fs').mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE || 'http://localhost:4173/dream-nyang-rpg/'
const ZONES = (process.env.ZONES || 'forest,vale,altar').split(',')
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
;(async () => {
  const b = await chromium.launch({ args: ARGS })
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(250) }
  await p.evaluate(() => { const s = window.__slice; for (let k = 0; k < 40 && !s.chapters.guide.done; k++) { const ids = ['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy', 'shop', 'workshop', 'board', 'sewer', 'recall', 'boss']; s.guideHit({ type: ids[s.chapters.guide.step], amount: 999, depth: 1 }) } })
  await p.waitForTimeout(800); await p.click('#chapter-clear-ok').catch(() => {}); await p.waitForTimeout(400)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  const out = []
  for (const zone of ZONES) {
    await p.evaluate((z) => { window.__slice.hero.hp = 9999; window.__slice.enterZone(z) }, zone); await p.waitForTimeout(2500)
    const roster = await p.evaluate(() => window.__slice.combat.foes.filter((f) => f.alive).map((f) => ({ kind: f.kind, hp: Math.round(f.maxHp), elite: f.elite || '' })))
    const kinds = []
    for (const r of roster) if (!kinds.find((k) => k.kind === r.kind && k.elite === r.elite)) kinds.push(r)
    for (const k of kinds.slice(0, 5)) {
      const ok = await p.evaluate(({ kind, elite }) => {
        const s = window.__slice, cam = s.stage.camera
        const f = s.combat.foes.find((x) => x.alive && x.kind === kind && (x.elite || '') === elite && x.hp === x.maxHp)
        if (!f) return false
        window.__hp = null
        s.hero.maxHp = 99999; s.hero.hp = 99999
        let first = 0, frames = 0
        const others = s.combat.foes.filter((x) => x !== f)
        const sh = s.shooter, f0 = sh.fired, l0 = sh.landed
        const t0 = performance.now()
        const pin = () => {
          if (!f.alive || f.dying > 0 || f.hp <= 0) { window.__hp = { kind, elite, hp: Math.round(f.maxHp), secs: first ? +((performance.now() - first) / 1000).toFixed(2) : null, fired: sh.fired - f0, landed: sh.landed - l0, shotSecs: +((sh.fired - f0) * s.stats.gun.gap).toFixed(2), fps: Math.round(frames / ((performance.now() - t0) / 1000)) }; return }
          if (performance.now() - t0 > 30000) { window.__hp = { kind, elite, hp: Math.round(f.maxHp), secs: null, left: Math.round(f.hp) }; return }
          frames++
          // Keep the rest of the zone out of the line of fire (the ray hits the nearest foe).
          for (const o of others) { o.object.position.set(200, -50, 200); o.home.set(200, -50, 200) }
          if (!first && f.hp < f.maxHp) first = performance.now()
          // Pin it on the crosshair ray, 7 m out, so every shot of the held trigger can land.
          const dir = cam.getWorldDirection(cam.position.clone())
          const at = cam.position.clone().addScaledVector(dir, 7); at.y -= 0.5
          f.object.position.copy(at); f.home.copy(at); f.windup = 0
          s.hero.hp = s.hero.maxHp
          requestAnimationFrame(pin)
        }
        pin()
        return true
      }, k)
      if (!ok) continue
      await p.mouse.move(640, 360); await p.mouse.down()
      await p.waitForFunction(() => window.__hp, null, { timeout: 35000, polling: 100 }).catch(() => {})
      await p.mouse.up()
      const t = await p.evaluate(() => window.__hp)
      await p.screenshot({ path: `${OUT}/${zone}-${k.kind}${k.elite ? '-elite' : ''}.png` })
      await p.waitForTimeout(400)
      out.push({ zone, ...t })
    }
  }
  for (const o of out) console.log(JSON.stringify(o))
  console.log('HP_DONE', JSON.stringify(await p.evaluate(() => ({ dps: window.__slice.stats }))))
  await b.close()
})()
