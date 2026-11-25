"""Build the README GIF and the plugin-market storefront assets.

Sources are real screenshots of TaskTrafficLight.app on a 1x screen
(98x166 each, background #121212). Everything here is derived from them, so
the assets can be regenerated after re-shooting:

    python3 docs/make-assets.py

Outputs:
    docs/demo.gif                  five states, looping, bilingual captions
    assets/screenshot-1..3.png     storefront carousel images (2x)
    assets/icon-180.png            storefront tile
"""
from PIL import Image, ImageDraw, ImageFont
import os

SCALE = 2
PAD = 20
BG = (18, 18, 18)
ZH = (232, 234, 238)
EN = (146, 152, 160)
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
SRC_DIR = "/tmp/lightgif"
SIZE = (98, 166)

# (screenshot, Chinese line, English line, hold in ms)
STATES = [
    ("s1.png", "没有任务在跑", "idle", 1300),
    ("s2.png", "有会话在跑", "working", 1300),
    ("s3.png", "有东西在等你", "waiting for you", 1500),
    ("s5.png", "跑完了，还没看", "finished, unread", 1500),
    ("s4.png", "灯亮到你打开它", "until you open it", 1600),
]

CANVAS_W = 452


def panel(name):
    """One screenshot without the capture's top border row."""
    img = Image.open(os.path.join(SRC_DIR, name)).convert("RGB").crop((0, 1, SIZE[0], SIZE[1]))
    return img.resize((SIZE[0] * SCALE, SIZE[1] * SCALE), Image.LANCZOS)


def card(name, zh, en):
    """Panel on the left, a two-line caption on the right."""
    img = panel(name)
    cw, ch = CANVAS_W, img.height + PAD * 2
    canvas = Image.new("RGB", (cw, ch), BG)
    canvas.paste(img, (PAD, PAD))

    d = ImageDraw.Draw(canvas)
    f_zh = ImageFont.truetype(FONT, 17)
    f_en = ImageFont.truetype(FONT, 13)
    zh_box = d.textbbox((0, 0), zh, font=f_zh)
    en_box = d.textbbox((0, 0), en, font=f_en)
    zh_h, en_h = zh_box[3] - zh_box[1], en_box[3] - en_box[1]
    gap = 10
    top = (ch - (zh_h + gap + en_h)) / 2
    d.text((236, top - zh_box[1]), zh, font=f_zh, fill=ZH)
    d.text((236, top + zh_h + gap - en_box[1]), en, font=f_en, fill=EN)
    return canvas


def make_gif():
    frames = [card(name, zh, en) for name, zh, en, _ in STATES]
    durations = [hold for _, _, _, hold in STATES]
    out = "docs/demo.gif"
    pal = [f.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
           for f in frames]
    pal[0].save(out, save_all=True, append_images=pal[1:], duration=durations, loop=0,
                optimize=True, disposal=2)
    return out, os.path.getsize(out) / 1024, sum(durations) / 1000


def make_screenshots():
    picks = [STATES[1], STATES[2], STATES[3]]
    out = []
    for i, (name, zh, en, _) in enumerate(picks, start=1):
        path = f"assets/screenshot-{i}.png"
        card(name, zh, en).save(path, optimize=True)
        out.append(path)
    return out


def make_icon():
    """180x180 tile: the housing and three lamps, no text."""
    s = 180
    img = Image.new("RGB", (s, s), (15, 16, 19))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=40, fill=(15, 16, 19))
    d.rounded_rectangle([52, 26, 128, 154], radius=26, fill=(27, 28, 32), outline=(51, 53, 59), width=3)
    for cy, color in ((56, (255, 91, 80)), (90, (255, 214, 10)), (124, (48, 209, 88))):
        d.ellipse([74, cy - 16, 106, cy + 16], fill=color)
    path = "assets/icon-180.png"
    img.save(path, optimize=True)
    return path


if __name__ == "__main__":
    os.makedirs("docs", exist_ok=True)
    os.makedirs("assets", exist_ok=True)
    gif, kb, secs = make_gif()
    shots = make_screenshots()
    icon = make_icon()
    from PIL import Image as _I
    w, h = _I.open(gif).size
    print(f"{gif}: {w}x{h} {kb:.0f} KB {secs:.1f}s")
    print("screenshots:", ", ".join(shots))
    print("icon:", icon)
