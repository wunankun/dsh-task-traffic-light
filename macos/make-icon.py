"""Render the app icon master and the macOS .icns set.

Run with a Python that has Pillow:

    python3 macos/make-icon.py

It writes macos/Resources/AppIcon.icns (what build.sh copies into the bundle)
and refreshes assets/icon-180.png so the market card and the app agree.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SIZE = 1024
RED = (255, 91, 80)
AMBER = (255, 214, 10)
GREEN = (48, 209, 88)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def body() -> Image.Image:
    """The dark housing: a vertical gradient inside a macOS-shaped squircle."""
    inset = 100
    side = SIZE - inset * 2
    gradient = Image.new("RGB", (side, side))
    top, bottom = (40, 40, 44), (22, 22, 24)
    for y in range(side):
        t = y / (side - 1)
        gradient.paste(
            tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)),
            (0, y, side, y + 1),
        )
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    layer.paste(gradient, (inset, inset), rounded_mask(side, 185))
    return layer


def lamp(color, center, radius: int) -> Image.Image:
    """One lit lamp: a soft halo plus a shaded disc."""
    glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
        fill=color + (150,),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius * 0.55))

    disc = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(disc)
    draw.ellipse(
        (center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius),
        fill=color + (255,),
    )
    # A small specular highlight keeps the disc from reading as a flat sticker.
    shine = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shine).ellipse(
        (center[0] - radius * 0.62, center[1] - radius * 0.72,
         center[0] + radius * 0.05, center[1] - radius * 0.16),
        fill=(255, 255, 255, 70),
    )
    shine = shine.filter(ImageFilter.GaussianBlur(radius * 0.12))
    return Image.alpha_composite(glow, Image.alpha_composite(disc, shine))


def master() -> Image.Image:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas = Image.alpha_composite(canvas, body())
    radius = 92
    for color, y in ((RED, 372), (AMBER, 512), (GREEN, 652)):
        canvas = Image.alpha_composite(canvas, lamp(color, (SIZE // 2, y), radius))
    return canvas


def main() -> None:
    icon = master()
    resources = ROOT / "macos" / "Resources"
    resources.mkdir(parents=True, exist_ok=True)

    iconset = ROOT / "macos" / "build" / "AppIcon.iconset"
    iconset.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        icon.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
        icon.resize((size * 2, size * 2), Image.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")
    # iconutil turns the iconset directory into the .icns the bundle needs.
    import subprocess

    subprocess.run(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(resources / "AppIcon.icns")],
        check=True,
    )
    icon.resize((180, 180), Image.LANCZOS).save(ROOT / "assets" / "icon-180.png")
    print("wrote", resources / "AppIcon.icns", "and assets/icon-180.png")


if __name__ == "__main__":
    main()
