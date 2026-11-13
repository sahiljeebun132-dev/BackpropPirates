import type { ReactNode } from 'react'

import mark from '/brand/zetway-mark.png'

type Props = {
  children: ReactNode
}

const buildLabel = new Date(__BUILD_TIME__).toLocaleString('en-GB', {
  timeZone: 'Indian/Mauritius',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** Phone-first page frame: sticky header, scrolling content, footer, safe-area aware.
 *
 *  The header bar is the logo's own background colour so the mark sits flush on
 *  it. The wordmark is live text rather than part of the image, so it stays
 *  crisp at any size and the tagline is still legible on a small screen.
 */
export function AppShell({ children }: Props) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-slate-50 shadow-sm">
      <header className="sticky top-0 z-10 flex items-center gap-2.5 bg-ink px-4 pb-2.5 pt-[max(0.5rem,env(safe-area-inset-top))] shadow">
        <img src={mark} alt="" width={298} height={298} className="h-10 w-10 shrink-0" />
        <div className="min-w-0">
          <p className="text-xl font-bold leading-none tracking-tight text-white">
            ZET<span className="text-brand">WAY</span>
          </p>
          <p className="mt-1 text-[10px] font-medium uppercase leading-none tracking-[0.18em] text-slate-400">
            Vigilance en route
          </p>
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">{children}</main>

      <footer className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-slate-500">
        Team BackpropPirates · Life Powered by Tech 2026 · build {buildLabel}
      </footer>
    </div>
  )
}
