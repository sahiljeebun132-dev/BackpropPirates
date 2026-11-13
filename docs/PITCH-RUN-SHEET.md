# Zetway — pitch run sheet

**Saturday 14 November, 13:00. Ten minutes.** Read this at 08:00, not at 12:55.

Everything below is a thing that already works. Nothing here needs building.

---

## Before you walk in

- [ ] Phone charged, **airplane mode off for now**, APK installed, crash watch armed once so the permissions are already granted. Arm it by tapping the **Crash watch** line on the home screen, then *Turn crash watch on* on the page it opens
- [ ] **Check the footer says `Android app`**, not `Web app`. Only the Android build buzzes, texts and calls on its own — the web one cannot, by design of the browser, and the footer is there because an evening was lost to not knowing which was installed
- [ ] Laptop charged. Open these four tabs **before** the room fills:
  1. `backprop-pirates.vercel.app`
  2. `backprop-pirates.vercel.app/crash-demo.html`
  3. `docs/pitch-assets/zetway-demo.mp4` (the backup video, **local file**, not streamed)
  4. The deck
- [ ] Load the live app once on the laptop **while you still have wifi**, so the service worker caches it. If the venue wifi dies, the demo still runs. **Do this after the last deploy, not before** — a deploy renames the app's bundle, because the filenames carry a content hash, and the stored copy still points at the old one. The first online load after the deploy is what puts the new bundle in the cache.
- [ ] Judges can install it themselves: the site carries both builds, in a card low on the home screen. Say so — it is a stronger line than any slide about shipping twice from one codebase.
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

1. **Grand Baie → Port Louis, motorcycle.** The two dropdowns and *Motorcycle* are already the defaults. Under **When you are leaving** tap **Change**, then set the time to **19:00** — your rider commutes home after dark, and that is the number on your slides. Tap *Check this route*.
   → **31 out of 100. Severe risk.**

   > **Do not leave it on _Now_.** At 13:00 the forecast puts you in daylight and the same route scores **46** — still Severe, but not the number on the deck, and not the number the airplane-mode run will show, because offline it falls back to after-dark and reads 31. The score would change mid-pitch with nothing to explain it. Verified across all four light bands: day 46, dawn-dusk 38, night-lit 32, night-unlit 31.
2. **Tap any factor.** It opens to its figures and names the government table.
   → *"Where does 31 come from" is the first question a judge asks. We answer it in the app, not the pitch.*
3. **Scroll to the map.** The route, with fourteen red stretches lying across it.
   → *"This is the whole idea. Not a district average — the black spots on the road you are about to ride."* Tap one; it names the road.
4. **Scroll back up to the card under the dial** — it sits above the factors, not below the map. It reads *Leaving earlier, at … scores 46, not 31*; the app picks the time. Tap *Use … instead* and the score moves.
   → *Darkness with no street lighting is 2.2× as likely to end in a death. 8.2% fatal against 3.7%.*
   → If the card does not appear, the same comparison is already written in **What to do about it** further down. It only offers a slot that is at least 6 points better and within three hours, which is why departing in daylight it never shows.
5. **Broken down or had a crash** — the second pill row, under the two tiles. Then *No, everyone is fine → Fully off the road → Continue*.
   → Motorcycle guides, because the planner already knew you were on a bike.
6. **Chain trouble.** Point at *"Stop and call for help if"* sitting **above** the steps.
   → *A chain that comes off at speed can lock the rear wheel.*
7. **Point at _Watch someone do this_** above the steps, and say what it is.
   → *"That opens YouTube. Someone else's video, and we say so. The steps underneath are the ones we wrote and the ones that work with no signal."* Honesty about a borrowed thing reads better than pretending it is yours.
8. **Then the surprise card.** See below.

---

## The surprise card — do this live

This is the strongest 30 seconds you have. **Rehearse it once tonight.**

1. Say: *"The card was Offline Mode. Watch."*
2. **Turn on airplane mode.** Show the phone.
3. **Reload the app.** It still loads.
4. Run a route. **The score still works.**
5. Point at the banner: *Working now* vs *Waiting for signal*.
6. **Open _Ask Zetway_ and type "my chain came off", still in airplane mode.** It answers.
   → *"And the assistant works too, because it is not a chatbot and there is no server to lose. It looks your question up in the same tables."*

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
Yes, and the app says so on screen — the figure is labelled **direct**, and a segment counts as on your corridor within **2 km** of the line, which is printed under the stretch list.

Do not call it "a fair approximation" any more. We measured it. Against real road routes on five corridors the straight line understates distance by **42% on average** — Grand Baie to Port Louis is 18.2 km direct and 27.3 km by road, and Grand Baie to Centre de Flacq is 24.7 against 39.7. The honest answer is:

> *"It is a straight line, and we checked how wrong that is rather than guessing: about 40% short on the corridors we measured. The score is an exposure indicator over a corridor, not a distance calculator, so the ranking holds — but real routing is the first thing we would add, and it is a key away, not a rewrite."*

That is a stronger answer than the one it replaces, because a judge who measures it themselves finds you already had the number.

**"How do you know the score is calibrated?"**
`check_score_spread.mjs` scores all 5,200 combinations: 22 to 94, median 59. **Our first version was wrong** — it rated 70% of routes Severe because vehicle occupants are always the largest casualty group, so every car trip was punished for being ordinary. We re-anchored each factor to the range the data spans.

**"What about privacy / is this legal?"**
We read the **Data Protection Act 2017** and the **Road Traffic Act** rather than guessing. A voice recording is personal data, so the crash recording rests on the vital-interests basis the Act allows: capped at 45 seconds, announced on screen, never uploaded. Hand-held phone use while driving is an offence carrying penalty points, so everything the app asks of a rider happens before they set off or after they've stopped. There's a panel in the app that says all of this — and says we're students, not lawyers.

**"Is the assistant AI? Is it a chatbot?"**
No, and the screen says so before you ask. There is no model and no network call: it matches your words against the places, guides and tables already on the phone, answers with the real figure, and names the table. That is why it still answers in airplane mode. Ask it the capital of France and it tells you it cannot, and lists the four things it can do. We would rather ship something narrow that cannot be wrong about which road is dangerous than something broad that can.

**"Who would run it?"**
The people who already publish this data. Handing it over is a repo transfer, not a procurement.

---

## If something breaks

| Fails | Do this |
|---|---|
| Venue wifi | **Nothing.** The app is cached. That *is* the surprise-card answer — lean into it. |
| Phone won't mirror | Hold it up and narrate. Or switch to the laptop tab. |
| Live demo misbehaves | `zetway-demo.mp4`, 1 min 42 s, plays from the local file with no network. |
| Crash watch won't fire | Tap the **Crash watch** line, then *Show me what happens in a crash* — the rehearsal. Two taps now, not one, so know where it is. Say it's a rehearsal. |
| Everything | The deck has screenshots of all of it. |

---

## Do not say

- "It predicts accidents." It doesn't. It's an **exposure indicator** from recorded history.
- "It detects crashes automatically and calls for help." It detects and it **asks**; the countdown exists because detection is sometimes wrong.
- Any number that isn't on the screen behind you.
