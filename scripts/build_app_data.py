"""Turn the raw official tables in data/raw/json into the files the app loads.

Every number the app shows is produced here from an official dataset. Nothing is
invented. Each output file carries a `sources` block naming the dataset, the
data.govmu.org resource URL and the licence, so any figure on screen can be
traced back to a published government table.

Run:  python -I scripts/build_app_data.py
In:   data/raw/json/*.json      (written by scripts/fetch_raw.py)
Out:  public/data/*.json        (loaded by the React app)
"""

from __future__ import annotations

import json
import math
import pathlib
import re
import sys
from collections import defaultdict
from typing import Any

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RAW = pathlib.Path("data/raw/json")
OUT = pathlib.Path("public/data")

# Mauritius sits near 20.3 S. Degrees -> km at that latitude, good to ~0.1% over
# an island 65 km across, and far cheaper than haversine for thousands of checks.
KM_PER_DEG_LAT = 110.57
KM_PER_DEG_LON = 111.32 * math.cos(math.radians(20.3))

# A route counts as "passing" an accident-prone area within this distance of the
# straight corridor. Chosen because Mauritius' road network is dense: beyond this
# the segment is realistically a different route.
HOTSPOT_CORRIDOR_KM = 2.0

# The 9 administrative districts in the health-facility table are not the 7
# police districts in the casualty table. This mapping is a documented
# assumption of ours, not something the publisher states.
ADMIN_TO_POLICE: dict[str, list[str]] = {
    "Port Louis": ["Port Louis North", "Port Louis South"],
    "Plaines Wilhems": ["Plaines Wilhems and Black River", "Upper Plaines Wilhems"],
    "Black River": ["Plaines Wilhems and Black River"],
    "Moka": ["Moka and Flacq"],
    "Flacq": ["Moka and Flacq"],
    "Pamplemousses": ["Pamplemousses and Riviere du Rempart"],
    "Riviere du Rempart": ["Pamplemousses and Riviere du Rempart"],
    "Grand Port": ["Grand Port and Savanne"],
    "Savanne": ["Grand Port and Savanne"],
}

# Upper Plaines Wilhems is the highlands half of Plaines Wilhems. Towns listed
# here resolve to it; the rest of Plaines Wilhems resolves to the lower division.
UPPER_PLAINES_WILHEMS_TOWNS = {
    "curepipe", "vacoas", "phoenix", "quatre bornes", "floreal",
    "forest side", "eau coulee", "la caverne", "glen park",
}

# Towns offered in the planner. Kept to places that carry a real health facility
# (so the coordinates come from the official table) and that a commuter would
# actually name as an origin or destination.
PLACE_WHITELIST = [
    "Port Louis", "Curepipe", "Quatre Bornes", "Rose Hill", "Beau Bassin",
    "Vacoas", "Phoenix", "Moka", "Flic en Flac", "Black River", "Tamarin",
    "Bambous", "Grand Baie", "Goodlands", "Triolet", "Pamplemousses",
    "Terre Rouge", "Grand Gaube", "Centre de Flacq", "Poste de Flacq",
    "Bon Accueil", "Mahebourg", "Rose Belle", "Souillac", "Chemin Grenier",
    "Quartier Militaire", "Saint Pierre", "Albion",
]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def load(slug: str) -> dict:
    return json.loads((RAW / f"{slug}.json").read_text(encoding="utf-8"))


def fix_text(s: Any) -> str:
    """Repair UTF-8 that the publisher saved as cp1252 ('Place DâArmes')."""
    if not isinstance(s, str):
        return ""
    if any(ch in s for ch in ("Ã", "â", "Â")):
        try:
            s = s.encode("cp1252", errors="strict").decode("utf-8", errors="strict")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    # Curly quotes and stray non-breaking spaces left by the repair.
    s = s.replace("’", "'").replace("‘", "'").replace("\xa0", " ")
    return re.sub(r"\s+", " ", s).strip()


