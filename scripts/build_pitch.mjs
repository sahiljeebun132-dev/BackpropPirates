/**
 * Builds docs/Zetway-Pitch.pptx: the six-slide pitch deck (the rules cap it at six).
 *
 * Figures are read from public/data, the same files the app loads, so the deck
 * cannot drift from what the demo shows. Re-run after any data change:
 *   node scripts/build_pitch.mjs
 */

import { readFileSync } from 'node:fs'
import Module, { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// apply_theme.js ships inside the pptx skill and resolves jszip relative to
// itself, where there isn't one. Point Node at this project's node_modules
// before requiring it, so `node scripts/build_pitch.mjs` just works instead
// of needing NODE_PATH set by hand. Without this the deck still builds but
// applyTheme throws, and every scheme colour silently falls back to Office's
// stock palette.
process.env.NODE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules',
)
Module._initPaths()

const require = createRequire(import.meta.url)
const pptxgen = require('pptxgenjs')
const { applyTheme } = require('C:/Users/sahil/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/local-agent-mode-sessions/skills-plugin/1a751674-6b34-42a6-a419-ae28cf8cd6ce/906e34c4-6be4-4981-881e-82c4c796f8fa/skills/pptx/scripts/apply_theme.js')

/** A PNG or JPEG's real pixel size, read from the file.
 *
 *  The aspect ratios on this deck's screenshots used to be typed in by hand
 *  next to each addImage. Replace a screenshot with one of a different shape
 *  and pptxgenjs stretches it to the old ratio without complaining, so the
 *  slide quietly shows a squashed phone. Reading the header costs nothing and
 *  removes the whole class of mistake.
 */
function imageSize(file) {
  const b = readFileSync(file)
  if (b[0] === 0x89 && b[1] === 0x50) {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  }
  // JPEG: walk the segments to the first start-of-frame.
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const marker = b[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  throw new Error(`cannot read dimensions of ${file}`)
}

/** Fit an image to a height, keeping its real proportions. */
const byHeight = (file, h) => {
  const { w, h: ih } = imageSize(file)
  return { w: h * (w / ih), h }
}

const load = (n) => JSON.parse(readFileSync(`public/data/${n}.json`, 'utf8'))
const D = {
  hotspots: load('hotspots'), districts: load('districts'), conditions: load('conditions'),
  emergency: load('emergency'), exposure: load('exposure'), island: load('island'),
  places: load('places'),
}
const light = Object.fromEntries(D.conditions.light.conditions.map((c) => [c.condition, c]))
const dark = light['Darkness no street lighting']
const day = light['Day light']
const worst = [...D.districts.districts].sort((a, b) => b.casualtyAccidents - a.casualtyAccidents)[0]
const quietest = Math.min(...D.districts.districts.map((d) => d.casualtyAccidents))
const nf = (n) => Number(n).toLocaleString('en-GB')

// Read from the source so a slide cannot drift from the app. The last time
// a count was typed by hand here, the deck claimed ten tables and listed
// nine.
const BREAKDOWN_SRC = readFileSync('src/lib/breakdown.ts', 'utf8')
const CAR_GUIDES = (BREAKDOWN_SRC.match(/vehicle: 'car',/g) || []).length
const MOTO_GUIDES = (BREAKDOWN_SRC.match(/vehicle: 'motorcycle',/g) || []).length
if (!CAR_GUIDES || !MOTO_GUIDES) throw new Error('guide counts failed to parse')
const pct = (n, dp = 1) => `${(n * 100).toFixed(dp)}%`

// --- theme -----------------------------------------------------------------
// Taken from the Zetway logo: its own near-black ground, the blue from WAY, and
// the Mauritius flag colours inside the pin. Nothing invented here either.
const THEME = {
  name: 'Zetway',
  headFontFace: 'Cambria',
  bodyFontFace: 'Calibri',
  colors: {
    dk1: '15181F', // the logo's background
    lt1: 'FFFFFF',
    dk2: '1E2430', // raised panels on the dark slides
    lt2: 'F1F5F9',
    accent1: '0E6FA3', // deep blue: white text on it passes contrast
    accent2: 'D83030', // flag red
    accent3: 'F0C000', // flag yellow
    accent4: '007848', // flag green
    accent5: '94A3B8', // muted captions
    accent6: '189EDB', // the blue in WAY
    hlink: '0E6FA3', folHlink: '94A3B8',
  },
}

const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.3 x 7.5 inches
pres.title = 'Zetway: pitch'
pres.author = 'Team BackpropPirates'
pres.company = 'Life Powered by Tech 2026'
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }

