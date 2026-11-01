// Free-cursor (Alt) and mouse-usability check. HEADED=1 runs on the box display so pointer lock is real.
// Needs a dev build (window.__slice). HEADED=1 with a display gives real pointer lock; headless Chrome refuses it.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-shots'
require('fs').mkdirSync(OUT, { recursive: true })
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const GPU = () => { for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) { const o = C.prototype.getParameter; C.prototype.getParameter = function (k) { if (k === 0x9246) return 'ANGLE (NVIDIA GeForce RTX 3060)'; return o.call(this, k) } } }
const BASE = process.env.BASE || 'http://localhost:4173/dream-nyang-rpg/'
const res = []
const check = (name, ok, extra = '') => { res.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`) }
const st = (p) => p.evaluate(() => ({ alt: document.body.classList.contains('alt-free'), free: document.body.classList.contains('cursor-free'), locked: !!document.pointerLockElement, relock: !document.getElementById('relock').classList.contains('hidden'), fired: window.__slice.shooter.fired, cfree: window.__slice.cursor.free }))
;(async () => {
  const headed = !!process.env.HEADED
  const b = await chromium.launch({ args: ARGS, headless: !headed })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  await p.addInitScript(GPU)
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(300) }
  await p.evaluate(() => { const s = window.__slice; for (let k = 0; k < 40 && !s.chapters.guide.done; k++) { const ids = ['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy', 'shop', 'workshop', 'board', 'sewer', 'recall', 'boss']; s.guideHit({ type: ids[s.chapters.guide.step], amount: 999, depth: 1 }) } })
  await p.waitForTimeout(800); await p.click('#chapter-clear-ok').catch(() => {}); await p.waitForTimeout(400)
  await p.evaluate(() => { window.__altPrevented = []; window.addEventListener('keydown', (e) => { if (e.key === 'Alt') window.__altPrevented.push(e.defaultPrevented) }); window.addEventListener('keyup', (e) => { if (e.key === 'Alt') window.__altPrevented.push(e.defaultPrevented) }) })

  // Take the lock with a real click (headed) / see the headless refusal.
  await p.mouse.click(640, 400); await p.waitForTimeout(500)
  let s = await st(p); console.log('after click', JSON.stringify(s))
  const real = s.locked
  // Alt held → free cursor.
  await p.keyboard.down('Alt'); await p.waitForTimeout(250)
  console.log('raf', await Promise.race([p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r('ticking'))))), new Promise((r) => setTimeout(() => r('STALLED'), 2000))]))
  s = await st(p)
  check('Alt 누르면 커서가 풀린다(alt-free, cursor-free, 잠금 해제)', s.alt && s.free && !s.locked && s.cfree, JSON.stringify(s))
  // Tooltip on hotbar hover.
  const slot = await p.$('#hotbar > *')
  const box = await slot.boundingBox()
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.waitForTimeout(250)
  const tip = await p.evaluate(() => { const t = document.getElementById('tip'); return t && !t.classList.contains('hidden') && getComputedStyle(t).display !== 'none' ? t.innerText : '' })
  check('커서가 풀리면 스킬 칸에 툴팁이 뜬다', tip.length > 0, JSON.stringify(tip.slice(0, 40)))
  await p.screenshot({ path: `${OUT}/cursor_alt_tooltip_1280x720.png` })
  // No firing while free (hold Alt and press the mouse on the world).
  const f0 = (await st(p)).fired
  await p.mouse.move(640, 300); await p.mouse.down(); await p.waitForTimeout(400); await p.mouse.up(); await p.waitForTimeout(200)
  s = await st(p)
  check('커서가 풀린 동안 클릭해도 쏘지 않는다', s.fired === f0, `fired ${f0}→${s.fired}`)
  await p.keyboard.up('Alt'); await p.waitForTimeout(700)
  s = await st(p)
  check('Alt 떼면 커서가 다시 숨는다', !s.alt && !s.cfree, JSON.stringify(s))
  if (real) check('Alt 떼면 시점이 다시 잠기거나 "클릭해서 계속"이 뜬다', s.locked || s.relock, JSON.stringify(s))
  const prevented = await p.evaluate(() => window.__altPrevented)
  check('Alt keydown/keyup 기본 동작을 막는다', prevented.length >= 2 && prevented.every(Boolean), JSON.stringify(prevented))

  // Lock lost without a gesture (Esc / browser refusal) → "클릭해서 계속"; clicking it takes the lock again.
  if (real) {
    await p.evaluate(() => document.exitPointerLock()); await p.waitForTimeout(800)
    s = await st(p); check('잠금이 풀렸는데 다시 못 걸면 "클릭해서 계속" 버튼이 뜬다', s.relock && !s.locked, JSON.stringify(s))
    await p.screenshot({ path: `${OUT}/cursor_relock_1280x720.png` })
    await p.click('#relock', { force: true }); await p.waitForFunction(() => !!document.pointerLockElement && document.getElementById('relock').classList.contains('hidden'), null, { timeout: 8000 }).catch(() => {})
    s = await st(p); check('"클릭해서 계속"을 누르면 다시 잠긴다', s.locked && !s.relock, JSON.stringify(s))
  }
  // Toggle mode in ⚙.
  await p.keyboard.down('Alt'); await p.waitForTimeout(300)
  await p.click('#gear'); await p.waitForTimeout(100); await p.keyboard.up('Alt'); await p.waitForTimeout(300)
  s = await st(p); check('설정 창이 열리면 커서가 자동으로 풀린다', s.cfree && !s.locked, JSON.stringify(s))
  const before = await p.textContent('#alt-mode')
  await p.click('#alt-mode'); await p.waitForTimeout(100)
  const after = await p.textContent('#alt-mode')
  const saved = await p.evaluate(() => localStorage.getItem('dream-nyang-rpg-alt-mode'))
  check('⚙에서 Alt 누르는 동안/전환 모드를 고르고 저장한다', before !== after && saved === 'toggle', `${before} → ${after} (${saved})`)
  await p.screenshot({ path: `${OUT}/cursor_settings_1280x720.png` })
  await p.click('#gear'); await p.waitForTimeout(200)
  await p.keyboard.press('Alt'); await p.waitForTimeout(200)
  const t1 = (await st(p)).alt
  await p.keyboard.press('Alt'); await p.waitForTimeout(200)
  const t2 = (await st(p)).alt
  check('전환 모드: Alt 한 번에 켜지고 다시 누르면 꺼진다', t1 && !t2, `${t1} ${t2}`)

  // Bag: right-click equips, drag and drop equips, hover tips.
  await p.evaluate(() => { const s = window.__slice, save = s.game.save; for (const id of ['hat_beret', 'hat_pin']) { try { save.inventory.push(s.makeItem(id, 'rare', Math.random, 3)) } catch {} } })
  await p.keyboard.press('i'); await p.waitForFunction(() => window.__slice.cursor.free && !document.pointerLockElement, null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(300)
  s = await st(p); check('가방이 열리면 커서가 자동으로 풀린다', s.cfree, JSON.stringify(s))
  const bag = await p.evaluate(() => [...document.querySelectorAll('#inv-grid [data-uid]')].map((e) => e.dataset.uid))
  const worn0 = await p.evaluate(() => JSON.stringify(window.__slice.game.save.equipment))
  if (bag.length) {
    const cell = await p.$(`#inv-grid [data-uid="${bag[0]}"]`)
    const cb = await cell.boundingBox()
    await p.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2); await p.waitForTimeout(250)
    const itip = await p.evaluate(() => document.getElementById('tip')?.innerText || '')
    check('가방 아이템에 마우스를 올리면 정보 툴팁이 뜬다', itip.length > 0, JSON.stringify(itip.split('\n')[0]))
    await p.screenshot({ path: `${OUT}/cursor_bag_tooltip_1280x720.png` })
    await cell.click({ button: 'right' }); await p.waitForTimeout(300)
    const worn1 = await p.evaluate(() => JSON.stringify(window.__slice.game.save.equipment))
    const eq = await p.evaluate((uid) => Object.values(window.__slice.game.save.equipment).includes(uid), bag[0])
    check('가방 아이템 오른쪽 클릭으로 바로 장착', eq && worn1 !== worn0, '')
    // Right-click the worn one again → back to the bag; then drag it onto its slot.
    const slotCell = await p.$(`#inv-slots [data-uid="${bag[0]}"]`)
    if (slotCell) {
      await slotCell.click({ button: 'right' }); await p.waitForTimeout(300)
      const off = await p.evaluate((uid) => !Object.values(window.__slice.game.save.equipment).includes(uid), bag[0])
      check('장착 칸 오른쪽 클릭으로 해제', off)
      const slotName = ''
      const target = await p.evaluate(() => [...document.querySelectorAll('#inv-slots [data-slot]')].map((e) => e.dataset.slot))
      let dropped = false
      for (const sl of target) {
        await p.dragAndDrop(`#inv-grid [data-uid="${bag[0]}"]`, `#inv-slots [data-slot="${sl}"]`).catch(() => {})
        await p.waitForTimeout(200)
        dropped = await p.evaluate((uid) => Object.values(window.__slice.game.save.equipment).includes(uid), bag[0])
        if (dropped) { console.log('dropped on', sl, slotName); break }
      }
      check('가방 아이템을 장착 칸으로 끌어다 놓아 장착', dropped)
    }
  } else check('가방에 아이템이 있다', false)
  await p.keyboard.press('i'); await p.waitForTimeout(300)

  // Sewer: minimap click opens the big map (Alt toggle on → free cursor).
  await p.evaluate(() => window.__slice.enterSewer(1, 1)); await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 })
  await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 }); await p.waitForTimeout(2500)
  await p.keyboard.press('Alt'); await p.waitForFunction(() => window.__slice.cursor.free && !document.pointerLockElement, null, { timeout: 8000 }).catch(() => {})
  const mm = await (await p.$('#minimap')).boundingBox()
  await p.mouse.move(mm.x + mm.width / 2, mm.y + mm.height / 2); await p.waitForTimeout(250)
  await p.screenshot({ path: `${OUT}/cursor_minimap_hover_1280x720.png` })
  await p.mouse.click(mm.x + mm.width / 2, mm.y + mm.height / 2); await p.waitForFunction(() => window.__slice.run.minimap.big, null, { timeout: 8000 }).catch(() => {})
  const big = await p.evaluate(() => window.__slice.run.minimap.big)
  check('미니맵을 클릭하면 큰 지도가 열린다', big)
  await p.screenshot({ path: `${OUT}/cursor_bigmap_1280x720.png` })
  s = await st(p); check('큰 지도가 열려 있으면 커서가 풀려 있다', s.cfree)
  // Quest tracker row click → toast in a run.
  await p.evaluate(() => window.__slice.run.minimap.toggle(false))
  await p.evaluate(() => { const c = window.__slice.chapters; c.quests.c2_slime.status = 'active'; window.__slice.paintContracts() })
  const row = await p.$('#contract-hud .ch')
  if (row) { await row.click(); await p.waitForTimeout(250); const tn = await p.evaluate(() => document.getElementById('toasts').children.length); check('퀘스트 목록 줄을 클릭하면 반응한다(탐험 중 안내 토스트)', tn > 0) }
  await p.screenshot({ path: `${OUT}/cursor_sewer_free_1280x720.png` })
  await b.close()
  const fail = res.filter((r) => !r.ok).length
  console.log(`CURSOR CHECKS ${res.length} FAIL ${fail} (real pointer lock: ${real})`)
  process.exit(fail ? 1 : 0)
})()
