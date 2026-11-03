// HUD layout audit: collect rects of visible HUD pieces per scene and fail on overlaps / off-screen,
// on anything inside the crosshair keep-out (AIM) and on guide fold checks (auto-collapse, chip, J, X, combat).
// Run against a dev build (needs window.__slice): NODE_ENV=development npx vite build --mode development && npx vite preview; then node tools/qa/qa-hud.cjs
// (PLAYWRIGHT=path to the playwright module, BASE=url, VP=1280x720,360x640 to pick viewports, OUT=folder).
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const OUT = process.env.OUT || 'qa-shots'
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
const GPU = () => { for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) { const o = C.prototype.getParameter; C.prototype.getParameter = function (k) { if (k === 0x9246) return 'ANGLE (NVIDIA GeForce RTX 3060)'; return o.call(this, k) } } }
const BASE = process.env.BASE || 'http://localhost:4173/dream-nyang-rpg/'
const VIEWPORTS = [
  ['1920x1080', 1920, 1080, false], ['1280x720', 1280, 720, false], ['656x484', 656, 484, false],
  ['390x844', 390, 844, true], ['844x390', 844, 390, true], ['360x640', 360, 640, true], ['768x1024', 768, 1024, true],
].filter(([n]) => !process.env.VP || process.env.VP.split(',').includes(n))
const HUD = ['.top', '#tracker', '#delve', '#wave', '#bossbar', '#zone-banner', '#levelup', '#guide', '#guide-chip', '#note', '#toasts', '#minimap', '#contract-hud', '#loot-toasts', '#hud-pocket > *', '#stick', '#hotbar > *', '#actions > button', '#hint', '#relock', '#dialog', '.foe-arrow']
const PANELS = { bag: '#inv .inv-card', shop: '#town .inv-card, #town .town-card', workshop: '#town .inv-card, #town .town-card', board: '#town .inv-card, #town .town-card', stash: '#town .inv-card, #town .town-card', settings: '#settings', help: '#help .help-card', summary: '#summary .card', clear: '.chapter-box', bigmap: '#minimap.big' }
const log = (...a) => console.log(...a)
const report = { overlaps: [], offscreen: [], aim: [], panels: [], checks: [], scenes: 0 }
/** Crosshair keep-out (same formula as src/ui/layout.ts aimZone). */
function aimZone(w, h) { const hw = Math.min(150, Math.max(56, w * 0.12)), hh = Math.min(100, Math.max(40, h * 0.1)); return { id: 'AIM', x: w / 2 - hw, y: h / 2 - hh, w: hw * 2, h: hh * 2 } }
/** Not aiming while these are up (talk box, "click to continue" prompt). */
const AIM_EXEMPT = /^#(dialog|relock|minimap\.big|map-legend)/
async function check(p, vp, name, fn, want) {
  const got = await p.evaluate(fn)
  const ok = got === want
  report.checks.push({ vp, name, ok, got, want })
  log(`${vp} check ${name}: ${ok ? 'ok' : 'FAIL'} (got ${got}, want ${want})`)
}

