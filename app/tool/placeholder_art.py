"""Draws DexBot's placeholder app icons, until real art exists.

Re-run from `app/` after changing a colour: `python3 tool/placeholder_art.py`
(needs Pillow). The characters are `tool/characters.py`'s.
"""
from PIL import Image, ImageDraw

PRIMARY = (61, 220, 151)   # 0xff3ddc97, brand.dart's primary
SHADE = (31, 158, 103)     # 0xff1f9e67, brand.dart's shade
EYES = (240, 255, 248)     # 0xfff0fff8, brand.dart's eyes
BACKDROP = (21, 21, 30)    # the web manifest's background, #15151e
SCALE = 4                  # drawn large and scaled down, for smooth edges


def dex(size, canvas):
    """Dex, a rounded robot, drawn into a `canvas` of `size` at `SCALE`."""
    w, h = size
    d = ImageDraw.Draw(canvas)
    s = SCALE
    cx = w * s // 2
    # Antenna.
    d.line([(cx, int(h * 0.20 * s)), (cx, int(h * 0.29 * s))], fill=SHADE, width=int(w * 0.03 * s))
    r = int(w * 0.055 * s)
    d.ellipse([cx - r, int(h * 0.20 * s) - r, cx + r, int(h * 0.20 * s) + r], fill=PRIMARY)
    # Head.
    hw, top, bottom = int(w * 0.40 * s), int(h * 0.28 * s), int(h * 0.62 * s)
    d.rounded_rectangle([cx - hw, top, cx + hw, bottom], radius=int(w * 0.16 * s), fill=PRIMARY)
    # Eyes.
    ey, er, ex = int(h * 0.44 * s), int(w * 0.075 * s), int(w * 0.17 * s)
    for x in (cx - ex, cx + ex):
        d.ellipse([x - er, ey - er, x + er, ey + er], fill=EYES)
        pr = er // 2
        d.ellipse([x - pr, ey - pr + er // 4, x + pr, ey + pr + er // 4], fill=BACKDROP)
    # Body.
    bw, btop, bbottom = int(w * 0.30 * s), int(h * 0.64 * s), int(h * 0.86 * s)
    d.rounded_rectangle([cx - bw, btop, cx + bw, bbottom], radius=int(w * 0.10 * s), fill=SHADE)
    cr = int(w * 0.06 * s)
    cy = (btop + bbottom) // 2
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=PRIMARY)


def icon(path, px, backdrop=True, alpha=True, pad=0.0):
    side = px * SCALE
    big = Image.new("RGBA", (side, side), BACKDROP + (255,) if backdrop else (0, 0, 0, 0))
    inner = int(side * (1 - 2 * pad))
    figure = Image.new("RGBA", (inner, inner), (0, 0, 0, 0))
    dex((inner // SCALE, inner // SCALE), figure)
    offset = (side - inner) // 2
    big.alpha_composite(figure, (offset, offset))
    image = big.resize((px, px), Image.LANCZOS)
    if not alpha:
        image = image.convert("RGB")
    image.save(path, optimize=True)


icon("assets/branding/icon.png", 512)

for folder, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    res = f"android/app/src/main/res/mipmap-{folder}"
    icon(f"{res}/ic_launcher.png", px)
    icon(f"{res}/ic_launcher_round.png", px)
    # The adaptive foreground is 108dp with the safe zone in its middle 66dp.
    icon(f"{res}/ic_launcher_foreground.png", px * 108 // 48, backdrop=False, pad=0.2)

icon("ios/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_1024.png", 1024, alpha=False)
for px in (16, 32, 64, 128, 256, 512, 1024):
    icon(f"macos/Runner/Assets.xcassets/AppIcon.appiconset/app_icon_{px}.png", px)

icon("web/favicon.png", 32)
icon("web/icons/Icon-192.png", 192)
icon("web/icons/Icon-512.png", 512)
icon("web/icons/Icon-maskable-192.png", 192, pad=0.1)
icon("web/icons/Icon-maskable-512.png", 512, pad=0.1)
