import { useOnline } from '../lib/useOnline'

/**
 * What still works when the signal goes.
 *
 * The honest half of offline support. It would be easy to hide the fact
 * that the forecast and other riders' reports have stopped and let the
 * rider assume the screen is current — and that is exactly the failure
 * worth avoiding, because they would act on it. So the banner names what is
 * stored and what is missing, in that order, and it is specific rather than
 * a shrug about "some features".
 *
 * Nothing here is cached that should not be. The score, the black spots,
 * the emergency numbers and the roadside guides were always computed on the
 * device from files that ship with the app; only fetching them needed the
 * network. The forecast and the hazard reports genuinely cannot be known
 * offline, and are not guessed.
 */
export function OfflineBanner() {
  const online = useOnline()
  if (online) return null

  return (
    <section
      role="status"
      className="rounded-2xl bg-ink p-4 text-white ring-1 ring-white/15"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-base">&#9888;</span>
        <h2 className="text-sm font-semibold">No internet. Most of Zetway still works.</h2>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-flag-green">
            Working now
          </p>
          <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-slate-300">
            <li>The Corridor Safety Score and every figure behind it</li>
            <li>The 48 accident-prone segments on your route</li>
            <li>Hospitals, police stations and garages, with numbers to call</li>
            <li>All roadside guides, for cars and motorcycles</li>
            <li>Crash watch — it reads a sensor, not a server</li>
          </ul>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-flag-yellow">
            Waiting for signal
          </p>
          <ul className="mt-1 space-y-0.5 text-xs leading-relaxed text-slate-300">
            <li>The weather forecast, so pick the light condition yourself</li>
            <li>Hazard reports from other riders, and sending your own</li>
          </ul>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
        Nothing stale is shown as if it were live. The score never needed the network — it is
        worked out on this device from 269 KB of government tables stored with the app.
      </p>
    </section>
  )
}