async function boot(b, w, h, touch) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  p.on('pageerror', (e) => log('PAGEERROR', e.message))
  await p.addInitScript(GPU)
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(600); await p.keyboard.press('Escape'); await p.waitForTimeout(1500)
  for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__slice.talk.close()); await p.waitForTimeout(300) }
  return p
}
const ready = (p) => p.waitForFunction(() => !document.getElementById('fade').classList.contains('on'), null, { timeout: 60000 })
/** Visible HUD rects. */
const rects = (p, sels) => p.evaluate((sels) => {
  const out = []
  for (const sel of sels) document.querySelectorAll(sel).forEach((el, i) => {
    let n = el, vis = true
    while (n && n !== document.body) { const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) { vis = false; break } n = n.parentElement }
    if (!vis) return
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return
    const pop = el.id === 'contract-hud' && getComputedStyle(el).position === 'absolute'
    out.push({ pop, id: sel + (pop ? '(popover)' : '') + (i ? `#${i}` : ''), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) })
  })
  return out
}, sels)
function audit(vp, scene, rs, w, h) {
  report.scenes++
  const bad = []
  for (const r of rs) if (r.x < -1 || r.y < -1 || r.x + r.w > w + 1 || r.y + r.h > h + 1) { bad.push(`OFF ${r.id}`); report.offscreen.push({ vp, scene, id: r.id, r }) }
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], c = rs[j]
    if (a.pop || c.pop) continue // a menu the player opened on purpose drops over the view
    const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x), oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y)
    if (ox > 2 && oy > 2) { bad.push(`${a.id} × ${c.id} (${ox}×${oy})`); report.overlaps.push({ vp, scene, a: a.id, b: c.id, ox, oy, ra: a, rb: c }) }
  }
  const az = aimZone(w, h)
  for (const r of rs) {
    if (AIM_EXEMPT.test(r.id)) continue
    const ox = Math.min(r.x + r.w, az.x + az.w) - Math.max(r.x, az.x), oy = Math.min(r.y + r.h, az.y + az.h) - Math.max(r.y, az.y)
    if (ox > 0 && oy > 0) { bad.push(`${r.id} × AIM (${Math.round(ox)}×${Math.round(oy)})`); report.aim.push({ vp, scene, id: r.id, r, az }) }
  }
  log(`${vp} ${scene}: ${rs.length} pieces [${rs.map((r) => r.id.replace(/^[#.]/, "")).join(" ")}] ${bad.length ? 'FAIL ' + bad.join(', ') : 'ok'}`)
}
async function scene(p, vp, name, w, h) {
  await p.waitForTimeout(450)
  audit(vp, name, await rects(p, HUD), w, h)
  await p.screenshot({ path: `${OUT}/${name}_${vp}.png`, timeout: 120000 })
}
/** A panel: fits the view, and scrolls when its content is taller. */
async function panel(p, vp, name, sel, w, h) {
  await p.waitForTimeout(350)
  const info = await p.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 0)
    if (!el) return null
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
    return { x: r.left, y: r.top, w: r.width, h: r.height, sh: el.scrollHeight, ch: el.clientHeight, ov: cs.overflowY }
  }, sel)
  const fits = info && info.x >= -1 && info.y >= -1 && info.x + info.w <= w + 1 && info.y + info.h <= h + 1
  const scrolls = info && (info.sh <= info.ch + 2 || info.ov === 'auto' || info.ov === 'scroll')
  const ok = !!(fits && scrolls)
  report.panels.push({ vp, name, ok, info })
  log(`${vp} panel ${name}: ${ok ? 'ok' : 'FAIL'} ${JSON.stringify(info)}`)
  await p.screenshot({ path: `${OUT}/panel_${name}_${vp}.png`, timeout: 120000 })
}
const fast = (p, upto) => p.evaluate((upto) => { const s = window.__slice; for (let k = 0; k < 40; k++) { const c = s.chapters; if (c.guide.done || c.guide.step >= upto) break; const ids = ['move', 'shoot', 'dash', 'kill', 'skill', 'equip', 'candy', 'shop', 'workshop', 'board', 'sewer', 'recall', 'boss']; s.guideHit({ type: ids[c.guide.step], amount: 999, depth: 1 }) } }, upto)
const quests = (p) => p.evaluate(() => { const s = window.__slice, c = s.chapters; c.quests.c2_slime.status = 'active'; c.quests.c2_bat.status = 'active'; c.quests.c2_named.status = 'active'; c.quests.c2_fluff.status = 'done'; s.paintContracts() })
const noise = (p) => p.evaluate(() => { const s = window.__slice; s.toast('퀘스트 진행! 솜사탕 슬라임 3/12', 'quest'); s.toast('하트 사탕을 챙겼어', 'reward'); const it = s.makeItem ? null : null; s.chapterUI.say('모찌', '여기서 꾹 참고 쏘는 거다냥!') })
const loot = (p) => p.evaluate(() => { const s = window.__slice; const el = document.getElementById('loot-toasts'); const d = document.createElement('div'); d.className = 'loot-toast r-rare'; d.style.setProperty('--rar', '#4aa8ff'); d.innerHTML = '<b>반짝이는 별 물총</b><small>희귀 · 파워 42</small><button class="quick" type="button">장착 (G)</button>'; el.append(d) })

