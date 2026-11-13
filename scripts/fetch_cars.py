"""Build the car picker's list from Wikidata.

Why Wikidata and not a car API: the obvious free one is NHTSA vPIC, but it is
the United States market register. Three of the most common cars on Mauritian
roads — the Toyota Vitz, the Nissan March and the Toyota Aqua — are Japanese
domestic models and simply are not in it. A driver who cannot find their own
car stops trusting the app. Wikidata is global, open (CC0) and knows all three.

Run:  python -I scripts/fetch_cars.py
Out:  public/data/cars.json
"""

from __future__ import annotations

import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ENDPOINT = "https://query.wikidata.org/sparql"
OUT = pathlib.Path("public/data/cars.json")

# Wikidata asks for a descriptive agent string on its query service.
AGENT = "ZetwayRoadSafety/1.0 (hackathon project; Mauritius road safety)"

# Q3231690 is "automobile model". Walking the subclass tree picks up the
# specific kinds (city car, SUV and so on) that models are filed under.
QUERY = """
SELECT ?modelLabel ?brandLabel ?start WHERE {
  ?model wdt:P31/wdt:P279* wd:Q3231690 .
  ?model wdt:P176 ?brand .
  OPTIONAL { ?model wdt:P571 ?start . }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
"""

# Veteran and vintage makes clutter the list without helping anyone stranded
# on the A1 today. A model with no date at all is kept: plenty of current
# models simply have no inception statement.
OLDEST_YEAR = 1985


def run_query() -> list[dict]:
    url = f"{ENDPOINT}?{urllib.parse.urlencode({'query': QUERY, 'format': 'json'})}"
    req = urllib.request.Request(
        url, headers={"Accept": "application/sparql-results+json", "User-Agent": AGENT}
    )
    last: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8")
            # At least one label in the dump carries a literal control
            # character, which strict JSON rejects. The data is fine; the
            # encoding of one label is not.
            return json.loads(raw, strict=False)["results"]["bindings"]
        except Exception as exc:  # noqa: BLE001
            last = exc
            print(f"  attempt {attempt + 1} failed: {exc}")
            time.sleep(5 * (attempt + 1))
    raise RuntimeError("Wikidata query failed") from last


def main() -> int:
    rows = run_query()
    print(f"  {len(rows)} rows from Wikidata")

    by_make: dict[str, set[str]] = {}
    skipped_old = 0
    for r in rows:
        model = r.get("modelLabel", {}).get("value", "").strip()
        make = r.get("brandLabel", {}).get("value", "").strip()
        # The label service returns the raw Q-id when an entity has no English
        # label. Those are unusable in a picker.
        if not model or not make or model.startswith("Q") and model[1:].isdigit():
            continue
        if make.startswith("Q") and make[1:].isdigit():
            continue
        start = r.get("start", {}).get("value", "")
        if start[:4].isdigit() and int(start[:4]) < OLDEST_YEAR:
            skipped_old += 1
            continue
        # "Toyota Corolla" under make Toyota reads better as just "Corolla".
        short = model[len(make):].strip() if model.lower().startswith(make.lower()) else model
        by_make.setdefault(make, set()).add(short or model)

    makes = {m: sorted(v) for m, v in sorted(by_make.items()) if v}
    total = sum(len(v) for v in makes.values())

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "makes": makes,
                "source": {
                    "name": "Wikidata",
                    "url": "https://query.wikidata.org/",
                    "licence": "CC0",
                    "note": ("Model names only. Wikidata does not hold repair procedures, "
                             "jack points or service data, and neither does any other free "
                             "source, so the app never claims model-specific steps."),
                },
                "counts": {"makes": len(makes), "models": total},
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"  {len(makes)} makes, {total} models -> {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  skipped {skipped_old} models older than {OLDEST_YEAR}")

    for probe_make, probe_model in [("Toyota", "Vitz"), ("Nissan", "March"),
                                    ("Honda", "Fit"), ("Suzuki", "Swift")]:
        found = probe_model in makes.get(probe_make, [])
        print(f"  {probe_make} {probe_model}: {'found' if found else 'MISSING'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
