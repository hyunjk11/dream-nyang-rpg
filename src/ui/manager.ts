import Phaser from 'phaser'
import { ITEMS, SHOP } from '../data/items'
import { DIALOGUES } from '../data/dialogues'
import { HOTBAR, SKILLS, type SkillDef } from '../data/skills'
import { INTRO } from '../data/story'
import { asset } from '../game/assets'
import { audio } from '../game/audio'
import { bus } from '../game/bus'
import { hud } from '../game/hud'
import { bindStick, controls, gate } from '../game/input'
import { resetRuntime } from '../game/runtime'
import { respawnHere } from '../game/scenes/WorldScene'
import { applySettings, commit, live, settings } from '../game/session'
import { xpToNext } from '../sim/formulas'
import { bagItems } from '../sim/inventory'
import { itemLines, itemName, rerollCost, sellValue } from '../sim/loot'
import {
  applyActions,
  buyEntry,
  freshSave,
  learnSkill,
  rerollWeapon,
  sellOwned,
  tryEquip,
  tryUnequip,
  usePotion,
  type ActionOutcome,
} from '../sim/mutate'
import { clearGame, hasGame, loadGame } from '../sim/persist'
import { questLog } from '../sim/quests'
import { computeStats } from '../sim/stats'
import { RARITY_KO, SLOT_KO, type EquipSlot, type ItemInstance, type SaveData } from '../sim/types'

const SLOT_ORDER: EquipSlot[] = ['weapon', 'hat', 'outfit', 'accessory', 'collar']
const SHORT: Record<string, string> = {
  spray: '물보라',
  shield: '방벽',
  focus: '집중',
  taunt: '도발',
  heal: '치유',
  pounce: '펀치',
}

let locks = 0
let game: Phaser.Game
let modalKind = ''

export function mountUI(phaser: Phaser.Game): void {
  game = phaser
  if (import.meta.env.DEV) (window as unknown as { __game?: Phaser.Game }).__game = phaser
  const root = document.getElementById('ui-root')
  if (!root) return
  root.innerHTML = `
    <div id="title-layer" class="layer"></div>
    <div id="intro-layer" class="layer hidden"></div>
    <div id="hud-layer" class="layer hidden"></div>
    <div id="dialogue-layer" class="layer hidden"></div>
    <div id="modal-layer" class="layer hidden"></div>
    <div id="death-layer" class="layer hidden"></div>
    <div id="confirm-layer" class="layer hidden"></div>
    <div id="toast-layer"></div>
    <div id="level-banner" class="hidden">레벨 업</div>
  `
  buildHud()
  bus.on('boot', () => {
    document.getElementById('boot-screen')?.classList.add('hidden')
    showTitle()
  })
  bus.on('toast', (text) => pushToast(text))
  bus.on('levelup', () => flashLevel())
  bus.on('quest', () => audio.sfx('quest'))
  bus.on('dialogue', (id) => openDialogue(id))
  bus.on('death', () => showDeath())
  bus.on('refresh', () => {
    if (modalKind === 'inventory') renderInventory()
    if (modalKind === 'skills') renderSkills()
    if (modalKind === 'quests') renderQuests()
    if (modalKind === 'shop') renderShop()
    if (modalKind === 'tinker') renderTinker()
  })
  window.addEventListener('dream-menu', (event) => {
    const detail = (event as CustomEvent<string>).detail
    if (detail === 'inventory') openModal('inventory')
    if (detail === 'skills') openModal('skills')
    if (detail === 'quests') openModal('quests')
    if (detail === 'pause') openModal('pause')
  })
  requestAnimationFrame(tickHud)
}

function lock(): void {
  locks += 1
  live.paused = true
  gate.suspended = true
  controls.attackHeld = false
  document.body.classList.add('locked')
}

function unlock(): void {
  locks = Math.max(0, locks - 1)
  live.paused = locks > 0
  gate.suspended = locks > 0
  document.body.classList.toggle('locked', locks > 0)
}

