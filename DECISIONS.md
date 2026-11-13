# Decision log

Key decisions with times. Friday 13 – Saturday 14 November 2026, Mauritius time.

| Time | Decision | Why | Alternatives considered |
|---|---|---|---|
| Fri 12:27 | Created the public repo `BackpropPirates` | Rule 2: own public repo from kickoff | — |
| Fri 13:33 | Automatic hourly checkpoint commits, on top of manual commits after each feature | Judges check commit history; organisers asked for every 1–2 hours | Manual commits only; every 3 hours |
| Fri 14:05 | Stack: mobile-first web app (Vite, React, TypeScript, Tailwind) on Vercel | Opens on any phone from a link, with no APK build that can fail before the demo. Organisers confirmed web apps count equally | Expo/React Native APK; Flutter |
| Fri 14:20 | Theme 2, Powered to Move. Problem: commuters cannot see how dangerous a specific journey is | Mauritius publishes rich road-casualty data that reaches nobody who is about to travel | Theme 1 scam checker; Theme 3 clinic finder |
| Fri 14:30 | User: a young two-wheeler rider on the northern corridor, riding after dark | 49.9% of casualties are riders or pedestrians; the worst district is on that corridor; darkness more than doubles the fatal share. A specific user, not "everyone in Mauritius" | A general driver audience, which the organisers named as a classic mistake |
| Fri 14:40 | Core dataset: Accident Prone Areas, because it holds real road geometry | It is the difference between "this district is risky" and "your route passes 14 named black spots". Turned a generic idea into a corridor-specific one | District averages only |
| Fri 14:45 | Fetch data via the Electric Sheep mirror rather than scraping data.govmu.org | The portal is behind a bot check. The mirror carries the original CKAN resource IDs and URLs, so provenance survives and the app links to the original file | Manual browser downloads, which nobody could reproduce |
| Fri 15:00 | Derive town coordinates from official health-facility positions | Even the place list is then data-derived rather than typed in | A hand-written list of town coordinates |
| Fri 15:05 | Map the 9 administrative districts onto the 7 police districts ourselves, and publish the mapping | The casualty table and the facilities table use different district schemes. Better to state the assumption than to hide it | Dropping the district factor entirely |
| Fri 15:20 | Score shows its own arithmetic: each factor opens to its figures and its source table | "Where does 31 come from" is the first question a judge asks. Answer it in the app, not in the pitch | A single opaque number |
| Fri 15:35 | Rebuilt the score's normalisation after testing all 5,200 combinations | The first model rated 70% of journeys Severe and nothing safe, because vehicle occupants are always the largest casualty group, so every car trip was punished for being ordinary. Anchoring each factor to both ends of the observed range fixed it | Shipping it and hoping no judge tried a rural daytime route |
| Fri 15:50 | Keep a build journal as a generated Word document | So any team member can answer a jury question with the same figures the app shows, and it regenerates from the live data | Notes in a chat thread |
| Fri 16:00 | Named the app **Zetway** | Short, memorable and ours. "Zet" reads as the Creole/French clip of *trajet* — the journey — which is exactly what the app scores. The team stays BackpropPirates | SafeRoute Mauritius, which was descriptive but generic |
| Fri 16:20 | Adopted the Zetway logo and rebuilt the app palette from it | The mark carries the Mauritius flag inside a location pin, which says "this is about this island" before a word is read. The app's near-black header is the logo's own background so the mark sits flush, the blue is sampled from WAY, and the alert colours are the flag's own red, yellow and green | Keeping the generic teal |
| _Sat --:--_ | _Surprise card adaptation: TODO_ | | |
