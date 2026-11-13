// Follow the run sheet literally, tap by tap, and report where it diverges.
//
// A run sheet is only worth the last time someone walked it. This performs
// each numbered step exactly as written and records what the app did, so a
// step that no longer matches shows up here instead of on stage.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const B = () => [...document.querySelectorAll('button')]
  const exact = (t) => B().find((b) => b.textContent.trim().toLowerCase() === t.toLowerCase())
  const part = (t) => B().find((b) => b.textContent.toLowerCase().includes(t.toLowerCase()))
  const setSelect = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const steps = []
  const note = (n, ok, detail) => steps.push({ step: n, ok, detail })

  // Reset to home.
  for (let i = 0; i < 10; i++) {
    const b = B().find((x) => ['Home', 'Back', 'Change journey'].includes(x.textContent.trim()))
    if (!b) break
    b.click()
    await sleep(400)
  }

  // Pre-flight: the footer must name the build.
  const footer = document.body.innerText.match(/(Android app|Web app) · build[^\n]*/)
  note('pre-flight: footer names the build', !!footer, footer ? footer[0] : 'not found')

  // 1. Grand Baie -> Port Louis, motorcycle, departing 19:00.
  //
  // The hour is pinned, and that is the point. This step used to leave the
  // departure on "now" and assert 31. It passed at 01:29 because the forecast
  // put the trip after dark, and it would have failed at the 13:00 pitch,
  // where the same route scores 46 in daylight. The light band is the largest
  // single factor in the score, so a check that inherits the clock only tests
  // the hour it happened to run at.
  const sel = document.querySelectorAll('select')
  setSelect(sel[0], 'grand-baie')
  setSelect(sel[1], 'port-louis')
  await sleep(200)
  exact('Motorcycle')?.click()
  await sleep(200)

  // The disclosure's accessible text is the whole row — the question, the
  // current summary and the word Change — so match the row, not the word.
  const change = B().find((b) => /When are you leaving\?/.test(b.textContent))
  note(
    '1a. departure sits behind a disclosure',
    !!change && /Change|Hide/.test(change.textContent),
    change ? change.textContent.trim().replace(/\s+/g, ' ').slice(0, 54) : 'missing',
  )
  change?.click()
  await sleep(400)

  const when = document.querySelector('input[type="datetime-local"]')
  if (when) {
    const d = new Date()
    const p2 = (n) => String(n).padStart(2, '0')
    const v = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T19:00`
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(when, v)
    when.dispatchEvent(new Event('input', { bubbles: true }))
    when.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(500)
  }
  note('1b. departure set to 19:00', !!when, when ? when.value : 'input missing')

  exact('Check this route')?.click()
  await sleep(2600)
  const m = document.body.innerText.match(/(\d{1,3})\s*\n+\s*out of 100\s*\n+\s*(\w+) risk/)
  note('1c. score is 31 Severe at 19:00', !!m && m[1] === '31' && m[2] === 'Severe', m ? `${m[1]} ${m[2]}` : 'no score')

  // 2. Tap a factor; it must name a table.
  const factor = B().find((b) => /pts/.test(b.textContent) && b.textContent.length < 200)
  const beforeLen = document.body.innerText.length
  factor?.click()
  await sleep(500)
  const grew = document.body.innerText.length > beforeLen
  const names = /Open Data Mauritius|Statistics Mauritius/.test(document.body.innerText)
  note('2. factor opens and names a table', !!factor && grew && names, `expanded=${grew} named=${names}`)

  // 3. The map, with its stretches.
  const map = document.querySelector('svg[role="img"][aria-label*="Map of the corridor"]')
  const stretches = document.body.innerText.match(/(\d+)\s+accident-prone stretch/)
  note('3. map present with 14 stretches', !!map && stretches?.[1] === '14', `stretches=${stretches?.[1]}`)

  // 5. Back home, then the breakdown row.
  exact('Change journey')?.click()
  await sleep(700)
  const row = part('Broken down or had a crash')
  note('5a. breakdown entry point on home', !!row, row ? row.textContent.trim().slice(0, 48) : 'missing')
  row?.click()
  await sleep(800)
  const fine = part('everyone is fine')
  note('5b. "No, everyone is fine" present', !!fine, fine ? fine.textContent.trim() : 'missing')
  fine?.click()
  await sleep(450)
  const off = part('Fully off the road')
  note('5c. "Fully off the road" present', !!off, off ? off.textContent.trim().slice(0, 40) : 'missing')
  off?.click()
  await sleep(450)
  part('Motorcycle or scooter')?.click()
  await sleep(300)
  exact('Continue')?.click()
  await sleep(700)

  // 6. Chain trouble, warning above the steps.
  const chain = part('Chain trouble')
  note('6a. motorcycle guides shown', !!chain, chain ? 'Chain trouble listed' : 'missing')
  chain?.click()
  await sleep(800)
  const text = document.body.innerText
  const warn = text.indexOf('Stop and call for help if')
  const stepsIdx = text.search(/\nStep by step/)
  note('6b. warning sits above the steps', warn >= 0 && stepsIdx > warn, `warn@${warn} steps@${stepsIdx}`)

  // 7. The video link.
  const vid = text.includes('Watch someone do this')
  note('7. "Watch someone do this" on the guide', vid, vid ? 'present' : 'missing')

  // Fallback path: crash watch rehearsal, two taps.
  for (let i = 0; i < 10; i++) {
    const b = B().find((x) => ['Home', 'Back', 'Change journey'].includes(x.textContent.trim()))
    if (!b) break
    b.click()
    await sleep(400)
  }
  const cw = B().find((b) => b.textContent.includes('Crash watch'))
  note('fallback 1/2: Crash watch line on home', !!cw, cw ? cw.textContent.trim().slice(0, 44) : 'missing')
  cw?.click()
  await sleep(700)
  const rehearse = part('Show me what happens in a crash')
  note('fallback 2/2: rehearsal on that page', !!rehearse, rehearse ? 'present' : 'missing')

  return { failures: steps.filter((s) => !s.ok).length, steps }
})()
