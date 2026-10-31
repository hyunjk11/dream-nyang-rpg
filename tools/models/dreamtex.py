# Dream pastel recolour of a texture: python3 dreamtex.py in out png|webp (needs Pillow)
import sys, io
from PIL import Image
import colorsys
src, dst, fmt = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(src).convert('RGBA')
px = im.load()
lav = (216/255, 200/255, 255/255)
for y in range(im.height):
    for x in range(im.width):
        r, g, b, a = px[x, y]
        h, s, v = colorsys.rgb_to_hsv(r/255, g/255, b/255)
        # Pastel: less saturation, lifted shadows; warm reds/browns lean pink-lilac.
        if s > 0.15 and (h < 0.11 or h > 0.9):
            h = 0.92 + (h if h < 0.5 else h - 1) * 0.3
        s *= 0.62
        v = 0.34 + 0.66 * v
        rr, gg, bb = colorsys.hsv_to_rgb(h % 1, s, v)
        k = 0.22
        rr, gg, bb = rr*(1-k)+lav[0]*k, gg*(1-k)+lav[1]*k, bb*(1-k)+lav[2]*k
        px[x, y] = (int(rr*255), int(gg*255), int(bb*255), a)
im.save(dst, fmt.upper(), **({'quality': 90} if fmt == 'webp' else {'optimize': True}))
