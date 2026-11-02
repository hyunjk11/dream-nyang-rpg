// 고정 전설 QA: a real 깊이 1 boss chest with the pity full drops 별비 개틀링 (white-gold pillar, ★ tag,
// banner), she picks it up (→ 도감), wears it, and the 전설 도감 panel shows it.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5185/dream-nyang-rpg/ OUT=dir [VPS=1280x720,390x844] node tools/qa/qa-legends.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-legends-out'
fs.mkdirSync(OUT, { recursive: true })
const VPS = (process.env.VPS || '1280x720,390x844').split(',').map((v) => v.split('x').map(Number))
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const fails = []
  for (const [vw, vh] of VPS) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 700 })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
    const check = (name, ok, info) => { console.log(JSON.stringify({ vp: `${vw}x${vh}`, check: name, ok, info })); if (!ok) fails.push(`${vw}x${vh} ${name}`) }
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
    await p.evaluate(() => {
      const s = window.__slice, sv = s.game.save
      sv.delve = { unlocked: 1, cleared: 0, checkpoint: null, runs: 0, open: null, ...(sv.delve || {}) }
      s.legends.tries['leg_starrain:boss'] = 10
      s.hero.hp = s.hero.maxHp
      s.enterSewer(1, 4, 3)
    })
    await p.waitForFunction(() => window.__slice.run && window.__slice.run.plan.floor === 4, null, { timeout: 60000 })
    await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
    await p.waitForTimeout(1500)
    const drop = await p.evaluate(async () => {
      const s = window.__slice, r = s.run, m = r.maze, T = 3.4, wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
      const at = (x, y) => ({ x: (x - m.w / 2 + 0.5) * T, z: (y - m.h / 2 + 0.5) * T })
      const tp = (x, z) => { s.hero.object.position.set(x, 0, z); s.hero.hp = s.hero.maxHp }
      const c = m.bossRoom; const cc = at(c.x + 1, c.y + 1); tp(cc.x, cc.z); await wait(1200)
      if (r.boss.damage(1e12)) r.bossDown(); await wait(3500)
      const ch = r.chest.group.position; tp(ch.x, ch.z + 3.2); await wait(400)
      // Open from a step back so the pillar is in view before the magnet pulls it in.
      tp(ch.x, ch.z + 0.6); await wait(300); const portal = r.portalAt; if (portal === 'chest') r.use()
      tp(ch.x, ch.z + 4.5); await wait(900)
      return { portal, beams: r.loot.beams, labels: r.loot.labels, last: s.lastLegend, banner: document.getElementById('zone-banner')?.textContent ?? '' }
    })
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-legend-drop.png` })
    check('drop_pillar_and_tag', drop.portal === 'chest' && drop.banner.includes('고정 전설') && drop.beams.some((x) => x.fixed && x.height > 5) && drop.labels.some((l) => l.includes('별비 개틀링')) && drop.last?.id === 'leg_starrain', drop)
    // Walk onto the loot: the magnet brings it in.
    const picked = await p.evaluate(async () => {
      const s = window.__slice, r = s.run, wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
      const ch = r.chest.group.position
      for (let i = 0; i < 12 && !s.legends.found.includes('leg_starrain'); i++) { s.hero.object.position.set(ch.x, 0, ch.z + 0.8); await wait(300) }
      const gun = s.game.save.items.find((i) => i.defId === 'leg_starrain')
      return { found: s.legends.found, gun: gun ? gun.uid : null, toasts: [...document.querySelectorAll('.toast, #toasts *')].map((t) => t.textContent).join(' | ').slice(0, 300) }
    })
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-legend-picked.png` })
    check('picked_into_codex', picked.found.includes('leg_starrain') && !!picked.gun, picked)
    const worn = await p.evaluate(async (uid) => {
      const s = window.__slice
      s.game.save.equipment.weapon = uid; s.applyBuild()
      await new Promise((ok) => setTimeout(ok, 300))
      return { kind: s.stats.weaponKind, fire: s.stats.fireRate, star: s.stats.starShot }
    }, picked.gun)
    check('wear_legend', worn.kind === 'water' && worn.fire > 1.15 && worn.star > 0.1, worn)
    await p.evaluate(() => window.__slice.townUI.open('codex'))
    await p.waitForTimeout(500)
    const codex = await p.evaluate(() => {
      const cards = [...document.querySelectorAll('#codex-grid .codex-card')]
      const r = document.querySelector('#town .town-card').getBoundingClientRect()
      return { n: cards.length, found: cards.filter((c) => c.classList.contains('found')).map((c) => c.dataset.id), head: document.querySelector('#town h3 small')?.textContent, detail: document.getElementById('codex-detail')?.textContent?.slice(0, 120), box: { x: r.x, y: r.y, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight } }
    })
    await p.screenshot({ path: `${OUT}/${vw}x${vh}-codex.png` })
    const bx = codex.box
    check('codex_panel', codex.n === 7 && codex.found.length === 1 && codex.found[0] === 'leg_starrain' && codex.head === '1/7' && bx.x >= -1 && bx.y >= -1 && bx.r <= bx.w + 1 && bx.b <= bx.h + 1, codex)
    // Tap an unknown card: silhouette + where to look.
    await p.click('#codex-2'); await p.waitForTimeout(300)
    const unk = await p.evaluate(() => document.getElementById('codex-detail')?.textContent ?? '')
    check('codex_unknown_hint', unk.includes('???') && unk.includes('깊이 3 보스'), unk.slice(0, 120))
    check('no_errors', errs.length === 0, errs.slice(0, 5))
    await ctx.close()
  }
  await b.close()
  console.log(fails.length ? `LEGENDS_FAIL ${fails.join(' | ')}` : 'LEGENDS_OK')
})()