function showTitle(): void {
  unlockAll()
  const layer = document.getElementById('title-layer')
  if (!layer) return
  layer.classList.remove('hidden')
  layer.style.backgroundImage = `url(${asset('title_bg.jpg')})`
  document.getElementById('hud-layer')?.classList.add('hidden')
  document.getElementById('intro-layer')?.classList.add('hidden')
  document.getElementById('modal-layer')?.classList.add('hidden')
  const cont = hasGame()
  layer.innerHTML = `
    <div class="title-shade"></div>
    <div class="title-top">
      <p class="eyebrow">별하와 모찌</p>
      <h1>꿈냥 RPG</h1>
      <p class="tagline">장난감 총으로 지키는, 달콤하고 위험한 꿈</p>
    </div>
    <div class="title-actions">
      <button class="btn primary" id="btn-new" type="button">새 게임</button>
      <button class="btn" id="btn-continue" type="button" ${cont ? '' : 'disabled'}>이어하기</button>
      <div class="row-btns">
        <button class="btn ghost" id="btn-help" type="button">조작법</button>
        <button class="btn ghost" id="btn-settings" type="button">설정</button>
      </div>
    </div>
  `
  document.getElementById('btn-new')?.addEventListener('click', () => {
    click()
    if (hasGame()) confirm('저장된 꿈을 지우고 새로 시작할까요?', beginNew)
    else beginNew()
  })
  document.getElementById('btn-continue')?.addEventListener('click', () => {
    if (!cont) return
    click()
    const save = loadGame()
    if (!save) return
    live.save = save
    applySettings(save.settings)
    resetRuntime()
    startWorld(save.zoneId, save.spawn)
  })
  document.getElementById('btn-help')?.addEventListener('click', () => {
    click()
    openModal('help')
  })
  document.getElementById('btn-settings')?.addEventListener('click', () => {
    click()
    openModal('settings')
  })
}

function beginNew(): void {
  resetRuntime()
  live.save = freshSave(settings.current)
  commit()
  showIntro()
}

function showIntro(): void {
  const layer = document.getElementById('intro-layer')
  const title = document.getElementById('title-layer')
  if (!layer) return
  title?.classList.add('hidden')
  layer.classList.remove('hidden')
  let index = 0
  const paint = () => {
    const slide = INTRO[index]
    layer.style.backgroundImage = `url(${asset(`${slide.image}.jpg`)})`
    layer.innerHTML = `
      <div class="intro-card">
        <p>${slide.text.replaceAll('\n', '<br>')}</p>
        <div class="row-btns">
          <button class="btn ghost" id="intro-skip" type="button">건너뛰기</button>
          <button class="btn primary" id="intro-next" type="button">${index === INTRO.length - 1 ? '눈을 뜬다' : '다음'}</button>
        </div>
      </div>
    `
    document.getElementById('intro-skip')?.addEventListener('click', () => {
      click()
      finishIntro()
    })
    document.getElementById('intro-next')?.addEventListener('click', () => {
      click()
      index += 1
      if (index >= INTRO.length) finishIntro()
      else paint()
    })
  }
  paint()
}

function finishIntro(): void {
  document.getElementById('intro-layer')?.classList.add('hidden')
  document.getElementById('hud-layer')?.classList.remove('hidden')
  startWorld('meadow', 'default')
}

function startWorld(zoneId: string, spawn: string): void {
  document.getElementById('title-layer')?.classList.add('hidden')
  document.getElementById('intro-layer')?.classList.add('hidden')
  document.getElementById('hud-layer')?.classList.remove('hidden')
  if (game.scene.isActive('boot')) game.scene.stop('boot')
  if (game.scene.isActive('world') || game.scene.isSleeping('world')) game.scene.start('world', { zoneId, spawn })
  else game.scene.start('world', { zoneId, spawn })
}

function returnTitle(): void {
  if (live.save) commit()
  if (game.scene.isActive('world')) game.scene.stop('world')
  game.scene.start('boot')
  showTitle()
}

