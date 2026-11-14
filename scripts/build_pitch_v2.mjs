/**
 * The six slides, shaped to the skit.
 *
 * Run: node scripts/build_pitch_v2.mjs
 * Out: docs/Zetway-Pitch.pptx
 *
 * The previous deck was built around the Corridor Safety Score, because that
 * was the strongest single thing to defend. The skit walks a different road:
 * a breakdown on the way to uni, then "why not Waze", then the roadside fix,
 * then airplane mode, then a crash, then the two tabs. A deck that argues in
 * a different order from the people standing in front of it makes the room
 * choose which to follow, so this one follows the skit.
 *
 * It does not depict the skit. Each slide carries the terminology and the
 * figures for the beat being acted, so a judge reading the screen and a judge
 * watching Asmi are being told the same thing.
 *
 * Every number here already appears in the app or in README.md. Nothing was
 * rounded up for the slide.
 */
import pptxgen from 'pptxgenjs'

const OUT = 'docs/Zetway-Pitch.pptx'
const A = 'docs/pitch-assets'

const INK = '15181F'
const BRAND = '189EDB'
const DEEP = '0E6FA3'
const RED = 'D7263D'
const GREEN = '007848'
const PAPER = 'F7F9FC'
const SLATE = '5B6676'
const WHITE = 'FFFFFF'
const DIMW = 'C9D4E2'

const HEAD = 'Cambria'
const BODY = 'Calibri'

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.3 x 7.5 — set before any slide is added
pres.author = 'BackpropPirates'
pres.title = 'Zetway'

/** Footer. A fresh object every call: pptxgenjs converts options to EMU in
 *  place, so one shared object would be mutated by the first slide to use it. */
const foot = (slide, n, dark) =>
  slide.addText(`Zetway · BackpropPirates · ${n} of 6`, {
    x: 0.5, y: 6.95, w: 12.3, h: 0.3, align: 'right',
    fontSize: 10, fontFace: BODY, color: dark ? '7C8EA6' : '9AA7B8', isTextBox: true,
  })

const srcLine = (slide, text, dark) =>
  slide.addText(text, {
    x: 0.7, y: 6.5, w: 11.9, h: 0.35,
    fontSize: 10.5, fontFace: BODY, color: dark ? '8FA2B8' : SLATE, isTextBox: true,
  })

/* ------------------------------------------------- 1. the problem, in numbers */
{
  const s = pres.addSlide()
  s.background = { color: INK }
  s.addImage({ path: `${A}/logo.png`, x: 0.7, y: 0.55, w: 1.0, h: 1.0 })
  s.addText('Zetway', {
    x: 1.9, y: 0.6, w: 7, h: 0.6,
    fontSize: 40, bold: true, fontFace: HEAD, color: WHITE, isTextBox: true,
  })
  s.addText('Know the road before you go', {
    x: 1.95, y: 1.18, w: 8, h: 0.4,
    fontSize: 16, fontFace: BODY, color: BRAND, isTextBox: true,
  })

  const stats = [
    ['134', 'people killed on Mauritian roads in 2024'],
    ['3,029', 'injured or killed, from 39,485 reported accidents'],
    ['49.9%', 'of them were on two wheels or on foot'],
  ]
  stats.forEach(([big, small], i) => {
    const x = 0.7 + i * 4.15
    s.addText(big, {
      x, y: 2.5, w: 3.8, h: 1.0,
      fontSize: 54, bold: true, fontFace: HEAD, color: i === 2 ? RED : WHITE, isTextBox: true,
    })
    s.addText(small, {
      x, y: 3.5, w: 3.8, h: 1.0,
      fontSize: 14, fontFace: BODY, color: DIMW, isTextBox: true,
    })
  })

  s.addText(
    'Half the harm lands on the people with no metal around them — and none of them can see any of this before they set off.',
    { x: 0.7, y: 4.9, w: 11.9, h: 0.9, fontSize: 18, fontFace: BODY, color: WHITE, isTextBox: true },
  )
  srcLine(s, 'Statistics Mauritius and Open Data Mauritius, via data.govmu.org, 2024.', true)
  foot(s, 1, true)
  s.addNotes(
    'Runs under Asmi breaking down and calling Rajeev. Do not read the slide — let the scene play.\n\n' +
    'Rajeev\'s line lands here: the BackpropPirates built Zetway.\n\n' +
    'If you say one number, say 49.9%. Half the casualties are riders or people on foot, which is who the app is for.',
  )
}

