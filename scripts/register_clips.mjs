// Put the rendered guide animations into src/lib/guideVideo.ts.
//
// Eleven clips arrived at once from eleven separate render jobs, and the
// duration of each has to match the file or the player shows a scrub bar
// that lies. Typing eleven entries by hand and eyeballing eleven durations
// is the kind of job that is wrong once and nobody notices until a judge
// drags the scrubber.
//
// So the durations are read out of the files. There is no ffprobe on this
// machine, so the MP4 is parsed directly: walk the atom tree to the movie
// header, which carries a timescale and a duration in those units. That is
// four numbers at a known offset and it needs no dependency.
//
// Run:  node scripts/register_clips.mjs          report what would change
//       node scripts/register_clips.mjs --write  rewrite the CLIP map

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/** Which file belongs to which guide. The only hand-maintained part, because
 *  a filename cannot be derived from a guide id without guessing. */
const CLIPS = {
  'flat-tyre': 'fix-tyre.mp4',
  'moto-chain': 'fix-chain.mp4',
  'moto-puncture': 'fix-moto-puncture.mp4',
  'wont-start': 'fix-jump-start.mp4',
  'moto-wont-start': 'fix-moto-start.mp4',
  'moto-dropped': 'fix-moto-dropped.mp4',
  overheating: 'fix-overheating.mp4',
  'moto-lights': 'fix-moto-lights.mp4',
  'warning-light': 'fix-warning-light.mp4',
  'oil-check': 'fix-oil-check.mp4',
  'out-of-fuel': 'fix-out-of-fuel.mp4',
  'moto-overheating': 'fix-moto-overheating.mp4',
  'moto-out-of-fuel': 'fix-moto-fuel.mp4',
}

const ROOT = process.cwd()
const GUIDES_DIR = path.join(ROOT, 'public', 'guides')
const TARGET = path.join(ROOT, 'src', 'lib', 'guideVideo.ts')

/** Walk the atom tree and return the movie header's duration in seconds.
 *  Atoms are [4-byte big-endian size][4-byte type][payload]. */
function durationSeconds(file) {
  const buf = readFileSync(file)
  let offset = 0
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    if (size < 8) break
    if (type === 'moov') {
      // The movie header is the first child of moov.
      let inner = offset + 8
      const end = Math.min(offset + size, buf.length)
      while (inner + 8 <= end) {
        const isize = buf.readUInt32BE(inner)
        const itype = buf.toString('ascii', inner + 4, inner + 8)
        if (isize < 8) break
        if (itype === 'mvhd') {
          const version = buf.readUInt8(inner + 8)
          if (version === 1) {
            const timescale = buf.readUInt32BE(inner + 28)
            const dur = Number(buf.readBigUInt64BE(inner + 32))
            return dur / timescale
          }
          const timescale = buf.readUInt32BE(inner + 20)
          const dur = buf.readUInt32BE(inner + 24)
          return dur / timescale
        }
        inner += isize
      }
    }
    offset += size
  }
  throw new Error(`no mvhd in ${path.basename(file)}`)
}

const rows = []
const missing = []

for (const [guideId, fileName] of Object.entries(CLIPS)) {
  const full = path.join(GUIDES_DIR, fileName)
  if (!existsSync(full)) {
    missing.push(`${guideId} -> ${fileName}`)
    continue
  }
  const seconds = Math.round(durationSeconds(full))
  const bytes = readFileSync(full).length
  rows.push({ guideId, fileName, seconds, bytes })
}

rows.sort((a, b) => a.guideId.localeCompare(b.guideId))

const totalMb = rows.reduce((t, r) => t + r.bytes, 0) / 1e6
console.log(`${rows.length} clip(s) present, ${totalMb.toFixed(1)} MB total\n`)
for (const r of rows) {
  console.log(
    `  ${r.guideId.padEnd(20)} ${r.fileName.padEnd(26)} ${String(r.seconds).padStart(3)}s  ${(r.bytes / 1e6).toFixed(2)} MB`,
  )
}
if (missing.length) {
  console.log(`\n${missing.length} not rendered yet:`)
  for (const m of missing) console.log(`  ${m}`)
}

const body = rows
  .map((r) => `  '${r.guideId}': { src: '/guides/${r.fileName}', seconds: ${r.seconds} },`)
  .join('\n')
const block = `const CLIP: Record<string, { src: string; seconds: number }> = {\n${body}\n}`

if (!process.argv.includes('--write')) {
  console.log('\n--write would set:\n')
  console.log(block)
  process.exit(0)
}

const src = readFileSync(TARGET, 'utf8')
const re = /const CLIP: Record<string, \{ src: string; seconds: number \}> = \{[\s\S]*?\n\}/
if (!re.test(src)) {
  console.error('\nCould not find the CLIP map in guideVideo.ts — not writing.')
  process.exit(1)
}
writeFileSync(TARGET, src.replace(re, block), 'utf8')
console.log(`\nwrote ${rows.length} entries into src/lib/guideVideo.ts`)