const C = pres.SchemeColor
const W = 13.3
const M = 0.6 // page margin

// --- layouts ---------------------------------------------------------------
pres.defineSlideMaster({
  title: 'DARK',
  background: { color: C.text1 },
  objects: [
    { text: {
      text: 'Team BackpropPirates  ·  Life Powered by Tech 2026  ·  Theme 2: Powered to Move',
      options: { x: M, y: 6.85, w: W - 2 * M, h: 0.3, fontSize: 11, color: C.accent5, align: 'left' },
    } },
  ],
})

pres.defineSlideMaster({
  title: 'LIGHT',
  background: { color: C.background1 },
  objects: [
    { placeholder: {
      options: { name: 'title', type: 'title', x: M, y: 0.36, w: W - 2 * M, h: 0.95,
        fontSize: 32, bold: true, color: C.text1, valign: 'middle' },
      text: ' ',
    } },
    { text: {
      text: 'Zetway',
      options: { x: W - M - 1.6, y: 6.9, w: 1.6, h: 0.28, fontSize: 10, color: C.accent5, align: 'right' },
    } },
  ],
  slideNumber: { x: M, y: 6.9, w: 0.6, h: 0.28, fontSize: 10, color: C.accent5 },
})

// --- helpers ---------------------------------------------------------------
/** Big number with a caption under it. Used on the title and problem slides. */
function statBlock(slide, { x, y, w, value, label, valueColor, labelColor, size = 54 }) {
  slide.addText(value, {
    isTextBox: true, x, y, w, h: 0.95, margin: 0,
    fontSize: size, bold: true, color: valueColor, align: 'center', valign: 'bottom',
    fontFace: 'Calibri', objectName: `stat-${label.slice(0, 18)}`,
  })
  slide.addText(label, {
    isTextBox: true, x, y: y + 1.0, w, h: 0.7, margin: 0,
    fontSize: 12, color: labelColor, align: 'center', valign: 'top',
  })
}

/** Soft card used to group content on the light slides. */
function card(slide, { x, y, w, h, fill = C.background2, name }) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.1, fill: { color: fill }, line: { color: fill },
    objectName: name,
  })
}

// ===========================================================================
// 1. Title
// ===========================================================================
pres.addSection({ title: 'Opening' })
{
  const s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Opening' })

  // The lockup carries the name and the tagline, and its own background matches
  // the slide, so it sits flush with no visible plate behind it.
  const logoW = 5.1
  s.addImage({
    path: 'docs/pitch-assets/logo.png',
    x: M - 0.15, y: 0.6, w: logoW, h: logoW * (342 / 830), objectName: 'logo-lockup',
  })

  s.addText(
    'A commuter can see how dangerous their specific journey is — for how they travel, at the hour they travel — from the government\u2019s own road-casualty data.',
    { isTextBox: true, x: M, y: 2.78, w: 8.6, h: 0.95, margin: 0, fontSize: 16, color: 'CBD5E1', lineSpacing: 24 },
  )

  card(s, { x: M, y: 3.92, w: W - 2 * M, h: 2.35, fill: C.background2, name: 'stat-band' })
  const cols = (W - 2 * M - 0.6) / 3
  statBlock(s, { x: M + 0.3, y: 4.18, w: cols, value: nf(D.island.fatal),
    label: `people killed on Mauritian roads in ${D.island.year}`, valueColor: C.accent2, labelColor: 'CBD5E1' })
  statBlock(s, { x: M + 0.3 + cols, y: 4.18, w: cols, value: nf(D.island.casualties),
    label: 'injured or killed, from 39,485 reported accidents', valueColor: C.background1, labelColor: 'CBD5E1' })
  statBlock(s, { x: M + 0.3 + 2 * cols, y: 4.18, w: cols, value: pct(D.exposure.vulnerableShare, 0),
    label: 'of them were on two wheels or on foot', valueColor: C.accent3, labelColor: 'CBD5E1' })

  s.addText('Source: Statistics Mauritius and Open Data Mauritius, via data.govmu.org', {
    isTextBox: true, x: M, y: 6.46, w: 9.5, h: 0.3, margin: 0, fontSize: 10, color: C.accent5, italic: true,
  })

  s.addNotes(
    `Open with the number. In ${D.island.year}, ${nf(D.island.fatal)} people were killed on Mauritian roads and ${nf(D.island.casualties)} were injured or killed, out of ${nf(D.island.accidents)} reported accidents, on an island of 1.3 million.\n\n` +
    `The figure that shaped everything: ${pct(D.exposure.vulnerableShare)} of casualties were riders or people on foot. Half the harm lands on the people with no metal around them.\n\n` +
    `Zetway is "Zet" from trajet, the journey. That is what it scores.`,
  )
}