/* --------------------------------------------------------- 2. why not Waze */
{
  const s = pres.addSlide()
  s.background = { color: PAPER }
  s.addText('“Why not just use Waze?”', {
    x: 0.7, y: 0.5, w: 11.9, h: 0.7,
    fontSize: 32, bold: true, fontFace: HEAD, color: INK, isTextBox: true,
  })
  s.addText('The question a judge asks first, so we answer it first.', {
    x: 0.7, y: 1.2, w: 11.9, h: 0.4,
    fontSize: 15, fontFace: BODY, color: SLATE, isTextBox: true,
  })

  const cols = [
    ['Waze tells you about traffic', [
      'Crowd-reported congestion, right now',
      'Needs a signal to be useful at all',
      'Nothing once you have stopped',
      'Nothing if you cannot reach the screen',
    ], SLATE],
    ['Zetway tells you about harm', [
      'Government casualty records, scored for your journey, your vehicle and your hour',
      'Score, black spots, emergency numbers and all 15 roadside guides work in airplane mode',
      'Fifteen roadside guides, safety check first',
      'Hands-free crash response — a shout is enough',
    ], DEEP],
  ]
  cols.forEach(([title, items, colour], i) => {
    const x = 0.7 + i * 6.1
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 1.75, w: 5.8, h: 4.2, rectRadius: 0.1,
      fill: { color: i ? 'E8F4FB' : 'EDF1F6' },
      line: { color: i ? BRAND : 'D8E0E9', width: i ? 1.5 : 1 },
    })
    s.addText(title, {
      x: x + 0.3, y: 1.95, w: 5.2, h: 0.45,
      fontSize: 18, bold: true, fontFace: HEAD, color: colour, isTextBox: true,
    })
    s.addText(
      items.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < items.length - 1 } })),
      { x: x + 0.3, y: 2.5, w: 5.2, h: 3.3, fontSize: 13.5, fontFace: BODY, color: INK,
        paraSpaceAfter: 10, isTextBox: true },
    )
  })

  srcLine(s, 'We are not competing on navigation. We are answering a question nobody else answers: how dangerous is this specific journey, and what happens when it goes wrong.')
  foot(s, 2, false)
  s.addNotes(
    'Ayush, to the judges.\n\n' +
    'The honest framing: Waze is a good app at a different job. It reports congestion from a crowd; we score harm from the government record. And it needs a signal, which is exactly what a rider in trouble often does not have.\n\n' +
    'Do not claim Waze is bad. Claim it answers a different question.',
  )
}

