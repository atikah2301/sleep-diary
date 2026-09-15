"""One-off script to generate the PWA icon PNGs. Not part of the deployed app."""

from PIL import Image, ImageDraw

BG = (30, 27, 75)  # deep indigo, matches the app's dark theme
MOON = (250, 204, 21)  # warm crescent


def make_icon(size: int, path: str) -> None:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    corner_radius = size // 6
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=corner_radius, fill=BG)

    moon_radius = size * 0.32
    center = (size * 0.46, size * 0.5)
    draw.ellipse(
        [
            center[0] - moon_radius,
            center[1] - moon_radius,
            center[0] + moon_radius,
            center[1] + moon_radius,
        ],
        fill=MOON,
    )

    bite_radius = moon_radius * 0.92
    bite_center = (center[0] + moon_radius * 0.62, center[1] - moon_radius * 0.28)
    draw.ellipse(
        [
            bite_center[0] - bite_radius,
            bite_center[1] - bite_radius,
            bite_center[0] + bite_radius,
            bite_center[1] + bite_radius,
        ],
        fill=BG,
    )

    img.save(path)


if __name__ == "__main__":
    make_icon(192, "icon-192.png")
    make_icon(512, "icon-512.png")
