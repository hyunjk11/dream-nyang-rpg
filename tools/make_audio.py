"""Original soft dream-pop loops and UI/combat stings for 꿈냥 RPG."""

from pathlib import Path

import numpy as np

SR = 44100
OUT = Path("/workspace/public/assets/audio")
OUT.mkdir(parents=True, exist_ok=True)


def midi(note: float) -> float:
    return 440 * 2 ** ((note - 69) / 12)


def env(n: int, attack: float, release: float) -> np.ndarray:
    a = max(1, int(attack * SR))
    r = max(1, int(release * SR))
    if a + r >= n:
        return np.linspace(0, 1, n)
    sustain = n - a - r
    return np.concatenate([np.linspace(0, 1, a), np.ones(sustain), np.linspace(1, 0, r)])


def tone(freq: float, dur: float, volume: float, harmonics=(1, 0.35, 0.12)) -> np.ndarray:
    n = int(SR * dur)
    t = np.arange(n) / SR
    wave = np.zeros(n)
    for index, amp in enumerate(harmonics, start=1):
        wave += amp * np.sin(2 * np.pi * freq * index * t)
    return wave * env(n, 0.02, min(0.4, dur * 0.45)) * volume


def write(path: Path, samples: np.ndarray) -> None:
    stereo = np.column_stack([samples, np.roll(samples, int(0.012 * SR))]) if samples.ndim == 1 else samples
    peak = np.max(np.abs(stereo)) or 1
    stereo = np.clip(stereo / peak * 0.9, -1, 1)
    pcm = (stereo * 32767).astype(np.int16)
    import wave

    with wave.open(str(path), "w") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())


def loop_cross(samples: np.ndarray, fade: int = 1200) -> np.ndarray:
    if len(samples) <= fade * 2:
        return samples
    out = samples[:-fade].copy()
    ramp = np.linspace(0, 1, fade)
    out[:fade] = samples[:fade] * ramp + samples[-fade:] * (1 - ramp)
    return out


def music(kind: str) -> np.ndarray:
    bpm = 78 if kind == "village" else 96
    beat = 60 / bpm
    bars = 8
    total = int(SR * beat * 4 * bars)
    mix = np.zeros(total)
    progression = [60, 57, 65, 67] if kind == "village" else [60, 65, 67, 57]
    qualities = {
        60: [0, 4, 7, 11],
        57: [0, 3, 7, 10],
        65: [0, 4, 7, 11],
        67: [0, 4, 7, 10],
    }
    melody = [
        76, 79, 81, 79, 76, 74, 76, 79,
        76, 72, 69, 71, 72, 76, 74, 72,
        77, 81, 84, 81, 79, 77, 76, 74,
        74, 79, 83, 81, 79, 77, 76, 74,
    ]
    if kind == "battle":
        melody = [m + (0 if i % 4 else 0) for i, m in enumerate(melody)]
    for bar, root in enumerate(progression * 2):
        start = int(bar * 4 * beat * SR)
        dur = 4 * beat * 0.98
        for interval in qualities[root]:
            freq = midi(root + interval - 12)
            note = tone(freq, dur, 0.05 if kind == "village" else 0.06, (1, 0.2, 0.05))
            mix[start : start + len(note)] += note
        bass = tone(midi(root - 24), beat * 1.8, 0.12 if kind == "village" else 0.16, (1, 0.15))
        mix[start : start + len(bass)] += bass
        if kind == "battle":
            pulse = tone(midi(root - 12), beat * 0.35, 0.07, (1, 0.05))
            for step in range(4):
                at = start + int(step * beat * SR)
                mix[at : at + len(pulse)] += pulse
    step = beat / 2
    for index, note in enumerate(melody * 2):
        if kind == "battle" and index % 2 == 1 and note < 74:
            continue
        start = int(index * step * SR)
        bell = tone(midi(note), beat * 0.7, 0.09 if kind == "village" else 0.07, (1, 0.45, 0.18, 0.05))
        end = min(total, start + len(bell))
        mix[start:end] += bell[: end - start]
    # soft noise hats
    rng = np.random.default_rng(3 if kind == "village" else 9)
    for index in range(bars * 4):
        start = int(index * beat * SR)
        n = int(0.05 * SR)
        hat = rng.normal(0, 0.015 if kind == "village" else 0.03, n) * np.linspace(1, 0, n)
        mix[start : start + n] += hat
    return loop_cross(mix)


