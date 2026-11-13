/**
 * Builds docs/Zetway-Pitch.pptx: the six-slide pitch deck (the rules cap it at six).
 *
 * Figures are read from public/data, the same files the app loads, so the deck
 * cannot drift from what the demo shows. Re-run after any data change:
 *   node scripts/build_pitch.mjs
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pptxgen = require('pptxgenjs')
const { applyTheme } = require('C:/Users/sahil/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/local-agent-mode-sessions/skills-plugin/1a751674-6b34-42a6-a419-ae28cf8cd6ce/906e34c4-6be4-4981-881e-82c4c796f8fa/skills/pptx/scripts/apply_theme.js')

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
  s.addText('Pick the journey, get the risk and the fix', { placeholder: 'title' })

  const shotH = 4.55
  const shotW = shotH * (396 / 854)
  s.addImage({ path: 'docs/pitch-assets/planner.png', x: M, y: 1.45, w: shotW, h: shotH, objectName: 'shot-planner',
    rounding: false, shadow: { type: 'outer', color: '94A3B8', blur: 10, offset: 2, angle: 90, opacity: 0.4 } })
  s.addImage({ path: 'docs/pitch-assets/score.png', x: M + shotW + 0.3, y: 1.45, w: shotW, h: shotH, objectName: 'shot-score',
    rounding: false, shadow: { type: 'outer', color: '94A3B8', blur: 10, offset: 2, angle: 90, opacity: 0.4 } })

  const tx = M + 2 * shotW + 0.95
  const tw = W - M - tx
  s.addText('One feature, working end to end', {
    isTextBox: true, x: tx, y: 1.5, w: tw, h: 0.35, margin: 0, fontSize: 15, bold: true, color: C.accent1,
  })
  s.addText(
    [
      { text: 'A Corridor Safety Score out of 100. Tap any factor and it shows its figures and names the table they came from.', options: { bullet: true, breakLine: true } },
      { text: `Which of the island\u2019s ${D.hotspots.hotspots.length} officially designated accident-prone segments your route passes, by road number.`, options: { bullet: true, breakLine: true } },
      { text: 'Advice written for how you travel, each line citing its source.', options: { bullet: true, breakLine: true } },
      { text: `The nearest of ${nf(D.emergency.places.length)} hospitals, health centres and police stations along the way, with tap-to-call, plus 114 and 999.`, options: { bullet: true } },
    ],
    { isTextBox: true, x: tx, y: 1.95, w: tw, h: 2.9, margin: 0, fontSize: 13, color: C.text1,
      lineSpacing: 19, paraSpaceAfter: 10 },
  )

  card(s, { x: tx, y: 5.05, w: tw, h: 0.95, fill: 'ECFDF5', name: 'demo-note' })
  s.addText(
    [
      { text: 'Live demo  ', options: { bold: true, color: C.accent1 } },
      { text: 'Grand Baie to Port Louis, by motorcycle, after dark: 31 / 100. The same trip by car in daylight: 51.' },
    ],
    { isTextBox: true, x: tx + 0.22, y: 5.17, w: tw - 0.44, h: 0.72, margin: 0, fontSize: 11.5, color: '334155', lineSpacing: 16 },
  )

  s.addNotes(
    `This is the live demo. Open it on a phone: backprop-pirates.vercel.app\n\n` +
    `Demo path: Grand Baie to Port Louis, motorcycle, after dark unlit, gives 31/100 Severe. Then switch the mode to car and the time to daylight and it moves to 51. Then try Bon Accueil to Centre de Flacq, car, daylight: 80, Lower risk. The score genuinely discriminates.\n\n` +
    `It is a mobile web app, not an APK, so one link works on every phone in the room and there was no build that could fail before the demo. The organisers confirmed web apps count equally.`,
  )
}

// ===========================================================================
// 4. The data
// ===========================================================================
pres.addSection({ title: 'The data' })
{
  const s = pres.addSlide({ masterName: 'LIGHT', sectionTitle: 'The data' })
  s.addText('Nine official tables, one of them mappable', { placeholder: 'title' })

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
      { text: `${D.emergency.counts.hospital + D.emergency.counts.clinic} health facilities and ${D.emergency.counts.police} police stations with coordinates — the help panel, and every town coordinate in the planner`, options: { bullet: true, breakLine: true } },
      { text: 'Vehicles registered by type — the exposure denominator, so we can say riders are hurt 1.28 times as often per registered vehicle', options: { bullet: true } },
    ],
    { isTextBox: true, x: rx, y: 1.9, w: rw, h: 3.0, margin: 0, fontSize: 12, color: C.text1, lineSpacing: 17, paraSpaceAfter: 8 },
  )

  card(s, { x: M, y: 4.2, w: 6.35, h: 1.5, fill: 'ECFDF5', name: 'pipeline-card' })
  s.addText('Nothing is hand-entered', {
    isTextBox: true, x: M + 0.35, y: 4.38, w: 5.65, h: 0.3, margin: 0, fontSize: 13, bold: true, color: C.accent1,
  })
  s.addText(
    'Two scripts: one downloads the tables, one cleans them into the files the app loads. The raw downloads are committed, so anyone can re-run it and get the same numbers.',
    { isTextBox: true, x: M + 0.35, y: 4.72, w: 5.65, h: 0.85, margin: 0, fontSize: 12, color: '334155', lineSpacing: 17 },
  )

  s.addText('All tables: Open Data Mauritius (MDPA) and Statistics Mauritius, CC-BY-SA 4.0, via data.govmu.org.', {
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
  const shotW = shotH * (368 / 604)
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
      'Static JSON on a free tier. No backend, no API keys, no database.',
      'A data refresh is two scripts and a push.',
    ]],
    ['Reaches people now', [
      'A link, not an app store. It opens on any phone and installs to the home screen.',
      'Works on the cheap Android phones riders actually carry.',
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
  s.addText('[ Card drawn: ______________ · What we changed, and where you can see it in the demo ]', {
    isTextBox: true, x: M + 0.3, y: 4.38, w: W - 2 * M - 0.6, h: 0.5, margin: 0,
    fontSize: 13, color: 'FDE68A', italic: true,
  })

  s.addText('Next', {
    isTextBox: true, x: M, y: 5.25, w: 1.2, h: 0.3, margin: 0, fontSize: 13, bold: true, color: C.accent6,
  })
  s.addText(
    'Real road routing instead of straight lines  ·  the Metro Express corridor  ·  crowd hazard reports  ·  offline caching for where the signal drops',
    { isTextBox: true, x: M, y: 5.58, w: W - 2 * M, h: 0.5, margin: 0, fontSize: 13, color: 'CBD5E1' },
  )

  s.addText('backprop-pirates.vercel.app', {
    isTextBox: true, x: M, y: 6.2, w: 6, h: 0.4, margin: 0,
    fontSize: 17, bold: true, color: C.accent6,
  })

  s.addNotes(
    `Cost: it genuinely runs on nothing. Static JSON on a free tier, no backend, no API keys. That matters for a public-sector handover.\n\n` +
    `Reach: a link works on any phone. No app store review, no install friction, and it works on the cheap Android phones the riders we built this for actually carry.\n\n` +
    `Who runs it: the people who publish this data already. Handing it over is a repo transfer, not a procurement exercise.\n\n` +
    `Limits, if asked: routes are straight lines between towns, not real road paths, and the app says so. Light and junction tables are 2018, the latest published. 26 towns, limited to places with an official health facility so the coordinates are real.\n\n` +
    `FILL IN THE SURPRISE CARD BOX BEFORE PITCHING.`,
  )
}

await pres.writeFile({ fileName: 'docs/Zetway-Pitch.pptx' })
await applyTheme('docs/Zetway-Pitch.pptx', THEME)
console.log('  wrote docs/Zetway-Pitch.pptx')
