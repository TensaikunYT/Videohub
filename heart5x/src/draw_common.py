"""Shared drawing engine: fonts, palette, background, heart sprite, ECG,
text helpers, grain/vignette. All coordinates are in design units
(1080x1920) and scaled by ctx['s'] at draw time.
"""

import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(os.path.dirname(HERE), "assets", "fonts")

W, H = 1080, 1920

# Palette (from brief)
VOID = (7, 9, 13)
NAVY = (11, 18, 32)
CRIMSON = (193, 18, 31)
CORAL = (255, 77, 90)
CYAN = (61, 214, 245)
INDIGO = (58, 75, 155)
AMBER = (255, 176, 32)
DANGER = (255, 59, 48)
WHITE = (255, 255, 255)
SECONDARY = (184, 194, 214)

_font_cache = {}


def font(family, size, weight=700):
    """Load a variable font at design-unit size, set weight variation."""
    key = (family, int(size), weight)
    if key in _font_cache:
        return _font_cache[key]
    files = {
        "montserrat": "Montserrat.ttf",
        "inter": "Inter.ttf",
        "mono": "JetBrainsMono.ttf",
    }
    path = os.path.join(FONTS, files[family])
    f = ImageFont.truetype(path, max(8, int(size)))
    try:
        axes = f.get_variation_axes()
        vals = [a['default'] for a in axes]
        for j, axis in enumerate(axes):
            if axis['name'] in (b'Weight', 'Weight', 'wght'):
                vals[j] = max(axis['minimum'], min(axis['maximum'], weight))
        f.set_variation_by_axes(vals)
    except Exception:
        pass
    _font_cache[key] = f
    return f


def S(ctx, v):
    return v * ctx["s"]


def box(ctx, x, y, w, h):
    s = ctx["s"]
    return [x * s, y * s, (x + w) * s, (y + h) * s]


def _vgrad(w, h, top, bottom):
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    t = np.linspace(0, 1, h)[:, None, None]
    top = np.array(top, dtype=np.float32)
    bot = np.array(bottom, dtype=np.float32)
    arr[:] = (top[None, None, :] * (1 - t) + bot[None, None, :] * t).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def make_background(ctx):
    """Dark-studio background: void->navy gradient, soft glows, haze, vignette."""
    s = ctx["s"]
    w, h = int(W * s), int(H * s)
    img = _vgrad(w, h, (10, 13, 22), VOID).convert("RGBA")
    # radial glows (crimson top-center, cyan bottom, indigo mid)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx, cy = w * 0.5, h * 0.34
    r = w * 0.75
    gd.ellipse([cx - r, cy - r * 1.2, cx + r, cy + r * 1.2], fill=(120, 20, 30, 46))
    cx2, cy2 = w * 0.5, h * 0.78
    r2 = w * 0.9
    gd.ellipse([cx2 - r2, cy2 - r2, cx2 + r2, cy2 + r2], fill=(30, 70, 95, 40))
    gd.ellipse([w * 0.1, h * 0.45, w * 0.9, h * 0.75], fill=(40, 50, 110, 30))
    glow = glow.filter(ImageFilter.GaussianBlur(w * 0.12))
    img.alpha_composite(glow)
    # vignette
    vig = Image.new("L", (w, h), 0)
    vd = ImageDraw.Draw(vig)
    vd.ellipse([-w * 0.25, -h * 0.12, w * 1.25, h * 1.12], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(w * 0.18))
    dark = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    img.paste(dark, (0, 0), Image.eval(vig, lambda v: 255 - v))
    return img


def heart_points(n=260, w=640.0, h=600.0):
    """Parametric heart outline points (x right, y down), centered at origin."""
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x / 17.0 * w / 2, -y / 17.0 * h / 2))
    return pts


