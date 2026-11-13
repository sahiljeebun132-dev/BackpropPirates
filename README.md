# Zetway
### Vigilance en route

**Live app: https://backprop-pirates.vercel.app** (open it on a phone — nothing to install)

**Android app:** [latest APK](https://github.com/sahiljeebun132-dev/BackpropPirates/releases/download/latest/app-debug.apk),
rebuilt by CI from every commit. It is the same app, plus the three things a browser forbids —
see [Two builds](#two-builds).

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
- **Live hazard reports from other riders.** Report a crash, blockage, flood, road hazard or
  police check and it reaches everyone on that corridor within seconds. A crash or flood shows as
  a banner above the score. Reports expire after four hours.
- **Live conditions and a leave-by recommendation.** Sunrise, sunset and hourly rain for your
  corridor come from Open-Meteo (free, no key). The app scores the same journey every half hour
  around your planned time and offers the safest slot within three hours. Grand Baie to Port
  Louis by motorcycle at 19:00 scores 31; at 18:00 it scores 46, because the trip is then in
  daylight.

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
| Casualty accidents by severity and weather condition (2013–2018 pooled) | The wet-road advice |
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

### Why not satellite imagery

We looked at it and rejected it on the evidence. Seeing something car-sized needs roughly
sub-metre resolution, which means low Earth orbit and about one pass a day; the satellites that
watch continuously are weather satellites at 500 m to 2 km a pixel, where a car does not exist.
Mauritius is also frequently cloudy. Commercial tasking costs hundreds of dollars a shot with
hours of lead time. So we use the remote-sensed data that does arrive hourly and free — the
weather model — and turn it into a decision about when to leave.

The app also does not notify the police automatically. A false positive sends officers to
nothing, we have no integration or authority, and the rules ask us to help people reach services
rather than investigate. One-tap calling to the nearest station is the honest version.

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

Rain is deliberately **not** a score factor. Pooled over 2013–2018 it lifts the fatal share from
4.67% to 5.88%, a ratio of 1.26 — real, but too small to swing a score, and only 8% of casualty
accidents happen in the wet. The app says so on screen and shows it as advice instead.

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

Plus Capacitor 7 for the Android build, which wraps the same compiled React app — there is no
second codebase and no duplicated UI.

The web app came first and is still the one we demo from: one link opens on every phone in the
room, and no build step can fail an hour before the pitch. The organisers confirmed a web app
counts equally. The APK is additive.

### Two builds

Everything Zetway does, both builds do identically — except the moments after a crash, where the
browser is deliberately barred and the app is not.

| After a detected impact | Web | Android app |
|---|---|---|
| Detect, alarm, 30-second countdown | yes | yes |
| Keep watching with the screen off and the app closed | no — the page is suspended | **yes, foreground service** |
| Vibrate | only where the browser allows it, never on iOS | yes |
| Text every emergency contact with your location | one tap each | **automatic, no tap** |
| Call your first contact | one tap | **automatic, no tap** |
| Call 114 / 999 | one tap | one tap |
| Works with no signal | no | yes, the data ships inside the APK |

The second row is the one that decides whether any of this is real. A web page is throttled the
moment it is backgrounded and suspended when the screen goes off, so the web build is only
watching while you are looking at it — and nobody rides like that. In the Android build a
foreground service holds the sensor and a partial wake lock, so the phone is watched in a pocket.
It shows a notification the whole time and costs extra battery, and the app says both.

The "one tap" row for 114 is not an oversight. **Android refuses `ACTION_CALL` for emergency
numbers from any third-party app**, redirects it to the preloaded dialler, and `TelecomManager`
accepts an emergency call only from the default dialler; `CALL_PRIVILEGED` would lift the
restriction and is closed to third-party apps. No app on the Play Store can auto-dial an
ambulance. `CrashResponsePlugin` asks the operating system whether a number is an emergency
number and refuses rather than throwing mid-crash, so the automatic call goes to the first saved
contact — a person who can act, who already has the location by text, and who can ring 114
themselves.

| Path | Responsibility |
|---|---|
| `scripts/fetch_raw.py` | Downloads the official tables |
| `scripts/build_app_data.py` | Cleans them into `public/data` |
| `scripts/check_score_spread.mjs` | Validates the score across all 5,200 combinations |
| `scripts/build_journal.mjs` | Regenerates the build journal |
| `src/lib/risk.ts` | Scoring model and advice generator — pure functions, no UI |
| `src/lib/geo.ts` | Distance and corridor maths |
| `src/lib/live.ts` | Open-Meteo fetch, sunrise/sunset to light band, rain over the trip |
| `src/lib/departure.ts` | Scores the journey across departure times to find a safer slot |
| `api/reports.ts` | Serverless function behind the hazard reports, with all validation |
| `src/lib/reports.ts` | Client for the reports API |
| `src/lib/useAppData.ts` | Loads the data files once |
| `src/components/` | One component per panel |
| `src/lib/platform.ts` | Which build is running, and where the API lives for it |
| `src/lib/nativeCrash.ts` | Typed bridge to the native plugin; resolves to "could not" on the web |
| `src/lib/escalate.ts` | What happens automatically after an unanswered countdown |
| `android/.../CrashResponsePlugin.java` | The native half: vibration, automatic SMS, automatic call |
| `.github/workflows/android.yml` | Builds and republishes the APK on every push |

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

### Building the Android app

Needs **JDK 21** and the Android SDK (platform 35, build-tools 35.0.0); `ANDROID_HOME` must point
at the SDK, or `android/local.properties` must set `sdk.dir`. Capacitor 7's Gradle plugins request
a Java 21 toolchain specifically — on 17 the build fails at configuration with "no locally
installed toolchains match".

```bash
npm run cap:sync                      # build the web app and copy it into the Android project
cd android && ./gradlew assembleDebug  # gradlew.bat on Windows
# -> android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run android:icons` regenerates the launcher icons from `assets/`. CI builds the same APK on
every push, so a working laptop is never the only way to get one.

The official data is static JSON in `public/data`, and the weather forecast needs no key.

Hazard reports need a Vercel Blob store. `vercel blob create-store zetway-reports --access private`
links it to the project and sets `BLOB_READ_WRITE_TOKEN` automatically. The token stays on the
server: the browser only ever talks to `/api/reports`, which decides what may be written. Without
the store the rest of the app works unchanged and the reports panel says it is unavailable.

## What we have not done

- Routes are straight lines between towns, not real road paths. The app says so on screen.
- The light, junction and road-type tables are from 2018, the latest the publisher has released.
  District data is 2024. Every figure in the app carries its year.
- 26 towns, limited to places with an official health facility so the coordinates are real.
- No live traffic feed; live layers are weather, daylight and rider reports.
- Reports are unverified by design, so they inform the rider but never move the score.
- Whether a particular road is lit is something no forecast knows, so the rider tells us.

## Documents

- [Build journal](docs/Zetway-Build-Journal.docx) — the running record of the build, the data,
  the decisions and the jury Q&A
- [Decision log](DECISIONS.md)