// ===========================================================================
// 2. Problem and user
// ===========================================================================
pres.addSection({ title: 'The problem' })
{
  const s = pres.addSlide({ masterName: 'LIGHT', sectionTitle: 'The problem' })
  s.addText('Half the harm falls on the least protected', { placeholder: 'title' })

  // Left: the specific person.
  card(s, { x: M, y: 1.5, w: 6.0, h: 3.5, name: 'user-card' })
  s.addText('Who we built it for', {
    isTextBox: true, x: M + 0.35, y: 1.78, w: 5.3, h: 0.32, margin: 0,
    fontSize: 13, bold: true, color: C.accent1, charSpacing: 1,
  })
  s.addText(
    'A young motorcycle or auto-cycle rider commuting the northern corridor — Grand Baie and Goodlands down into Port Louis — riding home after dark.',
    { isTextBox: true, x: M + 0.35, y: 2.18, w: 5.3, h: 1.45, margin: 0, fontSize: 16, color: C.text1, lineSpacing: 24 },
  )
  s.addText(
    [
      { text: 'They cannot see any of this before they set off.', options: { bold: true, breakLine: true } },
      { text: 'The data exists. It sits in annual PDF digests and CSV tables that reach statisticians, not riders.' },
    ],
    { isTextBox: true, x: M + 0.35, y: 3.72, w: 5.3, h: 1.18, margin: 0, fontSize: 14, color: '334155', lineSpacing: 21 },
  )

  // Right: three figures that define their risk.
  const rx = 7.05
  const rw = W - M - rx
  const rows = [
    [nf(worst.casualtyAccidents), `casualty accidents in ${worst.name} in ${worst.year} — the worst of the seven police districts, against ${nf(quietest)} in the quietest`, C.accent2],
    [nf(worst.riderCasualties), 'of that district\u2019s casualties were riders, the highest rider count on the island', C.accent3],
    [`${(dark.fatalShare / day.fatalShare).toFixed(1)}×`, `as likely to be fatal in unlit darkness as in daylight — ${pct(dark.fatalShare)} of casualties against ${pct(day.fatalShare)}`, C.accent6],
  ]
  rows.forEach(([value, label, colour], i) => {
    const y = 1.5 + i * 1.22
    card(s, { x: rx, y, w: rw, h: 1.05, name: `fact-${i}` })
    s.addText(value, {
      isTextBox: true, x: rx + 0.28, y: y + 0.12, w: 1.75, h: 0.8, margin: 0,
      fontSize: 30, bold: true, color: colour, align: 'left', valign: 'middle', fontFace: 'Calibri',
    })
    s.addText(label, {
      isTextBox: true, x: rx + 2.12, y: y + 0.1, w: rw - 2.4, h: 0.85, margin: 0,
      fontSize: 11.5, color: '334155', valign: 'middle', lineSpacing: 16,
    })
  })

  s.addText('All figures: Open Data Mauritius, data.govmu.org. District data 2024; light conditions 2018, the latest published.', {
    isTextBox: true, x: M, y: 5.25, w: W - 2 * M, h: 0.3, margin: 0, fontSize: 10, color: C.accent5, italic: true,
  })

  s.addNotes(
    `Not "everyone in Mauritius" — one rider, one corridor, one moment.\n\n` +
    `${worst.name} is genuinely the worst district: ${nf(worst.casualtyAccidents)} casualty accidents against ${nf(quietest)} in the quietest. ${nf(worst.riderCasualties)} of its casualties were riders.\n\n` +
    `Darkness with no street lighting: ${pct(dark.fatalShare)} of casualties are fatal, against ${pct(day.fatalShare)} in daylight. More than twice as deadly.\n\n` +
    `If asked why the light data is 2018: that is the most recent year the publisher has released. Every figure in the app carries its year.`,
  )
}

