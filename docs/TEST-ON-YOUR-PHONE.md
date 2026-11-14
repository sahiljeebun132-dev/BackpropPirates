# Zetway — install it and test it

Two builds, one codebase. Test the **Android app**; the web app is the fallback and the thing judges can open from a link.

---

## Part 1 — Install

### The Android app (do this one)

The file is `android/app/build/outputs/apk/debug/app-debug.apk`, about 7.6 MB.

**Over USB, from the laptop** — fastest, and it grants the permissions for you:

```bash
adb install -r -g "android/app/build/outputs/apk/debug/app-debug.apk"
```

`-r` replaces an older copy without wiping your saved contacts. `-g` pre-grants the runtime permissions, which is handy for a quick check but **skips the thing you most want to see** — the first-run permission card. Drop `-g` when you are testing that screen.

**Without a cable** — copy the APK to the phone (USB-C transfer, Drive, WhatsApp to yourself), tap it in Files, and allow "Install unknown apps" for whichever app asked. Android will warn you the app is unverified: that is what an unsigned debug build looks like, and it is expected.

To rebuild after a code change:

```bash
npm run build && npx cap sync android && (cd android && ./gradlew assembleDebug)
```

That needs `JAVA_HOME` pointing at JDK 21 — Capacitor 7 rejects 17.

### The web app

Open `https://backprop-pirates.vercel.app` in Chrome → ⋮ → **Add to Home screen**. Same codebase, minus the four things only the native build can do (background watching, automatic SMS, automatic call, lock-screen alert).

---

## Part 2 — The test list

Work down it. The right-hand column is what proves the claim, so if something differs, that is a bug worth knowing about tonight rather than at 13:00 tomorrow.

### A. First run — 3 minutes

| # | Do this | Should happen |
|---|---|---|
| A1 | Install **without** `-g`, open the app | "Before you ride" card appears **before** anything else, listing each permission and why |
| A2 | Tap through and allow all | Card does not come back on the next launch |
| A3 | Deny one, reopen the app | It explains what stops working, and does not nag on every screen |
| A4 | Scroll to Crash watch → readiness checklist | Seven items. All green reads "Ready to alert you with the phone locked" |
| A5 | Turn off notifications in Android settings, reopen | The checklist turns that item red and offers the settings shortcut |

### B. The planner — 4 minutes

| # | Do this | Should happen |
|---|---|---|
| B1 | Grand Baie → Port Louis, **Motorcycle**, Now | A score out of 100 with a band. Grand Baie → Port Louis on a bike reads **31, Severe** |
| B2 | Tap any factor | It opens to its own figures and names the government table it came from |
| B3 | Scroll to the map | Your route as a dashed blue line, accident-prone stretches in red across it |
| B4 | Tap a red stretch | It names the road and its length |
| B5 | Change departure to after dark | The score moves, and the darkness factor explains why |
| B6 | Switch Motorcycle → Car, same route | Score changes. Riders and pedestrians are weighted separately |
| B7 | Try a short hop (Curepipe → Vacoas) | Map still frames sensibly; it does not zoom to two dots |

### C. Breakdown guides — 3 minutes

| # | Do this | Should happen |
|---|---|---|
| C1 | "Broken down or had a crash?" → No one is hurt → Fully off the road | Guides for the vehicle the planner already knows you are on |
| C2 | On a motorcycle, check the list | 8 bike guides — puncture, won't start, chain, dropped it, lights, overheating, out of fuel, fire |
| C3 | Switch to Car | 7 car guides, including tyre and coolant |
| C4 | Open **Chain trouble** | "Stop and call for help if" sits **above** the steps, not below them |
| C5 | Say you are on a blind bend | It tells you to get clear first and changes the waiting advice |
| C6 | Tap **Read this aloud** on any guide | The phone speaks the steps. Until this morning the button did not appear in the app at all — the WebView has no speech synthesis, so it now goes through Android's own engine |

### C7–C10. Hands-free help — 4 minutes

This is the one to try somewhere you can shout without alarming anybody.

| # | Do this | Should happen |
|---|---|---|
| C7 | Home → **Hands-free help** → Start listening | Asks for the microphone the first time. Then "Listening — tap to stop", a level meter, and a block saying what this phone can actually do |
| C8 | Read the **Listening in** line | Says the language it settled on. French if your phone has the pack — that is how Kreol is matched. English if not, and it says so plainly rather than pretending |
| C9 | Say **"help"**, or "au secours", or "oskour" | Counts down out loud from 10 and shows what it heard. Say **"stop"** and it stops |
| C10 | Shout with no words at all | Counts down from 15 — longer, because a horn can fake a shout. Shouting is the trigger that needs no language, no model and no signal |
| C11 | Tap **Measure my shout** | Six seconds: three of silence, three of you shouting. It then states the gap it measured and the threshold it set. Do this once on the phone you will demo with — until you do, it is running a default that was never measured against a real microphone, and it says so |
| C12 | Read **Shout measured on this phone** | Should now say yes, with your own number. If it says it could not tell your shout apart from the room, the microphone is not delivering — check nothing else is holding it |

