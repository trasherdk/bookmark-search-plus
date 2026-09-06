"""Generate toolbar icons: a gold star on a rounded amber tile."""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path


def write_png(path: Path, width: int, height: int, pixels: list[tuple[int, int, int, int]]) -> None:
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixels[y * width + x])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def point_in_polygon(x: float, y: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(poly) - 1
    for i, (xi, yi) in enumerate(poly):
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def star_polygon(cx: float, cy: float, outer: float, inner: float) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for i in range(10):
        angle = math.radians(-90 + i * 36)
        radius = outer if i % 2 == 0 else inner
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points


def rounded_rect(x: float, y: float, size: int, radius: float) -> bool:
    if x < 0 or y < 0 or x >= size or y >= size:
        return False
    if radius <= 0:
        return True
    if radius < x < size - radius and radius < y < size - radius:
        return True
    corners = (
        (radius, radius),
        (size - radius, radius),
        (radius, size - radius),
        (size - radius, size - radius),
    )
    if (x <= radius or x >= size - radius) and (y <= radius or y >= size - radius):
        cx = radius if x <= radius else size - radius
        cy = radius if y <= radius else size - radius
        return (x - cx) ** 2 + (y - cy) ** 2 <= radius**2
    return 0 <= x < size and 0 <= y < size


def make_icon(size: int) -> list[tuple[int, int, int, int]]:
    pixels: list[tuple[int, int, int, int]] = []
    radius = size * 0.22
    star = star_polygon(size / 2, size / 2 + size * 0.02, size * 0.34, size * 0.15)
    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            if not rounded_rect(px, py, size, radius):
                pixels.append((0, 0, 0, 0))
                continue
            if point_in_polygon(px, py, star):
                pixels.append((255, 213, 79, 255))
            else:
                pixels.append((232, 145, 16, 255))
    return pixels


def main() -> None:
    out = Path(__file__).resolve().parent
    for size in (16, 32, 48, 128):
        write_png(out / f"icon{size}.png", size, size, make_icon(size))


if __name__ == "__main__":
    main()
