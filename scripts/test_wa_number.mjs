// wa.me rejects anything that is not full international, and the one screen
// that uses it is the one after a crash. These are the shapes a Mauritian
// rider actually saves a contact in.
import { readFileSync } from 'node:fs'
const src = readFileSync('src/lib/crashWatch.ts', 'utf8')
const body = src.slice(src.indexOf('export function waNumber'))
const fn = body.slice(body.indexOf('{'), body.indexOf('\n}') + 2)
// MU lives outside the function in the module, so it has to be carried in.
const MU = /const MU = '(\d+)'/.exec(src)[1]
const waNumber = new Function('MU', 'phone', fn.replace(/^\{/, '').replace(/\}$/, '')).bind(null, MU)

const cases = [
  ['5789 1234', '23057891234', 'local mobile with a space'],
  ['57891234', '23057891234', 'local mobile, no space'],
  ['+230 5789 1234', '23057891234', 'already international'],
  ['+23057891234', '23057891234', 'international, no spaces'],
  ['00230 5789 1234', '23057891234', 'international via 00'],
  ['230 5789 1234', '23057891234', 'country code, no plus'],
  ['+33 6 12 34 56 78', '33612345678', 'a French number stays French'],
  ['212 3456', '2302123456', 'local landline, seven digits'],
]
let bad = 0
for (const [input, want, why] of cases) {
  const got = waNumber(input)
  const ok = got === want
  if (!ok) bad++
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${JSON.stringify(input).padEnd(20)} -> ${got.padEnd(13)} ${ok ? '' : '(want ' + want + ')'}  ${why}`)
}
console.log(`\n${cases.length - bad} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
