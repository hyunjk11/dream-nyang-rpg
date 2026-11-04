// 스킬 화면 깨짐 재현 (real render path): desktop composer forced (GPU name hidden), DPR 2, adaptive
// quality locked at the top tier (bloom ON). Real keys 1–4 cast every skill again and again: in the
// open, point-blank (a foe pulled onto the hero), face-to-wall and looking at the floor — in 몽실 마을,
// 몽실 들판, 꿈 미로, sewer floor and the boss floor. Per scene: frame detector (black/white blocks,
// central 50% region; "partial" = ≥25%) and a raw HDR scan of the scene buffer before the sanitize
// pass (NaN / Inf / max / pixels over 4 and 24). Dev builds only (window.__slice).
// Usage: PLAYWRIGHT=… BASE=… OUT=dir [SCENES=mongsil,field,maze,sewer,boss] [ROUNDS=6] [DPR=2] node tools/qa/qa-skillglitch.cjs
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright')
const fs = require('fs')
const BASE = process.env.BASE || 'http://localhost:5199/dream-nyang-rpg/'
const OUT = process.env.OUT || '/workspace/polish/qa/skillglitch/run'
const SCENES = (process.env.SCENES || 'mongsil,field,maze,sewer,boss').split(',')
const ROUNDS = +(process.env.ROUNDS || 6)
const DPR = +(process.env.DPR || 2)
fs.mkdirSync(OUT, { recursive: true })

function detector() {
  window.__glitch = { frames: 0, black: 0, white: 0, pblack: 0, pwhite: 0, maxBlack: 0, maxWhite: 0, shots: [], tag: '' }
  const S = document.createElement('canvas'); S.width = 48; S.height = 27
  const sx = S.getContext('2d', { willReadFrequently: true })
  const tick = () => {
    requestAnimationFrame(tick)
    const c = document.getElementById('view')
    const g = window.__glitch
    if (!c || !c.width || document.body.classList.contains('travelling') || !window.__glitchOn) return
    try { sx.drawImage(c, 0, 0, 48, 27) } catch { return }
    const d = sx.getImageData(12, 5, 24, 17).data
    let k = 0, w = 0
    for (let i = 0; i < d.length; i += 4) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); if (mx < 14) k++; if (mn > 242) w++ }
    const n = d.length / 4, fk = k / n, fw = w / n
    g.frames++
    g.maxBlack = Math.max(g.maxBlack, fk); g.maxWhite = Math.max(g.maxWhite, fw)
    if (fk >= 0.25) g.pblack++
    if (fw >= 0.25) g.pwhite++
    const bad = fk >= 0.6 ? 'black' : fw >= 0.6 ? 'white' : fk >= 0.25 ? 'pblack' : fw >= 0.25 ? 'pwhite' : ''
    if (fk >= 0.6) g.black++
    if (fw >= 0.6) g.white++
    if (bad && g.shots.length < 6) {
      const F = document.createElement('canvas'); F.width = c.width; F.height = c.height
      F.getContext('2d').drawImage(c, 0, 0)
      g.shots.push({ bad, tag: g.tag, frac: +(Math.max(fk, fw)).toFixed(2), url: F.toDataURL('image/png') })
    }
  }
  addEventListener('load', () => setTimeout(() => requestAnimationFrame(tick), 500))
}