/* ------------------------------------------- 3. broken down, or had a crash */
{
  const s = pres.addSlide()
  s.background = { color: PAPER }
  s.addText('Broken down, or had a crash', {
    x: 0.7, y: 0.45, w: 8.5, h: 0.65,
    fontSize: 30, bold: true, fontFace: HEAD, color: INK, isTextBox: true,
  })
  s.addText('What Rajeev walks Asmi through, tap by tap.', {
    x: 0.7, y: 1.12, w: 8.5, h: 0.4,
    fontSize: 15, fontFace: BODY, color: SLATE, isTextBox: true,
  })

  const steps = [
    ['Safety check first', 'On a main road it refuses to show repair steps at all. Get off the carriageway, then fix it.'],
    ['Tell it the vehicle', 'Car or motorcycle, then the symptom. 15 guides — 7 for cars, 8 for motorcycles, written separately.'],
    ['Watch the fix', 'Each guide carries a clip we drew ourselves, bundled in the app so it plays with no signal.'],
    ['Reach help', 'The nearest of 241 hospitals and police stations, with tap-to-call.'],
  ]
  steps.forEach(([t, d], i) => {
    const y = 1.75 + i * 1.15
    s.addShape(pres.ShapeType.ellipse, {
      x: 0.7, y: y + 0.05, w: 0.42, h: 0.42, fill: { color: BRAND },
    })
    s.addText(String(i + 1), {
      x: 0.7, y: y + 0.05, w: 0.42, h: 0.42, align: 'center',
      fontSize: 14, bold: true, fontFace: BODY, color: WHITE, isTextBox: true,
    })
    s.addText(t, {
      x: 1.3, y, w: 6.6, h: 0.4,
      fontSize: 17, bold: true, fontFace: HEAD, color: INK, isTextBox: true,
    })
    s.addText(d, {
      x: 1.3, y: y + 0.4, w: 7.0, h: 0.7,
      fontSize: 12.5, fontFace: BODY, color: SLATE, isTextBox: true,
    })
  })

  s.addImage({ path: `${A}/guide-chain.png`, x: 9.3, y: 1.5, w: 3.3, h: 4.6 })
  srcLine(s, 'Health facilities and police stations: Open Data Mauritius, 169 + 72 with coordinates. Guides written from manufacturer and road-safety guidance, not generated.')
  foot(s, 3, false)
  s.addNotes(
    'Rajeev navigating Asmi. The deck is the map of what he is doing, not a script.\n\n' +
    'The safety check is the part worth saying out loud: the app will not show repair steps while the rider says they are on a main road. That is a deliberate refusal, and it is the kind of thing a jury notices.\n\n' +
    'If asked which clip to show, pick the chain or the jump-start. Avoid the motorcycle puncture.',
  )
}

/* ------------------------------------------------ 4. offline / surprise card */
{
  const s = pres.addSlide()
  s.background = { color: INK }
  s.addText('“What if I have no wifi?”', {
    x: 0.7, y: 0.45, w: 11.9, h: 0.65,
    fontSize: 30, bold: true, fontFace: HEAD, color: WHITE, isTextBox: true,
  })
  s.addText('Surprise card: Offline Mode', {
    x: 0.7, y: 1.12, w: 11.9, h: 0.4,
    fontSize: 16, bold: true, fontFace: BODY, color: BRAND, isTextBox: true,
  })

  s.addShape(pres.ShapeType.roundRect, {
    x: 0.7, y: 1.75, w: 5.9, h: 2.5, rectRadius: 0.1,
    fill: { color: '1C2430' }, line: { color: GREEN, width: 1.5 },
  })
  s.addText('Works in airplane mode', {
    x: 1.0, y: 1.95, w: 5.3, h: 0.4,
    fontSize: 17, bold: true, fontFace: HEAD, color: '5BD08C', isTextBox: true,
  })
  s.addText(
    ['The Corridor Safety Score', 'All 48 designated black spots', 'Every emergency number', 'All 15 roadside guides']
      .map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < 3 } })),
    { x: 1.0, y: 2.45, w: 5.3, h: 1.6, fontSize: 13.5, fontFace: BODY, color: WHITE,
      paraSpaceAfter: 8, isTextBox: true },
  )

  s.addShape(pres.ShapeType.roundRect, {
    x: 6.9, y: 1.75, w: 5.7, h: 2.5, rectRadius: 0.1,
    fill: { color: '1C2430' }, line: { color: '3A4555', width: 1 },
  })
  s.addText('Cannot, and the app says so', {
    x: 7.2, y: 1.95, w: 5.1, h: 0.4,
    fontSize: 17, bold: true, fontFace: HEAD, color: DIMW, isTextBox: true,
  })
  s.addText(
    ['The weather forecast', 'Other riders’ live reports', 'They are not cached and not faked — a banner names what is stored and what is waiting for signal']
      .map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < 2 } })),
    { x: 7.2, y: 2.45, w: 5.1, h: 1.6, fontSize: 13.5, fontFace: BODY, color: DIMW,
      paraSpaceAfter: 8, isTextBox: true },
  )

  s.addText('What the constraint cost us', {
    x: 0.7, y: 4.45, w: 11.9, h: 0.4,
    fontSize: 17, bold: true, fontFace: HEAD, color: WHITE, isTextBox: true,
  })
  s.addText(
    'We were building an agentic assistant that called an API for every answer. The card made that the one thing that could not work, so we moved the reasoning onto the device: 596 KB of data ships inside the app, and the score itself is computed from 67 KB of government tables. We adapted the app rather than restarting it.',
    { x: 0.7, y: 4.9, w: 11.9, h: 1.4, fontSize: 14.5, fontFace: BODY, color: DIMW, isTextBox: true },
  )
  foot(s, 4, true)
  s.addNotes(
    'Asmi asks about wifi and airplane mode; Rajeev answers; then Sahil takes the surprise card.\n\n' +
    'Say plainly what we gave up: an agentic build with API calls. The card made that impossible, and we moved the reasoning onto the device instead of starting again. That is the answer to "did you bolt the card on at the end" — no, it is why there are no map tiles anywhere in this app.\n\n' +
    'Demo it: airplane mode on, run a route, the score still comes out.',
  )
}

