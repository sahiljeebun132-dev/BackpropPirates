import type { ReactNode } from 'react'

type Props = {
  title: string
  subtitle?: string
  children: ReactNode
}

const buildLabel = new Date(__BUILD_TIME__).toLocaleString('en-GB', {
  timeZone: 'Indian/Mauritius',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** Phone-first page frame: sticky header, scrolling content, footer, safe-area aware. */
export function AppShell({ title, subtitle, children }: Props) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-slate-50 shadow-sm">
      <header className="sticky top-0 z-10 bg-teal-700 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white shadow">
        <h1 className="text-lg font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="text-sm text-teal-100">{subtitle}</p>}
      </header>

      <main className="flex-1 space-y-4 px-4 py-4">{children}</main>

      <footer className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-slate-500">
        Team BackpropPirates · Life Powered by Tech 2026 · build {buildLabel}
      </footer>
    </div>
  )
}