def num(v: Any) -> float | None:
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def phone(v: Any) -> str | None:
    """'2031001.0' -> '2031001'."""
    f = num(v)
    if f is None or f <= 0:
        return None
    return str(int(f))


def km_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    dy = (a[0] - b[0]) * KM_PER_DEG_LAT
    dx = (a[1] - b[1]) * KM_PER_DEG_LON
    return math.hypot(dx, dy)


def km_point_to_segment(p: tuple[float, float], a: tuple[float, float],
                        b: tuple[float, float]) -> float:
    """Shortest distance in km from point p to the line segment a-b."""
    py, px = (p[0] - a[0]) * KM_PER_DEG_LAT, (p[1] - a[1]) * KM_PER_DEG_LON
    by, bx = (b[0] - a[0]) * KM_PER_DEG_LAT, (b[1] - a[1]) * KM_PER_DEG_LON
    denom = bx * bx + by * by
    if denom == 0:
        return math.hypot(px, py)
    t = max(0.0, min(1.0, (px * bx + py * by) / denom))
    return math.hypot(px - t * bx, py - t * by)


def parse_multilinestring(geom: str) -> list[list[float]]:
    """'MULTILINESTRING ((lon lat, lon lat))' -> [[lat, lon], ...]."""
    pts: list[list[float]] = []
    for lon_s, lat_s in re.findall(r"(-?\d+\.?\d*)\s+(-?\d+\.?\d*)", geom or ""):
        lon, lat = float(lon_s), float(lat_s)
        # Mauritius: lat about -20.6..-19.9, lon about 57.2..57.9.
        if -21.5 < lat < -19.0 and 56.5 < lon < 58.5:
            pts.append([round(lat, 6), round(lon, 6)])
    return pts


def latest_year(rows: list[dict]) -> int:
    return max(int(r["year"]) for r in rows if num(r.get("year")) is not None)


def source_of(slug: str) -> dict:
    m = load(slug)["meta"]
    return {
        "dataset": fix_text(m.get("source_dataset")),
        "resource": m.get("source_resource"),
        "url": m.get("source_url"),
        "licence": m.get("license_id"),
        "publisher": "Open Data Mauritius (MDPA), data.govmu.org",
        "rows": m.get("row_count"),
    }


# --------------------------------------------------------------------------- #
# builders
# --------------------------------------------------------------------------- #
def build_emergency() -> dict:
    """Hospitals, health centres and police stations, with their real coordinates."""
    places: list[dict] = []

    for r in load("health_facilities")["rows"]:
        lat, lon = num(r.get("latitude")), num(r.get("longitude"))
        if lat is None or lon is None:
            continue
        kind = fix_text(r.get("instituitions"))  # publisher's spelling
        places.append({
            "id": f"h{len(places)}",
            "kind": "hospital" if kind == "Hospitals" else "clinic",
            "category": kind,
            "name": fix_text(r.get("name")),
            "town": fix_text(r.get("city")),
            "district": fix_text(r.get("district")),
            "phone": phone(r.get("phone_number")),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
        })

    for r in load("police_stations")["rows"]:
        lat, lon = num(r.get("latitude")), num(r.get("longitude"))
        if lat is None or lon is None:
            continue
        places.append({
            "id": f"p{len(places)}",
            "kind": "police",
            "category": fix_text(r.get("division")).title(),
            "name": f"{fix_text(r.get('stations'))} Police Station",
            "town": fix_text(r.get("stations")),
            "district": None,
            "phone": phone(r.get("phone_number1")) or phone(r.get("phone_number2")),
            "lat": round(lat, 6),
            "lon": round(lon, 6),
        })

    return {
        "places": places,
        "counts": {
            "hospital": sum(p["kind"] == "hospital" for p in places),
            "clinic": sum(p["kind"] == "clinic" for p in places),
            "police": sum(p["kind"] == "police" for p in places),
        },
        "sources": [source_of("health_facilities"), source_of("police_stations")],
    }


