// 퀘스트 2 + 포털 QA: four story points (1장 시작, 미로 뒤, 몽실, 3장) → HUD + 수첩; portal menus at each point.
// Usage: PLAYWRIGHT=… BASE=… OUT=dir POUT=dir TAG=after node tools/qa/qa-quests2.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-quests2'
const POUT = process.env.POUT || OUT
const TAG = process.env.TAG || 'after'
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(POUT, { recursive: true })
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
;(async () => {
  const b = await chromium.launch({ args: ARGS })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
  const out = { quests: {}, portals: {} }
  await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(2000)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(300) }
  const state = async () => p.evaluate(() => {
    const rows = [...document.querySelectorAll('#contract-hud > div.q')].map((r) => r.textContent.trim())
    const book = window.__slice.questBook().map((q) => `[${q.group}] ${q.title} | ${q.area ?? '-'} | ${q.line}`)
    return { rows, book }
  })
  const portal = async (name, which) => {
    if (which === 'island') { await p.evaluate(() => { if (window.__slice.game.zone !== 'village') window.__slice.enterZone('village') }); await p.waitForTimeout(1200) }
    await p.evaluate((w) => { const sl = window.__slice; sl.talk.close(); sl.talk.start(w === 'mongsil' && sl.mongsilGate ? sl.mongsilGate() : sl.gateTalk()) }, which)
    await p.waitForTimeout(700)
    for (let i = 0; i < 4 && !(await p.$$('#dlg-choices button')).length; i++) { await p.keyboard.press('Enter'); await p.waitForTimeout(500) }
    const rows = await p.evaluate(() => [...document.querySelectorAll('#dlg-choices button')].map((x) => (x.classList.contains('locked') ? '[잠김] ' : '') + x.textContent.trim()))
    out.portals[name] = rows
    await p.screenshot({ path: `${POUT}/${TAG}-${name}.png` })
    await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(300)
  }
  const stage = async (name) => {
    await p.evaluate(() => window.__slice.paintContracts()); await p.waitForTimeout(600)
    out.quests[name] = await state()
    await p.screenshot({ path: `${OUT}/${TAG}-${name}-hud.png` })
    await p.evaluate(() => window.__slice.questLog('main')); await p.waitForTimeout(600)
    await p.screenshot({ path: `${OUT}/${TAG}-${name}-log.png` })
    await p.evaluate(() => window.__slice.questLog('bounty')); await p.waitForTimeout(500)
    await p.screenshot({ path: `${OUT}/${TAG}-${name}-log-bounty.png` })
    await p.keyboard.press('Escape'); await p.waitForTimeout(400)
  }
  await stage('1-ch1-start')
  await portal('ch1-island-gate', 'island')
  await p.evaluate(() => {
    const sl = window.__slice, c = sl.chapters, d = sl.dream
    c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; c.card = 0
    d.maze.entered = true; d.maze.passed = true; d.maze.step = 4
  })
  await stage('2-after-maze')
  await portal('ch2-island-gate', 'island')
  await p.evaluate(() => {
    const sl = window.__slice, c = sl.chapters, d = sl.dream
    d.story.state = 'active'; d.story.count = 2
    c.quests.c2_slime.status = 'active'; c.quests.c2_slime.progress = 4; c.quests.c2_bat.status = 'active'
    const t = sl.townOf(sl.game.save); if (t.contracts && t.contracts[0]) t.contracts[0].status = 'active'
  })
  await stage('3-mongsil')
  await portal('ch2-mongsil-gate', 'mongsil')
  await p.evaluate(() => {
    const sl = window.__slice, c = sl.chapters, d = sl.dream
    d.story.step = 4; d.story.done = true; d.story.state = 'active'; c.current = 3; if (!c.cleared.includes(2)) c.cleared.push(2)
  })
  await stage('4-ch3')
  await portal('ch3-mongsil-gate', 'mongsil')
  out.errors = errs
  fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
  await b.close()
})()
