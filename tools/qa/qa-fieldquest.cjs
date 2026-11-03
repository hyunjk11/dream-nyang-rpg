// 몽실 들판 quests: board gating (only after the maze reaches 몽실 마을), real place name, and the
// click-to-track waypoint chip + minimap pin on each leg (island → 몽실 마을 → 몽실 들판). Dev build.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-shots/fieldquest'
require('fs').mkdirSync(OUT, { recursive: true })
const BASE = process.env.BASE || 'http://localhost:4173/dream-nyang-rpg/'
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const res = []
const check = (name, ok, extra = '') => { res.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`) }
;(async () => {
  const b = await chromium.launch({ args: ARGS })
  const p = await (await b.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push(e.message))
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(250) }
  await p.evaluate(() => { const s = window.__slice; for (let k = 0; k < 40 && !s.chapters.guide.done; k++) { const ids = ['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy', 'shop', 'workshop', 'board', 'sewer', 'recall', 'boss']; s.guideHit({ type: ids[s.chapters.guide.step], amount: 999, depth: 1 }) } })
  await p.waitForTimeout(800); await p.click('#chapter-clear-ok').catch(() => {}); await p.waitForTimeout(400)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  const board = () => p.evaluate(() => ({ take: [...document.querySelectorAll('[id^="chapter-take-c2_"]')].map((e) => e.id), text: (document.getElementById('town-panel') || document.body).innerText.match(/[^\n]*몽실 들판[^\n]*/g) || [], oldField: /(^|[^실 ])들판/.test(document.body.innerText.replace(/몽실 들판/g, '')) }))
  // 1) Chapter 2 open, maze not passed: no field quests on the board, a hint instead.
  await p.evaluate(() => window.__slice.townUI.open('board')); await p.waitForTimeout(600)
  let s = await board(); await p.screenshot({ path: `${OUT}/board-before-maze.png` })
  check('미로 전: 게시판에 몽실 들판 퀘스트 없음, 안내 문구', s.take.length === 0 && s.text.length > 0, s)
  await p.evaluate(() => window.__slice.townUI.close()); await p.waitForTimeout(300)
  // 2) Maze passed: quests are offered, take 솜사탕 슬라임 퇴치 with a real click.
  await p.evaluate(() => { const d = window.__slice.dream; d.maze.entered = true; d.maze.passed = true; d.maze.step = 4 })
  await p.evaluate(() => window.__slice.townUI.open('board')); await p.waitForTimeout(600)
  s = await board(); await p.screenshot({ path: `${OUT}/board-after-maze.png` })
  check('미로 후: 몽실 들판 퀘스트 두 개가 게시판에 붙는다', s.take.includes('chapter-take-c2_slime') && s.take.includes('chapter-take-c2_bat'), s)
  check('게시판 문구가 "몽실 들판"을 쓴다(맨 "들판" 없음)', s.text.some((t) => /몽실 마을 별문/.test(t)) && !s.oldField, s.text)
  const tb = await (await p.$('#chapter-take-c2_slime')).boundingBox()
  await p.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2); await p.waitForTimeout(500)
  await p.evaluate(() => window.__slice.townUI.close()); await p.waitForTimeout(600)
  const track = async (leg) => {
    await p.evaluate(() => { window.__slice.setWaypoint(null); window.__slice.paintContracts() }); await p.waitForTimeout(400)
    const row = await p.$('#contract-hud > div[data-id="c2_slime"]')
    if (!row) { check(`${leg}: 퀘스트 줄이 HUD에 있다`, false); return null }
    const rb = await row.boundingBox()
    // The player holds Alt to get a cursor over the HUD, then clicks the quest row.
    await p.keyboard.down('Alt'); await p.waitForTimeout(250)
    await p.mouse.click(rb.x + rb.width / 2, rb.y + rb.height / 2); await p.waitForTimeout(300)
    await p.keyboard.up('Alt'); await p.waitForTimeout(600)
    const w = await p.evaluate(() => ({ wp: window.__slice.waypoint && { label: window.__slice.waypoint.label, goal: window.__slice.waypoint.goal, dots: window.__slice.waypoint.dots }, chip: (document.getElementById('waypoint') || {}).innerText || '', row: (document.querySelector('#contract-hud > div[data-id="c2_slime"]') || {}).innerText || '' }))
    await p.screenshot({ path: `${OUT}/track-${leg}.png` })
    const mm = await p.$('#minimap'); if (mm) await mm.screenshot({ path: `${OUT}/minimap-${leg}.png` })
    return w
  }
  // 3) Island leg.
  let w = await track('island')
  check('섬: 길 안내가 별문 → 몽실 마을 → 몽실 들판', !!w?.wp && /별문 → 몽실 마을 → 몽실 들판/.test(w.wp.label) && !!w.wp.goal && /몽실 들판/.test(w.row), w)
  // 4) 몽실 마을 leg: waypoint points at 몽실 마을's 별문 (minimap pin in the run).
  await p.evaluate(() => window.__slice.enterMongsil()); await p.waitForFunction(() => !window.__slice.travelling && window.__slice.run, null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  w = await track('mongsil')
  check('몽실 마을: 길 안내가 별문 → 몽실 들판, 목표 지점 있음', !!w?.wp && /몽실 마을 별문 → 몽실 들판/.test(w.wp.label) && !!w.wp.goal && w.wp.dots > 0, w)
  // 5) Field leg.
  await p.evaluate(() => window.__slice.enterField()); await p.waitForFunction(() => !window.__slice.travelling && window.__slice.delve && window.__slice.delve.plan.objective === 'field', null, { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(1500)
  w = await track('field')
  check('몽실 들판: 길 안내가 슬라임 쪽을 가리킨다', !!w?.wp && !!w.wp.goal && !/별문/.test(w.wp.label), w)
  check('페이지 오류 없음', errs.length === 0, errs.slice(0, 3))
  const fails = res.filter((r) => !r.ok).length
  console.log(fails ? `FIELDQ_FAIL ${fails}` : `FIELDQ_OK ${res.length}`)
  await b.close(); process.exit(fails ? 1 : 0)
})()
