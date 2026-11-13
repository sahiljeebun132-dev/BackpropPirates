# Zetway

**Live app: https://backprop-pirates.vercel.app** (open it on a phone)

Team BackpropPirates · Life Powered by Tech, 13–14 November 2026
IET Society × Middlesex University Mauritius · **Theme 2: Powered to Move**

> Zetway tells a commuter how dangerous their specific journey is — for how they are
> travelling, at the hour they are travelling — using the government's own road-casualty data,
> and shows them where help is along the way.

## The problem

In 2024 Mauritius recorded **39,485 road accidents**. **134 people were killed** and **3,029 were
injured or killed**, on an island of about 1.3 million.

The figure that shaped this app: **49.9% of everyone hurt was riding a two-wheeler or walking.**
Half the harm lands on the people with no metal around them, and they are the ones with the least
information before they set off.

## Our user

A young motorcycle or auto-cycle rider commuting the northern corridor — Grand Baie, Triolet and
Goodlands down into Port Louis — often riding home after dark.

- They ride through **Pamplemousses and Rivière du Rempart**, which recorded **649 casualty
  accidents in 2024**, the worst of the seven police districts.
- **357** of that district's casualties were riders, the highest rider count on the island.
- Riding in darkness with no street lighting, **8.2% of casualties are fatal**, against **3.7% in
  daylight**.

None of this is visible to them today. The data exists, in annual PDF digests and CSV tables.

## What the app does

Pick origin, destination, travel mode and time of day. It returns:

- A **Corridor Safety Score** out of 100, with the four measurements behind it. Tap any one to see
  its figures and the table they came from.
- Which of the island's **48 officially designated accident-prone road segments** your corridor
  passes, by road number and name.
- **Advice specific to you**, each line citing the table it came from.
- The **nearest hospitals, health centres and police stations** along the corridor, with
  tap-to-call numbers, plus 114 and 999 buttons.

## Data sources

Eleven official tables, all from [data.govmu.org](https://data.govmu.org), all CC-BY-SA 4.0,
published by the Mauritius Digital Promotion Agency and Statistics Mauritius.

| Dataset | What it powers |
|---|---|
| Accident Prone Areas (48 segments, with geometry) | Which black spots your corridor passes |
| Casualty Accidents, Pedestrian and Rider Casualties by Police District (2013–2024) | District casualty volume and the split between people on foot, riders and vehicle occupants |
| Casualties by severity and light conditions (2018) | The time-of-day factor and the darkness warning |
| Casualty accidents by degree of casualties and junction type (2018) | The junction advice |
| Casualty accidents by road type, severity and collision type (2018) | Motorway warning, pedestrian-collision advice |
| Locations of Hospitals, Clinics, Medi-Clinics, AHC and CHC (169) | Nearest medical help; also every town coordinate in the planner |
| Location of Police Stations (72) | Nearest police station |
| Vehicles registered by type (2024) | The exposure denominator: casualties per 1,000 registered vehicles |
| Road traffic accidents and casualties (2024) | The island-wide figures on the opening screen |

**Nothing is hand-entered.** Two scripts do all of it:

```bash
python -I scripts/fetch_raw.py        # downloads the tables into data/raw/json
python -I scripts/build_app_data.py   # cleans them into public/data
```

The raw downloads are committed, so anyone can re-run the pipeline and get the same files.

**Why not fetch data.govmu.org directly:** the portal sits behind a bot check, so a script cannot
pull the CSVs. We used the Electric Sheep Africa mirror on Hugging Face, which carries the original
CKAN package ID, resource ID and the data.govmu.org URL on every row. Provenance is intact and the
app links to the original resource file.

**Cleaning notes:** the pipeline repairs text the publisher saved in the wrong encoding
(`Place DâArmes` → `Place d'Armes`), parses `MULTILINESTRING` geometry, derives town coordinates
from facility positions, maps the 9 administrative districts onto the 7 police districts (our
assumption, published inside `places.json`), and computes the shares and rates the score needs.

## How the score works

Four measurements, weighted, subtracted from 100. Higher is safer.

| Factor | Weight | Scaled against |
|---|---|---|
| Accident-prone segments within 2 km of the corridor | 35% | The 90th-percentile corridor in this network (13 segments), measured across all 325 town pairs |
| Casualty accidents in the districts crossed | 25% | The quietest and busiest districts on the island |
| Share of casualties here who travel as you do, vs the island share | 25% | The range of that ratio across all districts and groups |
| Share of casualties that are fatal in that light | 15% | Daylight (safest recorded) to an unlit road (worst) |

Each factor is a ratio between two published figures, and **both ends of every scale come from the
data**. The only numbers we chose are the four weights, and the app prints them on screen.

The score is an **exposure indicator, not a prediction**. It cannot know about today's traffic,
weather or the driver, and the app says so.

### We tested it, and it was wrong first time

`node scripts/check_score_spread.mjs` scores all **5,200** route/mode/time combinations.

The first model divided each factor by its maximum alone. That rated **70% of all journeys
"Severe"** and never rated anything safe, because vehicle occupants are always the largest casualty
group — so every car trip was punished for being ordinary. Re-anchoring each factor to both ends of
the range the data spans fixed it. Scores now run **22 to 94, median 59**: a rural daytime car trip
scores 80, the northern corridor by motorcycle at night scores 31.

## Tech stack

Vite 8, React 19, TypeScript, Tailwind 4, deployed on Vercel.

A mobile-first web app rather than an APK: one link opens on every phone in the room, and there is
no build step that can fail an hour before the demo. The organisers confirmed a web app counts
equally.

| Path | Responsibility |
|---|---|
| `scripts/fetch_raw.py` | Downloads the official tables |
| `scripts/build_app_data.py` | Cleans them into `public/data` |
| `scripts/check_score_spread.mjs` | Validates the score across all 5,200 combinations |
| `scripts/build_journal.mjs` | Regenerates the build journal |
| `src/lib/risk.ts` | Scoring model and advice generator — pure functions, no UI |
| `src/lib/geo.ts` | Distance and corridor maths |
| `src/lib/useAppData.ts` | Loads the data files once |
| `src/components/` | One component per panel |

Scoring is separated from the UI and the data layer is a single hook, so a surprise constraint
lands in one place rather than across the app.

## Surprise card

**Card drawn:** _not yet drawn_
**How we adapted:** _to be filled in_

## AI tools used (disclosure)

| Tool | What it did | What we did |
|---|---|---|
| Claude Code (Anthropic, Claude Opus 5) | Dataset discovery, the cleaning pipeline, the scoring model, the React components, the build journal | Chose the theme, problem and user; directed the approach; reviewed and tested every output; caught and called the score calibration problem |

Everything produced was reviewed, built and tested by the team.

## How to run

```bash
npm install
npm run dev      # http://localhost:5173 — add --host to open it on a phone on the same Wi-Fi
npm run build    # type-check and production build
npm run lint
```

No environment variables and no API keys. All data is static JSON in `public/data`.

## What we have not done

- Routes are straight lines between towns, not real road paths. The app says so on screen.
- The light, junction and road-type tables are from 2018, the latest the publisher has released.
  District data is 2024. Every figure in the app carries its year.
- 26 towns, limited to places with an official health facility so the coordinates are real.
- No live traffic, weather or crowd reports.

## Documents

- [Build journal](docs/Zetway-Build-Journal.docx) — the running record of the build, the data,
  the decisions and the jury Q&A
- [Decision log](DECISIONS.md)