def make_heart_sprite(ctx, width=640):
    """Stylized heart: gradient fill, rim light, highlight, aorta stub."""
    s = ctx["s"]
    ss = 2  # supersample
    w = int(width * s * ss)
    h = int(width * 0.94 * s * ss)
    pad = int(40 * s * ss)
    cw, ch = w + 2 * pad, h + 2 * pad
    mask = Image.new("L", (cw, ch), 0)
    md = ImageDraw.Draw(mask)
    pts = [(x * s * ss + cw / 2, y * s * ss + ch / 2) for x, y in heart_points(w=width, h=width * 0.94)]
    md.polygon(pts, fill=255)
    # gradient fill clipped by mask
    grad = _vgrad(cw, ch, (255, 96, 104), (70, 8, 16)).convert("RGBA")
    # darken bottom third
    shade = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    sd.rectangle([0, ch * 0.55, cw, ch], fill=(30, 0, 5, 110))
    shade = shade.filter(ImageFilter.GaussianBlur(pad * 0.6))
    grad.alpha_composite(shade)
    img = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)
    # rim light: coral outline glow
    rim = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rim)
    rd.polygon(pts, outline=(255, 110, 110, 200), width=max(2, int(3 * s * ss)))
    rim = rim.filter(ImageFilter.GaussianBlur(max(2, int(4 * s * ss))))
    img.alpha_composite(rim)
    # cyan fill light on left edge
    rim2 = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    rd2 = ImageDraw.Draw(rim2)
    left_pts = [p for p in pts if p[0] < cw / 2]
    rd2.polygon(pts, outline=(90, 200, 235, 90), width=max(2, int(2 * s * ss)))
    rim2 = rim2.filter(ImageFilter.GaussianBlur(max(2, int(6 * s * ss))))
    img.alpha_composite(rim2)
    # highlight
    hl = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hx, hy = cw * 0.36, ch * 0.30
    hr = w * 0.16
    hd.ellipse([hx - hr, hy - hr * 0.7, hx + hr, hy + hr * 0.7], fill=(255, 200, 200, 70))
    hl = hl.filter(ImageFilter.GaussianBlur(max(2, int(10 * s * ss))))
    img.alpha_composite(hl)
    # aorta stub on top
    ad = ImageDraw.Draw(img)
    ax = cw / 2
    aw = w * 0.13
    ad.rounded_rectangle([ax - aw / 2, ch * 0.06, ax + aw / 2, ch * 0.34],
                         radius=aw / 2, fill=(200, 40, 50, 255),
                         outline=(255, 120, 120, 255), width=max(1, int(2 * s * ss)))
    # Fine branching coronary vessels and layered contours, kept low contrast.
    vessel = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vessel)
    def path(points, color, thick):
        vd.line([(cw*x, ch*y) for x,y in points], fill=color, width=max(1,int(thick*s*ss)), joint="curve")
    path([(0.52,0.28),(0.52,0.39),(0.48,0.49),(0.46,0.60),(0.49,0.75)], (76,9,20,130), 7)
    path([(0.52,0.39),(0.43,0.42),(0.36,0.48),(0.29,0.53)], (255,157,143,95), 4)
    path([(0.50,0.47),(0.58,0.48),(0.68,0.53),(0.73,0.58)], (255,145,135,90), 4)
    path([(0.46,0.60),(0.37,0.62),(0.32,0.68)], (255,135,125,70), 3)
    # Clip details to the myocardium, avoiding the surrounding void.
    import PIL.ImageChops
    vessel.putalpha(PIL.ImageChops.multiply(vessel.getchannel('A'), mask))
    img.alpha_composite(vessel)
    # downscale + slight tilt for style
    img = img.resize((int(cw / ss), int(ch / ss)), Image.LANCZOS)
    img = img.rotate(-8, resample=Image.BICUBIC, expand=True)
    return img


def make_glow(sprite, blur=18):
    a = sprite.split()[3]
    g = Image.new("RGBA", sprite.size, (255, 60, 70, 0))
    g.putalpha(a.point(lambda v: int(v * 0.55)))
    return g.filter(ImageFilter.GaussianBlur(blur))


def paste_center(base, sprite, cx, cy, scale=1.0, alpha=255):
    """Paste sprite centered at design coords (cx, cy), scaled."""
    s = base.size[0] / W
    if scale != 1.0:
        nw = max(2, int(sprite.size[0] * scale))
        nh = max(2, int(sprite.size[1] * scale))
        sprite = sprite.resize((nw, nh), Image.LANCZOS)
    if alpha < 255:
        a = sprite.split()[3].point(lambda v: int(v * alpha / 255))
        sprite = sprite.copy()
        sprite.putalpha(a)
    x = int(cx * s - sprite.size[0] / 2)
    y = int(cy * s - sprite.size[1] / 2)
    base.alpha_composite(sprite, (x, y))
    return sprite