;(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: DPR })
  await ctx.addInitScript(detector)
  await ctx.addInitScript(() => {
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue
      const get = C.prototype.getExtension
      C.prototype.getExtension = function (name) { return name === 'WEBGL_debug_renderer_info' ? null : get.call(this, name) }
    }
    Element.prototype.requestPointerLock = function () { return Promise.reject(new Error('qa')) }
  })
  const p = await ctx.newPage()
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)))
  await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.goto(BASE)
  await p.waitForFunction(() => !document.getElementById('btn-new').disabled, null, { timeout: 120000 })
  await p.click('#btn-new'); await p.waitForTimeout(800); await p.keyboard.press('Escape'); await p.waitForTimeout(1200)
  const setup = await p.evaluate(() => {
    const s = window.__slice
    for (let i = 0; i < 12; i++) s.talk.close?.()
    for (let i = 0; i < 40 && s.game.save.level < 14; i++) s.giveXp(200)
    for (const id of ['bubble_bomb', 'overdrive', 'mochi_rush', 'candy_aura']) s.game.save.build.ranks[id] = 3
    s.applyBuild?.()
    s.quality.setEnabled(false)
    return { composer: !!s.stage.hdrScan(), pr: s.stage.renderer.getPixelRatio(), mobile: s.stage.mobile }
  })
  console.log('setup', JSON.stringify(setup))
  const rows = []
  for (const where of SCENES) {
    const go = await p.evaluate(async (where) => {
      const s = window.__slice, c = s.chapters
      const wait = (ms) => new Promise((ok) => setTimeout(ok, ms))
      const settle = async () => { for (let i = 0; i < 400 && s.travelling; i++) await wait(100); await wait(1500) }
      const inTown = () => s.run?.plan?.objective === 'town'
      c.guide.done = true; if (!c.cleared.includes(1)) c.cleared.push(1); c.current = Math.max(c.current, 2); c.card = 0
      s.dream.maze.passed = true
      if (s.run && where !== 'field') { if (inTown()) s.mongsilToIsland?.(); else s.leaveSewer?.('recall'); await settle() }
      if (where === 'mongsil') s.enterMongsil(true)
      else if (where === 'field') { if (!inTown()) { s.enterMongsil(true); await settle() } s.enterField() }
      else if (where === 'maze') s.enterArea('maze')
      else if (where === 'sewer') s.enterSewer(1, 1)
      else if (where === 'boss') s.enterSewer(1, 4)
      await settle()
      for (let i = 0; i < 12; i++) { s.talk.close?.(); await wait(100) }
      s.quality.setEnabled(false)
      return { run: !!s.run, obj: s.run?.plan?.objective ?? null, foes: s.run?.horde?.foes?.filter((f) => f.alive !== false).length ?? 0 }
    }, where)
    console.log(where, JSON.stringify(go))
    await p.evaluate((t) => { const g = window.__glitch; g.tag = t; window.__glitchOn = true }, where)
    const g0 = await p.evaluate(() => ({ ...window.__glitch, shots: window.__glitch.shots.length }))
    const hdr = { scans: 0, nan: 0, inf: 0, max: 0, over4: 0, over24: 0, at: null }
    const modes = ['open', 'pointblank', 'wall', 'floor']
    for (let r = 0; r < ROUNDS; r++) {
      const mode = modes[r % modes.length]
      await p.evaluate((mode) => {
        const s = window.__slice
        s.hero.hp = s.hero.maxHp
        for (const id of Object.keys(s.skills.cooldown)) s.skills.cooldown[id] = 0
        const v = s.shooter.view, hp = s.hero.object.position
        if (mode === 'floor') v.pitch = 1.1
        else v.pitch = 0.1
        if (mode === 'pointblank') {
          const foes = (s.run?.horde?.foes ?? []).filter((f) => f.alive !== false && f.object)
          foes.slice(0, 4).forEach((f, i) => { f.object.position.set(hp.x + Math.sin(v.yaw) * (0.9 + i * 0.3), f.object.position.y, hp.z + Math.cos(v.yaw) * (0.9 + i * 0.3)) })
        }
      }, mode)
      // walk into it while casting: real keys (wall mode: walk 1.6 s first, into whatever is ahead)
      await p.keyboard.down('KeyW')
      if (mode === 'wall') await p.waitForTimeout(1600)
      for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) { await p.keyboard.press(k); await p.waitForTimeout(120) }
      await p.keyboard.up('KeyW')
      await p.evaluate(() => { const s = window.__slice; for (const id of Object.keys(s.skills.cooldown)) s.skills.cooldown[id] = 0 })
      for (const k of ['Digit4', 'Digit2', 'Digit1', 'Digit3']) await p.keyboard.press(k)
      for (let q = 0; q < 3; q++) {
        await p.waitForTimeout(q === 0 ? 60 : 200)
        const h = await p.evaluate(() => window.__slice.stage.hdrScan())
        if (!h) continue
        hdr.scans++; hdr.nan += h.nan; hdr.inf += h.inf; hdr.max = Math.max(hdr.max, h.max); hdr.over4 = Math.max(hdr.over4, h.over4); hdr.over24 = Math.max(hdr.over24, h.over24); if (h.at && !hdr.at) hdr.at = { ...h, mode }
      }
      // fire a few real clicks too (gun shots near walls)
      await p.mouse.down(); await p.waitForTimeout(400); await p.mouse.up()
    }
    await p.evaluate(() => { window.__glitchOn = false })
    const g = await p.evaluate(() => window.__glitch)
    for (const [i, s] of g.shots.slice(g0.shots).entries()) fs.writeFileSync(`${OUT}/${s.tag}-${s.bad}-${i}.png`, Buffer.from(s.url.split(',')[1], 'base64'))
    await p.screenshot({ path: `${OUT}/${where}-end.png` })
    const row = { where, frames: g.frames - g0.frames, black: g.black - g0.black, white: g.white - g0.white, pblack: g.pblack - g0.pblack, pwhite: g.pwhite - g0.pwhite, maxBlack: +g.maxBlack.toFixed(2), maxWhite: +g.maxWhite.toFixed(2), hdr }
    rows.push(row)
    console.log(JSON.stringify(row))
    await p.evaluate(() => { const g = window.__glitch; g.maxBlack = 0; g.maxWhite = 0 })
  }
  fs.writeFileSync(`${OUT}/skillglitch.json`, JSON.stringify({ setup, rows, errs }, null, 1))
  console.log('DONE', JSON.stringify({ errs: errs.slice(0, 3) }))
  await b.close()
})()
