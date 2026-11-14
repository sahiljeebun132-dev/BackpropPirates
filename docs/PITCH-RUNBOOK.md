# Zetway — pitch runbook

**Saturday 14 November 2026, 13:00. Ten minutes.** Team BackpropPirates.

Two roles. **Speaker** talks and never touches a device. **Driver** works the phone
and the laptop and never talks. If you are pitching alone, do the demo beats
with the laptop only and skip the second phone — the run-of-show below marks
which beats need a second pair of hands.

Everything the Speaker needs to say is in the deck's own speaker notes, in more
detail than this. This file is the running order, the taps, and what to do when
something fails.

---

## T-30 (12:30) — pre-flight

Do these in order. None of them takes longer than a minute, and three of them
are things only you can do.

- [ ] **Install the APK on the demo phone.** `backprop-pirates.vercel.app/zetway.apk`
      — the live file is sha `7f99c06f` / 18.6 MB. **Reinstall even if you
      already installed one today:** the earlier build had a broken
      report-a-hazard screen and a map missing two thirds of its roads. The web
      link works on any phone, but only the Android app can read the
      accelerometer with the screen off, text without a tap, and sound at alarm
      priority. Demo the app, not the link.
- [ ] **Turn location on before you demo Report a hazard.** Without a position
      the send button reads "Turn location on to send this" and stays disabled
      — correct, because a hazard with no location is useless, but it looks
      broken on stage. The location pill is in the header.
- [ ] **Save emergency contacts** in the app: your teammates, and any judge who
      is willing. An empty contact list makes the crash beat do nothing.
- [ ] **Tap "Measure my shout"** — *in the pitch room, with people in it.* It
      takes six seconds and sets the trigger against that room's actual noise
      floor. A threshold calibrated in a quiet bedroom will not fire in a hall.
- [ ] **Open `backprop-pirates.vercel.app/c/ZETW14` on the laptop.** Leave the
      tab open. This is the chamber that fires the crash.
- [ ] **Open `/w/ZETW14` on a second teammate's phone** and leave it on screen.
      This is your guaranteed receiver — see the fallback note below. Do not
      build the beat on judges joining in time.
- [ ] **Airplane mode on, check the score still computes, airplane mode off.**
      Ten seconds, and it is the proof behind the surprise card.
- [ ] **Charge everything. Screen timeout to never. Do-not-disturb OFF** — the
      alarm needs to be audible.
- [ ] **Know the two numbers on slide 6.** The slide used to say 442 KB, which
      stopped being true when `roads.json` was added. It now says **67 KB**,
      which is what the Corridor Safety Score actually needs: hotspots,
      districts, conditions, exposure and the town coordinates. Verified against
      `src/lib/risk.ts` today.

      The second number is **596 KB** — all ten data files, which is what the
      service worker precaches and what makes the black spots, emergency numbers
      and guides work offline too. Of that, 278 KB is government tables and the
      rest is road geometry from OpenStreetMap.

      **Do not merge the two.** Slide 6's speaker notes say the score comes
      "from ten static files" — that is right about the files and would be wrong
      at 67 KB. Say "67 KB for the score, under 600 KB for everything that works
      offline", or just say one of them.
- [ ] **Push nothing after noon.** The deploy is live and verified. A build at
      12:50 is the only thing that can still break this.

---

## Run of show — 10 minutes

Timings are cumulative. The demo is four of the ten minutes, which is correct:
the demo is the thing. If you are running long, cut from slide 4, never from the
demo.

### 0:00 — Slide 1 · The number (45s)

Open with the number, not with yourselves.

> In 2024, 134 people were killed on Mauritian roads. 3,029 were injured or
> killed, out of 39,485 reported accidents, on an island of 1.3 million. And
> 49.9% of those casualties were on two wheels or on foot — half the harm lands
> on the people with no metal around them.

Then one line on the name: Zetway is *Zet*, from *trajet* — the journey. That is
what it scores.

### 0:45 — Slide 2 · Who, and what they cannot see (45s)

Not "everyone in Mauritius". One rider.

> A young motorcycle rider commuting the northern corridor — Grand Baie and
> Goodlands down into Port Louis — riding home after dark. Pamplemousses and
> Rivière du Rempart is the worst of the seven police districts: 649 casualty
> accidents against 204 in the quietest, and 357 of its casualties were riders.
> In unlit darkness a casualty is 2.2 times as likely to be fatal as in
> daylight.
>
> They cannot see any of this before they set off. The data exists — it sits in
> annual PDF digests that reach statisticians, not riders.

