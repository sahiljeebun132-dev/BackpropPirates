import type { ReactNode } from 'react'

import mark from '/brand/zetway-mark.png'
import { isNative } from '../lib/platform'

type Props = {
  children: ReactNode
  /** The location pill. Null hides it, which is right on a page where the
   *  rider's own position changes nothing. */
  location?: { active: boolean; label: string; onPress: () => void } | null
}

/** Which build is on the phone, for when a test result and the code disagree.
 *
 *  No longer printed in the footer — a rider scrolled past it on every screen
 *  and it was only ever for us. It is still worth keeping, so it goes where
 *  the people who need it look: `__ZETWAY_BUILD__` in the console. */
const buildLabel = new Date(__BUILD_TIME__).toLocaleString('en-GB', {
  timeZone: 'Indian/Mauritius',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, string>).__ZETWAY_BUILD__ = buildLabel
}

/**
 * Phone-first page frame: sticky header, scrolling content, footer.
 *
 * The bar is white rather than the logo's near-black. A dark bar at the top
 * of a white page reads as a title bar and takes the eye first, every time
 * the page is opened, for no gain — the rider already knows which app they
 * opened. Light, with a hairline and a blur behind it, the bar recedes and
 * the first thing seen is whatever the screen is actually for.
 *
 * The mark stays the existing one rather than the shield in the supplied
 * design. It is the same image as the APK's launcher icon and the one in the
 * deck, and a logo that changes between the slide and the phone is a thing
 * judges notice.
 *
 * On a laptop the column is phone-width with the flag wash behind it, so a
 * mirrored demo does not show two grey gutters.
 */
export function AppShell({ children, location = null }: Props) {
  return (
    <div className="zw-canvas flex min-h-dvh w-full flex-col items-center justify-center sm:p-4">
      {/* A phone, on a laptop.
       *
       *  Every frame decoration is behind `sm:`, so on a real handset and
       *  inside the APK this is still edge-to-edge and square-cornered — the
       *  rounding and the drop shadow exist only for the mirrored demo,
       *  where a full-width column on a 27-inch screen reads as a website
       *  rather than the phone app it is.
       *
       *  The scroll moves from the document into <main> here. That is what
       *  makes `h-dvh` with `overflow-hidden` hold the frame to a fixed
       *  height instead of letting the page grow past it. */}
      <div className="zw-page relative flex h-dvh w-full flex-col overflow-hidden sm:h-[min(915px,calc(100dvh-2rem))] sm:w-[412px] sm:rounded-[34px] sm:border sm:border-slate-200/90 sm:shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
        <header className="z-30 shrink-0 border-b border-slate-200/70 bg-white/95 backdrop-blur-md">
          {/* Three columns rather than two, so the lockup sits in the real
              middle of the bar instead of wherever the location pill leaves
              it. The outer columns are the same width and the left one is
              empty, which is the cheapest way to centre something next to a
              control that comes and goes. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
            <span aria-hidden="true" />
            <div className="flex min-w-0 items-center justify-center gap-2.5">
              <img src={mark} alt="" width={298} height={298} className="h-8 w-8 shrink-0" />
              <div className="min-w-0 text-center">
                <span className="block font-display text-base font-extrabold leading-none tracking-tight text-slate-900">
                  Zetway
                </span>
                <span className="mt-0.5 block truncate text-[10.5px] leading-tight text-slate-500">
                  Know the road before you go
                </span>
              </div>
            </div>

            <div className="flex justify-end">

            {location && (
              <button
                type="button"
                onClick={location.onPress}
                className={`inline-flex min-h-[30px] shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-bold transition-colors ${
                  location.active
                    ? 'border-flag-green/30 bg-flag-green/10 text-flag-green'
                    : 'border-brand/30 bg-brand/10 text-brand-deep'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3 shrink-0"
                  aria-hidden="true"
                >
                  {location.active ? (
                    <>
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </>
                  ) : (
                    <>
                      <circle cx="12" cy="12" r="7" />
                      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                    </>
                  )}
                </svg>
                <span className="max-w-[125px] truncate">{location.label}</span>
              </button>
            )}
            </div>
          </div>
        </header>

        {/* The only scroll container. Children must not assume the document
            scrolls: a `sticky` element inside a page now sticks to this, not
            to the viewport. */}
        <main className="zw-scroll flex-1 space-y-3.5 overflow-y-auto px-4 py-4">{children}</main>

        {/* Which build this is, spelled out. Two people lost an evening to a
            phone that would not vibrate before anyone established whether it
            was running the Android app or the web one, and only the Android
            app can buzz at alarm priority. A word in the footer settles it. */}
        {/* One line, not three. The build timestamp that used to sit here was
            for us, and a rider scrolling past it on every screen paid for it
            in the only currency a phone has. Which build this is stays: two
            people lost an evening to a phone that would not vibrate before
            anyone established whether it was the Android app or the web one,
            and only the Android app can buzz at alarm priority. */}
        <footer className="shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1.5 text-center text-[11px] text-slate-400">
          BackpropPirates · {isNative() ? 'Android app' : 'Web app'}
        </footer>
      </div>
    </div>
  )
}
