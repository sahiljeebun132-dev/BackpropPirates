/* Zetway offline support.
 *
 * Written for the surprise card: "your user suddenly has no internet, adapt
 * one important feature so it still works offline."
 *
 * The feature that has to survive is the Corridor Safety Score and the
 * guidance around it, and it is the right one to pick for an honest reason:
 * it is the only part of Zetway that does not need the network in the first
 * place. The score is computed in the browser from nine static JSON files
 * totalling 269 KB — the government casualty tables, the 48 accident-prone
 * segments, the hospitals and police stations, the garages, the car list.
 * Nothing is asked of a server. The app only ever failed offline because
 * the files had to be fetched.
 *
 * So the strategy is not a trick. Precache those files and the shell, and
 * everything that was already local stays available: the score, the named
 * black spots on your route, the emergency numbers, every roadside guide
 * for cars and motorcycles, and crash watch — which reads a sensor and
 * needs no network at all.
 *
 * What genuinely cannot work offline is the live layer: the Open-Meteo
 * forecast and other riders' hazard reports. Those are not cached and not
 * faked. The app already degrades to the rider choosing the light condition
 * by hand, and the UI says which parts are live and which are stored.
 *
 * A note on the Android build: it never had this problem. The APK ships the
 * same nine files inside it, so the core has always worked with no signal.
 * This closes the same gap on the web.
 */

// Bump to retire old caches. The hashed asset names make a stale bundle
// impossible, but the data files keep their names across deploys, so a
// version is the only thing that forces them to refresh.
// v5: seven hotspot names were repaired (a UTF-8 apostrophe that had been
// stored one byte per character, so "Place d'Armes" read as "Place DâArmes").
// The file name did not change, so every phone that had already cached v4 —
// including the two due on stage — would have gone on showing the broken
// names, and the old bundle with them, until something else forced a refresh.
const CACHE = 'zetway-v7'

const DATA = [
  'cars', 'conditions', 'districts', 'emergency', 'exposure',
  'garages', 'hotspots', 'island', 'places', 'roads',
].map((n) => `/data/${n}.json`)

const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/brand/zetway-logo.png',
  // The header's mark, which is a different file from the logo above. It was
  // missing here, so the first offline load rendered the app with a hole
  // where its own logo should be.
  '/brand/zetway-mark.png',
  '/crash-demo.html',
]

/**
 * The app's own compiled JavaScript and CSS, read out of index.html.
 *
 * These have content-hashed names that change every build, so they cannot
 * be listed here. Relying on runtime caching to pick them up does not work
 * either, and that is a bug worth remembering: on a first visit the page
 * has already fetched its bundle before the worker takes control, so those
 * requests never pass through it. The cache then looks healthy — shell
 * present, all nine data files present — and an offline reload gets a blank
 * page, because the one thing missing is the application itself.
 *
 * So install reads index.html and caches whatever it references. No build
 * step to keep in sync, and it is correct from the very first visit.
 */
async function assetsFromShell() {
  try {
    const html = await (await fetch('/index.html', { cache: 'reload' })).text()
    const urls = new Set()
    const pattern = /(?:src|href)="(\/[^"]+\.(?:js|css))"/g
    let m
    while ((m = pattern.exec(html)) !== null) urls.add(m[1])

    // Fonts are referenced from inside a stylesheet, not from the HTML, so
    // the sweep above never sees them and the offline app falls back to
    // system-ui — a visibly different screen from the one demoed a minute
    // earlier. Read each stylesheet and pick its @font-face files up too,
    // which keeps this free of a build step that could drift.
    for (const css of [...urls].filter((u) => u.endsWith('.css'))) {
      try {
        const text = await (await fetch(css, { cache: 'reload' })).text()
        const fonts = /url\((?:"|')?(\/[^)"']+\.woff2)(?:"|')?\)/g
        let f
        while ((f = fonts.exec(text)) !== null) urls.add(f[1])
      } catch {
        // One unreadable stylesheet must not cost us the rest of the shell.
      }
    }
    return [...urls]
  } catch {
    return []
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const assets = await assetsFromShell()
      // Added one at a time rather than with addAll, which rejects the whole
      // batch if a single file 404s. One missing icon must not be the reason
      // a rider has no offline score.
      await Promise.all(
        [...SHELL, ...DATA, ...assets].map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {}),
        ),
      )
      await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

/** Live data, which is never served from cache.
 *
 *  Serving a stale forecast or an hours-old hazard report would be worse
 *  than serving nothing: the rider would act on it. These are allowed to
 *  fail, and the app is built to say so. */
const isLive = (url) =>
  url.pathname.startsWith('/api/') || url.origin !== self.location.origin

/** Big downloads, which are never cached.
 *
 *  The handler below is stale-while-revalidate over every same-origin 200,
 *  which is right for a 300 KB bundle and wrong for a 7.6 MB APK. Cache
 *  Storage has a quota, and a browser that hits it evicts whole caches
 *  rather than the newest entry — so one judge downloading the Android
 *  build could take the offline app shell down with it. These stream from
 *  the network and are not kept. */
const isBigDownload = (url) => /\.(?:apk|mp4|webm|zip)$/i.test(url.pathname)

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (isLive(url)) return // straight to the network, and allowed to fail
  if (isBigDownload(url)) return // streamed, never kept: it would evict the shell

  // Navigations: try the network so a deploy is picked up, fall back to the
  // cached shell. Without this an offline reload is a browser error page
  // rather than the app.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy)).catch(() => {})
          return res
        })
        .catch(async () => (await caches.match('/index.html')) ?? Response.error()),
    )
    return
  }

  // Everything else same-origin: serve from cache at once, refresh behind.
  // The rider gets the score immediately and the files are current next time.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request)
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => null)
      return cached ?? (await network) ?? Response.error()
    })(),
  )
})