### 1:30 — Slide 3 · DEMO, part one: before you ride (2:00)

**Driver mirrors the phone.** Speaker narrates, Driver taps.

| Driver taps | Speaker says |
|---|---|
| Plan a trip → Grand Baie → Port Louis → Motorcycle → **19:30**, road **not lit** | "One rider, one corridor, one moment." |
| Read the score: **31** | "Thirty-one out of a hundred, from the government's own tables." |
| Tap the time-of-day factor | "Tap any factor and it shows you the figures and names the table. 8.2% of casualties are fatal on an unlit road against 3.7% in daylight." |
| Tap **leave at 17:00** → **46** | "Same road, same bike, a couple of hours earlier — thirty-one to forty-six. Still severe, because this corridor is dangerous at any hour and the app will not pretend otherwise. That is the product: not a warning, a decision you can act on." |
| Open the live map, let it follow | "The roads are geometry stored in the app. No tiles, no requests — so it does not go blank in a dead spot." |

> **Do not promise the badge will change.** Both 31 and 46 are labelled
> "Severe risk", because the band threshold is 50 and this corridor does not
> clear it at any hour. If the Speaker says "and now it's safe" while the screen
> still says Severe, the demo contradicts itself on the slide the whole pitch
> rests on. Say the number moved and the band did not, and say why — that is a
> stronger answer to a sceptical judge than a badge turning green, and it is the
> same argument as the calibration story on slide 5. The score is an exposure
> indicator, not a verdict on whether the trip is acceptable.

**Needs a second phone:** on the second phone, report a hazard by voice — speak
it, confirm it, send it. It appears on the first phone within seconds.

> "Reported by speaking, because the one moment you cannot use a keyboard is
> riding past the thing you want to warn people about."

*Solo variant:* skip the second phone and say the line while showing the report
screen on the demo phone.

### 3:30 — Slide 3 · DEMO, part two: when it goes wrong (2:00)

This is your strongest two minutes. Slow down.

> "That is before you ride. Here is what happens when it goes wrong anyway —
> and the rider cannot reach the phone, because they are under the bike."

| Driver does | Speaker says |
|---|---|
| Hold up the phone, shout at it | "A shout alone arms it. Loudness read straight off the microphone — no model, no language, no network, no Google services. It works in a dead spot." |
| Let the countdown speak, then say **"I am fine"** | "It does not dial on hearing a noise. It opens a spoken countdown you can stop, because a false alarm costs a real crew a real call-out." |
| Shout again, then say **"help"** | "And during that countdown, 'help' escalates immediately instead of waiting." |
| Say **"anbilans"** | "In English, French or Kreol. This one goes straight to the dialler with 114 in it." |

**Optional, and the strongest way into this beat if the room is big:** play
`docs/pitch-assets/zetway-sos.mp4` first, on the laptop, before you touch the
phone. Thirteen seconds, no sound: the car on its roof, the driver hanging in
the belt, and the phone on the tarmac out of reach with the real app counting
down on it. It makes the next ninety seconds obvious instead of abstract. Say
"this is a drawing, the crash physics clip is the simulated one" if a judge
asks — it is a diorama and the repo says so.

Then the chamber. **On the laptop, press the trigger on `/c/ZETW14`.**

> "I am going to crash a phone from this laptop. Watch your own screens."

Every phone in the room on `/w/ZETW14` lights up with the alarm and the GPS
position. Let it ring for a full three seconds before you speak over it.

> "Every contact is texted a map link at once and the first one is called, with
> no tap. One honest note: a handset places one voice call at a time — that is
> the carrier's rule, not a choice we made. So the texts go out together, one
> call is placed, and this page is a live feed. Nothing in our deck claims
> otherwise."

Then stand it down from the laptop.

### 5:30 — Slide 4 · Twelve tables, nothing hand-entered (60s)

> "Twelve official tables. Ten of them power a feature. Two scripts: one
> downloads them, one cleans them — and the raw downloads are committed, so
> anyone can re-run it and get the same numbers.
>
> The find is the Accident Prone Areas table. It is not a list of place names,
> it is 48 road segments as real geometry, named by road number — 'M1: Belle
> Village up to Caudan'. So we name the black spots on *your* route, not a
> district average."

### 6:30 — Slide 5 · Where the number comes from (90s)

Linger here. This is the question a judge actually asks.