// ===========================================================================
// 3. The app
// ===========================================================================
pres.addSection({ title: 'The app' })
{
  const s = pres.addSlide({ masterName: 'LIGHT', sectionTitle: 'The app' })
  s.addText('Before you ride, and when it goes wrong', { placeholder: 'title' })

  // The whole product in one capture: a rider report, the score, and the
  // conditions panel telling them to leave an hour earlier.
  const shotH = 4.55
  const shotW = byHeight('docs/pitch-assets/live.png', shotH).w
  s.addImage({ path: 'docs/pitch-assets/live.png', x: M, y: 1.45, w: shotW, h: shotH,
    objectName: 'shot-live',
    shadow: { type: 'outer', color: '94A3B8', blur: 10, offset: 2, angle: 90, opacity: 0.4 } })

  const tx = M + shotW + 0.5
  const tw = W - M - tx

  s.addText(
    [
      { text: 'A Corridor Safety Score from the official record — tap any factor for its figures and its table.', options: { bullet: true, breakLine: true } },
      { text: `The ${D.hotspots.hotspots.length} designated accident-prone segments — drawn on your corridor and named by road number — and the nearest of ${nf(D.emergency.places.length)} hospitals and police stations with tap-to-call.`, options: { bullet: true, breakLine: true } },
      { text: 'Live conditions: sunrise, sunset and rain for this corridor, free and keyless from Open-Meteo.', options: { bullet: true, breakLine: true } },
      { text: 'Live hazard reports from other riders, within seconds, on this corridor.', options: { bullet: true } },
    ],
    { isTextBox: true, x: tx, y: 1.5, w: tw, h: 1.95, margin: 0, fontSize: 13, color: C.text1,
      lineSpacing: 19, paraSpaceAfter: 9 },
  )

  // The corridor map, sized by height to the space under the bullets. It
  // replaced the hazard-report capture here: both are good, but only one of
  // them makes the slide's own claim visible, and "14 named black spots on
  // your route" is that claim.
  const rh = 2.5
  const rw = byHeight('docs/pitch-assets/map.jpg', rh).w
  s.addImage({ path: 'docs/pitch-assets/map.jpg', x: tx, y: 3.6, w: rw, h: rh,
    objectName: 'shot-map',
    shadow: { type: 'outer', color: '94A3B8', blur: 8, offset: 2, angle: 90, opacity: 0.35 } })
  s.addText('14 of 48, on this corridor', {
    isTextBox: true, x: tx, y: 3.6 + rh + 0.04, w: rw, h: 0.26, margin: 0,
    fontSize: 10, color: C.text2, align: 'center', italic: true,
  })

  const cx = tx + rw + 0.35
  const cw = W - M - cx
  s.addShape(pres.ShapeType.roundRect, {
    x: cx, y: 3.6, w: cw, h: 2.5, rectRadius: 0.1,
    fill: { color: C.text1 }, line: { color: C.text1 }, objectName: 'when-it-goes-wrong',
  })
  s.addText('And when it goes wrong anyway', {
    isTextBox: true, x: cx + 0.28, y: 3.78, w: cw - 0.56, h: 0.3, margin: 0,
    fontSize: 13, bold: true, color: C.accent6,
  })
  s.addText(
    [
      { text: `Roadside guides: ${CAR_GUIDES} for cars, ${MOTO_GUIDES} for motorcycles, written separately. Safety check first — on a main road it refuses to show repair steps at all.`,
        options: { bullet: true, breakLine: true } },
      { text: 'Crash watch: a foreground service reads the accelerometer with the screen off. Over 3.1g it alarms and counts down 30 seconds.',
        options: { bullet: true, breakLine: true } },
      { text: 'Unanswered, the Android build texts every contact a map link and rings the first, with no tap. 114 stays one tap, because Android lets no app dial it.',
        options: { bullet: true } },
    ],
    { isTextBox: true, x: cx + 0.28, y: 4.14, w: cw - 0.56, h: 1.85, margin: 0,
      fontSize: 10.5, color: 'CBD5E1', lineSpacing: 13.5, paraSpaceAfter: 6 },
  )

  s.addNotes(
    `This is the live demo. backprop-pirates.vercel.app, open it on a phone.

` +
    `Demo path: Grand Baie to Port Louis by motorcycle at 19:00 scores 31. The app says leave at 18:00 instead and it scores 46, because that puts the trip in daylight: 3.7% of casualties in daylight are fatal against 8.2% on an unlit road. Tap the button and watch the score move.

` +
    `The map is drawn from the real geometry of those 48 segments, which ships with the app. No tiles and no requests — a tiled map would have been the one thing that went blank in airplane mode, on the slide where we claim it does not.

` +
    `Then report a hazard live from a phone in the room and show it appear on another phone within seconds.

` +
    `On satellite, if asked \u2014 and this used to be on the slide: we evaluated it and rejected it on evidence, not effort. Seeing something car-sized needs sub-metre resolution, which means low orbit and about one pass a day; the satellites that watch continuously are weather satellites at 500 m a pixel, where a car does not exist. Mauritius is cloudy too. Resolution and revisit rate are a tradeoff you cannot escape, and Mauritius is cloudy. Weather models ingest satellite observations, so what we use is still remote-sensed, it just arrives as numbers.

` +
    `Reports never move the score. The score cites government tables over years; an unverified report from a stranger is a different kind of claim, so it sits above the score instead of inside it.\n\n` +
    `If asked why 114 is not dialled automatically: Android refuses ACTION_CALL for emergency numbers from every third-party app and CALL_PRIVILEGED is closed to us, so no app on the Play Store can dial an ambulance by itself. Apple's own Crash Detection, with the hardware and the OS privileges, still counts down before calling. Our plugin asks the operating system whether a number is an emergency number and refuses rather than throwing mid-crash.\n\n` +
    `If asked about privacy or the law: we read the Data Protection Act 2017 and the Road Traffic Act rather than guessing. A voice recording is personal data, so the crash recording rests on the vital-interests basis the Act allows, is capped at 45 seconds, is announced on screen and never leaves the handset. Hand-held phone use while driving is an offence carrying penalty points, so everything the app asks of a rider happens before they set off or after they have stopped. There is a panel in the app that says all of this, and says we are students and not lawyers.`,
  )
}