function buildHud(): void {
  const hudEl = document.getElementById('hud-layer')
  if (!hudEl) return
  hudEl.innerHTML = `
    <div class="top-left">
      <div class="plate hit">
        <img class="face" id="hud-face" alt="" />
        <div>
          <div class="who"><b>별하</b> <span id="hud-lv">Lv.1</span></div>
          <div class="bar hp"><span id="hp-fill"></span></div>
          <div class="bar xp"><span id="xp-fill"></span></div>
        </div>
      </div>
      <div class="tracker hit" id="tracker"></div>
    </div>
    <div class="top-center" id="zone-name"></div>
    <div class="boss-wrap hidden" id="boss-wrap">
      <div class="boss-name" id="boss-name"></div>
      <div class="bar boss"><span id="boss-fill"></span></div>
    </div>
    <div class="top-right">
      <div class="gold hit" id="hud-gold">0 G</div>
      <div class="menu-row">
        <button class="mini hit" data-open="inventory" type="button">가방</button>
        <button class="mini hit" data-open="skills" type="button">스킬</button>
        <button class="mini hit" data-open="quests" type="button">퀘스트</button>
        <button class="mini hit" data-open="pause" type="button">메뉴</button>
      </div>
    </div>
    <button class="prompt hidden hit" id="prompt" type="button"></button>
    <div class="skillbar" id="skillbar"></div>
    <div class="touch-only joystick hit" id="stick"><div id="knob"></div></div>
    <div class="touch-only fight-cluster">
      <button class="round dash hit" id="btn-dash" type="button">대시</button>
      <button class="round attack hit" id="btn-attack" type="button">공격</button>
    </div>
    <button class="potion hit" id="btn-potion" type="button">포션 <b id="potion-count">0</b></button>
    <p class="rotate-hint">가로 모드가 더 편해요</p>
  `
  const face = document.getElementById('hud-face') as HTMLImageElement | null
  if (face) face.src = asset('byeolha.png')
  hudEl.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) => {
    button.addEventListener('click', () => {
      click()
      openModal(button.dataset.open ?? 'pause')
    })
  })
  document.getElementById('prompt')?.addEventListener('click', () => {
    click()
    controls.queueInteract()
  })
  document.getElementById('btn-potion')?.addEventListener('click', () => {
    click()
    const save = live.save
    if (!save) return
    const used = usePotion(save)
    if (!used.ok) pushToast(used.reason ?? '사용할 수 없어.')
    else {
      audio.sfx('potion')
      commit()
    }
  })
  const dash = document.getElementById('btn-dash')
  dash?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    controls.queueDash()
  })
  const attack = document.getElementById('btn-attack')
  attack?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    controls.attackHeld = true
  })
  const stick = document.getElementById('stick')
  const knob = document.getElementById('knob')
  if (stick && knob) bindStick(stick, knob)
  const bar = document.getElementById('skillbar')
  if (bar) {
    bar.innerHTML = HOTBAR.map((id) => {
      const skill = SKILLS[id]
      return `<button class="skill hit" data-skill="${id}" type="button"><span class="sweep"></span><span>${SHORT[id] ?? skill.name}</span><kbd>${skill.hotkey ?? ''}</kbd></button>`
    }).join('')
    bar.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault()
        event.stopPropagation()
        controls.queueSkill(button.dataset.skill ?? '')
      })
    })
  }
}

function tickHud(): void {
  const save = live.save
  if (save && !document.getElementById('hud-layer')?.classList.contains('hidden')) {
    const hp = document.getElementById('hp-fill')
    const xp = document.getElementById('xp-fill')
    if (hp) hp.style.width = `${Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100))}%`
    if (xp) xp.style.width = `${Math.max(0, Math.min(100, (hud.xp / Math.max(1, hud.next)) * 100))}%`
    const lv = document.getElementById('hud-lv')
    if (lv) lv.textContent = `Lv.${hud.level}`
    const gold = document.getElementById('hud-gold')
    if (gold) gold.textContent = `${hud.gold.toLocaleString('ko-KR')} G`
    const pot = document.getElementById('potion-count')
    if (pot) pot.textContent = String(hud.potions)
    const zone = document.getElementById('zone-name')
    if (zone) zone.textContent = hud.zone
    const tracker = document.getElementById('tracker')
    if (tracker) {
      tracker.innerHTML = hud.quests
        .map((quest) => `<p class="q-title">${quest.title}</p>${quest.lines.map((line) => `<p>${line}</p>`).join('')}`)
        .join('')
    }
    const prompt = document.getElementById('prompt')
    if (prompt) {
      prompt.textContent = hud.prompt ? (hud.prompt.startsWith('별문') ? hud.prompt : `말하기 · ${hud.prompt}`) : ''
      prompt.classList.toggle('hidden', !hud.prompt)
    }
    const bossWrap = document.getElementById('boss-wrap')
    if (bossWrap) {
      bossWrap.classList.toggle('hidden', !hud.boss)
      const name = document.getElementById('boss-name')
      const fill = document.getElementById('boss-fill')
      if (hud.boss && name && fill) {
        name.textContent = hud.boss.name
        fill.style.width = `${Math.max(0, hud.boss.ratio * 100)}%`
      }
    }
    document.getElementById('hud-layer')?.classList.toggle('low', hud.low)
    document.querySelectorAll<HTMLButtonElement>('[data-skill]').forEach((button) => {
      const id = button.dataset.skill ?? ''
      const learned = hud.learned.includes(id)
      const cd = hud.cds[id]
      const p = cd && cd.t > 0 ? Math.round((cd.r / cd.t) * 100) : 0
      button.style.setProperty('--p', String(p))
      button.classList.toggle('locked', !learned)
      const remain = button.querySelector('em')
      if (cd && cd.r > 0.05) {
        if (!remain) {
          const em = document.createElement('em')
          em.textContent = cd.r.toFixed(1)
          button.appendChild(em)
        } else remain.textContent = cd.r.toFixed(1)
      } else remain?.remove()
    })
    document.body.classList.toggle('force-touch', settings.current.showTouch)
  }
  requestAnimationFrame(tickHud)
}

