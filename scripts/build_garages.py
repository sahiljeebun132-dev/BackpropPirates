"""Turn the raw OpenStreetMap pull into the garage list the app loads.

Kept separate from build_app_data.py because the source is different in kind.
Everything in public/data is official government statistics; this is community
data, and the app says so wherever it is shown.

If the raw file is missing, an empty list is written rather than nothing, so
the app always has a valid file to fetch and the panel can say honestly that
it has no entries yet.

Run:  python -I scripts/build_garages.py
In:   data/raw/osm/vehicle_services.json
Out:  public/data/garages.json
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

RAW = pathlib.Path("data/raw/osm/vehicle_services.json")
OUT = pathlib.Path("public/data/garages.json")

# Dealers service what they sell, and motorcycle shops matter because riders
# are half the casualties on these roads. Car washes and kiosks turn up in the
# same query and are left out: they help nobody who has broken down.
KIND_OF = {
    "car_repair": "garage",
    "tyres": "tyres",
    "car_parts": "parts",
    "fuel": "fuel",
    "car": "dealer",
    "motorcycle": "motorcycle",
    "motorcycle_repair": "motorcycle",
    "vehicle_inspection": "inspection",
}

KIND_LABEL = {
    "garage": "Garage",
    "tyres": "Tyre shop",
    "parts": "Car parts",
    "fuel": "Filling station",
    "dealer": "Dealer and service",
    "motorcycle": "Motorcycle garage",
    "inspection": "Vehicle inspection",
}


def clean_phone(raw: str | None) -> str | None:
    """Normalise to something a phone will dial.

    Mauritian numbers appear in OSM as '+230 5 123 4567', '2301234567' and
    plain '1234567'. Spaces and punctuation are stripped; a leading +230 is
    kept because it always dials correctly, at home or roaming.
    """
    if not raw:
        return None
    first = re.split(r"[;,/]", raw)[0]
    cleaned = re.sub(r"[^\d+]", "", first)
    if not cleaned:
        return None
    if cleaned.startswith("00230"):
        cleaned = "+230" + cleaned[5:]
    if cleaned.startswith("230") and len(cleaned) > 9:
        cleaned = "+" + cleaned
    digits = re.sub(r"\D", "", cleaned)
    # A Mauritian number is 7 digits (landline) or 8 (mobile), plus the
    # optional 230. Anything shorter is a typo in the source.
    if len(digits) < 7:
        return None
    return cleaned


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)

    if not RAW.exists():
        OUT.write_text(
            json.dumps({"garages": [], "counts": {}, "source": None}, separators=(",", ":")),
            encoding="utf-8",
        )
        print(f"  no raw file at {RAW}; wrote an empty list so the app still loads")
        return 0

    payload = json.loads(RAW.read_text(encoding="utf-8"))
    places: list[dict] = []
    seen: set[tuple] = set()

    for el in payload.get("elements", []):
        tags = el.get("tags", {})
        kind = KIND_OF.get(tags.get("shop") or tags.get("amenity") or tags.get("craft") or "")
        if not kind:
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None or lon is None:
            continue
        name = (tags.get("name") or tags.get("operator") or "").strip()
        # Checked every contact spelling OSM uses. In Mauritius only "phone"
        # and "contact:phone" are ever populated, but the others cost nothing.
        phone = clean_phone(next(
            (tags[k] for k in ("phone", "contact:phone", "contact:mobile", "mobile",
                               "phone:mobile", "contact:phone:mobile", "contact:telephone")
             if tags.get(k)),
            None,
        ))
        # An unnamed point with no phone is a dot on a map, not something a
        # stranded driver can use.
        if not name and not phone:
            continue
        key = (round(lat, 5), round(lon, 5), name.lower())
        if key in seen:
            continue
        seen.add(key)
        places.append({
            "id": f"{el.get('type', 'n')}{el.get('id')}",
            "kind": kind,
            "name": name or KIND_LABEL[kind],
            "phone": phone,
            "lat": round(float(lat), 6),
            "lon": round(float(lon), 6),
            "street": (tags.get("addr:street") or "").strip() or None,
            "town": (tags.get("addr:city") or "").strip() or None,
            "hours": (tags.get("opening_hours") or "").strip() or None,
        })

    places.sort(key=lambda p: (p["kind"], p["name"]))
    counts: dict[str, int] = {}
    for p in places:
        counts[p["kind"]] = counts.get(p["kind"], 0) + 1

    OUT.write_text(
        json.dumps(
            {
                "garages": places,
                "counts": counts,
                "withPhone": sum(1 for p in places if p["phone"]),
                "source": {
                    "name": "OpenStreetMap contributors",
                    "via": "Overpass API",
                    "licence": "ODbL",
                    "note": ("Community-maintained, not an official register. There is no "
                             "public register of Mauritian mechanics, so this is the best "
                             "openly licensed source. Opening hours and numbers can be out "
                             "of date, so the app tells people to confirm before relying "
                             "on one."),
                },
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"  {len(places)} places -> {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  by kind: {counts}")
    print(f"  with a usable phone number: {sum(1 for p in places if p['phone'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