// ===========================================================================
// 4. The data
// ===========================================================================
pres.addSection({ title: 'The data' })
{
  const s = pres.addSlide({ masterName: 'LIGHT', sectionTitle: 'The data' })
  s.addText('Ten official tables, one of them mappable', { placeholder: 'title' })

  // The find.
  card(s, { x: M, y: 1.45, w: 6.35, h: 2.5, fill: '0F172A', name: 'find-card' })
  s.addText('The find', {
    isTextBox: true, x: M + 0.35, y: 1.7, w: 5.6, h: 0.3, margin: 0,
    fontSize: 12, bold: true, color: C.accent6, charSpacing: 1,
  })
  s.addText(
    `The Accident Prone Areas table is not a list of place names. It holds ${D.hotspots.hotspots.length} road segments as real geometry, named by road number.`,
    { isTextBox: true, x: M + 0.35, y: 2.05, w: 5.65, h: 0.85, margin: 0, fontSize: 15, color: C.background1, lineSpacing: 22 },
  )
  s.addText(
    [
      { text: '"M1: Belle Village up to Caudan"', options: { breakLine: true } },
      { text: '"A10: Lapeyre Hill to 16eme Mille, Forest Side"' },
    ],
    { isTextBox: true, x: M + 0.35, y: 2.92, w: 5.65, h: 0.6, margin: 0, fontSize: 12.5, color: C.accent6, italic: true, lineSpacing: 18 },
  )
  s.addText('So we name the black spots on your route, not a district average.', {
    isTextBox: true, x: M + 0.35, y: 3.5, w: 5.65, h: 0.35, margin: 0, fontSize: 12, color: 'CBD5E1',
  })

  // What each table does.
  const rx = 7.3
  const rw = W - M - rx
  s.addText('What the other tables power', {
    isTextBox: true, x: rx, y: 1.5, w: rw, h: 0.3, margin: 0, fontSize: 13, bold: true, color: C.accent1,
  })
  s.addText(
    [
      { text: 'Casualties by police district, 2013\u20132024 — district volume, and the split between people on foot, riders and vehicle occupants', options: { bullet: true, breakLine: true } },
      { text: 'Casualties by light condition — the time-of-day factor', options: { bullet: true, breakLine: true } },
      { text: 'Accidents by junction and road type — the junction and motorway advice', options: { bullet: true, breakLine: true } },
      { text: `Accidents by weather, pooled ${D.conditions.weather.years.join('–')} — the wet-road advice. Rain is 1.26 times as fatal, too small to score, so the app says it instead`, options: { bullet: true, breakLine: true } },
      { text: `${D.emergency.counts.hospital + D.emergency.counts.clinic} health facilities and ${D.emergency.counts.police} police stations with coordinates — the help panel, and every town coordinate in the planner`, options: { bullet: true, breakLine: true } },
      { text: 'Vehicles registered by type — the exposure denominator, so we can say riders are hurt 1.28 times as often per registered vehicle', options: { bullet: true } },
    ],
    { isTextBox: true, x: rx, y: 1.9, w: rw, h: 3.9, margin: 0, fontSize: 11.5, color: C.text1, lineSpacing: 16, paraSpaceAfter: 7 },
  )

  card(s, { x: M, y: 4.2, w: 6.35, h: 1.5, fill: 'ECFDF5', name: 'pipeline-card' })
  s.addText('Nothing is hand-entered', {
    isTextBox: true, x: M + 0.35, y: 4.38, w: 5.65, h: 0.3, margin: 0, fontSize: 13, bold: true, color: C.accent1,
  })
  s.addText(
    'Two scripts: one downloads the tables, one cleans them into the files the app loads. The raw downloads are committed, so anyone can re-run it and get the same numbers.',
    { isTextBox: true, x: M + 0.35, y: 4.72, w: 5.65, h: 0.85, margin: 0, fontSize: 12, color: '334155', lineSpacing: 17 },
  )

  s.addText('Tables: Open Data Mauritius (MDPA) and Statistics Mauritius, CC-BY-SA 4.0, via data.govmu.org. Live: Open-Meteo forecast, and reports from riders using the app.', {
    isTextBox: true, x: M, y: 5.95, w: W - 2 * M, h: 0.3, margin: 0, fontSize: 10, color: C.accent5, italic: true,
  })

  s.addNotes(
    `If asked how we got the data: data.govmu.org sits behind a bot check, so a script cannot fetch the CSVs. We used the Electric Sheep Africa mirror on Hugging Face, which carries the original CKAN package ID, resource ID and the data.govmu.org URL on every row. Provenance is intact and the app links to the original resource file.\n\n` +
    `The cleaning does real work: it repairs text the publisher saved in the wrong encoding, parses the MULTILINESTRING geometry, derives town coordinates from facility positions, and maps the 9 administrative districts onto the 7 police districts. That mapping is our assumption and we publish it inside places.json.\n\n` +
    `We downloaded 21 candidate tables and used the 9 that could power a feature.`,
  )
}

