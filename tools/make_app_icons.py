"""Draws the GoBoard logo (img/logo.svg) as PNG app icons for the install-as-an-app feature.

Run: python tools/make_app_icons.py   (needs numpy). Writes img/icon-192.png, img/icon-512.png,
img/icon-maskable-512.png (logo smaller, on a full background, for phones that cut icons into
shapes), img/apple-touch-icon.png and /apple-touch-icon.png (180, for iPhones and iPads), and PNG
favicons (Safari can't show the SVG one).
"""
import struct
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
WOOD, LINE, BLACK, WHITE, BACKGROUND = (0xDC, 0xB3, 0x5C), (0x3B, 0x2A, 0x14), (0x11, 0x11, 0x11), (0xF4, 0xF2, 0xEC), (0x30, 0x2E, 0x2B)


def draw(size, logo_fraction, background):
    """The logo in a 34x34 box, scaled to logo_fraction of the icon, 4x4 supersampled."""
    ss = 4
    n = size * ss
    ys, xs = np.mgrid[0:n, 0:n] + 0.5
    scale = n * logo_fraction / 34
    offset = (n - 34 * scale) / 2
    x = (xs - offset) / scale  # logo coordinates
    y = (ys - offset) / scale
    rgb = np.zeros((n, n, 3))
    alpha = np.zeros((n, n))
    if background is not None:
        rgb[:] = background
        alpha[:] = 1

    def paint(mask, color):
        rgb[mask] = color
        alpha[mask] = 1

    board = (x - 17) ** 2 + (y - 17) ** 2 <= 17 ** 2
    paint(board, WOOD)
    half = 0.7
    lines = (((np.abs(y - 11) <= half) & (x >= 4) & (x <= 30)) | ((np.abs(y - 23) <= half) & (x >= 2) & (x <= 32))
             | ((np.abs(x - 11) <= half) & (y >= 4) & (y <= 30)) | ((np.abs(x - 23) <= half) & (y >= 2) & (y <= 32)))
    paint(lines & board, LINE)
    paint((x - 11) ** 2 + (y - 11) ** 2 <= 6.5 ** 2, BLACK)
    paint((x - 23) ** 2 + (y - 23) ** 2 <= 6.5 ** 2, WHITE)

    # Average each 4x4 block (smooth edges).
    rgb = (rgb * alpha[..., None]).reshape(size, ss, size, ss, 3).mean(axis=(1, 3))
    a = alpha.reshape(size, ss, size, ss).mean(axis=(1, 3))
    rgb = np.where(a[..., None] > 0, rgb / np.maximum(a[..., None], 1e-9), 0)
    return np.dstack([rgb, a * 255]).round().clip(0, 255).astype(np.uint8)


def write_png(path, pixels):
    h, w, _ = pixels.shape
    raw = b"".join(b"\x00" + pixels[row].tobytes() for row in range(h))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"wrote {path.relative_to(ROOT)} ({len(png)} bytes)")


if __name__ == "__main__":
    img = ROOT / "img"
    write_png(img / "icon-192.png", draw(192, 1.0, None))
    write_png(img / "icon-512.png", draw(512, 1.0, None))
    write_png(img / "icon-maskable-512.png", draw(512, 0.7, BACKGROUND))
    write_png(img / "apple-touch-icon.png", draw(180, 0.86, BACKGROUND))
    # iPad/iPhone Safari can't use the SVG favicon, and looks for /apple-touch-icon.png at the site root.
    write_png(ROOT / "apple-touch-icon.png", draw(180, 0.86, BACKGROUND))
    write_png(img / "favicon-32.png", draw(32, 1.0, None))
    write_png(img / "favicon-96.png", draw(96, 1.0, None))
