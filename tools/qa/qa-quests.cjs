// Quest QA: chapter gating + the quest HUD / log / toasts, before vs after.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5195/dream-nyang-rpg/ OUT=dir TAG=after [VPS=1280x720,390x844] node tools/qa/qa-quests.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-quests-out'
const TAG = process.env.TAG || 'after'
const VPS = (process.env.VPS || '1280x720,390x844').split(',').map((s) => s.split('x').map(Number))
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
;(async () => {
  const b = await chromium.launch({ args: ARGS })
  let fails = 0
  for (const [w, h] of VPS) {
    const vp = `${w}x${h}`
    const touch = w < 700
    const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch })
    const p = await ctx.newPage()
    const errs = []
    p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
    const note = (check, ok, info) => { if (!ok) fails++; console.log(JSON.stringify({ vp, tag: TAG, check, ok, info })) }
    const shot = (name) => p.screenshot({ path: `${OUT}/${vp}-${TAG}-${name}.png` })
    // What the HUD shows about quests right now.
    const hud = () => p.evaluate(() => {
      const vis = (el) => !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0
      const ch = document.getElementById('contract-hud')
      const rows = ch ? [...ch.querySelectorAll(':scope > div')].map((r) => r.textContent.trim()) : []
      const tr = document.getElementById('tracker')
      return { rows, hudShown: vis(ch), tracker: vis(tr) ? tr.textContent.trim() : '', guideChip: vis(document.getElementById('guide-chip')), toasts: document.querySelectorAll('#toasts .toast').length }
    })
    await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
    await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
    await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(2000)
    for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(300) }
    await p.waitForTimeout(1200)
    // 1. Fresh chapter 1: nothing from chapter 2 anywhere.
    let s = await hud()
    await shot('ch1-fresh')
    const c2 = (rows) => rows.filter((r) => /모찌 ·|미로|이야기 ·|몽이|챕터 2|들판/.test(r))
    note('ch1_fresh_no_ch2', c2(s.rows).length === 0, s)
    // 2. Mid chapter 1 (guide at step 7) with two board bounties taken; early legacy chapter-2 state planted.
    await p.evaluate(() => {
      const sl = window.__slice, c = sl.chapters
      const ids = ['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy']
      for (const id of ids) sl.guideHit({ type: id, amount: 999 })
      c.quests.c2_slime.status = 'active'; c.quests.c2_slime.progress = 3
      sl.townUI.open('board')
    })
    await p.waitForTimeout(500)
    const takeCh2 = await p.evaluate(() => document.querySelectorAll('[id^="chapter-take-"]').length)
    for (const id of ['#board-take-0', '#board-take-1']) if (await p.$(id)) { await p.click(id); await p.waitForTimeout(200) }
    await p.evaluate(() => { window.__slice.townUI.close(); window.__slice.paintContracts() })
    await p.waitForTimeout(600)
    s = await hud()
    await shot('ch1-mid')
    note('ch1_mid_no_ch2', c2(s.rows).length === 0 && takeCh2 === 0, { ...s, takeCh2 })
    // 3. Busy chapter 2: guide done, maze passed, 몽이 s1 on, field quests, bounties.
    await p.evaluate(() => {
      const sl = window.__slice, c = sl.chapters, d = sl.dream
      c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = 2; c.card = 0
      d.maze.entered = true; d.maze.passed = true; d.maze.step = 4; d.story.state = 'active'; d.story.count = 2
      c.quests.c2_slime.status = 'active'; c.quests.c2_slime.progress = 4; c.quests.c2_bat.status = 'done'
      sl.paintContracts()
    })
    await p.waitForTimeout(800)
    s = await hud()
    await shot('ch2-busy')
    note('ch2_hud_rows', s.rows.length > 0, s)
    if (touch) { await p.evaluate(() => document.getElementById('quest-chip')?.click()); await p.waitForTimeout(400); await shot('ch2-busy-open'); await p.evaluate(() => document.getElementById('quest-chip')?.click()) }
    // 4. Quest log.
    const hasLog = await p.evaluate(() => !!window.__slice.questLog)
    if (hasLog) await p.evaluate(() => window.__slice.questLog())
    else { await p.evaluate(() => window.__slice.townUI.open('board')); await p.waitForTimeout(400); await p.click('#board-story') }
    await p.waitForTimeout(700)
    await shot('quest-log')
    const log = await p.evaluate(() => ({ tabs: document.querySelectorAll('#quest-log [role="tab"]').length, items: document.querySelectorAll('#quest-body article').length, collapsed: document.querySelectorAll('#quest-body details:not([open])').length }))
    note('quest_log', true, log)
    await p.keyboard.press('Escape'); await p.waitForTimeout(400)
    // 5. Four completions at once.
    await p.evaluate(() => { const sl = window.__slice; for (const t of ['퀘스트 완료! 솜사탕 슬라임 퇴치 · 마을 게시판에서 보상 받기', '의뢰 완료! 마을 게시판에서 보상을 받아.', '의뢰 완료! 마을 게시판에서 보상을 받아.', '모찌 퀘스트 완료! 꿈 조각 찾기']) sl.toast(t, 'quest') })
    await p.waitForTimeout(350)
    s = await hud()
    await shot('toasts')
    note('toasts_stack', true, { toasts: s.toasts })
    note('no_errors', errs.length === 0, errs.slice(0, 5))
    await ctx.close()
  }
  await b.close()
  console.log(fails ? `QUESTS_FAIL ${fails}` : 'QUESTS_OK')
})()
