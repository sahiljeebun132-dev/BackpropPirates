import { useEffect, useState } from 'react'

import { isNative } from '../lib/platform'

/**
 * Getting Zetway off the browser tab and onto the phone.
 *
 * Zetway ships twice from one codebase and the two builds are not equal.
 * Everything the web app does, the Android app does identically — but four
 * things only the Android build can do at all, and every one of them is the
 * part that matters on a real ride: watching for an impact with the screen
 * off, sending the texts without a tap, ringing a contact without a tap, and
 * putting the alert over a locked screen. A phone browser suspends a hidden
 * page, and no web page may dial or message on its own, by design.
 *
 * So this card does not say "also available as an app" and leave it there. It
 * names what the browser cannot do, because a rider who installs the wrong one
 * and believes they are covered is worse off than one who knows they are not.
 *
 * It offers both routes and does not pretend either is something it isn't:
 * the PWA install is a real install prompt where the browser gives us one and
 * honest instructions where it does not, and the APK download warns about the
 * "unverified app" screen before the rider meets it, because a security
 * warning nobody prepared you for is a reason to abandon an install.
 */

/** Chrome's install prompt event, which TypeScript's DOM library does not
 *  declare because it is not in any specification. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const APK_URL = '/zetway.apk'

/** Running from the home screen rather than inside a browser tab. */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    // Safari's own flag, which predates the standard media query.
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

type Platform = 'android' | 'ios' | 'other'

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return 'android'
  // iPadOS 13+ reports itself as a Mac, and the touch-point count is the
  // usual way to tell a real Mac from an iPad pretending to be one.
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  return 'other'
}

export function InstallApp() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [standalone, setStandalone] = useState(false)
  const [platform, setPlatform] = useState<Platform>('other')
  const [howOpen, setHowOpen] = useState(false)

  useEffect(() => {
    setStandalone(isStandalone())
    setPlatform(detectPlatform())

    const onPrompt = (e: Event) => {
      // Chrome shows its own mini-infobar unless this is cancelled, and then
      // hands us the event to fire whenever we like.
      e.preventDefault()
      setPromptEvent(e as InstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setPromptEvent(null)
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  // Inside the Android app already. Nothing here applies.
  if (isNative()) return null

  const install = async () => {
    if (!promptEvent) return
    await promptEvent.prompt()
    const { outcome } = await promptEvent.userChoice
    // The event is single-use whatever the rider chose.
    setPromptEvent(null)
    if (outcome === 'accepted') setInstalled(true)
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="text-sm font-semibold text-slate-900">Put Zetway on your phone</h2>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">
        You are reading this in a browser. Everything above works here — the score, the map,
        the guides, all of it offline. Four things do not, and they are the ones that matter
        after a crash.
      </p>

      <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-700">
        {[
          'Watching for an impact with the screen off and the app closed',
          'Texting your contacts your location without a tap',
          'Ringing your first contact without a tap',
          'Putting the alert over a locked screen',
        ].map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden="true" className="shrink-0 font-bold text-brand-deep">
              &bull;
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        A phone browser suspends a page it cannot see, and no web page is allowed to call or
        message by itself. Those are not things we have left to build.
      </p>

      <div className="mt-4 space-y-2">
        {/* The Android build. The only one that does the four things above. */}
        <a
          href={APK_URL}
          download="zetway.apk"
          className="block rounded-xl bg-brand-deep px-4 py-3.5 text-center text-sm font-semibold text-white active:bg-brand-deep/90"
        >
          Download the Android app
        </a>
        <p className="text-[11px] leading-relaxed text-slate-500">
          About 17 MB. Android will warn you it is from an <strong>unverified developer</strong> and
          ask you to allow installs from your browser — that is what an unsigned student build
          looks like, and you have to accept it to continue.
          {platform === 'ios' && ' This is an Android file; an iPhone cannot open it.'}
        </p>

        {/* The web app. Real prompt where the browser gives us one. */}
        {standalone || installed ? (
          <p className="rounded-xl bg-flag-green/10 px-3 py-2.5 text-xs font-medium text-flag-green ring-1 ring-flag-green/25">
            {installed && !standalone
              ? 'Web app installed. Open it from your home screen.'
              : 'You are running the installed web app.'}
          </p>
        ) : promptEvent ? (
          <button
            type="button"
            onClick={install}
            className="w-full rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 ring-1 ring-slate-200 active:bg-slate-100"
          >
            Install the web app instead
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setHowOpen((o) => !o)}
              className="w-full rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 ring-1 ring-slate-200 active:bg-slate-100"
            >
              {howOpen ? 'Hide' : 'Or add the web app to your home screen'}
            </button>
            {howOpen && (
              <div className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
                {platform === 'ios' ? (
                  <p>
                    In Safari, tap <strong>Share</strong>, then{' '}
                    <strong>Add to Home Screen</strong>. iOS gives no install button to a web
                    page, so this is the only route — and iOS will not run the crash watch in
                    the background whatever you do.
                  </p>
                ) : platform === 'android' ? (
                  <p>
                    In Chrome, tap <strong>&#8942;</strong> then{' '}
                    <strong>Add to Home screen</strong>. If you do not see it, you may have
                    added it already.
                  </p>
                ) : (
                  <p>
                    In Chrome or Edge, look for the install icon at the right-hand end of the
                    address bar, or open the <strong>&#8942;</strong> menu and choose{' '}
                    <strong>Install Zetway</strong>.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