> "Four measurements, each a ratio between published figures. On the capture
> beside me, that same Grand Baie trip: 14 accident-prone segments costs 35,
> district volume 8, rider risk 11, unlit darkness 15. A hundred minus
> sixty-nine is thirty-one. The only numbers we chose are the four weights, and
> the app prints them on screen.
>
> And the first version was wrong. We scored all 5,200 combinations and 70% came
> out 'Severe', because vehicle occupants are always the largest casualty group
> — so every ordinary car trip got punished for being ordinary. We re-anchored
> each factor to the range the data actually spans. Scores now run 22 to 94."

Then eight seconds on the voice bug — one example only:

> "Same thing in the voice triggers. Our cancel list held 'mo bon'. 'Mo bon'
> sits inside 'mo Bondie' — which is the commonest thing a hurt Mauritian says.
> A cry of pain was being read as a cancellation. Found by reading our own
> matcher against sentences a hurt person would really say, not by waiting for
> it on stage. 47 tests became 81."

### 8:00 — Slide 6 · Runs on nothing, belongs to someone (60s)

> "Static JSON from the edge and three small functions on free tiers. The
> weather feed needs no key. A data refresh is two scripts and a push.
>
> And it belongs to someone: the Road Safety Unit and the police already publish
> this data. Handing it over costs them a repository, not a procurement.
>
> Our surprise card is Offline Mode — and the honest version is that the score
> never needed the network. It is computed on the device from 442 KB of
> government tables. The score, the 48 black spots, the emergency numbers and
> all 15 roadside guides work in airplane mode. The forecast and other riders'
> reports cannot, are not cached, and the app says which is which."

### 9:00 — Close (30s)

> "Know the road before you go. backprop-pirates.vercel.app — it opens on any
> phone, no store, no install. Thank you."

Stop at 9:30. Leave the last thirty seconds alone.

---

## If something breaks

Decide these now so you are not deciding them on stage.

**Conference wifi is dead.** Lean in, do not apologise. Put the phone in
airplane mode and run the whole score demo anyway — that *is* the surprise card,
brought forward. Skip the chamber and the live hazard report; say "those two
need the network and the app tells you so" and play `docs/pitch-assets/zetway-demo.mp4`
from the laptop instead.

**Judges don't join `/w/ZETW14` in time.** Your teammate's phone is already on
it from the T-30 checklist. Fire the trigger anyway and show that one. Never
wait on the room.

**The shout doesn't fire.** Do not shout twice. Say the words instead — "ed mwa",
"help" — which go through the same path. Then say: "that is why the app measures
the room instead of shipping a fixed threshold," and move on. One recovery line,
then forward.

**The APK won't install on a judge's phone.** Don't troubleshoot it live. Give
them the link — it opens instantly on anything, which is the point of shipping
both.

**The score comes out different from 31 or 46.** The weather feed is live, so it
can move. Read whatever number is on screen and carry on — the factors and the
tables are what you are demonstrating, not one memorised figure. Never correct
yourself to a number the screen is not showing.

**Why 19:30 and 17:00, and not 19:00 and 18:00.** Sunset today is 18:25, and the
app counts "daylight" as ending 25 minutes before sunset — so 18:00 lands exactly
on the boundary between day (46) and dawn-dusk (38). One minute of drift in the
forecast and the Speaker says 46 while the screen says 38. 17:00 is comfortably
inside daylight and 19:30 is comfortably into night, and both give the same
numbers the deck quotes. The "road not lit" toggle is what makes the night trip
31 rather than 32 — set it.

**Something crashes outright.** `docs/pitch-assets/zetway-demo.mp4` is on the
laptop and is the whole demo, already recorded. Play it, narrate over it, and do
not mention that it was the backup.

**If a judge asks to see a roadside guide, pick one of these four.** An
adversarial pass over the clips frame by frame cleared *Car won't start*,
*Motorcycle won't start*, *Motorcycle dropped* and *Ran out of fuel* — every
beat checked against the written step it illustrates.

*Dashboard warning light* was a third defect and is now fixed: its needles used
to climb back to cruise on screen during step 2, where the car is supposed to be
switched off. Re-rendered and checked at the frame that was worst — both needles
now hold on their stops with the cluster dark. It is safe to show.

Avoid one. *Motorcycle puncture* has a nail that passes through the road surface
for about a third of a second, and an air hose that detaches from the valve and
floats. Neither is fatal if it plays, and neither is new — but do not choose it
yourself.

