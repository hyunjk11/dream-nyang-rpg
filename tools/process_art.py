"""Cut generated sprites off their green screen and pack them for the game."""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

RAW = Path("/opt/cursor/artifacts/assets")
OUT = Path("/workspace/public/assets")
OUT.mkdir(parents=True, exist_ok=True)

FEET = {
    "byeolha": 512,
    "mochi": 512,
    "npc_luna": 512,
    "npc_popo": 512,
    "npc_kiki": 512,
    "enemy_slime": 512,
    "enemy_bug": 512,
    "enemy_rabbit": 512,
    "enemy_bat": 512,
    "boss_bloom": 768,
    "prop_tree": 640,
    "prop_mushroom": 640,
    "prop_house": 640,
    "prop_workshop": 640,
    "prop_fountain": 640,
    "prop_portal": 640,
    "prop_well": 512,
    "prop_board": 512,
}
CENTER = {
    "gun_water": 384,
    "gun_bubble": 384,
    "gun_dart": 384,
    "prop_crystal": 384,
    "prop_lantern": 384,
    "prop_flower": 320,
    "loot_coin": 256,
    "loot_dust": 256,
    "loot_gem": 256,
    "loot_part": 256,
}
PHOTOS = ["title_bg", "intro_sleep", "intro_fall", "intro_wake"]
TEXTURES = ["tex_grass", "tex_path", "tex_altar"]


def source(name: str) -> Path:
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        path = RAW / f"{name}{ext}"
        if path.exists():
            return path
    raise FileNotFoundError(name)


def cutout(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    arr = np.array(image)
    rgb = arr[:, :, :3].astype(np.float32)
    h, w = rgb.shape[:2]
    corners = np.stack([rgb[2, 2], rgb[2, w - 3], rgb[h - 3, 2], rgb[h - 3, w - 3]])
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    mask = dist < 90
    labeled, _ = ndimage.label(mask)
    border = np.unique(np.concatenate([labeled[0], labeled[-1], labeled[:, 0], labeled[:, -1]]))
    labels = [int(value) for value in border if int(value) != 0]
    cut = np.isin(labeled, labels) if labels else mask
    outside = ndimage.distance_transform_edt(~cut)
    alpha = np.where(cut, 0, 255).astype(np.float32)
    feather = (outside > 0) & (outside < 2.4)
    alpha[feather] = np.clip(outside[feather] / 2.4, 0, 1) * 255
    red, green, blue = rgb[:, :, 0].copy(), rgb[:, :, 1].copy(), rgb[:, :, 2].copy()
    # Enclosed chroma holes (gaps between hair, halo, vines) stay bright green.
    holes = (green > 170) & (green > red + 60) & (green > blue + 60)
    alpha[holes] = 0
    spill = np.clip(green - np.maximum(red, blue), 0, None)
    edge = alpha < 240
    green[edge] -= spill[edge] * 0.9
    arr[:, :, 0] = np.clip(red, 0, 255)
    arr[:, :, 1] = np.clip(green, 0, 255)
    arr[:, :, 2] = np.clip(blue, 0, 255)
    arr[:, :, 3] = np.clip(alpha, 0, 255)
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def trim(image: Image.Image) -> Image.Image:
    arr = np.array(image)
    alpha = arr[:, :, 3]
    ys, xs = np.where(alpha > 12)
    if len(xs) == 0:
        return image
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def pack(image: Image.Image, size: int, anchor: str) -> Image.Image:
    image = trim(image)
    pad = 4 if anchor == "feet" else int(size * 0.08)
    max_w = size - pad * 2
    max_h = size - (pad + 2 if anchor == "feet" else pad * 2)
    scale = min(max_w / image.width, max_h / image.height)
    image = image.resize((max(1, int(image.width * scale)), max(1, int(image.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - image.width) // 2
    y = size - image.height - 2 if anchor == "feet" else (size - image.height) // 2
    canvas.paste(image, (x, y), image)
    return canvas


def seamless(image: Image.Image, band: int = 48) -> Image.Image:
    src = np.array(image.convert("RGB")).astype(np.float32)

    def blend(axis: int) -> None:
        nonlocal src
        if axis == 0:
            src = np.swapaxes(src, 0, 1)
        length = src.shape[1]
        overlap = min(band, length // 4)
        ramp = np.linspace(0, 1, overlap, dtype=np.float32).reshape(1, overlap, 1)
        src[:, :overlap] = src[:, :overlap] * ramp + src[:, -overlap:] * (1 - ramp)
        ramp_back = np.linspace(0, 1, overlap, dtype=np.float32).reshape(1, overlap, 1)
        left = np.flip(src[:, :overlap], axis=1)
        src[:, -overlap:] = src[:, -overlap:] * (1 - ramp_back) + left * ramp_back
        if axis == 0:
            src = np.swapaxes(src, 0, 1)

    blend(1)
    blend(0)
    return Image.fromarray(np.clip(src, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    for name, size in FEET.items():
        pack(cutout(Image.open(source(name))), size, "feet").save(OUT / f"{name}.png", "PNG", optimize=True)
        print("cut", name)
    for name, size in CENTER.items():
        pack(cutout(Image.open(source(name))), size, "center").save(OUT / f"{name}.png", "PNG", optimize=True)
        print("cut", name)
    for name in PHOTOS:
        image = Image.open(source(name)).convert("RGB")
        image.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
        image.save(OUT / f"{name}.jpg", "JPEG", quality=86, optimize=True)
        print("photo", name)
    for name in TEXTURES:
        image = Image.open(source(name)).convert("RGB")
        image = image.resize((1024, 1024), Image.Resampling.LANCZOS)
        seamless(image).save(OUT / f"{name}.jpg", "JPEG", quality=86, optimize=True)
        print("tex", name)


if __name__ == "__main__":
    main()
