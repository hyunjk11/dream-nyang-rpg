// Mouse pointer must be hidden whenever the game is playing (real trusted clicks; run headed under xvfb-run so pointer lock is real).
// REFUSE=1 makes requestPointerLock fail (like a browser that refuses), so the fallback path is tested.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-shots/cursor'
fs.mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE || 'http://localhost:5191/dream-nyang-rpg/'
const SAVE = process.env.SAVE ? fs.readFileSync(process.env.SAVE, 'utf8') : ''
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const res = []
const check = (name, ok, extra = '') => { res.push({ name, ok, extra }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`) }
const st = (p) => p.evaluate(() => {
  const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? getComputedStyle(e).cursor : 'n/a' }
  const hint = document.getElementById('aim-hint')
  return {
    locked: !!document.pointerLockElement,
    relock: !!document.getElementById('relock') && !document.getElementById('relock').classList.contains('hidden'),
    menu: document.body.classList.contains('menu'),
    aimClass: document.body.classList.contains('cursor-aim'),
    centre: at(640, 360), corner: at(60, 60), hud: at(1180, 40),
    hint: !!hint && !hint.classList.contains('hidden') && getComputedStyle(hint).display !== 'none',
  }
})
;(async () => {
  const b = await chromium.launch({ args: ARGS, headless: false })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
  if (SAVE) await ctx.addInitScript((save) => { if (!sessionStorage.getItem('seeded')) { localStorage.clear(); localStorage.setItem('dream-nyang-rpg-3d-save-v1', save); sessionStorage.setItem('seeded', '1') } }, SAVE)
  await ctx.addInitScript(() => { for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) { const o = C.prototype.getParameter; C.prototype.getParameter = function (k) { if (k === 0x9246) return 'ANGLE (NVIDIA GeForce RTX 3060)'; return o.call(this, k) } } })
  if (process.env.REFUSE) await ctx.addInitScript(() => { Element.prototype.requestPointerLock = function () { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 5); return Promise.reject(new DOMException('refused', 'NotAllowedError')) } })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await p.goto(BASE)
  if (!SAVE) { await p.evaluate(() => localStorage.clear()); await p.goto(BASE) }
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  const dev = await p.evaluate(() => !!window.__slice)
  const startBtn = SAVE && (await p.$('#btn-continue:not([disabled]):not(.hidden)')) ? '#btn-continue' : '#btn-new'
  const sb = await (await p.$(startBtn)).boundingBox()
  await p.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.waitForTimeout(1500)
  const skip = await p.$('#intro-skip')
  if (skip && await skip.isVisible()) { const k = await skip.boundingBox(); await p.mouse.click(k.x + k.width / 2, k.y + k.height / 2); await p.waitForTimeout(1500) }
  if (dev) {
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(250) }
    await p.evaluate(() => { const s = window.__slice; for (let k = 0; k < 40 && !s.chapters.guide.done; k++) { const ids = ['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy', 'shop', 'workshop', 'board', 'sewer', 'recall', 'boss']; s.guideHit({ type: ids[s.chapters.guide.step], amount: 999, depth: 1 }) } })
    await p.waitForTimeout(600); await p.click('#chapter-clear-ok').catch(() => {}); await p.waitForTimeout(400)
  } else {
    // Prod build (no __slice): read through the intro talk with real Enter presses like a player.
    for (let i = 0; i < 40; i++) {
      const open = await p.evaluate(() => { const d = document.getElementById('dialog'); return !!d && !d.classList.contains('hidden') && getComputedStyle(d).display !== 'none' })
      if (!open) break
      await p.keyboard.press('Enter'); await p.waitForTimeout(350)
    }
  }
  // 1) Real click on the world.
  await p.mouse.click(640, 400); await p.waitForTimeout(900)
  let s = await st(p)
  if (s.relock) { const bx = await (await p.$('#relock')).boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.waitForTimeout(1200); s = await st(p) }
  await p.mouse.move(700, 380); await p.waitForTimeout(200); s = await st(p)
  await p.screenshot({ path: `${OUT}/play.png` })
  const refuse = !!process.env.REFUSE
  check('플레이 중: 화면 가운데·구석·HUD 어디서도 포인터가 안 보인다', !s.menu && s.centre === 'none' && s.corner === 'none' && s.hud === 'none', JSON.stringify(s))
  if (refuse) check('잠금 거부: 작은 "클릭하면 조준" 안내만 보인다', s.hint && !s.locked, JSON.stringify(s))
  else check('잠금 성공: 조준 안내가 없다', s.locked && !s.hint, JSON.stringify(s))
  // 2) Esc drops the lock, click once to resume; pointer must be gone again right after.
  for (let i = 0; i < 3; i++) {
    await p.keyboard.press('Escape'); await p.waitForTimeout(100)
    await p.evaluate(() => document.exitPointerLock()); await p.waitForTimeout(400)
    const mid = await st(p)
    const bx = mid.relock ? await (await p.$('#relock')).boundingBox() : null
    if (bx) await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); else await p.mouse.click(640, 400)
    await p.waitForTimeout(1300)
    await p.mouse.move(620 + i * 30, 390); await p.waitForTimeout(150)
    s = await st(p)
    await p.screenshot({ path: `${OUT}/resume-${i}.png` })
    check(`재개 ${i + 1}: 클릭 한 번 뒤 포인터 숨김`, !s.relock && s.centre === 'none' && s.corner === 'none', JSON.stringify({ mid, after: s }))
    if (!refuse) check(`재개 ${i + 1}: 잠금 복구, 안내 없음`, s.locked && !s.hint, JSON.stringify(s))
  }
  // 3) Panel (bag): pointer visible while the panel is open, hidden again after closing.
  await p.keyboard.press('i'); await p.waitForTimeout(700)
  const trail = []
  for (let k = 0; k < 6; k++) { trail.push(await st(p)); await p.waitForTimeout(300) }
  console.log('bag trail', JSON.stringify(trail.map((t) => [t.locked, t.aimClass, t.centre.slice(0, 8), t.menu]), null, 0), await p.evaluate(() => JSON.stringify(window.__slice?.lockState?.())))
  const open = await st(p)
  await p.screenshot({ path: `${OUT}/panel.png` })
  check('가방 열림: 메뉴에서는 포인터가 보인다', open.centre !== 'none' || open.corner !== 'none', JSON.stringify(open))
  await p.keyboard.press('Escape'); await p.waitForTimeout(700)
  s = await st(p)
  if (s.relock) { const bx = await (await p.$('#relock')).boundingBox(); await p.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await p.waitForTimeout(1200) } else if (!s.locked) { await p.mouse.click(640, 400); await p.waitForTimeout(1200) }
  await p.mouse.move(650, 370); await p.waitForTimeout(150)
  s = await st(p)
  check('가방 닫고 계속: 포인터 숨김', s.centre === 'none' && s.corner === 'none', JSON.stringify(s))
  // 4) Lock lost with no button (e.g. focus loss): a key press retries, pointer stays hidden meanwhile.
  await p.evaluate(() => document.exitPointerLock()); await p.waitForTimeout(500)
  const lost = await st(p)
  check('잠금만 풀림: 그래도 포인터 숨김(버튼/안내 중 하나만)', lost.relock || (lost.centre === 'none'), JSON.stringify(lost))
  const lockState = dev ? await p.evaluate(() => window.__slice.lockState?.()) : null
  const fails = res.filter((r) => !r.ok).length
  fs.writeFileSync(`${OUT}/cursor.json`, JSON.stringify({ base: BASE, refuse, dev, res, lockState, events: await p.evaluate(() => window.__pl ?? null) }, null, 1))
  console.log(fails ? `CURSOR_FAIL ${fails}` : `CURSOR_OK ${res.length}`)
  await b.close(); process.exit(fails ? 1 : 0)
})()
