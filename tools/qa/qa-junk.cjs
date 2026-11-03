// 잡동사니 판매 with parts: loose common/uncommon parts sell, socketed / rare / 특수 parts stay.
// Real 'i' key opens the bag, a real mouse click on #inv-junk sells. Dev build (window.__slice).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-shots/junk'
require('fs').mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE || 'http://localhost:4173/dream-nyang-rpg/'
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const res = []
const check = (name, ok, extra = '') => { res.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`) }
;(async () => {
  const b = await chromium.launch({ args: ARGS })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
  await ctx.addInitScript(() => { Element.prototype.requestPointerLock = function () { return Promise.reject(new Error('qa')) } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  const setup = await p.evaluate(() => {
    const s = window.__slice; const save = s.game.save
    const gun = save.items.find((i) => i.uid === save.equipment.weapon)
    const mk = (id, r) => s.makeMod(id, r, 5)
    const socketed = mk('mod_barrel', 'common'); gun.mods = [...(gun.mods || []), socketed]
    const loose = [mk('mod_scope', 'common'), mk('mod_mag', 'uncommon'), mk('mod_chip_ice', 'common')]
    const rare = mk('mod_barrel', 'rare'); const trick = mk('mod_trick_star', 'common')
    save.items.push(...loose, rare, trick)
    return { gun: gun.uid, socketed: socketed.uid, loose: loose.map((m) => m.uid), keep: [rare.uid, trick.uid], gold: save.gold }
  })
  await p.keyboard.press('i'); await p.waitForTimeout(800)
  const btn = await p.$('#inv-junk')
  const label = btn ? await btn.innerText() : ''
  await p.screenshot({ path: `${OUT}/bag-before.png` })
  check('가방 잡동사니 버튼이 부품 수까지 센다', /잡동사니 판매 [3-9]개/.test(label), label)
  const bb = await btn.boundingBox()
  await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.waitForTimeout(600)
  const after = await p.evaluate((st) => {
    const save = window.__slice.game.save
    const has = (uid) => save.items.some((i) => i.uid === uid)
    const gun = save.items.find((i) => i.uid === st.gun)
    return { gold: save.gold, looseLeft: st.loose.filter(has).length, keepLeft: st.keep.filter(has).length, socketed: !!(gun && (gun.mods || []).some((m) => m.uid === st.socketed)), toasts: [...document.querySelectorAll('#toasts .toast')].map((t) => t.textContent) }
  }, setup)
  await p.screenshot({ path: `${OUT}/bag-after.png` })
  const t = after.toasts.find((x) => /잡동사니 판매/.test(x)) || ''
  check('느슨한 일반·고급 부품 3개가 팔렸다', after.looseLeft === 0, after)
  check('희귀 부품·특수 부품은 남는다', after.keepLeft === 2, after)
  check('총에 낀 부품은 그대로 총에 있다', after.socketed, after)
  check('골드가 올랐다', after.gold > setup.gold, { before: setup.gold, after: after.gold })
  check('토스트에 부품 3개와 골드가 나온다', /부품 3개/.test(t) && new RegExp(`\\+${after.gold - setup.gold} 골드`).test(t), t)
  check('페이지 오류 없음', errs.length === 0, errs.slice(0, 3))
  const fails = res.filter((r) => !r.ok).length
  console.log(fails ? `JUNK_FAIL ${fails}` : `JUNK_OK ${res.length}`)
  await b.close(); process.exit(fails ? 1 : 0)
})()
