// Does the phone understand a cry for help, and — far more important — does
// it ever mistake one for the opposite?
//
// The negation cases are the point of this file. A rider who says "ça va pas"
// is saying the worst thing they can say, and a matcher built on substrings
// will happily read "ça va" inside it and cancel the countdown that was about
// to save them. Every cancel phrase is checked here with a negator in front.
import { registerHooks } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = process.cwd()
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && !path.extname(spec)) {
      try {
        return next(spec + '.ts', ctx)
      } catch {
        /* fall through */
      }
    }
    return next(spec, ctx)
  },
})

const sos = await import(pathToFileURL(path.join(ROOT, 'src/lib/sosVoice.ts')).href)

let pass = 0
let fail = 0

function check(label, got, want) {
  const ok = got === want
  if (ok) pass++
  else fail++
  if (!ok) console.log(`  FAIL  ${label}\n        got ${got}, wanted ${want}`)
  return ok
}

// --------------------------------------------------------------- the words

console.log('\nCries for help, as a French recogniser would render them')
for (const [text, want] of [
  ['help', 'distress'],
  ['help me please', 'distress'],
  ['HELP', 'distress'],
  ['au secours', 'distress'],
  ["au s'cours aidez moi", 'distress'],
  ['oskour', 'distress'],
  ['o sekour mo blese', 'distress'],
  ['ambulance', 'distress'],
  ['appelez une ambulance', 'distress'],
  ['mo pa kapav bouze', 'distress'],
  ['I cannot move', 'distress'],
  ['urgence', 'distress'],
  ['aid mwa', 'distress'],
]) {
  check(JSON.stringify(text), sos.hearSos(text), want)
}

console.log('\nCalling it off')
for (const [text, want] of [
  ['stop', 'cancel'],
  ['stop stop stop', 'cancel'],
  ['mo korek', 'cancel'],
  ['tout korek', 'cancel'],
  ['I am fine', 'cancel'],
  ['false alarm', 'cancel'],
  ['annuler', 'cancel'],
  ['arete', 'cancel'],
  ['pa bizin', 'cancel'],
  ['ca va bien', 'cancel'],
]) {
  check(JSON.stringify(text), sos.hearSos(text), want)
}

console.log('\nNegated — the trap. None of these may read as "cancel".')
for (const text of [
  'ca va pas',
  'ça va pas du tout',
  'mo pa korek',
  'mo pa bon',
  'I am not fine',
  'im not ok',
  'i am not ok',
  'pa korek ditou',
  'no I am not fine',
]) {
  const got = sos.hearSos(text)
  const ok = got !== 'cancel'
  if (ok) pass++
  else fail++
  if (!ok) console.log(`  FAIL  ${JSON.stringify(text)}\n        read as cancel`)
}

console.log('\nOrdinary talk, which must do nothing at all')
for (const text of [
  '',
  'il fait beau aujourd hui',
  'mo pe al travay',
  'turn left at the roundabout',
  'what time is it',
  'quatre bornes',
  'delo lor sime',
]) {
  check(JSON.stringify(text), sos.hearSos(text), null)
}

console.log('\nBoth at once — the safe reading wins')
check('"help no stop im fine"', sos.hearSos('help no stop im fine'), 'cancel')

// ------------------------------------------------------------- the shouting

console.log('\nShouting, against a noisy background')

/** Feed a level for a span of milliseconds at 10 samples a second, which is
 *  roughly what Android's metering callback delivers. */
function feed(d, level, ms, t0) {
  let fired = false
  for (let t = t0; t < t0 + ms; t += 100) {
    if (d.push(level, t)) fired = true
  }
  return fired
}

{
  // A quiet room, then a long shout.
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 3000, 0)
  const fired = feed(d, 8.0, 2000, 3000)
  check('shout in a quiet room fires', fired, true)
}

{
  // A running engine at 5, then a shout over it at 9.
  const d = new sos.ShoutDetector()
  feed(d, 5.0, 4000, 0)
  const fired = feed(d, 9.0, 2000, 4000)
  check('shout over engine noise fires', fired, true)
}

{
  // The same engine, never shouted over. Must stay silent.
  const d = new sos.ShoutDetector()
  const fired = feed(d, 5.0, 20000, 0)
  check('steady engine noise alone does not fire', fired, false)
}

{
  // A horn: loud, but brief.
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 3000, 0)
  const fired = feed(d, 9.0, 400, 3000)
  check('a 400ms horn does not fire', fired, false)
}

{
  // Normal speech, a couple of points above the baseline.
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 2000, 0)
  const fired = feed(d, 3.0, 5000, 2000)
  check('ordinary speech does not fire', fired, false)
}

{
  // One shout must be one trigger, not forty.
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 3000, 0)
  let count = 0
  for (let t = 3000; t < 8000; t += 100) if (d.push(8.0, t)) count++
  check('one continuous shout triggers once', count, 1)
}

{
  // A long shout must not quietly become the baseline and disarm itself.
  const d = new sos.ShoutDetector()
  feed(d, 1.0, 2000, 0)
  feed(d, 8.0, 8000, 2000)
  const after = d.quietLevel
  const ok = after !== null && after < 5.0
  if (ok) pass++
  else fail++
  if (!ok) console.log(`  FAIL  baseline crept to ${after?.toFixed(2)} during a long shout`)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