def draw_ecg(img, ctx, t, x0, y0, w, h, bpm_now, chaotic=False, window=3.0):
    """Scrolling ECG strip. x0,y0,w,h in design units."""
    import bpm_clock
    s = ctx["s"]
    d = ImageDraw.Draw(img, "RGBA")
    # baseline grid
    d.line([x0 * s, y0 * s, (x0 + w) * s, y0 * s], fill=(80, 100, 140, 120), width=max(1, int(2 * s)))
    n = 220
    pts = []
    for i in range(n + 1):
        tt = t - window + window * i / n
        if tt < 0:
            v = 0.0
        else:
            ph = bpm_clock.phase(tt)
            if chaotic:
                v = bpm_clock.ecg_value_chaotic(ph, bpm_clock.beat_index(tt))
            else:
                v = bpm_clock.ecg_value(ph)
        x = (x0 + w * i / n) * s
        y = (y0 - v * h * 0.85) * s
        pts.append((x, y))
    col = bpm_clock.bpm_color(bpm_now)
    # glow pass + core pass
    d.line(pts, fill=col + (70,), width=max(2, int(7 * s)), joint="curve")
    d.line(pts, fill=col + (235,), width=max(1, int(3 * s)), joint="curve")
    # leading dot
    d.ellipse([pts[-1][0] - 4 * s, pts[-1][1] - 4 * s, pts[-1][0] + 4 * s, pts[-1][1] + 4 * s],
              fill=col + (255,))


def text_center(img, ctx, cx, cy, text, fam, size, fill, weight=800, shadow=True):
    s = ctx["s"]
    f = font(fam, size * s, weight)
    d = ImageDraw.Draw(img, "RGBA")
    bbox = d.textbbox((0, 0), text, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    if tw > 840 * s:
        f = font(fam, size * s * (840 * s / tw), weight)
        bbox = d.textbbox((0, 0), text, font=f)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x, y = cx * s - tw / 2 - bbox[0], cy * s - th / 2 - bbox[1]
    if shadow:
        d.text((x + 3 * s, y + 3 * s), text, font=f, fill=(0, 0, 0, 160))
    d.text((x, y), text, font=f, fill=fill)
    return tw / s, th / s


def text_left(img, ctx, x, y, text, fam, size, fill, weight=800, shadow=True):
    s = ctx["s"]
    f = font(fam, size * s, weight)
    d = ImageDraw.Draw(img, "RGBA")
    if shadow:
        d.text((x * s + 3 * s, y * s + 3 * s), text, font=f, fill=(0, 0, 0, 160))
    d.text((x * s, y * s), text, font=f, fill=fill)


def draw_bpm_counter(img, ctx, bpm_now):
    """Persistent BPM counter, top-left inside safe area."""
    s = ctx["s"]
    import bpm_clock
    col = bpm_clock.bpm_color(bpm_now)
    d = ImageDraw.Draw(img, "RGBA")
    x, y = 80 * s, 218 * s
    # backdrop pill
    d.rounded_rectangle([x - 14 * s, y - 10 * s, x + 330 * s, y + 92 * s],
                        radius=16 * s, fill=(10, 14, 24, 150), outline=col + (120,),
                        width=max(1, int(2 * s)))
    f1 = font("mono", 30 * s, 700)
    f2 = font("mono", 62 * s, 700)
    d.text((x, y), "BPM", font=f1, fill=SECONDARY + (255,))
    d.text((x + 78 * s, y - 8 * s), f"{int(round(bpm_now))}", font=f2, fill=col + (255,))


def apply_grain(img, frame_idx, amount=7):
    """Film grain <=3%: low-amplitude monochrome noise."""
    rng = np.random.default_rng(frame_idx * 7919 + 13)
    w, h = img.size
    noise = rng.integers(0, 256, size=(h, w), dtype=np.uint8)
    nimg = Image.fromarray(noise, "L").convert("RGBA")
    nimg.putalpha(amount)
    img.alpha_composite(nimg)


def fade_to_black(img, alpha):
    """alpha 0..255 black overlay."""
    if alpha <= 0:
        return
    ov = Image.new("RGBA", img.size, (0, 0, 0, int(alpha)))
    img.alpha_composite(ov)


def tint_wash(img, color, alpha):
    if alpha <= 0:
        return
    ov = Image.new("RGBA", img.size, color + (int(alpha),))
    img.alpha_composite(ov)
