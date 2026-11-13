// Guard the one part of the offline demo that is easy to delete by accident.
//
// public/sw.js precaches the shell and the nine data files by name, but the
// app's own JS and CSS have content-hashed names that change every build, so
// they cannot be listed. install() instead reads index.html and caches
// whatever it references. Runtime caching cannot replace this: on a first
// visit the page has already fetched its bundle before the worker takes
// control, so those requests never pass through it.
//
// Lose that sweep and nothing looks broken. The cache still reports the shell
// and all nine data files present; it is an offline reload that comes back
// blank, which is exactly when the room is watching. Nothing else in the
// build would notice, so this does.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sw = readFileSync(join(root, 'public', 'sw.js'), 'utf8')

const installStart = sw.indexOf("addEventListener('install'")
const activateStart = sw.indexOf("addEventListener('activate'")
const install = installStart === -1 ? '' : sw.slice(installStart, activateStart === -1 ? undefined : activateStart)

const checks = [
  {
    name: 'the sweep exists',
    why: 'assetsFromShell() is what finds the hashed bundle.',
    ok: /function assetsFromShell/.test(sw),
  },
  {
    name: 'it reads index.html',
    why: 'the bundle names only exist in the built HTML.',
    ok: /fetch\(\s*['"]\/index\.html['"]/.test(sw),
  },
  {
    name: 'it picks up js and css',
    why: 'without this pattern the sweep finds nothing to cache.',
    ok: sw.includes('(?:js|css)'),
  },
  {
    name: 'it follows stylesheets to their fonts',
    why: '@font-face files are referenced from the CSS, not the HTML; losing them changes the screen offline.',
    ok: sw.includes('woff2'),
  },
  {
    name: 'install runs the sweep',
    why: 'the sweep is useless if install() never calls it.',
    ok: /assetsFromShell\(/.test(install),
  },
  {
    name: 'install caches what the sweep found',
    why: 'calling it and dropping the result is the silent version of this bug.',
    ok: /\.\.\.assets/.test(install),
  },
]

let failed = 0
for (const c of checks) {
  if (c.ok) {
    console.log(`  ok    ${c.name}`)
  } else {
    console.error(`  FAIL  ${c.name} \u2014 ${c.why}`)
    failed++
  }
}

if (failed) {
  console.error(`\n${failed} of ${checks.length} service worker checks failed. The offline demo will come back blank.`)
  process.exit(1)
}
console.log(`\nPASS  service worker precaches the app bundle (${checks.length} checks)`)
