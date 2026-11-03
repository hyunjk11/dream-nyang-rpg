// "클릭해서 계속" one-click check with real (trusted) mouse input. Run headed (xvfb-run) so pointer lock is real.
// BASE=dev build (uses window.__slice to skip the tutorial) or prod with SAVE=<game-written save json>.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-shots/relock'
require('fs').mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE || 'http://localhost:4173/dream-nyang-rpg/'
const SAVE = process.env.SAVE ? require('fs').readFileSync(process.env.SAVE, 'utf8') : ''
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const res = []
const check = (name, ok, extra = '') => { res.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`) }
const st = (p) => p.evaluate(() => ({ locked: !!document.pointerLockElement, relock: !document.getElementById('relock').classList.contains('hidden') }))
// One real click on the button; then the button must stay gone (no second click needed).
async function oneClick (p, label, slow = false) {
  await p.waitForFunction(() => !document.getElementById('relock').classList.contains('hidden'), null, { timeout: 4000 }).catch(() => {})
  const before = await st(p)
  const box = await (await p.$('#relock')).boundingBox()
  await p.screenshot({ path: `${OUT}/${label}-before.png` })
  // slow: a 300 ms press near the bottom edge while the button bobs (the old click handler missed these).
  if (box && before.relock && slow) { await p.mouse.move(box.x + box.width / 2, box.y + box.height - 2); await p.mouse.down(); await p.waitForTimeout(300); await p.mouse.up() } else if (box && before.relock) await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  else await p.mouse.click(640, 400)
  await p.waitForTimeout(1500)
  const after = await st(p)
  await p.screenshot({ path: `${OUT}/${label}-after.png` })
  check(`${label}: 한 번 클릭으로 계속된다`, !after.relock, `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`)
  return after
}
;(async () => {
  const b = await chromium.launch({ args: ARGS, headless: false })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
  if (SAVE) await ctx.addInitScript((save) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('dream-nyang-rpg-3d-save-v1', save); sessionStorage.setItem('seeded', '1') } }, SAVE)
  // Report a real GPU name (software GL takes the phone path), like the player's machine.
  await ctx.addInitScript(() => { for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) { const o = C.prototype.getParameter; C.prototype.getParameter = function (k) { if (k === 0x9246) return 'ANGLE (NVIDIA GeForce RTX 3060)'; return o.call(this, k) } } })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await p.goto(BASE)
  if (!SAVE) { await p.evaluate(() => localStorage.clear()); await p.goto(BASE) }
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  const dev = await p.evaluate(() => !!window.__slice)
  // 1) Start screen: one real click on 이어하기/새로 시작 takes the lock (or resumes) with no extra click.
  const startBtn = SAVE && (await p.$('#btn-continue:not([disabled]):not(.hidden)')) ? '#btn-continue' : '#btn-new'
  const sb = await (await p.$(startBtn)).boundingBox()
  await p.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.waitForTimeout(1500)
  // New game opens the intro story; its 건너뛰기 is the click that starts play.
  const skip = await p.$('#intro-skip')
  if (skip && await skip.isVisible()) { const k = await skip.boundingBox(); await p.mouse.click(k.x + k.width / 2, k.y + k.height / 2); await p.waitForTimeout(1500) }
  let s = await st(p)
  await p.screenshot({ path: `${OUT}/start-after.png` })
  check('시작 화면: 한 번 클릭으로 바로 플레이(잠금 또는 버튼 없음)', (s.locked || !s.relock) && !(await p.evaluate(() => document.body.classList.contains('menu'))), JSON.stringify(s))
  if (dev) {
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(250) }
    await p.evaluate(() => { const s = window.__slice; for (let k = 0; k < 40 && !s.chapters.guide.done; k++) { const ids = ['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy', 'shop', 'workshop', 'board', 'sewer', 'recall', 'boss']; s.guideHit({ type: ids[s.chapters.guide.step], amount: 999, depth: 1 }) } })
    await p.waitForTimeout(600); await p.click('#chapter-clear-ok').catch(() => {}); await p.waitForTimeout(400)
  } else {
    for (let i = 0; i < 4; i++) { await p.keyboard.press('Escape'); await p.waitForTimeout(300) }
  }
  // Get into a locked state with a real click on the world.
  await p.mouse.click(640, 400); await p.waitForTimeout(800)
  s = await st(p); if (s.relock) s = await oneClick(p, 'enter')
  const real = s.locked
  console.log('real lock', real, JSON.stringify(await p.evaluate(() => { const e = document.elementFromPoint(640, 400); return { at: e && (e.id || e.tagName + '.' + e.className), body: document.body.className, cfree: window.__slice && window.__slice.cursor.free, focus: document.hasFocus() } })))
  // 2) Pause by Esc (browser drops the lock), then click right away inside Chrome's re-lock cooldown, repeat a few times.
  for (let i = 0; i < 3; i++) {
    await p.keyboard.press('Escape'); await p.waitForTimeout(100)
    // CDP key events don't trigger Chrome's own Esc unlock; drop it the way the browser does.
    await p.evaluate(() => document.exitPointerLock()); await p.waitForTimeout(i === 0 ? 150 : 400)
    await oneClick(p, `esc-${i}`)
    await p.waitForTimeout(1200)
  }
  for (let i = 0; i < 3; i++) {
    await p.evaluate(() => document.exitPointerLock()); await p.waitForTimeout(300)
    await oneClick(p, `slow-${i}`, true)
    await p.waitForTimeout(1200)
  }
  // 3) Panel open/close (bag), then resume.
  await p.keyboard.press('i'); await p.waitForTimeout(700); await p.keyboard.press('Escape'); await p.waitForTimeout(700)
  s = await st(p)
  if (s.relock || !s.locked) await oneClick(p, 'panel')
  else check('패널 닫힘: 버튼 없이 바로 계속', true, JSON.stringify(s))
  // 4) Focus loss: another tab in front, then come back.
  const q = await ctx.newPage(); await q.goto('about:blank'); await q.bringToFront(); await p.waitForTimeout(800)
  await p.bringToFront(); await p.waitForTimeout(800)
  s = await st(p)
  if (s.relock || !s.locked) await oneClick(p, 'blur')
  else check('포커스 복귀: 버튼 없이 바로 계속', true, JSON.stringify(s))
  await q.close()
  // 5) Start screen with a save: reload (pagehide saves), one real click on 이어하기 must leave the view locked.
  await p.reload(); await p.waitForFunction(() => !document.getElementById('btn-continue').disabled, null, { timeout: 120000 })
  await p.waitForTimeout(500)
  const cb = await (await p.$('#btn-continue')).boundingBox()
  await p.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2); await p.waitForTimeout(1200)
  s = await st(p); await p.screenshot({ path: `${OUT}/continue-after.png` })
  check('이어하기: 한 번 클릭으로 시점까지 잠긴다', real ? s.locked && !s.relock : !s.relock, JSON.stringify(s))
  const fails = res.filter((r) => !r.ok).length
  console.log(fails ? `RELOCK_FAIL ${fails}` : `RELOCK_OK ${res.length}`, JSON.stringify({ real, dev }))
  await b.close(); process.exit(fails ? 1 : 0)
})()
