"""Garages, tyre shops and filling stations in Mauritius, from OpenStreetMap.

Why OpenStreetMap and not a business directory: there is no official register
of Mauritian mechanics, and scraping a listings site would give unverified
numbers with no licence to republish them. OSM is openly licensed (ODbL),
attributable, and every entry can be traced to its own node. It is community
data, so the app labels it as such and tells people to confirm before relying
on it.

Overpass is free and frequently overloaded, returning 502s and timeouts, so
this rotates mirrors and backs off rather than giving up on the first failure.

Run:  python -I scripts/fetch_garages.py
Out:  data/raw/osm/vehicle_services.json   (raw Overpass response)
"""

from __future__ import annotations

import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OUT = pathlib.Path("data/raw/osm/vehicle_services.json")
AGENT = "ZetwayRoadSafety/1.0 (hackathon project; Mauritius road safety)"

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Deliberately lean. The elaborate version of this query times out on a loaded
# mirror; this one came back in a few seconds when the same server was
# refusing the longer one.
QUERY = """
[out:json][timeout:60];
area["ISO3166-1"="MU"]->.mu;
(
  node["shop"~"car_repair|tyres|car_parts"](area.mu);
  way["shop"~"car_repair|tyres|car_parts"](area.mu);
  node["amenity"="fuel"](area.mu);
);
out center tags;
"""

ATTEMPTS = 12


def fetch() -> dict:
    last: Exception | None = None
    for attempt in range(ATTEMPTS):
        mirror = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(
                mirror,
                data=urllib.parse.urlencode({"data": QUERY}).encode(),
                headers={"User-Agent": AGENT},
            )
            with urllib.request.urlopen(req, timeout=90) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if payload.get("elements"):
                print(f"  got {len(payload['elements'])} elements from {mirror.split('/')[2]}")
                return payload
            # A mirror with a stale or partial planet answers successfully
            # with nothing at all, which is worse than an error.
            print(f"  {mirror.split('/')[2]} returned an empty result, trying another")
        except Exception as exc:  # noqa: BLE001
            last = exc
            print(f"  attempt {attempt + 1} ({mirror.split('/')[2]}): {str(exc)[:70]}")
        time.sleep(min(30, 4 * (attempt + 1)))
    raise RuntimeError("every Overpass mirror failed") from last


def main() -> int:
    payload = fetch()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload), encoding="utf-8")

    els = payload["elements"]
    named = [e for e in els if e.get("tags", {}).get("name")]
    phoned = [e for e in els if any(k in e.get("tags", {}) for k in ("phone", "contact:phone"))]
    print(f"  saved {len(els)} elements to {OUT}")
    print(f"  {len(named)} named, {len(phoned)} with a phone number")
    return 0


if __name__ == "__main__":
    sys.exit(main())
