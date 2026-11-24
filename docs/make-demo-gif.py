"""Render the README demo GIF for dsh-task-traffic-light.

Draws the real panel colours and lamp layout next to a mock session list, so
the animation shows the whole idea: a lamp lights, you click it, the matching
session opens and its dot clears.
"""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import math, os

W, H = 720, 280
BG = (15, 16, 19)
CARD = (22, 23, 27)
CARD_LINE = (38, 40, 46)
ROW_ACTIVE = (31, 33, 39)
TEXT = (242, 243, 245)
MUTED = (154, 160, 166)
FAINT = (111, 116, 123)

RED = (255, 91, 80)
AMBER = (255, 214, 10)
GREEN = (48, 209, 88)
RED_OFF = (66, 17, 15)
AMBER_OFF = (69, 52, 4)
GREEN_OFF = (15, 56, 28)
DOT_OFF = (78, 82, 90)

FONT_DIR = "/System/Library/Fonts"
CJK = os.path.join(FONT_DIR, "Hiragino Sans GB.ttc")
FALLBACK = os.path.join(FONT_DIR, "STHeiti Medium.ttc")

PANEL = (44, 44, 104, 184)      # x, y, w, h
LAMP_R = 21
LAMP_X = 96
LAMP_Y = [80, 128, 176]
CARD_BOX = (186, 44, 486, 184)  # x, y, w, h
ROW_Y = [106, 150, 194]
ROW_H = 36


def font(size):
    for path in (CJK, FALLBACK):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


F_TITLE = font(13)
F_ROW = font(16)
F_CAP = font(16)


