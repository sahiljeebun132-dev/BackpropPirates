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

JUNCTIONS ARE KEPT WHATEVER THE TOLERANCE SAYS, and the first version of this
script did not do that. OpenStreetMap does not split a way at every junction:
a primary road runs through as one way and the side roads begin at a node in
the middle of it. Douglas-Peucker has no idea that node matters, so it threw
most of them away as insignificant bends — and the result looked like a map
and routed like 1,838 disconnected sticks. A flood fill from one end of it
reached 60 nodes out of 5,659.

So every coordinate shared by two or more ways is found first, and each way
is simplified in pieces between those points rather than end to end. The
shape is the same; the network is now actually a network.
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

    # Pass one: which coordinates does more than one way touch? Those are
    # junctions, and they have to survive simplification or the network is
    # not connected. Six decimals, because these are the publisher's own
    # numbers and a shared node is bit-identical between ways.
    seen: dict[tuple[float, float], int] = {}
    for el in elements:
        geom = el.get("geometry")
        if not geom:
            continue
        if (el.get("tags") or {}).get("highway") not in TOLERANCE_M:
            continue
        for g in {(round(g["lat"], 6), round(g["lon"], 6)) for g in geom}:
            seen[g] = seen.get(g, 0) + 1
    junctions = {k for k, n in seen.items() if n > 1}
    print(f"junctions      {len(junctions):,} shared by two or more ways")

    ways = []
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

        # Nothing is dropped for being short. The first version threw away
        # every way under 120 m as a stub too small to see, which removed
        # 2,570 of 4,408 ways — and those are the roundabout arms, the slip
        # roads and the junction links that hold the network together. The
        # map still looked like a map; a flood fill across it reached 439
        # nodes out of 5,693, and nothing could route anywhere.

        # Simplify between junctions rather than across them, so a node
        # another road joins at is never the one thrown away.
        tol = TOLERANCE_M[cls]
        pieces: list[list[tuple[float, float]]] = []
        current: list[tuple[float, float]] = [pts[0]]
        for q in pts[1:]:
            current.append(q)
            if (round(q[0], 6), round(q[1], 6)) in junctions:
                pieces.append(current)
                current = [q]
        if len(current) > 1:
            pieces.append(current)

        pts = []
        for piece in pieces:
            simplified = simplify(piece, tol)
            # The join is shared with the previous piece; do not repeat it.
            pts.extend(simplified if not pts else simplified[1:])
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
    print(f"ways kept      {len(ways):,}")
    print(f"points         {points_before:,} -> {points_after:,}")
    print(f"{OUT}  {size / 1000:.0f} KB")


if __name__ == "__main__":
    main()