// ===========================================================================
// 5. The score, and testing it
// ===========================================================================
pres.addSection({ title: 'How it works' })
{
  const s = pres.addSlide({ masterName: 'LIGHT', sectionTitle: 'How it works' })
  s.addText('Every number traces to a government table', { placeholder: 'title' })

  const shotH = 4.3
  const shotW = byHeight('docs/pitch-assets/breakdown.png', shotH).w
  s.addImage({ path: 'docs/pitch-assets/breakdown.png', x: M, y: 1.45, w: shotW, h: shotH, objectName: 'shot-breakdown',
    shadow: { type: 'outer', color: '94A3B8', blur: 10, offset: 2, angle: 90, opacity: 0.4 } })

  const tx = M + shotW + 0.55
  const tw = W - M - tx

  s.addText('Four measurements, each a ratio between published figures', {
    isTextBox: true, x: tx, y: 1.5, w: tw, h: 0.32, margin: 0, fontSize: 14, bold: true, color: C.accent1,
  })
  s.addText(
    [
      { text: 'Accident-prone segments on the corridor — 35%', options: { bullet: true, breakLine: true } },
      { text: 'Casualty volume in the districts crossed — 25%', options: { bullet: true, breakLine: true } },
      { text: 'How this corridor treats people who travel as you do, against the national pattern — 25%', options: { bullet: true, breakLine: true } },
      { text: 'Share of casualties that are fatal in that light — 15%', options: { bullet: true } },
    ],
    { isTextBox: true, x: tx, y: 1.9, w: tw, h: 1.65, margin: 0, fontSize: 12.5, color: C.text1, lineSpacing: 18, paraSpaceAfter: 6 },
  )
  s.addText(
    'Both ends of every scale come from the data — the worst district, the 90th-percentile corridor, the deadliest light condition. The only numbers we chose are the four weights, and the app prints them on screen.',
    { isTextBox: true, x: tx, y: 3.6, w: tw, h: 0.85, margin: 0, fontSize: 12, color: '334155', lineSpacing: 17 },
  )

  card(s, { x: tx, y: 4.55, w: tw, h: 1.45, fill: 'FEF3C7', name: 'bug-card' })
  s.addText('We tested it, and the first version was wrong', {
    isTextBox: true, x: tx + 0.25, y: 4.72, w: tw - 0.5, h: 0.3, margin: 0, fontSize: 12.5, bold: true, color: '92400E',
  })
  s.addText(
    'Scoring all 5,200 route, mode and time combinations showed 70% came out "Severe" and nothing safe: vehicle occupants are always the largest casualty group, so every car trip was punished for being ordinary. We re-anchored each factor to the range the data spans. Scores now run 22 to 94.',
    { isTextBox: true, x: tx + 0.25, y: 5.05, w: tw - 0.5, h: 0.85, margin: 0, fontSize: 11, color: '78350F', lineSpacing: 15 },
  )

  s.addNotes(
    `This is the slide to linger on. The first question a judge asks is "where does 31 come from" and the answer is in the app, not in the pitch.\n\n` +
    `Worked example on screen: 14 accident-prone segments costs 35 points, district volume 8, rider risk 11, unlit darkness 15. 100 minus 69 is 31.\n\n` +
    `The calibration story matters because it shows we tested the model rather than the demo route. The check script is in the repo: scripts/check_score_spread.mjs.\n\n` +
    `Be clear it is an exposure indicator, not a prediction. It cannot know about today's traffic, weather or the driver, and the app says so.`,
  )
}