function openModal(kind: string): void {
  if (!live.save && kind !== 'help' && kind !== 'settings') return
  if (document.getElementById('dialogue-layer') && !document.getElementById('dialogue-layer')?.classList.contains('hidden')) return
  modalKind = kind
  const layer = document.getElementById('modal-layer')
  if (!layer) return
  layer.classList.remove('hidden')
  if (locks === 0) lock()
  gate.onClose = () => closeModal()
  gate.onAdvance = null
  if (kind === 'inventory') renderInventory()
  else if (kind === 'skills') renderSkills()
  else if (kind === 'quests') renderQuests()
  else if (kind === 'shop') renderShop()
  else if (kind === 'tinker') renderTinker()
  else if (kind === 'settings') renderSettings()
  else if (kind === 'help') renderHelp()
  else renderPause()
}

function closeModal(): void {
  modalKind = ''
  document.getElementById('modal-layer')?.classList.add('hidden')
  const dialogueOpen = !document.getElementById('dialogue-layer')?.classList.contains('hidden')
  const deathOpen = !document.getElementById('death-layer')?.classList.contains('hidden')
  if (!dialogueOpen && !deathOpen) unlock()
  gate.onClose = null
}

function shell(title: string, body: string): void {
  const layer = document.getElementById('modal-layer')
  if (!layer) return
  layer.innerHTML = `<div class="modal"><header><h2>${title}</h2><button class="x" id="modal-x" type="button">닫기</button></header><div class="modal-body">${body}</div></div>`
  document.getElementById('modal-x')?.addEventListener('click', () => {
    click()
    closeModal()
  })
}

function renderInventory(): void {
  const save = live.save
  if (!save) return
  const selected = (document.getElementById('modal-layer')?.dataset.sel ?? '')
  const bag = bagItems(save)
  const slots = SLOT_ORDER.map((slot) => {
    const item = save.items.find((entry) => entry.uid === save.equipment[slot])
    return `<button class="slot ${item ? `r-${item.rarity}` : ''}" data-unequip="${slot}" type="button"><small>${SLOT_KO[slot]}</small><b>${item ? itemName(item) : '비어 있음'}</b></button>`
  }).join('')
  const grid = bag
    .map(
      (item) =>
        `<button class="slot ${selected === item.uid ? 'on' : ''} r-${item.rarity}" data-pick="${item.uid}" type="button"><b>${itemName(item)}</b><small>${RARITY_KO[item.rarity]}</small></button>`,
    )
    .join('')
  const picked = save.items.find((item) => item.uid === selected)
  shell(
    '가방',
    `<div class="inv">
      <div><h3>장착</h3>${slots}<div class="stats">${statBlock(save)}</div></div>
      <div><h3>가방 ${bag.length}/24</h3><div class="grid">${grid || '<p class="empty">비어 있어.</p>'}</div>
        <p class="mats">꿈가루 ${save.materials.dream_dust ?? 0} · 장난감 부품 ${save.materials.toy_part ?? 0} · 포션 ${save.potions}</p>
      </div>
      <div class="detail">${picked ? detailHtml(picked) : '<p class="empty">물건을 골라 봐.</p>'}
        <div class="row-btns">
          <button class="btn" id="do-equip" type="button" ${picked ? '' : 'disabled'}>장착</button>
          <button class="btn ghost" id="do-sell" type="button" ${picked ? '' : 'disabled'}>판매 ${picked ? sellValue(picked) : ''}</button>
        </div>
      </div>
    </div>`,
  )
  const layer = document.getElementById('modal-layer')
  if (layer) layer.dataset.sel = selected
  layer?.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((button) => {
    button.addEventListener('click', () => {
      if (layer) layer.dataset.sel = button.dataset.pick ?? ''
      renderInventory()
    })
  })
  layer?.querySelectorAll<HTMLButtonElement>('[data-unequip]').forEach((button) => {
    button.addEventListener('click', () => {
      const slot = button.dataset.unequip as EquipSlot
      const result = tryUnequip(save, slot)
      if (!result.ok) pushToast(result.reason ?? '해제할 수 없어.')
      else commit()
      renderInventory()
    })
  })
  document.getElementById('do-equip')?.addEventListener('click', () => {
    if (!picked) return
    const result = tryEquip(save, picked.uid)
    if (!result.ok) pushToast(result.reason ?? '장착할 수 없어.')
    else {
      click()
      commit()
    }
    renderInventory()
  })
  document.getElementById('do-sell')?.addEventListener('click', () => {
    if (!picked) return
    const result = sellOwned(save, picked.uid)
    if (!result.ok) pushToast(result.reason ?? '팔 수 없어.')
    else {
      click()
      if (layer) layer.dataset.sel = ''
      pushToast(`${result.gold} 골드`)
      commit()
    }
    renderInventory()
  })
}