The remaining clips have not been reviewed to that standard. They are not known
to be wrong; nobody has checked them frame by frame.

---

## Questions you will get

One-sentence answer first. The detail only if they push — the deck's speaker
notes carry the long version of every one of these.

**"Why doesn't it just dial 114 automatically?"**
Android refuses that call to every third-party app, and that door is closed to
us. *Detail:* `ACTION_CALL` is blocked for emergency numbers and
`CALL_PRIVILEGED` is not available to apps outside the system; Apple's own Crash
Detection, with the hardware and OS privileges, still counts down before
calling. Our plugin asks the OS whether a number is an emergency number and
refuses cleanly instead of throwing mid-crash.

**"Is this just Waze?"**
Waze crowd-reports congestion; we score how dangerous your specific journey is
from the government's casualty record, and we work offline.

**"Does it really understand Kreol?"**
No phone ships a Morisyen speech model, so we ask the recogniser for French and
match on roots — "oskour" arrives as something near "au secours" and still
matches. We are not claiming a Kreol model exists, because none does.

**"What about iPhones?"**
The link works on any iPhone today. The three crash features — reading the
accelerometer with the screen off, texting without a tap, alarm-priority sound —
are Android-only because iOS forbids them to third-party apps. Say this plainly;
it is a platform limit, not an unfinished feature.

**"What stops false hazard reports?"**
They expire after four hours, and they never move the score. The score cites
government tables over years; an unverified report from a stranger is a
different kind of claim, so it sits above the score rather than inside it.

**"What about false crash alarms?"**
Neither trigger dials anything on hearing a noise — both open a spoken,
cancellable countdown. *If they push:* play `crash-moto.mp4`, rendered in Blender
with Bullet rigid-body physics and an articulated belted occupant, nothing
keyframed. It is the picture of why the alert corroborates rotation and change
of speed rather than peak g alone.

**"Why is the light-condition data from 2018?"**
That is the most recent year the publisher has released. Every figure in the app
carries its year.

**"Have you thought about satellites?"**
We evaluated it and rejected it on evidence. Seeing something car-sized needs
sub-metre resolution, which means low orbit and roughly one pass a day; the
satellites that watch continuously are weather satellites at 500 m a pixel,
where a car does not exist. Mauritius is also cloudy. What we use is still
remote-sensed — it just arrives as numbers.

**"Is this legal? What about privacy?"**
We read the Data Protection Act 2017 and the Road Traffic Act rather than
guessing. The crash voice recording is personal data, rests on the
vital-interests basis the Act allows, is capped at 45 seconds, is announced on
screen, and never leaves the handset. Hand-held phone use while driving is an
offence, so everything the app asks of a rider happens before they set off or
after they have stopped. There is a panel in the app that says all of this, and
says we are students and not lawyers.

**"It says Severe either way — so what has the rider actually gained?"**
Forty-six is still severe, and that is the honest output: this corridor is
dangerous at every hour, and an app that turned green at 46 would be lying to
sell itself. What moved is the exposure — riding it in daylight instead of unlit
darkness takes the fatal share from 8.2% to 3.7%. The band is a label; the
number is the measurement, and the rider is choosing between two versions of a
trip they are going to make anyway. *If they push:* tap into the breakdown and
the app says it in its own words — "The score shows recorded exposure, not a
prediction about today."

**"Could you prove the scoring isn't tuned to your demo route?"**
`scripts/check_score_spread.mjs` scores all 5,200 combinations and is in the
repo. That is how we found the first version was wrong.

---

## Reference card

| | |
|---|---|
| App | `backprop-pirates.vercel.app` |
| APK | `backprop-pirates.vercel.app/zetway.apk` |
| Judges' live feed | `backprop-pirates.vercel.app/w/ZETW14` |
| Laptop chamber | `backprop-pirates.vercel.app/c/ZETW14` |
| Demo route | Grand Baie → Port Louis, Motorcycle: **19:30 unlit → 31**, **17:00 → 46** |
| Sunset today | 18:25 — daylight band ends 18:00, night begins 18:50 |
| Backup video | `docs/pitch-assets/zetway-demo.mp4` |
| Aftermath film | `docs/pitch-assets/zetway-sos.mp4` — 13s, no sound needed |
| Crash physics clip | `docs/pitch-assets/zetway-crash.mp4` |
| Deck | `docs/Zetway-Pitch.pptx` — 6 slides, full speaker notes |
