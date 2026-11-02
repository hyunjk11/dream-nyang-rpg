// 던전 유지 QA: recall / fall / reload all come back to the same floor state through the return portal.
// Usage: PLAYWRIGHT=… BASE=http://localhost:5181/dream-nyang-rpg/ OUT=dir [VP=1280x720] [FLOOR=1:2] node tools/qa/qa-persist.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const OUT = process.env.OUT || 'qa-persist-out'
const [vw, vh] = (process.env.VP || '1280x720').split('x').map(Number)
const [D, F] = (process.env.FLOOR || '1:2').split(':').map(Number)
const SEED = process.env.SEED === 'none' ? null : Number(process.env.SEED || 3)
;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await b.newContext({ viewport: { width: vw, height: vh } })
  const p = await ctx.newPage()
  const errs = []
  p.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message))
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
  const fails = []
  const check = (name, ok, info) => { console.log(JSON.stringify({ check: name, ok, info })); if (!ok) fails.push(name) }
  const settle = () => p.waitForFunction(() => !document.getElementById('fade').classList.contains('on') && !window.__slice.run?.parked, null, { timeout: 60000 })
  const inRun = async () => { await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 }); await settle(); await p.waitForTimeout(1200) }
  const inTown = async () => { await p.waitForFunction(() => !window.__slice.run, null, { timeout: 60000 }); await p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 }); await p.waitForTimeout(800) }
  const closeCards = () => p.evaluate(() => { for (const id of ['summary', 'down']) document.getElementById(id)?.classList.add('hidden'); document.querySelector('#summary button')?.click(); window.__slice.talk.close() })
  const view = () => p.evaluate(() => {
    const r = window.__slice.run
    const pos = window.__slice.hero.object.position
    return { foes: r.horde.foes.filter((f) => f.id <= 999 && f.dying <= 0).map((f) => f.id).sort((a, b) => a - b).join(','), opened: r.chests.filter((c) => c.chest.opened).length, key: !!r.explore?.hasKey, doors: !!r.explore?.doorsOpen, x: +pos.x.toFixed(1), z: +pos.z.toFixed(1), seen: Array.from(r.minimap.seen).reduce((a, v) => a + v, 0), depth: r.plan.depth, floor: r.plan.floor, seed: r.plan.seed, initial: r.initialFoes, salt: window.__slice.delve?.salt }
  })
  await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.goto(process.env.BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(200) }
  await p.evaluate(([d, f, seed]) => { const sv = window.__slice.game.save; sv.delve = { unlocked: 1, cleared: 0, checkpoint: null, runs: 0, open: null, ...(sv.delve || {}) }; sv.delve.unlocked = Math.max(sv.delve.unlocked, d); if (seed === null) window.__slice.enterSewer(d, f); else window.__slice.enterSewer(d, f, seed) }, [D, F, SEED])
  await inRun()
  // Change the floor: kill 3 foes, open a chest, take the key + doors, walk somewhere.
  await p.evaluate(async () => {
    const s = window.__slice, r = s.run
    for (const f of r.horde.foes.slice(0, 3)) r.horde.damage(f, 1e9)
    const c = r.chests.find((k) => k.chest.group.visible)
    if (c) { s.hero.object.position.set(c.chest.group.position.x, 0, c.chest.group.position.z); r.openLoot() }
    if (r.explore) { r.explore.hasKey = true }
    const m = r.maze, T = 3.4
    const t = m.start ?? { x: 1, y: 1 }
    s.hero.object.position.set((t.x - m.w / 2 + 0.5) * T + 0.6, 0, (t.y - m.h / 2 + 0.5) * T + 0.4)
  })
  await p.waitForTimeout(2500)
  const before = await view()
  await p.screenshot({ path: `${OUT}/persist-${D}-${F}-before.png` })
  // 1) Recall → town → return portal.
  await p.evaluate(() => window.__slice.leaveSewer('recall'))
  await inTown(); await closeCards()
  const portal1 = await p.evaluate(() => ({ active: window.__slice.returnPortal.active, kept: !!window.__slice.keptFloor, parked: window.__slice.parked }))
  check('귀환 후 돌아가기 포털', portal1.active && portal1.kept && !!portal1.parked, portal1)
  await p.screenshot({ path: `${OUT}/persist-${D}-${F}-town-portal.png` })
  await p.evaluate(() => window.__slice.returnThrough())
  await inRun()
  const back1 = await view()
  check('귀환 → 같은 층·같은 적·같은 상자·같은 자리', back1.foes === before.foes && back1.opened === before.opened && back1.key === before.key && Math.hypot(back1.x - before.x, back1.z - before.z) < 1.5, { before, back1 })
  // 2) Fall → town → return portal.
  await p.evaluate(() => { const s = window.__slice, h = s.hero; h.iframes = 0; s.run.host.hurt(1e9, h.object.position.clone().setX(h.object.position.x + 0.5)) })
  await p.waitForTimeout(500)
  await p.evaluate(() => { document.getElementById('retry')?.click() })
  await inTown(); await closeCards()
  const portal2 = await p.evaluate(() => ({ active: window.__slice.returnPortal.active, kept: !!window.__slice.keptFloor }))
  check('쓰러진 뒤에도 돌아가기 포털', portal2.active && portal2.kept, portal2)
  // 3) Reload the page → resume → portal from the save → same floor.
  await p.reload()
  await p.waitForFunction(() => !document.getElementById('btn-continue').disabled, null, { timeout: 120000 })
  await p.click('#btn-continue')
  await p.waitForTimeout(2500); await closeCards()
  const portal3 = await p.evaluate(() => ({ active: window.__slice.returnPortal.active, kept: window.__slice.keptFloor && { d: window.__slice.keptFloor.depth, f: window.__slice.keptFloor.floor, dead: window.__slice.keptFloor.dead.length }, parked: window.__slice.parked }))
  check('새로고침 후에도 저장된 층으로 포털', portal3.active && !!portal3.kept && !portal3.parked, portal3)
  await p.evaluate(() => window.__slice.returnThrough())
  await inRun()
  const back3 = await view()
  await p.screenshot({ path: `${OUT}/persist-${D}-${F}-after-reload.png` })
  check('새로고침 → 같은 층 복원', back3.depth === before.depth && back3.floor === before.floor && back3.foes === before.foes && back3.opened === before.opened && back3.key === before.key && back3.seen >= Math.min(before.seen, 1), { before, back3 })
  check('콘솔 오류 없음', errs.length === 0, errs.slice(0, 5))
  console.log(fails.length ? `PERSIST_FAILS ${fails.length}: ${fails.join(' | ')}` : 'PERSIST_OK')
  await b.close()
  process.exit(fails.length ? 1 : 0)
})()