def sting(kind: str) -> np.ndarray:
    rng = np.random.default_rng(abs(hash(kind)) % 10000)
    if kind == "shoot_water":
        t = np.arange(int(0.09 * SR)) / SR
        return np.sin(2 * np.pi * np.linspace(980, 520, len(t)) * t) * np.linspace(1, 0, len(t)) * 0.4 + rng.normal(0, 0.05, len(t)) * np.linspace(1, 0, len(t))
    if kind == "shoot_bubble":
        t = np.arange(int(0.16 * SR)) / SR
        return np.sin(2 * np.pi * 420 * t + np.sin(2 * np.pi * 8 * t)) * np.linspace(1, 0, len(t)) * 0.35
    if kind == "shoot_dart":
        t = np.arange(int(0.05 * SR)) / SR
        return (np.sin(2 * np.pi * 1800 * t) + rng.normal(0, 0.2, len(t))) * np.linspace(1, 0, len(t)) * 0.3
    if kind == "hit":
        n = int(0.08 * SR)
        return rng.normal(0, 1, n) * np.linspace(1, 0, n) ** 2 * 0.35
    if kind == "crit":
        a = tone(midi(88), 0.08, 0.3)
        b = tone(midi(96), 0.12, 0.25)
        return np.concatenate([a, b])
    if kind == "hurt":
        t = np.arange(int(0.22 * SR)) / SR
        return np.sin(2 * np.pi * np.linspace(320, 140, len(t)) * t) * np.linspace(1, 0, len(t)) * 0.35
    if kind == "dash":
        n = int(0.16 * SR)
        noise = rng.normal(0, 1, n)
        return noise * np.linspace(0.2, 1, n) * np.linspace(1, 0, n) * 0.25
    if kind == "pickup":
        return np.concatenate([tone(midi(84), 0.08, 0.25), tone(midi(88), 0.12, 0.22)])
    if kind == "coin":
        return np.concatenate([tone(midi(96), 0.06, 0.22), tone(midi(103), 0.1, 0.2)])
    if kind == "ui":
        return tone(midi(90), 0.05, 0.18, (1, 0.2))
    if kind == "levelup":
        notes = [72, 76, 79, 84]
        return np.concatenate([tone(midi(n), 0.12, 0.22) for n in notes])
    if kind == "heal":
        return sum(tone(midi(n), 0.35, 0.12) for n in (72, 76, 79))
    if kind == "explode":
        n = int(0.28 * SR)
        return rng.normal(0, 1, n) * np.linspace(1, 0, n) ** 1.6 * 0.45
    if kind == "quest":
        return np.concatenate([tone(midi(n), 0.1, 0.2) for n in (76, 79, 84)])
    if kind == "boss":
        n = int(0.35 * SR)
        t = np.arange(n) / SR
        return np.sin(2 * np.pi * 90 * t) * np.linspace(1, 0, n) * 0.4 + rng.normal(0, 0.15, n) * np.linspace(1, 0, n)
    if kind == "potion":
        return np.concatenate([tone(midi(n), 0.09, 0.18) for n in (79, 83, 88)])
    n = int(0.08 * SR)
    return np.sin(2 * np.pi * 180 * np.arange(n) / SR) * np.linspace(1, 0, n) * 0.2


def main() -> None:
    write(OUT / "bgm_village.wav", music("village"))
    write(OUT / "bgm_battle.wav", music("battle"))
    for name in [
        "shoot_water",
        "shoot_bubble",
        "shoot_dart",
        "hit",
        "crit",
        "hurt",
        "dash",
        "pickup",
        "coin",
        "ui",
        "levelup",
        "heal",
        "explode",
        "quest",
        "boss",
        "potion",
        "deny",
    ]:
        sample = sting(name)
        write(OUT / f"{name}.wav", sample)
        print(name)


if __name__ == "__main__":
    main()
