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

import csv
import io as _io
import json
import pathlib
import re
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
    """Ask for CSV, not JSON.

    The JSON form of this result set is not parseable: at least one label
    carries a raw control character that breaks the document even with strict
    mode off. CSV goes through Python's csv module cleanly.
    """
    url = f"{ENDPOINT}?{urllib.parse.urlencode({'query': QUERY})}"
    req = urllib.request.Request(url, headers={"Accept": "text/csv", "User-Agent": AGENT})
    last: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            return list(csv.DictReader(_io.StringIO(raw)))
        except Exception as exc:  # noqa: BLE001
            last = exc
            print(f"  attempt {attempt + 1} failed: {exc}")
            time.sleep(20 * (attempt + 1))  # the query service rate-limits hard
    raise RuntimeError("Wikidata query failed") from last


# Wikidata files manufacturers under their legal names, so the same marque
# appears as "Suzuki Motor Corporation", "Suzuki" and "Maruti Suzuki". These
# suffixes are stripped so one brand reads as one brand.
LEGAL_SUFFIXES = re.compile(
    r"\s+(Motor Corporation|Motor Company|Motor Co\.?|Motors|Motor|Automobile Company"
    r"|Automobiles|Automotive|Group|Holdings|Corporation|Company|AG|SA|S\.A\.|NV|N\.V\."
    r"|GmbH|Ltd\.?|Limited|Inc\.?|PLC|Co\.?)\.?$",
    re.IGNORECASE,
)


def tidy_make(make: str) -> str:
    previous = None
    while previous != make:
        previous = make
        make = LEGAL_SUFFIXES.sub("", make).strip(" ,.")
    return make


def main() -> int:
    rows = run_query()
    print(f"  {len(rows)} rows from Wikidata")

    # Wikidata sometimes files a model under a second manufacturer: the Toyota
    # Vitz also appears under Suzuki. Prepending the make there produced
    # "Suzuki Motor Corporation Toyota Vitz". Knowing every marque's first word
    # lets us spot a label that already names a different brand and leave it be.
    marque_words = {
        tidy_make((r.get("brandLabel") or "").strip()).split(" ")[0].lower()
        for r in rows
        if (r.get("brandLabel") or "").strip()
    }
    marque_words.discard("")

    cars: set[str] = set()
    skipped_old = 0
    for r in rows:
        model = (r.get("modelLabel") or "").strip()
        make = tidy_make((r.get("brandLabel") or "").strip())
        # The label service hands back the raw Q-id when an entity has no
        # English label, which is useless in a picker.
        if not model or not make:
            continue
        if re.fullmatch(r"Q\d+", model) or re.fullmatch(r"Q\d+", make):
            continue
        start = r.get("start") or ""
        if start[:4].isdigit() and int(start[:4]) < OLDEST_YEAR:
            skipped_old += 1
            continue
        # Most model labels already carry the marque ("Suzuki Swift"). Prepend
        # only when the label names no marque at all, so nothing reads
        # "Suzuki Suzuki Swift" or "Suzuki Motor Corporation Toyota Vitz".
        first_word = model.split(" ")[0].lower()
        already_branded = model.lower().startswith(make.lower()) or first_word in marque_words
        label = model if already_branded else f"{make} {model}"
        cars.add(re.sub(r"\s+", " ", label).strip())

    listing = sorted(cars, key=str.lower)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(
            {
                "cars": listing,
                "source": {
                    "name": "Wikidata",
                    "url": "https://query.wikidata.org/",
                    "licence": "CC0",
                    "note": ("Model names only. Wikidata holds no repair procedures, jack "
                             "points or service data, and neither does any other free source, "
                             "so the app never claims model-specific steps. Coverage of "
                             "Japanese domestic models is good but not complete, which is why "
                             "the field also accepts anything typed."),
                },
                "count": len(listing),
            },
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    print(f"  {len(listing)} cars -> {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
    print(f"  skipped {skipped_old} models older than {OLDEST_YEAR}")

    lowered = [c.lower() for c in listing]
    for probe in ["Toyota Vitz", "Suzuki Swift", "Honda Fit", "Nissan Micra",
                  "Nissan March", "Toyota Aqua", "Mazda Demio", "Nissan Note"]:
        hit = any(probe.lower() in c for c in lowered)
        print(f"  {probe:16s} {'found' if hit else 'not in Wikidata'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