function renderSkills(): void {
  const save = live.save
  if (!save) return
  const cards = (owner: 'byeolha' | 'mochi') =>
    Object.values(SKILLS)
      .filter((skill) => skill.owner === owner)
      .sort((a, b) => depth(a) - depth(b))
      .map((skill) => skillCard(save, skill))
      .join('')
  shell(
    '스킬',
    `<p class="points">별하 포인트 ${save.byeolhaPoints} · 모찌 포인트 ${save.mochiPoints}</p>
     <div class="trees"><section><h3>별하</h3>${cards('byeolha')}</section><section><h3>모찌</h3>${cards('mochi')}</section></div>`,
  )
  document.querySelectorAll<HTMLButtonElement>('[data-learn]').forEach((button) => {
    button.addEventListener('click', () => {
      const result = learnSkill(save, button.dataset.learn ?? '')
      if (!result.ok) pushToast(result.reason ?? '배울 수 없어.')
      else {
        click()
        audio.sfx('quest')
        commit()
      }
      renderSkills()
    })
  })
}

function skillCard(save: SaveData, skill: SkillDef): string {
  const learned = save.learnedSkills.includes(skill.id)
  const ready = skill.requires.every((req) => save.learnedSkills.includes(req))
  return `<article class="skill-card ${learned ? 'learned' : ''}" style="margin-left:${depth(skill) * 16}px">
    <h4>${skill.name} ${skill.hotkey ? `<kbd>${skill.hotkey}</kbd>` : ''}</h4>
    <p>${skill.description}</p>
    ${learned ? '<span class="badge">배움</span>' : `<button class="btn" data-learn="${skill.id}" type="button" ${ready ? '' : 'disabled'}>익히기</button>`}
  </article>`
}

function depth(skill: SkillDef): number {
  if (!skill.requires.length) return 0
  return 1 + Math.max(...skill.requires.map((id) => depth(SKILLS[id])))
}

function renderQuests(): void {
  const save = live.save
  if (!save) return
  const cards = questLog(save)
    .map(
      (quest) => `<article class="quest ${quest.statusKey}">
        <h3>${quest.title} <span>${quest.status}</span></h3>
        <p>${quest.summary}</p>
        ${quest.lines.map((line) => `<p class="obj">${line}</p>`).join('')}
        <p class="reward">보상 ${quest.reward}</p>
      </article>`,
    )
    .join('')
  shell('퀘스트', cards || '<p class="empty">아직 적힌 꿈이 없어.</p>')
}

function renderShop(): void {
  const save = live.save
  if (!save) return
  const rows = SHOP.map((entry, index) => {
    return `<div class="shop-row"><div><b>${entry.name}</b><p>${entry.blurb}</p></div><button class="btn" data-buy="${index}" type="button">${entry.price} G</button></div>`
  }).join('')
  const sell = bagItems(save)
    .map(
      (item) =>
        `<div class="shop-row"><div><b class="r-${item.rarity}">${itemName(item)}</b><p>${RARITY_KO[item.rarity]}</p></div><button class="btn ghost" data-sell="${item.uid}" type="button">${sellValue(item)} G</button></div>`,
    )
    .join('')
  shell('포포의 상점', `<p class="points">보유 ${save.gold.toLocaleString('ko-KR')} G · 포션 ${save.potions}</p><h3>구매</h3>${rows}<h3>판매</h3>${sell || '<p class="empty">팔 물건이 없어.</p>'}`)
  document.querySelectorAll<HTMLButtonElement>('[data-buy]').forEach((button) => {
    button.addEventListener('click', () => {
      const result = buyEntry(save, Number(button.dataset.buy))
      if (!result.ok) pushToast(result.reason ?? '살 수 없어.')
      else {
        click()
        audio.sfx('coin')
        commit()
      }
      renderShop()
    })
  })
  document.querySelectorAll<HTMLButtonElement>('[data-sell]').forEach((button) => {
    button.addEventListener('click', () => {
      const result = sellOwned(save, button.dataset.sell ?? '')
      if (!result.ok) pushToast(result.reason ?? '팔 수 없어.')
      else {
        click()
        commit()
      }
      renderShop()
    })
  })
}

