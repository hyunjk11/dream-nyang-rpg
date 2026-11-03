// 몽실 들판 look + density: screenshots at 1280x720 (desktop GPU path) and 360x640 (mobile),
// foes alive in the field and on 꿈 미로 floor 1, rAF FPS, real WASD/mouse input. Dev build.
// TAG=before|after OUT=dir BASE=url
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-shots/field'
const TAG = process.env.TAG || 'after'
require('fs').mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE || 'http://localhost:4173/dream-nyang-rpg/'
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const GPU = `(() => { for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) { const g = C.prototype.getParameter; C.prototype.getParameter = function (p) { if (p === 0x9246) return 'ANGLE (NVIDIA GeForce RTX 3060)'; return g.call(this, p) } } })()`
const out = { tag: TAG }
async function boot(b, vp, desktop) {
  const ctx = await b.newContext({ viewport: vp, hasTouch: !desktop, isMobile: !desktop })
  if (desktop) await ctx.addInitScript(GPU)
  await ctx.addInitScript(() => { Element.prototype.requestPointerLock = function () { return Promise.reject(new Error('qa')) } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  await p.evaluate(() => { const s = window.__slice; for (let k = 0; k < 40 && !s.chapters.guide.done; k++) { const ids = ['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy', 'shop', 'workshop', 'board', 'sewer', 'recall', 'boss']; s.guideHit({ type: ids[s.chapters.guide.step], amount: 999, depth: 1 }) } })
  await p.waitForTimeout(600); await p.click('#chapter-clear-ok').catch(() => {}); await p.waitForTimeout(300)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  await p.evaluate(() => { const s = window.__slice; s.giveXp(40000); const d = s.dream; d.maze.entered = true; d.maze.passed = true; d.maze.step = 4; s.hero.invuln = 1e9 })
  return { p, errs, ctx }
}
const fps = (p, ms) => p.evaluate((ms) => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else r(+(n * 1000 / (performance.now() - t0)).toFixed(1)) }; requestAnimationFrame(f) }), ms)
const alive = (p) => p.evaluate(() => { const r = window.__slice.run; if (!r || !r.horde) return null; const h = r.horde; let far = 0; const hp = r.lastHero || { x: 0, z: 0 }; for (const f of h.foes) if (f.dying <= 0 && Math.hypot(f.x - hp.x, f.z - hp.z) > 40) far++; return { alive: h.alive, far40: far, chasing: h.chasing } })
;(async () => {
  const b = await chromium.launch({ args: ARGS })
  for (const [name, vp, desktop] of [['1280', { width: 1280, height: 720 }, true], ['360', { width: 360, height: 640 }, false]]) {
    const { p, errs, ctx } = await boot(b, vp, desktop)
    await p.evaluate(() => window.__slice.enterField())
    await p.waitForFunction(() => !window.__slice.travelling && window.__slice.delve && window.__slice.delve.plan.objective === 'field', null, { timeout: 60000 }).catch(() => {})
    await p.waitForTimeout(3000)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(150) }
    const r = { arrive: await alive(p) }
    await p.screenshot({ path: `${OUT}/${TAG}-${name}-arrive.png` })
    // Real input: hold W for 2.5 s, drag the mouse to turn.
    await p.mouse.move(vp.width / 2, vp.height / 2)
    await p.keyboard.down('w'); await p.waitForTimeout(2500); await p.keyboard.up('w')
    await p.mouse.down(); await p.mouse.move(vp.width / 2 + 120, vp.height / 2, { steps: 8 }); await p.mouse.up()
    await p.waitForTimeout(500)
    await p.screenshot({ path: `${OUT}/${TAG}-${name}-walk.png` })
    for (const [k, yaw] of [['north', Math.PI], ['east', Math.PI / 2], ['south', 0]]) {
      await p.evaluate((y) => { const s = window.__slice.shooter; s.view.yaw = y; s.view.pitch = 0.05 }, yaw); await p.waitForTimeout(700)
      await p.screenshot({ path: `${OUT}/${TAG}-${name}-${k}.png` })
    }
    // Bridge: stand at the west end of the middle crossing facing east, hold W (real keys) and cross.
    const br = await p.evaluate(() => { const r = window.__slice.run; const m = r.maze; const c = m.river && m.river.crossings[1]; if (!c) return null; const T = 3.4; const x0 = (c.x - 1 - m.w / 2 + 0.5) * T; const z = (c.y + 1 - m.h / 2) * T; window.__slice.hero.object.position.set(x0 - 2, 0, z); const s = window.__slice.shooter; s.view.yaw = Math.PI / 2; s.view.pitch = 0.08; return { x0, xEnd: (c.x + c.len - m.w / 2) * T, z } })
    if (br) {
      await p.waitForTimeout(800)
      await p.screenshot({ path: `${OUT}/${TAG}-${name}-bridge.png` })
      await p.keyboard.down('w'); await p.waitForTimeout(desktop ? 8000 : 4500); await p.keyboard.up('w')
      const at = await p.evaluate(() => { const h = window.__slice.hero.object.position; return { x: +h.x.toFixed(1), z: +h.z.toFixed(1) } })
      r.bridge = { ...br, at, crossed: at.x > br.xEnd }
      await p.screenshot({ path: `${OUT}/${TAG}-${name}-bridge-crossed.png` })
    }
    r.fps = await fps(p, 4000)
    r.after10s = await alive(p)
    r.pos = await p.evaluate(() => { const h = window.__slice.run && window.__slice.run.lastHero; return h ? { x: +h.x.toFixed(1), z: +h.z.toFixed(1) } : null })
    if (name === '1280') {
      await p.evaluate(() => window.__slice.leaveSewer && window.__slice.leaveSewer()); await p.waitForTimeout(2500)
      await p.evaluate(() => window.__slice.enterArea('maze')); await p.waitForFunction(() => !window.__slice.travelling && window.__slice.run && window.__slice.run.horde, null, { timeout: 60000 }).catch(() => {})
      await p.waitForTimeout(2500)
      r.maze = await alive(p)
      r.mazeFps = await fps(p, 3000)
      await p.screenshot({ path: `${OUT}/${TAG}-${name}-maze.png` })
    }
    r.errors = errs.slice(0, 3)
    out[name] = r
    console.log(name, JSON.stringify(r))
    await ctx.close()
  }
  require('fs').writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 1))
  console.log('FIELD_DONE')
  await b.close()
})().catch((e) => { console.error('ERR', e); process.exit(1) })