def rounded(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def glow_layer(size, center, radius, color, alpha, blur):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    x, y = center
    d.ellipse([x - radius, y - radius, x + radius, y + radius], fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def lamp(img, index, on_color, lit):
    x, y = LAMP_X, LAMP_Y[index]
    if lit:
        img.alpha_composite(glow_layer(img.size, (x, y), LAMP_R + 16, on_color, 120, 18))
    base = on_color if lit else [RED_OFF, AMBER_OFF, GREEN_OFF][index]
    d = ImageDraw.Draw(img)
    d.ellipse([x - LAMP_R, y - LAMP_R, x + LAMP_R, y + LAMP_R], fill=base)
    if lit:
        # inner highlight
        d.ellipse(
            [x - LAMP_R * 0.55, y - LAMP_R * 0.75, x + LAMP_R * 0.05, y - LAMP_R * 0.15],
            fill=tuple(min(255, c + 70) for c in base),
        )


def draw_cursor(img, pos, pressed):
    d = ImageDraw.Draw(img)
    x, y = pos
    poly = [(x, y), (x, y + 16), (x + 4, y + 12), (x + 7, y + 18), (x + 10, y + 16), (x + 7, y + 10), (x + 12, y + 10)]
    d.polygon(poly, fill=(250, 250, 252), outline=(20, 20, 24))
    if pressed:
        d.ellipse([x - 4, y - 4, x + 8, y + 8], outline=(250, 250, 252), width=2)


def render(state):
    img = Image.new("RGBA", (W, H), BG)
    d = ImageDraw.Draw(img)
    rounded(d, [-30, -30, W + 30, H + 30], 0, fill=BG)

    # ---- traffic light panel
    x, y, w, h = PANEL
    if state.get("border"):
        col = state["border"]
        img.alpha_composite(glow_layer(img.size, (x + w / 2, y + h / 2), 90, col, 60, 26))
    rounded(d, [x, y, x + w, y + h], 22, fill=(27, 28, 32), outline=(51, 53, 59), width=2)
    lamp(img, 0, RED, state.get("red", False))
    lamp(img, 1, AMBER, state.get("yellow", False))
    lamp(img, 2, GREEN, state.get("green", False))

    # ---- session list
    cx, cy, cw, ch = CARD_BOX
    rounded(d, [cx, cy, cx + cw, cy + ch], 16, fill=CARD, outline=CARD_LINE, width=1)
    d.text((cx + 20, cy + 14), "会话", font=F_TITLE, fill=FAINT)

    rows = state.get("rows", [])
    active = state.get("active", -1)
    for i, (label, dot) in enumerate(rows):
        ry = ROW_Y[i]
        if i == active:
            rounded(d, [cx + 10, ry - ROW_H // 2, cx + cw - 10, ry + ROW_H // 2], 10, fill=ROW_ACTIVE)
        elif i == active + 100:  # hover
            rounded(d, [cx + 10, ry - ROW_H // 2, cx + cw - 10, ry + ROW_H // 2], 10, fill=(27, 29, 34))
        dx = cx + 32
        d.ellipse([dx - 6, ry - 6, dx + 6, ry + 6], fill=dot)
        if dot in (RED, AMBER, GREEN):
            img.alpha_composite(glow_layer(img.size, (dx, ry), 12, dot, 90, 8))
            d.ellipse([dx - 6, ry - 6, dx + 6, ry + 6], fill=dot)
        d.text((cx + 50, ry - 9), label, font=F_ROW, fill=TEXT if i == active else (208, 211, 216))

    # ---- caption
    d.text((44, 250), state.get("caption", ""), font=F_CAP, fill=MUTED)

    # ---- cursor + click ripple
    if state.get("cursor"):
        if state.get("ripple"):
            rr = state["ripple"]
            px, py = state["cursor"]
            d.ellipse([px - rr, py - rr, px + rr, py + rr], outline=(255, 255, 255, 200), width=2)
        draw_cursor(img, state["cursor"], state.get("pressed", False))

    return img.convert("RGB")


def lerp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def build():
    frames, durations = [], []

    def add(state, n=4, ms=80):
        for _ in range(n):
            frames.append(render(state))
            durations.append(ms)

    rows_idle = [("重构登录流程", DOT_OFF), ("写周报", DOT_OFF), ("整理测试数据", DOT_OFF)]

    def rows(one=DOT_OFF, two=DOT_OFF, three=DOT_OFF):
        return [("重构登录流程", one), ("写周报", two), ("整理测试数据", three)]

    base = dict(rows=rows_idle, caption="DSH 在后台跑着，你不用一直盯着屏幕", cursor=(600, 236))

    add(dict(base), 6)

    add(dict(base, red=True, rows=rows(RED), caption="红灯：有会话正在干活"), 10, 90)

    add(dict(base, red=True, border=AMBER, yellow=True, rows=rows(RED, AMBER),
             caption="黄灯：有审批或提问在等你", cursor=(600, 236)), 8, 90)

    # cursor travels to the yellow lamp
    start, end = (600, 236), (110, 128)
    for i in range(6):
        t = (i + 1) / 6
        add(dict(base, red=True, border=AMBER, yellow=True, rows=rows(RED, AMBER),
                 caption="黄灯：有审批或提问在等你", cursor=lerp(start, end, t)), 1, 70)

    add(dict(base, red=True, border=AMBER, yellow=True, rows=rows(RED, AMBER),
             caption="点一下，直接跳过去", cursor=(110, 128), ripple=18, pressed=True), 3, 70)

    add(dict(base, red=True, rows=rows(RED, DOT_OFF), caption="回答完，那盏灯自己就灭了",
             cursor=(110, 128), active=1), 6, 90)

    add(dict(base, green=True, border=GREEN, rows=rows(GREEN, DOT_OFF), caption="绿灯：跑完了，你还没打开看过",
             cursor=(110, 128), active=1), 8, 90)

    start, end = (110, 128), (110, 176)
    for i in range(5):
        t = (i + 1) / 5
        add(dict(base, green=True, border=GREEN, rows=rows(GREEN, DOT_OFF),
                 caption="绿灯：跑完了，你还没打开看过", cursor=lerp(start, end, t), active=1), 1, 70)

    add(dict(base, green=True, border=GREEN, rows=rows(GREEN, DOT_OFF),
             caption="点一下，切到那个会话", cursor=(110, 176), ripple=18, pressed=True, active=1), 3, 70)

    add(dict(base, rows=rows(DOT_OFF, DOT_OFF), caption="绿点消完，绿灯才灭",
             cursor=(110, 176), active=0), 7, 90)

    return frames, durations


def main():
    frames, durations = build()
    out = "docs/demo.gif"
    palette_frames = [f.quantize(colors=96, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for f in frames]
    palette_frames[0].save(
        out,
        save_all=True,
        append_images=palette_frames[1:],
        duration=durations,
        loop=0,
        optimize=True,
        disposal=2,
    )
    size = os.path.getsize(out)
    print(f"{out}: {len(frames)} frames, {size/1024:.0f} KB, {sum(durations)/1000:.1f}s")
    frames[0].save("docs/.frame0.png")


if __name__ == "__main__":
    main()
