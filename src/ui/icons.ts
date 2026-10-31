/**
 * Hand-drawn SVG icons for the 17 item bases (bag, shop, workshop, toasts). Plain strings, no
 * assets: soft pastel fills, a dark ink outline and a little white shine, 32×32.
 */
const INK = '#4a3358'
const S = `stroke="${INK}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"`
const shine = (x: number, y: number, r = 1.4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity=".85"/>`

const BODY: Record<string, string> = {
  // Water gun: chunky blue body, orange tank, drip.
  gun: `<path d="M5 13h17l3 2v4H14l-2 6H8l1-6H5z" fill="#8fd3ff" ${S}/><rect x="11" y="7" width="7" height="6" rx="2.5" fill="#ffb36b" ${S}/><path d="M25 15h3" ${S}/><path d="M29 18c0 1-.6 1.6-1.2 1.6s-1.2-.6-1.2-1.6.6-1.6 1.2-2.4c.6.8 1.2 1.4 1.2 2.4z" fill="#bfe8ff" ${S}/>${shine(9, 15)}`,
  // Bubble shotgun: wide bell barrel with bubbles.
  shotgun: `<path d="M4 15h13l5-4v12l-5-4H10l-2 6H5l1-6H4z" fill="#ffc6e5" ${S}/><circle cx="25" cy="9" r="2.6" fill="#e9f7ff" ${S}/><circle cx="27.5" cy="15.5" r="1.8" fill="#e9f7ff" ${S}/><circle cx="25" cy="21.5" r="2" fill="#e9f7ff" ${S}/>${shine(8, 16.5)}`,
  // Star burst rifle: long barrel, star on the stock.
  rifle: `<path d="M3 14h22v3H13l-2 7H7l1-7H3z" fill="#c9b8ff" ${S}/><path d="M25 14.5h4" ${S}/><path d="M6 6.5l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" fill="#ffe066" ${S}/>${shine(17, 15.5, 1)}`,
  // Dream dart sniper: slim, scope, feathered dart.
  dart: `<path d="M3 16h20v2.6H11l-1.6 6H6l1-6H3z" fill="#9be7c7" ${S}/><rect x="9" y="11" width="9" height="3.4" rx="1.7" fill="#7a6aa8" ${S}/><path d="M23 17.3l6-1.3v2.6z" fill="#ffd4a8" ${S}/>${shine(12, 12.6, 0.9)}`,
  // Beret: tilted soft dome with a stalk and a star badge.
  beret: `<path d="M4 19c0-6 6-9 13-9s11 3 11 7c0 2-2 3-5 3H8c-2.5 0-4-.4-4-1z" fill="#ff9fb8" ${S}/><path d="M17 10V7.5" ${S}/><path d="M8 20c3 2 13 2 17 0" fill="none" ${S}/><path d="M21 13.5l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill="#ffe066" stroke="${INK}" stroke-width="1"/>${shine(10, 14)}`,
  // Mushroom hood cap: red dome, white dots, cream band.
  mushroom: `<path d="M3 20C3 11 9 6 16 6s13 5 13 14z" fill="#ff7a7a" ${S}/><rect x="6" y="20" width="20" height="5" rx="2.5" fill="#fff1d6" ${S}/><circle cx="11" cy="13" r="2.2" fill="#fff"/><circle cx="19" cy="10.5" r="1.8" fill="#fff"/><circle cx="23" cy="16" r="2" fill="#fff"/><circle cx="15" cy="17" r="1.4" fill="#fff"/>`,
  // Star hair pin.
  pin: `<path d="M5 27l9-9" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/><path d="M5 27l9-9" stroke="#d8d0ff" stroke-width="1.6" stroke-linecap="round"/><path d="M19 4l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" fill="#ffe066" ${S}/>${shine(17.5, 10)}`,
  // Cropped hoodie: lilac with hood and pocket.
  hoodie: `<path d="M10 7c2-2 10-2 12 0l6 5-3 4-3-2v13H10V14l-3 2-3-4z" fill="#c7b2ff" ${S}/><path d="M12 7c0 3 2 5 4 5s4-2 4-5" fill="#a990f0" ${S}/><path d="M13 21h6v3h-6z" fill="#b39cf7" ${S}/><path d="M15 12v4M17 12v4" ${S}/>${shine(12.5, 17, 1)}`,
  // Starry cape: navy cape with stars, gold clasp.
  cape: `<path d="M11 6h10l7 21c-4 1.5-8 2-12 2s-8-.5-12-2z" fill="#5b6fd6" ${S}/><circle cx="16" cy="7" r="2" fill="#ffe066" ${S}/><path d="M12 16l.6 1.2 1.3.2-1 .9.3 1.3-1.2-.6-1.2.6.3-1.3-1-.9 1.3-.2zM20 21l.6 1.2 1.3.2-1 .9.3 1.3-1.2-.6-1.2.6.3-1.3-1-.9 1.3-.2z" fill="#fff6b3"/><circle cx="19" cy="13" r=".9" fill="#fff"/><circle cx="14" cy="24" r=".8" fill="#fff"/>`,
  // Cloud knit vest: cream with cable stitches, cloud hem.
  knit: `<path d="M9 5l4 2h6l4-2 3 6v14c-2 2-4 1-5 0-1 1-3 2-5 1-2 1-4 0-5-1-1 1-3 2-5 0V11z" fill="#fff1d6" ${S}/><path d="M13 7l3 6 3-6" fill="none" ${S}/><path d="M12 15c1 1 1 2 0 3s-1 2 0 3M20 15c-1 1-1 2 0 3s1 2 0 3" fill="none" stroke="#e6b98a" stroke-width="1.4" stroke-linecap="round"/>`,
  // Fluffy boots: brown boot, white fur cuff.
  boots: `<path d="M10 11h9v9l7 2c2 .6 3 2 3 4H8c-1 0-1.5-.6-1.5-1.5z" fill="#d79a6a" ${S}/><path d="M8 11c-1-3 1-5 3-4 1-2 4-2 5 0 1-2 4-1 4 1 2 0 2 3 0 4-1 1-11 1-12-1z" fill="#fff" ${S}/><path d="M8 25h21" ${S}/>${shine(13, 16)}`,
  // Cloud sneakers: mint upper, white sole, laces.
  sneakers: `<path d="M5 14c0-2 2-3 4-3 2 0 3 2 6 2l5 3 6 1c2 .5 3 2 3 4v2H5z" fill="#9be7c7" ${S}/><path d="M4 23h26v2.5c0 1-1 1.5-2 1.5H6c-1 0-2-.5-2-1.5z" fill="#fff" ${S}/><path d="M13 14l2 3M16 13.5l2 3" ${S}/>${shine(9, 15)}`,
  // Moon charm: crescent on a string with a tassel.
  charm: `<path d="M16 3v6" ${S}/><path d="M21 9a9 9 0 1 0 3 11 7 7 0 1 1-3-11z" fill="#ffe7a0" ${S}/><path d="M14 27l-1 3M16 27v3M18 27l1 3" ${S}/><circle cx="16" cy="26" r="1.6" fill="#ff9fb8" ${S}/>${shine(12, 15)}`,
  // Candy ring: gold band, pink candy gem.
  ring: `<ellipse cx="16" cy="21" rx="9" ry="7" fill="none" stroke="${INK}" stroke-width="4.6"/><ellipse cx="16" cy="21" rx="9" ry="7" fill="none" stroke="#ffd35a" stroke-width="2.4"/><path d="M11 10l5-5 5 5-5 5z" fill="#ff8fc0" ${S}/>${shine(14.5, 8.5, 1)}`,
  // Jingle bracelet: beads round a band, one bell.
  bracelet: `<circle cx="16" cy="15" r="9" fill="none" stroke="#c9b8ff" stroke-width="2.4"/><circle cx="7" cy="15" r="2" fill="#ff9fb8" ${S}/><circle cx="25" cy="15" r="2" fill="#9be7c7" ${S}/><circle cx="16" cy="6" r="2" fill="#8fd3ff" ${S}/><path d="M12 22c0-3 2-4 4-4s4 1 4 4v3h-8z" fill="#ffd35a" ${S}/><circle cx="16" cy="27" r="1.3" fill="${INK}"/>`,
  // Mochi's bell collar: red band, gold bell.
  bell: `<path d="M4 9c4 4 20 4 24 0v4c-4 4-20 4-24 0z" fill="#ff6b7d" ${S}/><path d="M10 25c0-6 2.6-9 6-9s6 3 6 9z" fill="#ffd35a" ${S}/><path d="M9 25h14" ${S}/><circle cx="16" cy="22" r="1.4" fill="${INK}"/>${shine(13.5, 19.5, 1)}`,
  // Starlight ribbon: pink bow with a star knot.
  ribbon: `<path d="M16 15L5 8c-2 3-2 11 0 14z" fill="#ff9fd0" ${S}/><path d="M16 15l11-7c2 3 2 11 0 14z" fill="#ff9fd0" ${S}/><path d="M14 17l-4 11 3-1 2 2 1-11zM18 17l4 11-3-1-2 2-1-11z" fill="#ffc6e5" ${S}/><path d="M16 11l1.3 2.6 2.9.4-2.1 2 .5 2.9-2.6-1.4-2.6 1.4.5-2.9-2.1-2 2.9-.4z" fill="#ffe066" ${S}/>`,
}

/** Old icon keys (saves, other callers) → the new art. */
const ALIAS: Record<string, string> = { hat: 'beret', outfit: 'hoodie', shoes: 'sneakers', collar: 'bell' }

export const ICON_KEYS = Object.keys(BODY)

/** An inline <svg> for an item base's icon key (falls back to a little gift box). */
export function iconSvg(key: string | undefined, size = 32): string {
  const body = BODY[key ?? ''] ?? BODY[ALIAS[key ?? ''] ?? ''] ?? `<rect x="7" y="11" width="18" height="15" rx="2" fill="#ffd4a8" ${S}/><path d="M16 11v15M7 16h18" ${S}/><path d="M16 11c-3-5-8-3-6 0M16 11c3-5 8-3 6 0" fill="none" ${S}/>`
  return `<svg class="item-svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`
}