// ===========================================================================
// 6. Impact and next
// ===========================================================================
pres.addSection({ title: 'Impact' })
{
  const s = pres.addSlide({ masterName: 'DARK', sectionTitle: 'Impact' })

  s.addText('Who runs it, what it costs, where it goes', {
    isTextBox: true, x: M, y: 0.55, w: W - 2 * M, h: 0.6, margin: 0,
    fontSize: 30, bold: true, color: C.background1, fontFace: 'Cambria',
  })

  const cw = (W - 2 * M - 0.6) / 3
  const cols = [
    ['Runs on nothing', [
      'Static JSON and one small function on a free tier. The weather feed needs no key at all.',
      'A data refresh is two scripts and a push.',
    ]],
    ['Reaches people now', [
      'A link first: it opens on any phone, no store, no install, nothing to fail before a demo.',
      'And an APK from the same code, for the three things a browser forbids after a crash.',
    ]],
    ['Belongs to someone', [
      'The Road Safety Unit or the police already publish this data.',
      'Handing it over costs them a repo, not a procurement.',
    ]],
  ]
  cols.forEach(([heading, lines], i) => {
    const x = M + i * (cw + 0.3)
    s.addShape(pres.ShapeType.roundRect, {
      x, y: 1.4, w: cw, h: 2.25, rectRadius: 0.1,
      fill: { color: '1E293B' }, line: { color: '1E293B' }, objectName: `impact-${i}`,
    })
    s.addText(heading, {
      isTextBox: true, x: x + 0.28, y: 1.62, w: cw - 0.56, h: 0.34, margin: 0,
      fontSize: 15, bold: true, color: C.accent6,
    })
    s.addText(lines.map((t, j) => ({ text: t, options: { breakLine: j < lines.length - 1 } })), {
      isTextBox: true, x: x + 0.28, y: 2.02, w: cw - 0.56, h: 1.45, margin: 0,
      fontSize: 12, color: 'CBD5E1', lineSpacing: 17, paraSpaceAfter: 8,
    })
  })

  // Surprise card: filled in once it is drawn.
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: 3.85, w: W - 2 * M, h: 1.2, rectRadius: 0.1,
    fill: { color: '422006' }, line: { color: 'B45309', width: 1 }, objectName: 'surprise-card',
  })
  s.addText('Surprise card', {
    isTextBox: true, x: M + 0.3, y: 4.03, w: 2.2, h: 0.3, margin: 0,
    fontSize: 13, bold: true, color: C.accent3,
  })
  s.addText(
    [
      { text: 'Offline Mode. ', options: { bold: true, color: C.accent3 } },
      { text: 'We kept the Corridor Safety Score working with no internet — and it never needed the network. It is computed on the device from 269 KB of government tables, so a service worker storing them is all it took. The score, the 48 black spots, the emergency numbers and all 15 roadside guides work in airplane mode. The forecast and other riders’ reports cannot, are not cached, and the app says which is which. The APK already shipped those files inside it.' },
    ],
    { isTextBox: true, x: M + 0.3, y: 4.36, w: W - 2 * M - 0.6, h: 0.62, margin: 0,
      fontSize: 11, color: 'FDE68A', lineSpacing: 13.5 },
  )

  s.addText('Next', {
    isTextBox: true, x: M, y: 5.25, w: 1.2, h: 0.3, margin: 0, fontSize: 13, bold: true, color: C.accent6,
  })
  s.addText(
    'Real road routing instead of straight lines  ·  the Metro Express corridor  ·  photos on reports  ·  a signed release build so the APK installs without a warning',
    { isTextBox: true, x: M, y: 5.58, w: W - 2 * M, h: 0.5, margin: 0, fontSize: 13, color: 'CBD5E1' },
  )

  s.addText('backprop-pirates.vercel.app', {
    isTextBox: true, x: M, y: 6.2, w: 6, h: 0.4, margin: 0,
    fontSize: 17, bold: true, color: C.accent6,
  })

  s.addNotes(
    `Cost: it genuinely runs on nothing. Static JSON on a free tier, no backend, no API keys. That matters for a public-sector handover.\n\n` +
    `Reach: a link works on any phone, with no store review and no install friction, and that is still what we demo from. The Android build is additive — it exists only because a browser may not text or call on its own after a crash — and inside the APK the data ships too, so the core works with no signal at all.\n\n` +
    `Who runs it: the people who publish this data already. Handing it over is a repo transfer, not a procurement exercise.\n\n` +
    `Limits, if asked: routes are straight lines between towns, not real road paths, and the app says so. Light and junction tables are 2018, the latest published. 26 towns, limited to places with an official health facility so the coordinates are real.\n\n` +
    `Surprise card, Offline Mode: the honest version of this answer is that we picked the one feature that never needed the network. The score is worked out in the browser from nine static files; the app only ever died offline because they had to be fetched. A service worker precaches them and the app's own bundle. Demo it by putting the phone in airplane mode and running a route — the score, the black spots, the emergency numbers and every roadside guide still work. The weather and other riders' reports genuinely cannot work offline, so they are not cached and not faked, and a banner names what is stored and what is waiting for signal. One trap worth mentioning if a judge is technical: on a first visit the page fetches its own JavaScript before the worker takes control, so runtime caching misses it and an offline reload is a blank page. Install reads index.html and caches what it references.`,
  )
}

await pres.writeFile({ fileName: 'docs/Zetway-Pitch.pptx' })
await applyTheme('docs/Zetway-Pitch.pptx', THEME)
console.log('  wrote docs/Zetway-Pitch.pptx')
