/** Little synth jingles that have no sample: the level-up arpeggio and the rare-loot twinkle. */
export type Chime = 'levelup' | 'loot_rare' | 'loot_epic' | 'loot_legendary' | 'skill' | 'forge' | 'reroll' | 'contract'

const NOTES: Record<Chime, { f: number[]; step: number; len: number; type: OscillatorType; gain: number }> = {
  levelup: { f: [784, 988, 1175, 1568, 1976], step: 0.075, len: 0.42, type: 'triangle', gain: 0.22 },
  loot_rare: { f: [1319, 1760], step: 0.06, len: 0.3, type: 'sine', gain: 0.16 },
  loot_epic: { f: [1047, 1319, 1568, 2093], step: 0.055, len: 0.34, type: 'triangle', gain: 0.17 },
  loot_legendary: { f: [880, 1109, 1319, 1760, 2217, 2637], step: 0.06, len: 0.5, type: 'triangle', gain: 0.2 },
  skill: { f: [660, 990], step: 0.04, len: 0.16, type: 'sine', gain: 0.12 },
  /** Kiki's anvil: a bright rising sparkle when a gun goes up a level. */
  forge: { f: [523, 784, 1047, 1568, 2093], step: 0.05, len: 0.38, type: 'triangle', gain: 0.2 },
  reroll: { f: [988, 1319, 1175, 1568], step: 0.045, len: 0.26, type: 'sine', gain: 0.15 },
  /** A contract reward claimed at the board. */
  contract: { f: [659, 880, 1109, 1319], step: 0.07, len: 0.36, type: 'triangle', gain: 0.18 },
}

export function playChime(ctx: AudioContext, bus: AudioNode, chime: Chime): void {
  const spec = NOTES[chime]
  const t0 = ctx.currentTime + 0.01
  spec.f.forEach((f, i) => {
    const t = t0 + i * spec.step
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = spec.type
    osc.frequency.setValueAtTime(f, t)
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(spec.gain, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.001, t + spec.len)
    osc.connect(g).connect(bus)
    osc.start(t)
    osc.stop(t + spec.len + 0.02)
    // A soft octave sparkle on top.
    const hi = ctx.createOscillator()
    const hg = ctx.createGain()
    hi.type = 'sine'
    hi.frequency.setValueAtTime(f * 2, t)
    hg.gain.setValueAtTime(0, t)
    hg.gain.linearRampToValueAtTime(spec.gain * 0.25, t + 0.01)
    hg.gain.exponentialRampToValueAtTime(0.001, t + spec.len * 0.6)
    hi.connect(hg).connect(bus)
    hi.start(t)
    hi.stop(t + spec.len)
  })
}