function renderTinker(): void {
  const save = live.save
  if (!save) return
  const item = save.items.find((entry) => entry.uid === save.equipment.weapon)
  if (!item) {
    shell('키키의 작업대', '<p class="empty">장착한 총이 없어.</p>')
    return
  }
  const cost = rerollCost(item)
  shell(
    '키키의 작업대',
    `<div class="detail">${detailHtml(item)}</div>
     <p>재조정 비용 ${cost} G. 일반 등급은 굴릴 능력이 없어.</p>
     <button class="btn primary" id="do-reroll" type="button">능력치 다시 굴리기</button>`,
  )
  document.getElementById('do-reroll')?.addEventListener('click', () => {
    const result = rerollWeapon(save)
    if (!result.ok) pushToast(result.reason ?? '재조정할 수 없어.')
    else {
      click()
      audio.sfx('quest')
      commit()
      pushToast('총이 다시 꿈결을 입었어.')
    }
    renderTinker()
  })
}

function renderSettings(): void {
  const s = settings.current
  shell(
    '설정',
    `<label>전체 음량 <input id="vol-master" type="range" min="0" max="100" value="${Math.round(s.master * 100)}" /></label>
     <label>음악 <input id="vol-bgm" type="range" min="0" max="100" value="${Math.round(s.bgm * 100)}" /></label>
     <label>효과음 <input id="vol-sfx" type="range" min="0" max="100" value="${Math.round(s.sfx * 100)}" /></label>
     <label class="check"><input id="opt-shake" type="checkbox" ${s.shake ? 'checked' : ''}/> 화면 흔들림</label>
     <label class="check"><input id="opt-vib" type="checkbox" ${s.vibration ? 'checked' : ''}/> 진동</label>
     <label class="check"><input id="opt-touch" type="checkbox" ${s.showTouch ? 'checked' : ''}/> 터치 버튼 항상 표시</label>
     <button class="btn ghost danger" id="wipe" type="button">꿈 기록 지우기</button>`,
  )
  const bindRange = (id: string, key: 'master' | 'bgm' | 'sfx') => {
    const node = document.getElementById(id)
    node?.addEventListener('input', (event) => {
      const value = Number((event.target as HTMLInputElement).value) / 100
      applySettings({ [key]: value })
      audio.apply()
    })
    node?.addEventListener('change', () => {
      if (key !== 'bgm') audio.sfx('ui')
    })
  }
  bindRange('vol-master', 'master')
  bindRange('vol-bgm', 'bgm')
  bindRange('vol-sfx', 'sfx')
  document.getElementById('opt-shake')?.addEventListener('change', (event) => {
    applySettings({ shake: (event.target as HTMLInputElement).checked })
  })
  document.getElementById('opt-vib')?.addEventListener('change', (event) => {
    applySettings({ vibration: (event.target as HTMLInputElement).checked })
  })
  document.getElementById('opt-touch')?.addEventListener('change', (event) => {
    applySettings({ showTouch: (event.target as HTMLInputElement).checked })
    document.body.classList.toggle('force-touch', settings.current.showTouch)
  })
  document.getElementById('wipe')?.addEventListener('click', () => {
    confirm('저장된 꿈을 지울까요? 이 브라우저에서만 사라져요.', () => {
      clearGame()
      live.save = null
      pushToast('기록을 지웠어.')
      closeModal()
      returnTitle()
    })
  })
}

function renderHelp(): void {
  shell(
    '조작법',
    `<div class="help">
      <h3>키보드 / 마우스</h3>
      <p>WASD 또는 방향키 이동 · 마우스 조준 · 클릭 공격(홀드 연사)</p>
      <p>Space 대시 · 1 2 3 별하 스킬 · 4 도발 · Z 치유 · X 냥냥 펀치</p>
      <p>R 포션 · E 대화 · I 가방 · K 스킬 · Q 퀘스트 · Esc 메뉴</p>
      <h3>터치</h3>
      <p>왼쪽 스틱으로 이동하고, 공격 버튼을 누르면 가까운 적을 자동으로 조준해.</p>
      <p>대시와 스킬은 오른쪽 버튼. 말풍선이 뜨면 말하기를 눌러.</p>
    </div>`,
  )
}

