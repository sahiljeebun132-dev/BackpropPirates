"""Download the official Mauritius open-data tables we use, as raw JSON.

Why this route: data.govmu.org sits behind a bot check, so the CSVs cannot be
fetched by a script. The same official resources are mirrored on Hugging Face by
Electric Sheep Africa, which carries the CKAN package/resource ids and the
original data.govmu.org `source_url` on every row, so provenance is preserved.

Run:  python -I scripts/fetch_raw.py
Out:  data/raw/json/<slug>.json   (rows + the source metadata for each table)
"""

from __future__ import annotations

import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request

ROWS_API = "https://datasets-server.huggingface.co/rows"
OUT_DIR = pathlib.Path("data/raw/json")
PAGE = 100

# slug -> Hugging Face repo id (mirror of a data.govmu.org CKAN resource)
DATASETS: dict[str, str] = {
    # --- core: geography of risk -------------------------------------------
    "accident_prone_areas": "electricsheepafrica/africa-mauritius-accident-prone-areas-9a43716c",
    "casualties_by_police_district": "electricsheepafrica/africa-mauritius-casualty-accidents-pedestrian-and-rider-casualties-by-poli-14449be0",
    # --- core: emergency infrastructure ------------------------------------
    "health_facilities": "electricsheepafrica/africa-mauritius-locations-of-hospitals-clinics-medi-clinics-area-health-ce-704f81ed",
    "police_stations": "electricsheepafrica/africa-mauritius-location-of-police-stations-in-mauritius-d804c76d",
    # --- conditions that change the advice ---------------------------------
    "casualties_by_light_condition": "electricsheepafrica/africa-mauritius-number-of-casualty-by-severity-of-accident-and-light-condi-f6b50a86",
    "accidents_by_junction_type": "electricsheepafrica/africa-mauritius-number-of-casualty-accidents-by-degree-of-casualties-and-j-4a00567c",
    "accidents_by_road_type": "electricsheepafrica/africa-mauritius-number-of-casualty-accidents-by-type-of-road-severity-of-a-4cb9074c",
    # --- travel mode risk, and the exposure denominator for it -------------
    "drivers_riders_involved": "electricsheepafrica/africa-mauritius-number-of-drivers-and-riders-involved-in-casualty-accident-7552cd0e",
    "vehicles_registered": "electricsheepafrica/africa-mauritius-vehicles-registered-by-type-as-at-end-of-year-island-of-ma-4410f6cf",
    # --- island-wide context for the pitch ---------------------------------
    "accident_rates": "electricsheepafrica/africa-mauritius-rates-accident-fatality-amp-casualty-island-of-mauritius-0c02c9f3",
    "accidents_and_casualties": "electricsheepafrica/africa-mauritius-road-traffic-accidents-and-casualties-8e5d4ad7",
}


def fetch_json(url: str, attempts: int = 4) -> dict:
    """GET JSON, retrying on the transient 5xx the rows API returns while it warms up."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except Exception as exc:  # noqa: BLE001 - we retry on anything transient
            last = exc
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"failed after {attempts} attempts: {url}") from last


def fetch_table(repo: str) -> list[dict]:
    """Page through every row of one mirrored table."""
    rows: list[dict] = []
    total = None
    while total is None or len(rows) < total:
        qs = urllib.parse.urlencode(
            {"dataset": repo, "config": "default", "split": "train",
             "offset": len(rows), "length": PAGE}
        )
        payload = fetch_json(f"{ROWS_API}?{qs}")
        if "error" in payload:
            raise RuntimeError(f"{repo}: {payload['error']}")
        total = payload["num_rows_total"]
        batch = [r["row"] for r in payload["rows"]]
        if not batch:
            break
        rows.extend(batch)
    return rows


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    failed: list[str] = []
    for slug, repo in DATASETS.items():
        try:
            rows = fetch_table(repo)
        except Exception as exc:  # noqa: BLE001
            print(f"  FAILED {slug}: {exc}")
            failed.append(slug)
            continue
        first = rows[0] if rows else {}
        meta = {
            "slug": slug,
            "hf_repo": repo,
            # Provenance straight off the rows, so the README can cite it exactly.
            "source_dataset": first.get("source_dataset"),
            "source_resource": first.get("source_resource"),
            "source_url": first.get("source_url"),
            "license_id": first.get("license_id"),
            "retrieved_at": first.get("retrieved_at"),
            "row_count": len(rows),
        }
        (OUT_DIR / f"{slug}.json").write_text(
            json.dumps({"meta": meta, "rows": rows}, indent=1), encoding="utf-8"
        )
        print(f"  {slug:32s} {len(rows):5d} rows  <- {meta['source_dataset']}")
    if failed:
        print("\nFailed:", ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