def build_places() -> dict:
    """Origin/destination list. Coordinates are the centroid of the official
    health-facility points in that town, so even the town list is data-derived."""
    by_town: dict[str, dict] = defaultdict(lambda: {"lats": [], "lons": [], "district": None})
    for r in load("health_facilities")["rows"]:
        town = fix_text(r.get("city"))
        lat, lon = num(r.get("latitude")), num(r.get("longitude"))
        if not town or lat is None or lon is None:
            continue
        by_town[town]["lats"].append(lat)
        by_town[town]["lons"].append(lon)
        by_town[town]["district"] = fix_text(r.get("district"))

    places = []
    for town in PLACE_WHITELIST:
        rec = by_town.get(town)
        if not rec or not rec["lats"]:
            print(f"  ! skipped '{town}': no official facility coordinates")
            continue
        admin = rec["district"]
        options = ADMIN_TO_POLICE.get(admin, [])
        if admin == "Plaines Wilhems":
            police = (["Upper Plaines Wilhems"] if town.lower() in UPPER_PLAINES_WILHEMS_TOWNS
                      else ["Plaines Wilhems and Black River"])
        else:
            police = options
        places.append({
            "id": town.lower().replace(" ", "-"),
            "name": town,
            "district": admin,
            "policeDistricts": police,
            "lat": round(sum(rec["lats"]) / len(rec["lats"]), 6),
            "lon": round(sum(rec["lons"]) / len(rec["lons"]), 6),
            "facilityCount": len(rec["lats"]),
        })

    places.sort(key=lambda p: p["name"])
    return {
        "places": places,
        "note": ("Town coordinates are the mean position of the official health "
                 "facilities recorded in that town. Administrative districts are "
                 "mapped to police districts by us; see policeDistrictMapping."),
        "policeDistrictMapping": ADMIN_TO_POLICE,
        "sources": [source_of("health_facilities")],
    }