function renderPause(): void {
  const save = live.save
  const time = save ? formatTime(save.playSeconds) : '0분'
  shell(
    '메뉴',
    `<p class="points">꿈속 시간 ${time}</p>
     <div class="pause-list">
       <button class="btn" data-jump="close" type="button">계속하기</button>
       <button class="btn" data-jump="inventory" type="button">가방</button>
       <button class="btn" data-jump="skills" type="button">스킬</button>
       <button class="btn" data-jump="quests" type="button">퀘스트</button>
       <button class="btn" data-jump="settings" type="button">설정</button>
       <button class="btn" data-jump="help" type="button">조작법</button>
       <button class="btn" id="do-save" type="button">지금 기록</button>
       <button class="btn ghost" id="do-title" type="button">타이틀로</button>
     </div>`,
  )
  document.querySelectorAll<HTMLButtonElement>('[data-jump]').forEach((button) => {
    button.addEventListener('click', () => {
      click()
      const jump = button.dataset.jump
      if (jump === 'close') closeModal()
      else if (jump) openModal(jump)
    })
  })
  document.getElementById('do-save')?.addEventListener('click', () => {
    if (!live.save) return
    commit()
    audio.sfx('quest')
    pushToast('꿈을 기록했어.')
  })
  document.getElementById('do-title')?.addEventListener('click', () => {
    confirm('타이틀로 돌아갈까요? 지금까지의 꿈은 기록돼요.', () => {
      closeModal()
      returnTitle()
    })
  })
}

function openDialogue(id: string): void {
  const dialogue = DIALOGUES[id]
  const save = live.save
  const layer = document.getElementById('dialogue-layer')
  if (!dialogue || !save || !layer) return
  if (modalKind) closeModal()
  layer.classList.remove('hidden')
  lock()
  let index = 0
  let char = 0
  let timer = 0
  let phase: 'lines' | 'choices' = 'lines'
  let applied = false
  let pending: ActionOutcome | null = null
  const paint = (text: string, choices = '') => {
    const line = dialogue.lines[Math.min(index, dialogue.lines.length - 1)]
    layer.innerHTML = `
      <div class="dialogue">
        <img src="${asset(`${line.portrait}.png`)}" alt="" />
        <div>
          <div class="speaker">${line.speaker}</div>
          <p id="dlg-text">${text}</p>
          <div class="choices">${choices}</div>
        </div>
      </div>`
  }
  const type = () => {
    window.clearInterval(timer)
    const line = dialogue.lines[index]
    char = 0
    paint('')
    timer = window.setInterval(() => {
      if (!line) {
        window.clearInterval(timer)
        return
      }
      char += 1
      const node = document.getElementById('dlg-text')
      if (node) node.textContent = line.text.slice(0, char)
      if (char >= line.text.length) window.clearInterval(timer)
    }, 18)
  }
  const applyBase = () => {
    if (applied) return
    applied = true
    if (dialogue.actions?.length) {
      pending = applyActions(save, dialogue.actions)
      commit(pending.result)
    }
  }
  const finishLines = () => {
    applyBase()
    if (dialogue.choices?.length) {
      phase = 'choices'
      const buttons = dialogue.choices
        .map((choice, choiceIndex) => `<button class="btn" data-choice="${choiceIndex}" type="button">${choice.text}</button>`)
        .join('')
      paint(dialogue.lines[dialogue.lines.length - 1].text, buttons)
      layer.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach((button) => {
        button.addEventListener('click', () => {
          click()
          const choice = dialogue.choices?.[Number(button.dataset.choice)]
          if (choice?.actions?.length) {
            pending = applyActions(save, choice.actions)
            commit(pending.result)
          }
          closeDialogue()
        })
      })
      return
    }
    closeDialogue()
  }
  const advance = () => {
    if (phase === 'choices') return
    const line = dialogue.lines[index]
    if (!line) {
      finishLines()
      return
    }
    if (char < line.text.length) {
      char = line.text.length
      const node = document.getElementById('dlg-text')
      if (node) node.textContent = line.text
      window.clearInterval(timer)
      return
    }
    index += 1
    if (index < dialogue.lines.length) type()
    else finishLines()
  }
  const closeDialogue = () => {
    window.clearInterval(timer)
    layer.classList.add('hidden')
    gate.onAdvance = null
    gate.onClose = null
    unlock()
    if (pending?.openShop) openModal('shop')
    else if (pending?.openTinker) openModal('tinker')
    else if (pending?.openQuests) openModal('quests')
  }
  gate.onAdvance = advance
  gate.onClose = () => {
    if (phase === 'choices') return
    window.clearInterval(timer)
    index = dialogue.lines.length
    finishLines()
  }
  layer.onclick = (event) => {
    if ((event.target as HTMLElement).closest('button')) return
    advance()
  }
  type()
}

