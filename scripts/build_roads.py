"""Turn the OpenStreetMap road network into something an offline app can draw.

Run:  python scripts/build_roads.py
In:   data/raw/osm/roads.json      (Overpass, ways with geometry)
Out:  public/data/roads.json

The live map used to draw only the 48 accident-prone segments, which meant a
rider saw four red lines floating in the dark and no road to put them on. The
honest fix is not map tiles — a tiled map is a request per square per zoom,
and it would be the one thing in this app that goes blank in airplane mode,
on the screen where we say nothing does. The fix is to carry the roads.

Mauritius is small enough that this is possible. The whole classified network
is a few thousand ways; the job here is to get it under a couple of hundred
kilobytes without it looking wrong at the zoom levels the map actually uses
(one to five kilometres across).

Three things do that work:

  * Only the classified network. Motorway down to tertiary. Residential
    streets would triple the size and are not what a rider navigates by.
  * Douglas-Peucker, with a tolerance set in metres rather than degrees, so
    a bend is kept by how far it actually deviates and not by how far north
    it happens to be.
  * Five decimal places, which is about a metre here. Any more is storing
    GPS noise and paying for it in bytes on every phone.

Class is kept per way because the map draws a motorway thicker than a
tertiary road, and that single distinction is most of what makes a tangle of
lines read as a road network.
"""

from __future__ import annotations

import io
import json
import math
import os

RAW = os.path.join("data", "raw", "osm", "roads.json")
OUT = os.path.join("public", "data", "roads.json")

# Metres of allowed deviation, per class. A motorway is drawn thick and
# followed at speed, so it can be simplified harder than a tertiary road
# whose bends are the thing that identifies it.
TOLERANCE_M = {
    "motorway": 28.0,
    "trunk": 24.0,
    "primary": 20.0,
    "secondary": 16.0,
    "tertiary": 14.0,
}

# Rank, so the map can draw the important roads last and on top.
RANK = {"motorway": 4, "trunk": 3, "primary": 2, "secondary": 1, "tertiary": 0}

KM_PER_DEG_LAT = 110.574
KM_PER_DEG_LON = 104.4


def metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    return (
        math.hypot((a[0] - b[0]) * KM_PER_DEG_LAT, (a[1] - b[1]) * KM_PER_DEG_LON) * 1000.0
    )


def perpendicular_m(p, a, b) -> float:
    """Distance from p to the segment ab, in metres."""
    ax, ay = a[1] * KM_PER_DEG_LON, a[0] * KM_PER_DEG_LAT
    bx, by = b[1] * KM_PER_DEG_LON, b[0] * KM_PER_DEG_LAT
    px, py = p[1] * KM_PER_DEG_LON, p[0] * KM_PER_DEG_LAT
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay) * 1000.0
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 1000.0


def simplify(points: list[tuple[float, float]], tol: float) -> list[tuple[float, float]]:
    """Douglas-Peucker, iterative so a long coastal road cannot blow the stack."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        lo, hi = stack.pop()
        worst, index = 0.0, -1
        for i in range(lo + 1, hi):
            d = perpendicular_m(points[i], points[lo], points[hi])
            if d > worst:
                worst, index = d, i
        if index != -1 and worst > tol:
            keep[index] = True
            stack.append((lo, index))
            stack.append((index, hi))
    return [p for p, k in zip(points, keep) if k]


def main() -> None:
    raw = json.load(io.open(RAW, encoding="utf-8"))
    elements = raw.get("elements", [])

    ways = []
    dropped_short = 0
    points_before = 0
    points_after = 0

    for el in elements:
        geom = el.get("geometry")
        if not geom:
            continue
        cls = (el.get("tags") or {}).get("highway")
        if cls not in TOLERANCE_M:
            continue

        pts = [(g["lat"], g["lon"]) for g in geom]
        points_before += len(pts)

        # A stub shorter than a city block adds a mark too small to see and
        # a row to every phone that downloads this.
        length = sum(metres(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
        if length < 120:
            dropped_short += 1
            continue

        pts = simplify(pts, TOLERANCE_M[cls])
        points_after += len(pts)

        ways.append(
            {
                "c": RANK[cls],
                "p": [[round(la, 5), round(lo, 5)] for la, lo in pts],
            }
        )

    # Heaviest class last, so the draw order is the paint order and the map
    # does not need to sort at runtime on a phone that is moving.
    ways.sort(key=lambda w: w["c"])

    out = {
        "source": "OpenStreetMap contributors, via Overpass, ODbL",
        "classes": ["tertiary", "secondary", "primary", "trunk", "motorway"],
        "ways": ways,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, "w", encoding="utf-8").write(json.dumps(out, separators=(",", ":")))

    size = os.path.getsize(OUT)
    print(f"ways kept      {len(ways):,}  ({dropped_short:,} stubs dropped)")
    print(f"points         {points_before:,} -> {points_after:,}")
    print(f"{OUT}  {size / 1000:.0f} KB")


if __name__ == "__main__":
    main()