/* -------------------------------------------------- 5. the crash, hands-free */
{
  const s = pres.addSlide()
  s.background = { color: PAPER }
  s.addText('“What if someone had a fatal crash?”', {
    x: 0.7, y: 0.45, w: 8.6, h: 0.65,
    fontSize: 28, bold: true, fontFace: HEAD, color: INK, isTextBox: true,
  })
  s.addText('The rider is upside down in the belt and cannot reach the phone.', {
    x: 0.7, y: 1.12, w: 8.6, h: 0.4,
    fontSize: 15, fontFace: BODY, color: SLATE, isTextBox: true,
  })

  const beats = [
    ['Over 3.1g', 'A foreground service reads the accelerometer with the screen off and the app closed.', RED],
    ['30 seconds, out loud', 'It speaks a countdown and listens. “I’m OK” stands it down. “Please call” escalates at once.', BRAND],
    ['Unanswered, it acts', 'Texts every contact a map link and rings the first, with no tap. Opens WhatsApp with the message written.', GREEN],
    ['114 stays one tap', 'Android lets no third-party app dial an emergency number. We say so on screen rather than pretend.', SLATE],
  ]
  beats.forEach(([t, d, c], i) => {
    const y = 1.75 + i * 1.12
    s.addShape(pres.ShapeType.rect, { x: 0.7, y, w: 0.07, h: 0.95, fill: { color: c } })
    s.addText(t, {
      x: 1.0, y, w: 7.9, h: 0.38,
      fontSize: 17, bold: true, fontFace: HEAD, color: c, isTextBox: true,
    })
    s.addText(d, {
      x: 1.0, y: y + 0.38, w: 8.1, h: 0.66,
      fontSize: 12.5, fontFace: BODY, color: INK, isTextBox: true,
    })
  })

  s.addImage({ path: `${A}/sosfilm_0250.png`, x: 9.4, y: 1.6, w: 3.2, h: 1.8 })
  s.addText('A shout alone is enough: loudness read straight off the microphone. No model, no language, no network, no Google services — so it still works in a dead spot.', {
    x: 9.4, y: 3.55, w: 3.2, h: 2.4, fontSize: 12, fontFace: BODY, color: SLATE, isTextBox: true,
  })
  srcLine(s, 'Threshold 3.1g and the 30-second countdown are the app’s own constants. The voice matcher is a table of roots in English, French and Kreol — 91 tests, none failing.')
  foot(s, 5, false)
  s.addNotes(
    'Asmi shakes the phone. Ayush narrates the crash. Sahil plays docs/pitch-assets/zetway-sos.mp4 — 13 seconds, no sound needed.\n\n' +
    'Say that the clip is a drawing. The crash physics clip is the simulated one; this is a posed diorama, and the phone screen in it is a real screenshot of the app counting down.\n\n' +
    'The recording: capped at 45 seconds, announced on screen, never leaves the handset. Data Protection Act 2017, vital interests.\n\n' +
    'If asked about false alarms: neither trigger dials anything on hearing a noise. Both open a spoken, cancellable countdown.',
  )
}

