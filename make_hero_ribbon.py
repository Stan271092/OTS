# -*- coding: utf-8 -*-
"""
Генератор вязкой стеклянной ленты для hero OTS.
Рисует PNG на прозрачном фоне: тело ленты из «капель» вдоль кривой Безье,
слои с гауссовым размытием -> эффект стекла/шёлка, синие кромки.
Запуск:  python make_hero_ribbon.py
Выход:   assets/hero-ribbon-generated.png
"""
import math
from PIL import Image, ImageDraw, ImageFilter

W, H = 2400, 1350  # холст 16:9 под полноэкранный hero

# ---------- геометрия: цепочка кубических кривых Безье ----------
# S-образный проход через весь экран: вход слева-снизу, арка вверх,
# спад через центр, уход вправо
CURVES = [
    ((-180, 980), (520, 800), (860, 170), (1330, 330)),
    ((1330, 330), (1740, 470), (2040, 1180), (2600, 720)),
]

def bez(p0, p1, p2, p3, t):
    mt = 1 - t
    x = mt**3*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t**3*p3[0]
    y = mt**3*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t**3*p3[1]
    return x, y

def sample(n_per=240):
    pts = []
    for c in CURVES:
        for i in range(n_per):
            pts.append(bez(*c, i / (n_per - 1)))
    return pts

CENTER = sample()

# ширина ленты вдоль пути: тонкие концы, толстая середина
def envelope(t):
    return 60 + 360 * math.sin(math.pi * min(max(t, 0), 1)) ** 0.9

def tangent(pts, i):
    a = pts[max(0, i - 2)]; b = pts[min(len(pts) - 1, i + 2)]
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = math.hypot(dx, dy) or 1
    return dx / n, dy / n

def offset_path(shift_k):
    """Путь, сдвинутый от центра линии на долю локального радиуса."""
    out = []
    n = len(CENTER)
    for i, (x, y) in enumerate(CENTER):
        t = i / (n - 1)
        tx, ty = tangent(CENTER, i)
        nx, ny = -ty, tx
        r = envelope(t) * shift_k
        out.append((x + nx * r, y + ny * r))
    return out

# ---------- рисование слоёв ----------
def disc_chain(draw, pts, r_fn, color):
    n = len(pts)
    for i, (x, y) in enumerate(pts):
        t = i / (n - 1)
        r = r_fn(t)
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)

def layer(blur):
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    return img, ImageDraw.Draw(img)

def paste(base, img, opacity=1.0):
    if opacity < 1:
        a = img.split()[3].point(lambda v: int(v * opacity))
        img.putalpha(a)
    base.alpha_composite(img)

out = Image.new("RGBA", (W, H), (0, 0, 0, 0))

# 1) мягкая падающая тень
img, d = layer(0)
disc_chain(d, [(x, y + 46) for x, y in CENTER], lambda t: envelope(t) * 1.02, (196, 210, 220, 160))
img = img.filter(ImageFilter.GaussianBlur(58))
paste(out, img, 0.55)

# 2) тело ленты — холодная подложка
img, d = layer(0)
disc_chain(d, CENTER, envelope, (222, 233, 242, 255))
img = img.filter(ImageFilter.GaussianBlur(14))
paste(out, img)

# 3) основное «стекло» — чуть смещено вверх, почти белое
img, d = layer(0)
shift = [(x, y - 12) for x, y in CENTER]
disc_chain(d, shift, lambda t: envelope(t) * 0.9, (250, 253, 255, 250))
img = img.filter(ImageFilter.GaussianBlur(5))
paste(out, img)

# 3b) затенение нижней стороны тела — объём
img, d = layer(0)
under = [(x, y + 26) for x, y in CENTER]
disc_chain(d, under, lambda t: envelope(t) * 0.72, (188, 203, 218, 190))
img = img.filter(ImageFilter.GaussianBlur(20))
paste(out, img, 0.85)

# 3c) тонкая складка вдоль тела
img, d = layer(0)
crease = offset_path(0.18)
for i in range(len(crease) - 1):
    d.line([crease[i], crease[i + 1]], fill=(198, 212, 226, 130), width=13, joint="curve")
img = img.filter(ImageFilter.GaussianBlur(9))
paste(out, img, 0.8)

# 4) светлое ядро — блик по «гребню»
img, d = layer(0)
core = [(x, y - 36) for x, y in CENTER]
disc_chain(d, core, lambda t: envelope(t) * 0.44, (255, 255, 255, 245))
img = img.filter(ImageFilter.GaussianBlur(15))
paste(out, img)

# 5) глянцевая верхняя кромка — тонкая белая линия
img, d = layer(0)
top_edge = offset_path(-0.76)
for i in range(len(top_edge) - 1):
    d.line([top_edge[i], top_edge[i + 1]], fill=(255, 255, 255, 245), width=11, joint="curve")
img = img.filter(ImageFilter.GaussianBlur(2.5))
paste(out, img, 0.95)

# 6) синий акцент вдоль верхней кромки (арка справа-сверху, t~0.25..0.5)
img, d = layer(0)
n = len(top_edge)
for i in range(int(n * 0.22), int(n * 0.52)):
    t = i / (n - 1)
    fade = math.sin(math.pi * (t - 0.22) / 0.30)  # мягкое нарастание/затухание
    x, y = top_edge[i]
    r = 9 * fade + 3
    d.ellipse([x - r, y - r, x + r, y + r], fill=(47, 123, 255, 235))
img = img.filter(ImageFilter.GaussianBlur(5))
paste(out, img, 0.95)

# 7) синяя прожилка вдоль нижней кромки (лево-низ, t~0.55..0.8)
img, d = layer(0)
low_edge = offset_path(0.78)
n = len(low_edge)
for i in range(int(n * 0.55), int(n * 0.82)):
    t = i / (n - 1)
    fade = math.sin(math.pi * (t - 0.55) / 0.27)
    x, y = low_edge[i]
    r = 11 * fade + 3
    d.ellipse([x - r, y - r, x + r, y + r], fill=(41, 166, 255, 230))
img = img.filter(ImageFilter.GaussianBlur(6))
paste(out, img, 0.9)

# 8) тонкие «пряди», отходящие от ленты
WISPS = [
    ((1250, 380), (1000, 640), (700, 560), (430, 720), 34),
    ((1450, 420), (1600, 700), (1500, 900), (1750, 1080), 40),
    ((900, 300), (650, 180), (400, 260), (160, 120), 26),
]
img, d = layer(0)
for p0, p1, p2, p3, wdt in WISPS:
    for i in range(90):
        t = i / 89
        x, y = bez(p0, p1, p2, p3, t)
        fade = math.sin(math.pi * t) ** 0.7
        r = wdt * fade
        d.ellipse([x - r, y - r, x + r, y + r], fill=(210, 226, 238, 130))
img = img.filter(ImageFilter.GaussianBlur(30))
paste(out, img, 0.55)

out.save("assets/hero-ribbon-generated.png")
print("saved assets/hero-ribbon-generated.png", out.size)
