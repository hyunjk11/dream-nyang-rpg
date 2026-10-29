"""Turn generated walk sheets into uniform-frame spritesheets."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

from process_art import cutout

RAW = Path("/opt/cursor/artifacts/assets")
OUT = Path("/workspace/public/assets")

SHEETS = [
    ("byeolha_walk_side", 6, "byeolha"),
    ("byeolha_walk_front", 6, "byeolha"),
    ("byeolha_walk_back", 6, "byeolha"),
    ("byeolha_idle", 4, "byeolha"),
    ("byeolha_hit", 4, "byeolha"),
    ("byeolha_dash", 4, "byeolha"),
    ("byeolha_death", 4, "byeolha"),
    ("mochi_walk", 6, "mochi"),
    ("mochi_idle", 4, "mochi"),
]


def source(name: str) -> Path:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        path = RAW / f"{name}{ext}"
        if path.exists():
            return path
    raise FileNotFoundError(name)


def split(image: Image.Image, expected: int) -> list[Image.Image]:
    arr = np.array(image)
    alpha = arr[:, :, 3] > 16
    cols = alpha.any(axis=0)
    spans: list[tuple[int, int]] = []
    start = None
    for i, on in enumerate(cols):
        if on and start is None:
            start = i
        elif not on and start is not None:
            if i - start > 8:
                spans.append((start, i))
            start = None
    if start is not None and len(cols) - start > 8:
        spans.append((start, len(cols)))
    # Merge spans split by a thin hole inside one character.
    merged: list[tuple[int, int]] = []
    for span in spans:
        if merged and span[0] - merged[-1][1] < 14:
            merged[-1] = (merged[-1][0], span[1])
        else:
            merged.append(span)
    if len(merged) != expected:
        xs = np.where(cols)[0]
        left, right = int(xs[0]), int(xs[-1]) + 1
        width = right - left
        merged = []
        for i in range(expected):
            a = left + int(round(i * width / expected))
            b = left + int(round((i + 1) * width / expected))
            merged.append((a, b))
    frames = []
    for a, b in merged:
        pad = 2
        crop = image.crop((max(0, a - pad), 0, min(image.width, b + pad), image.height))
        frames.append(trim(crop))
    return frames


def trim(image: Image.Image) -> Image.Image:
    arr = np.array(image)
    ys, xs = np.where(arr[:, :, 3] > 16)
    if len(xs) == 0:
        return image
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def build(name: str, expected: int, group: str, scale: float, canvas: tuple[int, int]) -> dict:
    image = cutout(Image.open(source(name)).convert("RGBA"))
    frames = split(image, expected)
    cw, ch = canvas
    sheet = Image.new("RGBA", (cw * len(frames), ch), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        resized = frame.resize(
            (max(1, int(frame.width * scale)), max(1, int(frame.height * scale))),
            Image.Resampling.LANCZOS,
        )
        if resized.width > cw - 4 or resized.height > ch - 4:
            fit = min((cw - 8) / resized.width, (ch - 8) / resized.height)
            resized = resized.resize(
                (max(1, int(resized.width * fit)), max(1, int(resized.height * fit))),
                Image.Resampling.LANCZOS,
            )
        x = index * cw + (cw - resized.width) // 2
        y = ch - resized.height - 4
        sheet.paste(resized, (x, y), resized)
    sheet.save(OUT / f"{name}.png", "PNG", optimize=True)
    print(name, "frames", len(frames), "cell", cw, ch)
    return {"key": name, "file": f"{name}.png", "frameWidth": cw, "frameHeight": ch, "frames": len(frames)}


def group_scale(names: list[str], counts: dict[str, int], target_h: int) -> float:
    heights = []
    for name in names:
        image = cutout(Image.open(source(name)).convert("RGBA"))
        for frame in split(image, counts[name]):
            heights.append(frame.height)
    return target_h / max(heights)


def main() -> None:
    counts = {name: count for name, count, _group in SHEETS}
    byeolha_names = [name for name, _c, group in SHEETS if group == "byeolha" and "death" not in name and "dash" not in name]
    mochi_names = [name for name, _c, group in SHEETS if group == "mochi"]
    byeolha_scale = group_scale(byeolha_names, counts, 332)
    mochi_scale = group_scale(mochi_names, counts, 200)
    meta = []
    for name, count, group in SHEETS:
        if group == "byeolha":
            meta.append(build(name, count, group, byeolha_scale, (300, 400)))
        else:
            meta.append(build(name, count, group, mochi_scale, (280, 260)))
    lines = [
        "export interface SheetDef {",
        "  key: string",
        "  file: string",
        "  frameWidth: number",
        "  frameHeight: number",
        "  frames: number",
        "}",
        "",
        "export const SHEETS: SheetDef[] = [",
    ]
    for row in meta:
        lines.append(
            f"  {{ key: '{row['key']}', file: '{row['file']}', frameWidth: {row['frameWidth']}, frameHeight: {row['frameHeight']}, frames: {row['frames']} }},"
        )
    lines.append("]")
    lines.append("")
    Path("/workspace/src/game/sheets.ts").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