/* ------------------------------------- 6. accidents, climate, and what's next */
{
  const s = pres.addSlide()
  s.background = { color: PAPER }
  s.addText('Accidents, Climate, and what we would do next', {
    x: 0.7, y: 0.45, w: 11.9, h: 0.65,
    fontSize: 28, bold: true, fontFace: HEAD, color: INK, isTextBox: true,
  })

  s.addImage({ path: `${A}/map.jpg`, x: 0.7, y: 1.3, w: 3.5, h: 4.3 })

  s.addText('Accidents & road safety', {
    x: 4.5, y: 1.3, w: 3.9, h: 0.4,
    fontSize: 18, bold: true, fontFace: HEAD, color: RED, isTextBox: true,
  })
  s.addText(
    'All 48 stretches the authorities have designated accident-prone, drawn on the real road network by road number — not a district average. Daylight and after-dark views, because 8.2% of casualties on an unlit road are fatal against 3.7% in daylight.',
    { x: 4.5, y: 1.78, w: 3.9, h: 2.1, fontSize: 12.5, fontFace: BODY, color: INK, isTextBox: true },
  )

  s.addText('Climate & vigilance', {
    x: 8.7, y: 1.3, w: 3.9, h: 0.4,
    fontSize: 18, bold: true, fontFace: HEAD, color: DEEP, isTextBox: true,
  })
  s.addText(
    'Light, rain and the forecast for the corridor you are about to travel, from the Open-Meteo API — free and keyless. It tells a rider when a heavy storm is due over the route to uni or to work, at the hour they would be on it.',
    { x: 8.7, y: 1.78, w: 3.9, h: 2.1, fontSize: 12.5, fontFace: BODY, color: INK, isTextBox: true },
  )

  s.addShape(pres.ShapeType.roundRect, {
    x: 4.5, y: 3.95, w: 8.1, h: 1.65, rectRadius: 0.08,
    fill: { color: 'EDF1F6' }, line: { color: 'D8E0E9', width: 1 },
  })
  s.addText('What we would do next', {
    x: 4.8, y: 4.1, w: 7.5, h: 0.35,
    fontSize: 15, bold: true, fontFace: HEAD, color: INK, isTextBox: true,
  })
  s.addText(
    'Better roadside clips — two still have defects we found and have not had time to redraw  ·  real road routing instead of straight lines  ·  the Metro Express corridor  ·  photos on hazard reports  ·  a signed release build so the APK installs without a warning',
    { x: 4.8, y: 4.5, w: 7.5, h: 1.0, fontSize: 12, fontFace: BODY, color: SLATE, isTextBox: true },
  )

  srcLine(s, 'Ten government tables power a feature; two scripts download and clean them, and the raw downloads are committed so anyone can re-run it. Runs on free tiers. backprop-pirates.vercel.app')
  foot(s, 6, false)
  s.addNotes(
    'Asmi asks about the two tabs; Rajeev answers; Sahil closes.\n\n' +
    'Name Open-Meteo out loud — a free keyless API that needs no account is part of the "runs on nothing" argument.\n\n' +
    'Being honest about the two defective clips is worth more than hiding them. It says we reviewed our own output frame by frame, which is also how we found the score was wrong on the first attempt.\n\n' +
    'Close on the handover: the Road Safety Unit and the police already publish this data. Handing it over costs them a repository, not a procurement.',
  )
}

await pres.writeFile({ fileName: OUT })
console.log('WROTE', OUT)
