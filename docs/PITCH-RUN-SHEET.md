# Zetway — pitch run sheet

**Saturday 14 November, 13:00. Ten minutes.** Read this at 08:00, not at 12:55.

Everything below is a thing that already works. Nothing here needs building.

---

## Before you walk in

- [ ] Phone charged, **airplane mode off for now**, APK installed, crash watch armed once so the permissions are already granted
- [ ] Laptop charged. Open these four tabs **before** the room fills:
  1. `backprop-pirates.vercel.app`
  2. `backprop-pirates.vercel.app/crash-demo.html`
  3. `docs/pitch-assets/zetway-demo.mp4` (the backup video, **local file**, not streamed)
  4. The deck
- [ ] Load the live app once on the laptop **while you still have wifi**, so the service worker caches it. If the venue wifi dies, the demo still runs.
- [ ] Team leader: repo link submitted via the organisers' form

---

## The ten minutes

| Time | What | The one line that matters |
|---|---|---|
| 0:00–1:00 | **The number** | 134 killed in 2024. 3,029 injured or killed. **Half were on two wheels or on foot** — the people with the least information before they set off. |
| 1:00–2:00 | **The user** | A rider commuting the northern corridor after dark. Their district recorded 649 casualty accidents, the worst of seven. None of it reaches them before they ride. |
| 2:00–5:00 | **Live demo** (below) | Not slides. Open the app. |
| 5:00–6:30 | **When it goes wrong** | 15 roadside guides, cars and motorcycles separately. Crash watch. |
| 6:30–7:30 | **Surprise card** | Airplane mode, live, in front of them. |
| 7:30–8:30 | **Where the numbers come from** | Every figure names its table. Show the "Based on:" line. |
| 8:30–10:00 | **Q&A** | Answers below. |

---

## The live demo, in order

Do it on **your phone**, mirrored or held up. Say what you are about to do before you do it.

1. **Grand Baie → Port Louis, motorcycle, now.** Tap *Check this route*.
   → **31 out of 100. Severe.**
2. **Tap any factor.** It opens to its figures and names the government table.
   → *"Where does 31 come from" is the first question a judge asks. We answer it in the app, not the pitch.*
3. **Tap "leave at 18:00" if it offers it.** The score moves.
   → *Darkness with no street lighting is 2.2× as likely to end in a death. 8.2% fatal against 3.7%.*
4. **Broken down or had a crash? → No one is hurt → Fully off the road → Continue.**
   → Motorcycle guides, because the planner already knew you were on a bike.
5. **Chain trouble.** Point at *"Stop and call for help if"* sitting **above** the steps.
   → *A chain that comes off at speed can lock the rear wheel.*
6. **Then the surprise card.** See below.

---

## The surprise card — do this live

This is the strongest 30 seconds you have. **Rehearse it once tonight.**

1. Say: *"The card was Offline Mode. Watch."*
2. **Turn on airplane mode.** Show the phone.
3. **Reload the app.** It still loads.
4. Run a route. **The score still works.**
5. Point at the banner: *Working now* vs *Waiting for signal*.

Then the line that wins it:

> *"We didn't bolt offline on. The score never needed the network — it's worked out on the phone from 269 KB of government tables. The app only ever died offline because it had to fetch them. And the Android build never had the problem at all: those files already ship inside the APK."*

Then, immediately and without being asked:

> *"The forecast and other riders' reports genuinely can't work offline. We don't cache them and we don't fake them — a stale forecast is worse than none, because you'd act on it."*

---

## Questions you will get, and the honest answers

**"Why doesn't it call the ambulance automatically?"**
Android refuses `ACTION_CALL` for emergency numbers from every third-party app, and `CALL_PRIVILEGED` is closed to us. **No app on the Play Store can dial an ambulance by itself.** Apple's own Crash Detection, with the hardware and the OS privileges, still counts down before calling — and still flooded dispatch centres near ski resorts. Our plugin asks the OS whether a number is an emergency number and refuses rather than throwing mid-crash. The texts and the call to a saved contact *are* automatic.

**"Is any of this data invented?"**
No. Two scripts: `fetch_raw.py` downloads the tables, `build_app_data.py` cleans them. Nothing typed by hand. The raw downloads are in the repo.

**"Your routes are straight lines."**
Yes, and the app says so on screen. A segment counts as on your corridor within 3 km of the line. On an island 65 km across that is a fair approximation, and real routing is the obvious next step.

**"How do you know the score is calibrated?"**
`check_score_spread.mjs` scores all 5,200 combinations: 22 to 94, median 59. **Our first version was wrong** — it rated 70% of routes Severe because vehicle occupants are always the largest casualty group, so every car trip was punished for being ordinary. We re-anchored each factor to the range the data spans.

**"What about privacy / is this legal?"**
We read the **Data Protection Act 2017** and the **Road Traffic Act** rather than guessing. A voice recording is personal data, so the crash recording rests on the vital-interests basis the Act allows: capped at 45 seconds, announced on screen, never uploaded. Hand-held phone use while driving is an offence carrying penalty points, so everything the app asks of a rider happens before they set off or after they've stopped. There's a panel in the app that says all of this — and says we're students, not lawyers.

**"Who would run it?"**
The people who already publish this data. Handing it over is a repo transfer, not a procurement.

---

## If something breaks

| Fails | Do this |
|---|---|
| Venue wifi | **Nothing.** The app is cached. That *is* the surprise-card answer — lean into it. |
| Phone won't mirror | Hold it up and narrate. Or switch to the laptop tab. |
| Live demo misbehaves | `zetway-demo.mp4`, 93 seconds, plays from the local file with no network. |
| Crash watch won't fire | Use *Show me what happens in a crash* — the rehearsal. Say it's a rehearsal. |
| Everything | The deck has screenshots of all of it. |

---

## Do not say

- "It predicts accidents." It doesn't. It's an **exposure indicator** from recorded history.
- "It detects crashes automatically and calls for help." It detects and it **asks**; the countdown exists because detection is sometimes wrong.
- Any number that isn't on the screen behind you.
