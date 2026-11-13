import type { ReactNode } from 'react'

import mark from '/brand/zetway-mark.png'

type Props = {
  children: ReactNode
  /** The location pill. Null hides it, which is right on a page where the
   *  rider's own position changes nothing. */
  location?: { active: boolean; label: string; onPress: () => void } | null
}

const buildLabel = new Date(__BUILD_TIME__).toLocaleString('en-GB', {
  timeZone: 'Indian/Mauritius',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

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
    <div className="zw-canvas flex min-h-dvh justify-center">
      <div className="zw-page zw-scroll flex min-h-dvh w-full max-w-md flex-col shadow-sm ring-1 ring-slate-200/70">
        <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200/70 bg-white/95 backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 px-4 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
            <div className="flex min-w-0 items-center gap-2.5">
              <img src={mark} alt="" width={298} height={298} className="h-8 w-8 shrink-0" />
              <div className="min-w-0">
                <span className="block font-display text-base font-extrabold leading-none tracking-tight text-slate-900">
                  Zetway
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-tight text-slate-500">
                  Know the road before you go
                </span>
              </div>
            </div>

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
        </header>

        <main className="flex-1 space-y-3.5 px-4 py-4">{children}</main>

        <footer className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center text-[11px] text-slate-400">
          Team BackpropPirates · Life Powered by Tech 2026 · build {buildLabel}
        </footer>
      </div>
    </div>
  )
}
