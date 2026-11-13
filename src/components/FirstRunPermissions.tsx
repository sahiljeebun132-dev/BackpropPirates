import { useState } from 'react'

import { requestCrashPermissions } from '../lib/nativeCrash'
import { isNative } from '../lib/platform'

const ASKED_KEY = 'zetway.permissions.asked'

/**
 * Asks for everything the crash response needs, once, when the app opens.
 *
 * The first version asked for each permission at the moment it was used,
 * which sounds polite and was in fact the worst possible choice: SEND_SMS
 * and CALL_PHONE were requested *during* the escalation, so the first thing
 * that happened after a crash was a permission dialog in front of someone
 * who might be unable to answer it. Everything after that dialog would
 * simply not have happened, and nothing would have said so.
 *
 * So it is asked up front — but with the reason on screen first, rather than
 * four system dialogs appearing out of nowhere the moment the app opens. The
 * rider can decline and the rest of the app works exactly as before; the
 * checklist above the arm button then shows what is missing.
 *
 * Android only. In a browser each permission is prompted by its own API on
 * first use, which is the browser's business and not ours to pre-empt.
 */
export function FirstRunPermissions() {
  const [show, setShow] = useState(() => {
    if (!isNative()) return false
    try {
      return localStorage.getItem(ASKED_KEY) !== 'yes'
    } catch {
      // Private mode or blocked storage: better to ask than to skip silently.
      return true
    }
  })
  const [busy, setBusy] = useState(false)

  if (!show) return null

  const remember = () => {
    try {
      localStorage.setItem(ASKED_KEY, 'yes')
    } catch {
      // Asking again next launch is a far smaller problem than not asking.
    }
  }

  const allow = async () => {
    setBusy(true)
    await requestCrashPermissions()
    remember()
    setShow(false)
  }

  const later = () => {
    remember()
    setShow(false)
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-brand-deep/30">
      <h2 className="text-sm font-semibold text-slate-900">Before you ride</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        If you crash and cannot answer your phone, Zetway does these for you. Android has to be
        asked now, because after a crash there is nobody free to tap “Allow”.
      </p>
      <ul className="mt-3 space-y-2">
        {[
          ['Send a text', 'So your contacts get your location without you touching anything.'],
          ['Make a call', 'So the first contact is rung automatically.'],
          ['Your location', 'The single most useful thing in that message.'],
          ['Microphone', 'To record what is happening around the car after an impact.'],
          ['Notifications', 'So the alert can reach you on a locked screen.'],
        ].map(([title, why]) => (
          <li key={title} className="flex gap-2 text-xs leading-relaxed text-slate-700">
            <span aria-hidden="true" className="shrink-0 font-bold text-brand-deep">
              &middot;
            </span>
            <span>
              <span className="font-semibold text-slate-900">{title}</span> — {why}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={allow}
          disabled={busy}
          className="flex-1 rounded-xl bg-brand-deep px-4 py-3 text-sm font-semibold text-white active:bg-brand-deep/90 disabled:opacity-60"
        >
          {busy ? 'Asking…' : 'Allow these'}
        </button>
        <button
          type="button"
          onClick={later}
          disabled={busy}
          className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 active:bg-slate-200 disabled:opacity-60"
        >
          Not now
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        Nothing is sent unless a real impact is detected and you do not answer the 30-second
        countdown. Everything else in Zetway works whatever you choose here.
      </p>
    </section>
  )
}
