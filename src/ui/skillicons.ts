/**
 * Picture icons for the 15 skills (hotbar and skill tree), same hand-drawn style as the item
 * icons. They replaced one-letter hanja (泡 爆 猫 飴…) nobody could read.
 */
const INK = '#4a3358'
const S = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`
const shine = (x: number, y: number, r = 1.3) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".85"/>`
const star = (x: number, y: number, k = 1, fill = '#ffe066') =>
  `<path transform="translate(${x} ${y}) scale(${k})" d="M0-4l1.2 2.5 2.7.4-2 1.9.5 2.7L0 2.2-2.4 3.5l.5-2.7-2-1.9 2.7-.4z" fill="${fill}" stroke="${INK}" stroke-width="${1 / k}"/>`
const bubble = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#e9f7ff" ${S}/>${shine(x - r * 0.4, y - r * 0.4, r * 0.28)}`

const SKILL_BODY: Record<string, string> = {
  // 물총 손질: a water drop and a little wrench sparkle.
  polish: `<path d="M14 5c4 5 7 9 7 13a7 7 0 0 1-14 0c0-4 3-8 7-13z" fill="#8fd3ff" ${S}/>${shine(11, 17, 1.6)}${star(24, 9, 0.9)}`,
  // 두두두 리듬: two beamed notes.
  rhythm: `<path d="M11 23V9l12-3v14" fill="none" ${S}/><ellipse cx="8.5" cy="23" rx="3.2" ry="2.5" fill="#ffc6e5" ${S}/><ellipse cx="20.5" cy="20" rx="3.2" ry="2.5" fill="#ffc6e5" ${S}/><path d="M11 12l12-3" ${S}/>`,
  // 과열 폭주: a round flame.
  overdrive: `<path d="M16 4c1 4 6 6 6 13a6 6 0 0 1-12 0c0-3 1.5-5 3-6 0 2 1 3 2 3-1-4 0-7 1-10z" fill="#ff9a6b" ${S}/><path d="M16 15c2 2 3 3 3 5a3 3 0 0 1-6 0c0-2 2-3 3-5z" fill="#ffe066" ${S}/>`,
  // 별빛 조준: crosshair with a star in the middle.
  star_eye: `<circle cx="16" cy="16" r="10" fill="#f3edff" ${S}/><path d="M16 3v5M16 24v5M3 16h5M24 16h5" ${S}/>${star(16, 16.5, 1.3)}`,
  // 꿈 관통: an arrow through two dots.
  dream_pierce: `<circle cx="12" cy="16" r="4" fill="#c9b8ff" ${S}/><circle cx="21" cy="16" r="4" fill="#c9b8ff" ${S}/><path d="M3 16h25M24 12l4 4-4 4" fill="none" ${S}/>`,
  // 거품 폭탄: a cluster of bubbles bursting.
  bubble_bomb: `${bubble(13, 18, 7)}${bubble(23, 11, 4)}${bubble(24, 22, 3)}<path d="M5 7l2 2M9 4l.5 2.5M4 12l2.5.3" ${S}/>`,
  // 왕방울: one big bubble.
  big_bubble: `${bubble(16, 16, 11)}<path d="M9 21c2 3 6 4 9 3" fill="none" stroke="#9fd8ff" stroke-width="1.4" stroke-linecap="round"/>`,
  // 끈적 비누: a soap bar dripping.
  sticky_soap: `<rect x="5" y="8" width="22" height="12" rx="5" fill="#ffd4f0" ${S}/><path d="M10 20v4a1.6 1.6 0 0 0 3.2 0v-4M18 20v2.5a1.4 1.4 0 0 0 2.8 0V20" fill="#ffd4f0" ${S}/>${shine(10, 12, 1.6)}`,
  // 톡톡 연쇄: three bubbles joined by sparks.
  pop_chain: `${bubble(7, 22, 4)}${bubble(16, 13, 4)}${bubble(25, 22, 4)}<path d="M10 19l3-3M19 16l3 3" stroke="#ffb36b" stroke-width="1.6" stroke-linecap="round"/>`,
  // 반짝 마음: a heart with a sparkle.
  sparkle_heart: `<path d="M16 26C8 20 5 16 5 12a5 5 0 0 1 11-2 5 5 0 0 1 11 2c0 4-3 8-11 14z" fill="#ff9fc4" ${S}/>${shine(10, 11, 1.5)}${star(25, 7, 0.8)}`,
  // 폭신 털: a fluffy cloud puff.
  fluffy: `<path d="M8 23a5 5 0 0 1 0-10 6 6 0 0 1 11-3 5 5 0 0 1 6 4 4.5 4.5 0 0 1-1 9z" fill="#fff6e8" ${S}/>${shine(12, 13, 1.5)}`,
  // 모찌 돌진: a calico cat face with speed lines.
  mochi_rush: `<path d="M10 9l2 5M22 9l-2 5" ${S}/><path d="M9 8l3 6h8l3-6 1 9a8 7 0 0 1-16 0z" fill="#fff" ${S}/><path d="M9 8l3 6c-2 0-3 1-3.5 2z" fill="#ffb36b"/><circle cx="13" cy="18" r="1.1" fill="${INK}"/><circle cx="19" cy="18" r="1.1" fill="${INK}"/><path d="M15 21h2" ${S}/><path d="M2 14h4M1 19h5M3 24h4" ${S}/>`,
  // 골골 회복: a paw with a little heart.
  purr: `<ellipse cx="16" cy="20" rx="6" ry="5" fill="#ffd6e7" ${S}/><circle cx="9" cy="13" r="2.4" fill="#ffd6e7" ${S}/><circle cx="14" cy="9.5" r="2.4" fill="#ffd6e7" ${S}/><circle cx="19.5" cy="9.5" r="2.4" fill="#ffd6e7" ${S}/><circle cx="24" cy="13" r="2.4" fill="#ffd6e7" ${S}/><path d="M16 23c-2.5-1.8-3.4-3-3.4-4a1.7 1.7 0 0 1 3.4-.6 1.7 1.7 0 0 1 3.4.6c0 1-.9 2.2-3.4 4z" fill="#ff6b9a"/>`,
  // 하트 사탕 오라: a wrapped heart candy in a soft ring.
  candy_aura: `<circle cx="16" cy="16" r="12" fill="none" stroke="#ffc6e5" stroke-width="2" stroke-dasharray="3 3"/><path d="M5 11l5 3-5 3zM27 11l-5 3 5 3z" fill="#ffe066" ${S}/><path d="M16 22c-4.5-3-6-5-6-7a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 2-1.5 4-6 7z" fill="#ff7fb0" ${S}/>${shine(13, 14, 1)}`,
  // 행운 방울: a golden bell with a clover.
  lucky_bell: `<path d="M8 22c1-2 1-4 1-7a7 7 0 0 1 14 0c0 3 0 5 1 7z" fill="#ffe066" ${S}/><path d="M6 22h20" ${S}/><circle cx="16" cy="25" r="2" fill="#ffb36b" ${S}/><path d="M16 5v3" ${S}/><circle cx="14" cy="15" r="1.4" fill="#9be7c7"/><circle cx="17" cy="13.5" r="1.4" fill="#9be7c7"/><circle cx="18" cy="16.5" r="1.4" fill="#9be7c7"/>`,
}

export const SKILL_ICON_IDS = Object.keys(SKILL_BODY)

/** Inline <svg> for a skill id (a plain star when unknown). */
export function skillSvg(id: string, size = 30): string {
  const body = SKILL_BODY[id] ?? star(16, 16, 2.4)
  return `<svg class="skill-svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`
}