def build_hotspots(places: dict) -> dict:
    """The 48 officially designated accident-prone areas, with their geometry."""
    spots = []
    for r in load("accident_prone_areas")["rows"]:
        pts = parse_multilinestring(r.get("the_geom", ""))
        if not pts:
            continue
        name = fix_text(r.get("name"))
        road = (m.group(1) if (m := re.match(r"^([AMB]\d+)\s*:", name)) else None)
        label = re.sub(r"^[AMB]\d+\s*:\s*", "", name)
        lats = [p[0] for p in pts]
        lons = [p[1] for p in pts]
        length = sum(km_between(tuple(pts[i]), tuple(pts[i + 1])) for i in range(len(pts) - 1))
        spots.append({
            "id": f"ap{len(spots)}",
            "name": name,
            "road": road,
            "label": label,
            "points": pts,
            "mid": [round(sum(lats) / len(lats), 6), round(sum(lons) / len(lons), 6)],
            "lengthKm": round(length, 2),
        })
    # The score needs a yardstick for "a lot of hotspots". Rather than pick a
    # number, measure every town-pair corridor in the network and take the 90th
    # percentile. So the scale comes from the data and moves with it.
    counts = []
    pts = places["places"]
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            a = (pts[i]["lat"], pts[i]["lon"])
            b = (pts[j]["lat"], pts[j]["lon"])
            counts.append(sum(
                1 for s in spots
                if min(km_point_to_segment(tuple(p), a, b) for p in s["points"]) <= HOTSPOT_CORRIDOR_KM
            ))
    counts.sort()
    p90 = counts[int(0.9 * len(counts))] if counts else 1

    return {
        "hotspots": spots,
        "corridorRadiusKm": HOTSPOT_CORRIDOR_KM,
        "scale": {
            "p90Count": p90,
            "medianCount": counts[len(counts) // 2] if counts else 0,
            "maxCount": counts[-1] if counts else 0,
            "corridorsMeasured": len(counts),
            "note": ("Hotspot exposure is scored against the 90th-percentile "
                     "corridor in this network, so the scale is derived from the "
                     "data rather than chosen."),
        },
        "note": ("Road segments published by the authorities as accident-prone. "
                 "The app flags one when it lies within "
                 f"{HOTSPOT_CORRIDOR_KM} km of the direct line between origin and destination."),
        "sources": [source_of("accident_prone_areas")],
    }


def build_districts() -> dict:
    """Casualty accidents and who got hurt, per police district, latest year."""
    rows = load("casualties_by_police_district")["rows"]
    year = latest_year(rows)

    metric_of = {
        "casualty accidents": "casualtyAccidents",
        "pedestrian casualties": "pedestrian",
        "rider casualties": "rider",
        "other casualties": "other",
    }
    latest: dict[str, dict[str, float]] = defaultdict(dict)
    series: dict[str, dict[str, list]] = defaultdict(lambda: defaultdict(list))

    for r in rows:
        district = fix_text(r.get("dimension_police_district"))
        value, y = num(r.get("value")), num(r.get("year"))
        name = fix_text(r.get("indicator_name"))
        key = next((v for k, v in metric_of.items() if name.lower().endswith(k)), None)
        if not district or key is None or value is None or y is None:
            continue
        series[district][key].append([int(y), value])
        if int(y) == year:
            latest[district][key] = value

    districts = []
    for name, vals in sorted(latest.items()):
        casualties = vals.get("pedestrian", 0) + vals.get("rider", 0) + vals.get("other", 0)
        hist = sorted(series[name]["casualtyAccidents"])
        prev = dict(hist).get(year - 1)
        districts.append({
            "name": name,
            "year": year,
            "casualtyAccidents": vals.get("casualtyAccidents", 0),
            "pedestrianCasualties": vals.get("pedestrian", 0),
            "riderCasualties": vals.get("rider", 0),
            "otherCasualties": vals.get("other", 0),
            "totalCasualties": casualties,
            # Shares are what the mode weighting uses: in this district, how much
            # of the harm lands on people on foot vs on two wheels.
            "pedestrianShare": round(vals.get("pedestrian", 0) / casualties, 4) if casualties else 0,
            "riderShare": round(vals.get("rider", 0) / casualties, 4) if casualties else 0,
            "otherShare": round(vals.get("other", 0) / casualties, 4) if casualties else 0,
            "changeVsPrevYear": (round((vals.get("casualtyAccidents", 0) - prev) / prev, 4)
                                 if prev else None),
            "history": hist,
        })

    worst = max((d["casualtyAccidents"] for d in districts), default=1) or 1
    for d in districts:
        d["pressureIndex"] = round(d["casualtyAccidents"] / worst, 4)

    return {
        "year": year,
        "districts": districts,
        "islandTotals": {
            "casualtyAccidents": sum(d["casualtyAccidents"] for d in districts),
            "pedestrianCasualties": sum(d["pedestrianCasualties"] for d in districts),
            "riderCasualties": sum(d["riderCasualties"] for d in districts),
            "otherCasualties": sum(d["otherCasualties"] for d in districts),
        },
        "sources": [source_of("casualties_by_police_district")],
    }


def build_conditions() -> dict:
    """Light conditions, junction types and road types: how often each turns fatal."""
    # --- darkness vs daylight ---------------------------------------------- #
    light: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    light_rows = load("casualties_by_light_condition")["rows"]
    light_year = latest_year(light_rows)
    for r in light_rows:
        cond = fix_text(r.get("dimension_lightconditions"))
        sev = fix_text(r.get("dimension_severityofaccident"))
        v, y = num(r.get("value")), num(r.get("year"))
        if cond and sev and v is not None and y is not None and int(y) == light_year:
            light[cond][sev] += v

    light_out = []
    for cond, sev in light.items():
        total = sum(sev.values())
        if not total or cond == "Not specified":
            continue
        light_out.append({
            "condition": cond,
            "casualties": total,
            "fatal": sev.get("Fatal", 0),
            "serious": sev.get("Serious", 0),
            # Share of casualties in this light condition that were fatal. This
            # is what makes "travelling after dark" a real warning, not a guess.
            "fatalShare": round(sev.get("Fatal", 0) / total, 4),
            "seriousOrFatalShare": round((sev.get("Fatal", 0) + sev.get("Serious", 0)) / total, 4),
            "isDark": cond.lower().startswith("darkness"),
        })
    light_out.sort(key=lambda c: -c["fatalShare"])

    # --- junctions ---------------------------------------------------------- #
    junction: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    j_rows = load("accidents_by_junction_type")["rows"]
    j_year = latest_year(j_rows)
    for r in j_rows:
        jt = fix_text(r.get("dimension_junctiontype"))
        deg = fix_text(r.get("dimension_degreeofcasualty"))
        v, y = num(r.get("value")), num(r.get("year"))
        if jt and deg and v is not None and y is not None and int(y) == j_year:
            junction[jt][deg] += v

    junction_out = []
    for jt, deg in junction.items():
        total = sum(deg.values())
        if not total:
            continue
        junction_out.append({
            "junctionType": jt,
            "accidents": total,
            "fatal": deg.get("Fatal", 0),
            "fatalShare": round(deg.get("Fatal", 0) / total, 4),
        })
    junction_out.sort(key=lambda j: -j["accidents"])

    # --- road types --------------------------------------------------------- #
    road: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    pedestrian_collisions: dict[str, float] = defaultdict(float)
    r_rows = load("accidents_by_road_type")["rows"]
    r_year = latest_year(r_rows)
    for r in r_rows:
        rt = fix_text(r.get("dimension_roadtype"))
        sev = fix_text(r.get("dimension_severityofaccident"))
        coll = fix_text(r.get("dimension_collisiontype"))
        v, y = num(r.get("value")), num(r.get("year"))
        if not rt or v is None or y is None or int(y) != r_year:
            continue
        road[rt][sev] += v
        if coll == "Hit Pedestrian":
            pedestrian_collisions[rt] += v

    road_out = []
    for rt, sev in road.items():
        total = sum(sev.values())
        if not total:
            continue
        road_out.append({
            "roadType": rt,
            "accidents": total,
            "fatalShare": round(sev.get("Fatal", 0) / total, 4),
            "hitPedestrian": pedestrian_collisions.get(rt, 0),
            "hitPedestrianShare": round(pedestrian_collisions.get(rt, 0) / total, 4),
        })
    road_out.sort(key=lambda r: -r["accidents"])

    return {
        "light": {"year": light_year, "conditions": light_out},
        "junctions": {"year": j_year, "types": junction_out},
        "roads": {"year": r_year, "types": road_out},
        "sources": [source_of("casualties_by_light_condition"),
                    source_of("accidents_by_junction_type"),
                    source_of("accidents_by_road_type")],
    }


def build_mode_exposure(districts: dict) -> dict:
    """How over-represented two-wheel riders are, relative to how many exist.

    Casualty share alone says little. Comparing it with the share of registered
    vehicles that are two-wheelers gives a defensible over-representation ratio.
    """
    rows = load("vehicles_registered")["rows"]
    year = latest_year(rows)
    by_type = {}
    for r in rows:
        t = fix_text(r.get("dimension_typeofvehicle"))
        v, y = num(r.get("value")), num(r.get("year"))
        if t and v is not None and y is not None and int(y) == year:
            by_type[t] = by_type.get(t, 0) + v

    total_vehicles = sum(by_type.values())
    two_wheel = by_type.get("Motor cycle", 0) + by_type.get("Auto cycle", 0)
    island = districts["islandTotals"]
    all_casualties = (island["pedestrianCasualties"] + island["riderCasualties"]
                      + island["otherCasualties"]) or 1

    two_wheel_vehicle_share = two_wheel / total_vehicles if total_vehicles else 0
    rider_casualty_share = island["riderCasualties"] / all_casualties
    pedestrian_casualty_share = island["pedestrianCasualties"] / all_casualties

    # Casualties per 1,000 registered vehicles, two-wheelers against everything
    # else. Shares alone can't say whether a rider is personally worse off;
    # dividing by how many of each vehicle exist can.
    other_vehicles = total_vehicles - two_wheel
    rider_rate = (island["riderCasualties"] / two_wheel * 1000) if two_wheel else 0
    occupant_rate = (island["otherCasualties"] / other_vehicles * 1000) if other_vehicles else 0

    return {
        "vehicleYear": year,
        "casualtyYear": districts["year"],
        "registeredTotal": total_vehicles,
        "twoWheelRegistered": two_wheel,
        "twoWheelVehicleShare": round(two_wheel_vehicle_share, 4),
        "riderCasualtyShare": round(rider_casualty_share, 4),
        "pedestrianCasualtyShare": round(pedestrian_casualty_share, 4),
        # The headline: how much of the island's road harm lands on people with
        # no vehicle body around them.
        "vulnerableShare": round(rider_casualty_share + pedestrian_casualty_share, 4),
        "riderCasualtiesPer1000Vehicles": round(rider_rate, 2),
        "occupantCasualtiesPer1000Vehicles": round(occupant_rate, 2),
        "riderRiskRatio": round(rider_rate / occupant_rate, 2) if occupant_rate else None,
        "byType": dict(sorted(by_type.items(), key=lambda kv: -kv[1])),
        "sources": [source_of("vehicles_registered"),
                    source_of("casualties_by_police_district")],
    }


def build_island_context() -> dict:
    """Island-wide totals, for the pitch and the 'why this matters' line."""
    rows = load("accidents_and_casualties")["rows"]
    year = latest_year(rows)
    out: dict[str, float] = {}
    for r in rows:
        cat = fix_text(r.get("dimension_category"))
        sub = fix_text(r.get("dimension_subcategory"))
        v, y = num(r.get("value")), num(r.get("year"))
        if v is None or y is None or int(y) != year:
            continue
        if cat == "Road traffic accidents" and sub == "Number":
            out["accidents"] = v
        elif cat == "Casualties" and sub in ("Fatal", "Seriously injured", "Slightly injured"):
            out[sub.split()[0].lower()] = v
    # 'Motor vehicle involved / Registered motor vehicles' is deliberately left
    # out: in this table it is an index, not a vehicle count, and publishing it
    # as a count would be wrong.
    out["casualties"] = out.get("fatal", 0) + out.get("seriously", 0) + out.get("slightly", 0)
    return {"year": year, **out, "sources": [source_of("accidents_and_casualties")]}


# --------------------------------------------------------------------------- #
def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)

    places = build_places()
    hotspots = build_hotspots(places)
    districts = build_districts()
    conditions = build_conditions()
    emergency = build_emergency()
    exposure = build_mode_exposure(districts)
    island = build_island_context()

    files = {
        "places.json": places,
        "hotspots.json": hotspots,
        "districts.json": districts,
        "conditions.json": conditions,
        "emergency.json": emergency,
        "exposure.json": exposure,
        "island.json": island,
    }
    for name, payload in files.items():
        path = OUT / name
        path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        print(f"  {name:18s} {path.stat().st_size / 1024:7.1f} KB")

    print(f"\n  places           {len(places['places'])}")
    print(f"  hotspots         {len(hotspots['hotspots'])} segments")
    print(f"  districts        {len(districts['districts'])} ({districts['year']})")
    print(f"  emergency points {len(emergency['places'])} {emergency['counts']}")
    print(f"  hotspot scale    median {hotspots['scale']['medianCount']}, "
          f"p90 {hotspots['scale']['p90Count']}, max {hotspots['scale']['maxCount']}")
    print(f"  vulnerable share {exposure['vulnerableShare']:.1%} of casualties "
          f"(riders {exposure['riderCasualtyShare']:.1%} + pedestrians "
          f"{exposure['pedestrianCasualtyShare']:.1%})")
    print(f"  rider risk ratio x{exposure['riderRiskRatio']} per registered vehicle")
    print(f"  island {island['year']}: {island.get('accidents'):.0f} accidents, "
          f"{island.get('fatal'):.0f} killed, {island.get('casualties'):.0f} casualties")
    return 0


if __name__ == "__main__":
    sys.exit(main())
