"""Makes DexBot's characters: DiceBear "Personas" avatars on its "Bold Pop" backgrounds.

Personas is by Draftbit, licensed CC BY 4.0, so DexBot credits it
(assets/characters/CREDITS.md). Each still is fetched as SVG from DiceBear's
API at a pinned version, rendered at 512 px by `rsvg-convert`, and cut to a
circle, since the client draws a still exactly as given.

Re-run from `app/` after changing the cast: `python3 tool/characters.py`
(needs Pillow and librsvg). It prints the `CharacterDefinition` list that
`lib/brand.dart` holds.
"""
import io
import os
import subprocess
import sys
import urllib.parse
import urllib.request

from PIL import Image, ImageDraw

API = "https://api.dicebear.com/10.x/personas/svg"
BOLD_POP = ["ff5d8f", "ffb703", "43aa8b", "4d96ff", "b57bff"]
SIZE = 512

# id, label, the seed that draws it, and the Gemini voice it starts with.
CAST = [
    ("dex", "Dex", "Dex", "Kore"),
    ("ivy", "Ivy", "Ivy", "Aoede"),
    ("kai", "Kai", "Kai", "Puck"),
    ("eli", "Eli", "Eli", "Fenrir"),
    ("gia", "Gia", "Gia", "Leda"),
    ("nova", "Nova", "Nova", "Zephyr"),
    ("leo", "Leo", "Leo", "Charon"),
    ("juno", "Juno", "Juno", "Orus"),
]


def fetch(seed):
    print(f"fetching {seed}", file=sys.stderr)
    query = urllib.parse.urlencode({"seed": seed, "backgroundColor": ",".join(BOLD_POP)}, safe=",")
    with urllib.request.urlopen(f"{API}?{query}") as response:
        svg = response.read()
    png = subprocess.run(
        ["rsvg-convert", "-w", str(SIZE), "-h", str(SIZE)],
        input=svg, capture_output=True, check=True,
    ).stdout
    return Image.open(io.BytesIO(png)).convert("RGBA")


def round_off(image):
    scale = 4
    mask = Image.new("L", (SIZE * scale, SIZE * scale), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, SIZE * scale, SIZE * scale), fill=255)
    image.putalpha(mask.resize((SIZE, SIZE), Image.LANCZOS))
    return image


def hex_of(rgb):
    return "0xff" + "".join(f"{v:02x}" for v in rgb)


os.makedirs("assets/characters", exist_ok=True)
for id_, label, seed, voice in CAST:
    image = round_off(fetch(seed))
    image.save(f"assets/characters/{id_}.png", optimize=True)
    backdrop = image.getpixel((SIZE // 2, 12))[:3]
    shade = tuple(int(v * 0.72) for v in backdrop)
    print(f"""    CharacterDefinition(
      '{id_}',
      '{label}',
      Color({hex_of(backdrop)}),
      Color({hex_of(shade)}),
      Color(0xffffffff),
      ink: _round,
      still: 'assets/characters/{id_}.png',
      voice: '{voice}',
    ),""")