;(async () => {
  const b = await chromium.launch({ args: ARGS })
  for (const [vp, w, h, touch] of VIEWPORTS) {
    const p = await boot(b, w, h, touch)
    // Town, guide active, toasts and a loot card.
    await fast(p, 5); await p.waitForTimeout(400)
    await check(p, vp, 'new_step_full', () => window.__slice.guideView, 'full')
    await scene(p, vp, 'guide_full', w, h)
    await p.waitForTimeout(5000)
    await check(p, vp, 'auto_collapse_5s', () => window.__slice.guideView, 'chip')
    await scene(p, vp, 'guide_chip', w, h)
    await p.click('#quest-main')
    await check(p, vp, 'chip_click_expands', () => window.__slice.guideView, 'full')
    await p.keyboard.press('KeyJ')
    await check(p, vp, 'J_collapses', () => window.__slice.guideView, 'chip')
    await p.keyboard.press('KeyJ')
    await check(p, vp, 'J_expands', () => window.__slice.guideView, 'full')
    await p.click('#guide .guide-x')
    await check(p, vp, 'X_hides', () => window.__slice.guideView, 'off')
    await scene(p, vp, 'guide_hidden', w, h)
    await p.keyboard.press('KeyJ')
    await noise(p); await loot(p)
    await scene(p, vp, 'town_guide', w, h)
    // Town, guide on + chapter quests on (worst case for the right column).
    await quests(p); await p.evaluate(() => window.__slice.paintContracts())
    await scene(p, vp, 'town_quests', w, h)
    if (touch || w <= 900) { await p.evaluate(() => document.getElementById('quest-chip')?.click()); await scene(p, vp, 'town_quests_open', w, h); await p.evaluate(() => document.getElementById('quest-chip')?.click()) }
    // Panels in town.
    for (const t of ['shop', 'workshop', 'board', 'stash']) { await p.evaluate((t) => window.__slice.openTown(t), t); await panel(p, vp, t, PANELS[t], w, h); await p.evaluate(() => window.__slice.townUI.close()) }
    await p.evaluate(() => window.__slice.inventory.open('bag')); await panel(p, vp, 'bag', PANELS.bag, w, h)
    await p.evaluate(() => window.__slice.inventory.open('skills')); await panel(p, vp, 'skills', PANELS.bag, w, h); await p.evaluate(() => window.__slice.inventory.close())
    await p.evaluate(() => window.__slice.help.toggle(true)); await panel(p, vp, 'help', PANELS.help, w, h); await p.evaluate(() => window.__slice.help.toggle(false))
    await p.click('#gear'); await panel(p, vp, 'settings', PANELS.settings, w, h); await p.click('#gear')
    // Sewer: guide (recall step), quests, minimap, delve, wave.
    await fast(p, 11)
    await p.evaluate(() => window.__slice.enterSewer(1, 1)); await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 }); await ready(p); await p.waitForTimeout(3200)
    await quests(p); await noise(p); await loot(p)
    await scene(p, vp, 'sewer_guide', w, h)
    // Boss bar + floor banner + level-up + off-screen arrows.
    await p.evaluate(() => { const r = window.__slice.run; document.getElementById('bossbar')?.classList.remove('hidden'); window.__slice.zoneBanner('깊이 1 · 2층', '악몽 꽃이 기다려'); const P = window.__slice.hero.object.position; const yaw = r.view.yaw; let k = 0; for (const f of r.horde.foes) { if (k > 3) break; const a = yaw + Math.PI + (k - 1.5) * 0.7; f.x = P.x + Math.sin(a) * 6; f.z = P.z + Math.cos(a) * 6; f.mode = 'chase'; k++ } })
    await p.waitForTimeout(700)
    await scene(p, vp, 'sewer_boss', w, h)
    // The user's case: step 13/13 (악몽 꽃) in the sewer. A new step mid-fight stays folded.
    await fast(p, 12); await p.waitForTimeout(300)
    await check(p, vp, 'combat_new_step_folded', () => window.__slice.guideView, 'chip')
    await scene(p, vp, 'guide_combat', w, h)
    await p.keyboard.press('KeyJ'); await p.waitForTimeout(100)
    await check(p, vp, 'J_in_combat', () => window.__slice.guideView, 'full')
    await scene(p, vp, 'guide_combat_open', w, h)
    // Fight over (foes sent away): the owed card opens, then folds again.
    await p.evaluate(() => { const r = window.__slice.run; const P = window.__slice.hero.object.position; for (const f of r.horde.foes) { f.mode = 'idle'; f.x = P.x + 200; f.z = P.z + 200 } })
    await p.evaluate(() => window.__slice.guideFold('full'))
    await scene(p, vp, 'sewer_guide13_full', w, h)
    await p.evaluate(() => window.__slice.guideFold('chip'))
    await scene(p, vp, 'sewer_guide13_chip', w, h)
    await p.evaluate(() => window.__slice.run.minimap.toggle(true)); await panel(p, vp, 'bigmap', PANELS.bigmap, w, h)
    const legend = await rects(p, ['#map-legend', '#minimap.big'])
    if (legend.length === 2) audit(vp, 'bigmap', legend, w, h)
    await p.evaluate(() => window.__slice.run.minimap.toggle(false))
    await p.evaluate(() => window.__slice.leaveSewer('recall')); await p.waitForFunction(() => !window.__slice.run, null, { timeout: 20000 }); await ready(p); await p.waitForTimeout(600)
    await panel(p, vp, 'summary', PANELS.summary, w, h)
    await p.evaluate(() => document.getElementById('summary-close')?.click()); await p.waitForTimeout(300)
    // Guide done → chapter clear card.
    await fast(p, 99); await p.waitForSelector('#chapter-clear', { timeout: 8000 }).catch(() => {}); await panel(p, vp, 'clear', PANELS.clear, w, h)
    await p.click('#chapter-clear-ok').catch(() => {}); await p.waitForTimeout(300)
    // Field with quests, named foe, toasts.
    await quests(p)
    await p.evaluate(() => window.__slice.enterField()); await p.waitForFunction(() => window.__slice.run, null, { timeout: 60000 }); await ready(p); await p.waitForTimeout(3200)
    await noise(p); await loot(p)
    await scene(p, vp, 'field', w, h)
    // Talk dialog over the HUD (town).
    await p.evaluate(() => window.__slice.leaveSewer('recall')); await p.waitForFunction(() => !window.__slice.run, null, { timeout: 20000 }); await ready(p); await p.waitForTimeout(500)
    await p.evaluate(() => document.getElementById('summary-close')?.click()); await p.waitForTimeout(300)
    await p.evaluate(() => { const s = window.__slice; s.talk.start(s.gateTalk()) })
    await p.waitForTimeout(300)
    await scene(p, vp, 'town_talk', w, h)
    await p.context().close()
  }
  await b.close()
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(`${OUT}/report-${(process.env.VP || 'all').replace(/,/g, '_')}.json`, JSON.stringify(report, null, 1))
  const pf = report.panels.filter((x) => !x.ok).length
  const cf = report.checks.filter((x) => !x.ok).length
  log(`SCENES ${report.scenes} OVERLAPS ${report.overlaps.length} AIM ${report.aim.length} OFFSCREEN ${report.offscreen.length} PANEL_FAILS ${pf} CHECK_FAILS ${cf}/${report.checks.length}`)
  process.exit(report.overlaps.length + report.aim.length + report.offscreen.length + pf + cf ? 1 : 0)
})()