If words stop working mid-session the screen says so and keeps the shout
trigger running. That is deliberate: recognition is the fragile half and
shouting is the half that has to survive a dead spot.

### C13–C15. The demo room — 3 minutes

| # | Do this | Should happen |
|---|---|---|
| C13 | Laptop: **backprop-pirates.vercel.app/c/ZETW14**. Phone: Crash watch → *Pair with a demo screen* →  | Laptop lists one phone. The fire button only enables once it does, on purpose |
| C14 | Another phone: **backprop-pirates.vercel.app/w/ZETW14** → tap to watch, volume up | “Connected, all quiet” |
| C15 | Laptop: **Simulate impact** | Phone: red screen, countdown, buzz. Watcher: alarm, your coordinates, a map link. Say **“I am fine”** without touching the phone and it stands down. **Reset room** on the laptop before running it again |

### D. Crash watch — the important one, 10 minutes

| # | Do this | Should happen |
|---|---|---|
| D1 | Turn crash watch on | Card goes **On**; a notification sits in the shade saying it is watching |
| D2 | Watch the live sensor readout, shake gently | Number moves. Nothing fires |
| D3 | Turn **Test mode** on, shake hard | Alarm sounds, phone **buzzes**, countdown starts |
| D3a | While the countdown runs, say **"I'm OK"** | It cancels without you touching the phone. Saying **"help"** instead acts immediately rather than waiting out the thirty seconds |
| D4 | **Feel the vibration** | It buzzes in a long on-off pattern **for the whole countdown**, not for three seconds |
| D5 | Tap **I'm OK** | Alarm and buzzing stop at once. Watch re-arms itself |
| D6 | Fire it again → tap **Call ambulance 114 now** | Alarm silences, dialler opens with 114 in it, your contacts still get the text |
| D7 | Fire it again → tap **I need help — don't wait** | Skips straight to the help screen without waiting out the 30 seconds |
| D8 | Fire it again and **do nothing** | At zero: texts go out, it rings your first contact, the help screen lists what it did |
| D9 | Add a second contact, repeat D8 | Both are texted; only the first is rung |
| D10 | **Turn test mode off** | Threshold goes back to 3.1g. A hard shake should now do nothing |

### E. The lock-screen test — the one that matters on a real ride

| # | Do this | Should happen |
|---|---|---|
| E1 | Test mode on, crash watch on, **lock the phone**, put it in a pocket | — |
| E2 | Shake it hard through the pocket | Screen wakes by itself, alarm sounds, phone buzzes, the red screen is there **over** the lock screen |
| E3 | Leave it locked 10 minutes, then shake | Still fires. If not, battery optimisation killed it — the checklist has the shortcut |
| E4 | Close the app from recents, shake | Still fires. The service outlives the app |
| E5 | Put the phone in **Do Not Disturb**, shake | Still sounds **and still buzzes** — this is the bug fixed tonight |

### F. Offline — the surprise card, 2 minutes

| # | Do this | Should happen |
|---|---|---|
| F1 | Load the app once with signal, then turn on **airplane mode** | — |
| F2 | Force-close and reopen | It still opens |
| F3 | Run a route | The score still works, worked out on the phone |
| F4 | Look at the banner | "Waiting for signal" rather than a stale forecast |
| F5 | Check the forecast panel | It says it cannot work offline. It does **not** show an old number |

### G. Legal and accessibility — 2 minutes

| # | Do this | Should happen |
|---|---|---|
| G1 | Open the legal panel | Data Protection Act 2017 and Road Traffic Act, and the line saying we are students, not lawyers |
| G2 | Turn on TalkBack, sweep the home screen | Everything is reachable and the map has a text description |
| G3 | Phone font size to largest | Nothing clips or overlaps |

---

## Part 3 — What the emulator already proved

Run on a headless Android 15 emulator tonight, with exact values injected into the accelerometer — the one test a hand cannot do, because shaking a phone only ever tells you "something over the bar".

| Injected | In g | Alert |
|---|---|---|
| 9.81 m/s² (at rest) | 1.00 g | no |
| 24 m/s² (hard braking, pothole) | 2.45 g | **no** |
| 52 m/s² (collision) | 5.31 g | **yes** |

Also confirmed on the emulator:

- Foreground service runs as `FOREGROUND_SERVICE_TYPE_SPECIAL_USE` and holds `PARTIAL_WAKE_LOCK "zetway:crashwatch"`
- The service **cannot** be started by another app (`Requires permission not exported from uid 10209`)
- Alert posts on channel `zetway.alert.v3` at `IMPORTANCE_HIGH` with `USAGE_ALARM` and a full-screen intent
- Vibration runs **35,207 ms at `usage: ALARM`**, uninterrupted

That last line is the fix from tonight. Before it, the dump read `170 ms` at `usage: UNKNOWN` — and `UNKNOWN` is the bucket Android silently drops when Do Not Disturb is on or the ringer profile has vibration switched off. The alarm played, the phone never moved.

## What the emulator cannot tell you

Keep these on the real phone: how the vibration actually feels, a real SMS, a real call, your handset maker's battery manager, and what your lock screen does. That is section E, and it is the section worth your time.
