# BackpropPirates
LifePoweredByTechCompetition: Life Powered by Tech hackathon, 13–14 November 2026

> **One line:** _TODO: what the app does, for whom._

## The problem
_TODO: one specific Mauritian user and their real pain point. Why does it matter here?_

## Our user
_TODO: who exactly (age, situation, district) and what they do today without this app._

## What the app does
_TODO: the core feature, end to end, in 3–4 steps._

## Data sources
| Dataset | Publisher | Link | Feature it powers |
|---|---|---|---|
| _TODO_ | _e.g. Open Data Mauritius (MDPA)_ | _data.govmu.org/dataset/..._ | _TODO_ |

_Cleaning notes: TODO, describing what we fixed in the raw files and how._

## Surprise card
**Card drawn:** _TODO_
**How we adapted:** _TODO: what changed in the app, and where you can see it._

## Tech stack
- **Mobile-first web app**: Vite 8, React 19, TypeScript, Tailwind CSS 4. It runs in any phone browser and can be added to the home screen through the web manifest.
- **Hosting**: Vercel, which redeploys on every push to `main`.
- **Data**: cleaned JSON in `public/data/`, built from the raw official files in `data/raw/` by scripts in `scripts/` (see [data/README.md](data/README.md)).

Why a web app: one link works on every teammate's and judge's phone, and there's no APK build that could fail at the last minute. The organisers confirmed web apps count equally.

## AI tools used (disclosure)
| Tool | What we used it for |
|---|---|
| Claude Code (Anthropic, Claude Opus 5.5) | Planning, setup, code generation and review |
| _TODO_ | _TODO_ |

Everything AI produced was reviewed, run and tested by the team.

## How to run
**Live app:** _TODO: link (open on a phone)_

Run it locally (Node 20+):

```bash
npm install
npm run dev      # http://localhost:5173, or add --host to open it on a phone on the same Wi-Fi
npm run build    # type-check and production build into dist/
```

_TODO: any environment variables (never commit real keys)._

## Team
_TODO: names and roles._

## Decision log
See [DECISIONS.md](DECISIONS.md).