function showDeath(): void {
  const layer = document.getElementById('death-layer')
  if (!layer) return
  layer.classList.remove('hidden')
  if (locks === 0) lock()
  layer.innerHTML = `
    <div class="death-card">
      <h2>꿈이 흐려진다…</h2>
      <p>별하가 눈을 감았다가, 다시 뜬다. 손에 쥐었던 골드가 조금 모래처럼 흘렀다.</p>
      <button class="btn primary" id="btn-wake" type="button">다시 일어나기</button>
    </div>`
  document.getElementById('btn-wake')?.addEventListener('click', () => {
    click()
    const result = respawnHere()
    layer.classList.add('hidden')
    unlock()
    live.paused = locks > 0
    game.scene.start('world', { zoneId: result.zoneId, spawn: result.spawn })
    pushToast(result.lost > 0 ? `골드 ${result.lost}을 흘리고 다시 눈을 떴다.` : '다시 눈을 떴다.')
  })
}

function confirm(text: string, onYes: () => void): void {
  const layer = document.getElementById('confirm-layer')
  if (!layer) return
  layer.classList.remove('hidden')
  layer.innerHTML = `<div class="modal narrow"><p>${text}</p><div class="row-btns"><button class="btn ghost" id="no" type="button">아니오</button><button class="btn primary" id="yes" type="button">응</button></div></div>`
  const close = () => layer.classList.add('hidden')
  document.getElementById('no')?.addEventListener('click', () => {
    click()
    close()
  })
  document.getElementById('yes')?.addEventListener('click', () => {
    click()
    close()
    onYes()
  })
}

function flashLevel(): void {
  const banner = document.getElementById('level-banner')
  if (!banner || !live.save) return
  banner.textContent = `레벨 ${live.save.level}`
  banner.classList.remove('hidden')
  window.setTimeout(() => banner.classList.add('hidden'), 1500)
}

const toastQueue: string[] = []
let toastTimer = 0
function pushToast(text: string): void {
  if (!text) return
  toastQueue.push(text)
  pumpToast()
}
function pumpToast(): void {
  if (toastTimer || toastQueue.length === 0) return
  const layer = document.getElementById('toast-layer')
  if (!layer) return
  layer.textContent = toastQueue.shift() ?? ''
  layer.classList.add('show')
  toastTimer = window.setTimeout(() => {
    layer.classList.remove('show')
    toastTimer = 0
    pumpToast()
  }, 1500)
}

function click(): void {
  audio.sfx('ui', 1)
}

function unlockAll(): void {
  locks = 0
  live.paused = false
  gate.suspended = false
  gate.onAdvance = null
  gate.onClose = null
  document.body.classList.remove('locked')
}

function detailHtml(item: ItemInstance): string {
  const def = ITEMS[item.defId]
  return `<h3 class="r-${item.rarity}">${itemName(item)}</h3><p class="badge">${RARITY_KO[item.rarity]}</p><p>${def?.description ?? ''}</p><ul>${itemLines(item)
    .map((line) => `<li>${line}</li>`)
    .join('')}</ul>`
}

function statBlock(save: SaveData): string {
  const stats = computeStats(save)
  const rows: [string, string][] = [
    ['체력', `${Math.ceil(save.hp)} / ${stats.maxHp}`],
    ['공격력', String(stats.atk)],
    ['방어력', String(stats.def)],
    ['무기 공격력', String(stats.weaponDamage)],
    ['치명타', `${Math.round(stats.critChance * 100)}%`],
    ['치명타 피해', `x${stats.critDamage.toFixed(2)}`],
    ['공격 속도', `${Math.round(stats.attackSpeed * 100)}%`],
    ['이동 속도', String(Math.round(stats.moveSpeed))],
    ['행운', String(stats.luck)],
    ['다음 레벨', `${save.xp} / ${xpToNext(save.level)}`],
  ]
  return rows.map(([key, value]) => `<div><span>${key}</span><b>${value}</b></div>`).join('')
}

function formatTime(seconds: number): string {
  const min = Math.floor(seconds / 60)
  if (min < 1) return `${seconds}초`
  return `${min}분`
}
