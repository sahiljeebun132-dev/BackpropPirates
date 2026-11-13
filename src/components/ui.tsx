import type { ReactNode } from 'react'

/**
 * The handful of shapes the whole app is built from.
 *
 * The supplied design is four bespoke pages that happen to look alike. Pulling
 * the repeated shapes out first means the rest of the rebuild is composition
 * rather than copying, and a change to the card radius happens in one place
 * instead of fifteen.
 *
 * Colour is a prop rather than a class string at each call site, because the
 * same four accents recur — red for danger, amber for weather, blue for the
 * route, green for what is working — and spelling them out by hand is how a
 * palette drifts.
 */

export type Accent = 'red' | 'amber' | 'blue' | 'green' | 'slate'

const ACCENT: Record<Accent, { ring: string; chip: string; icon: string; tint: string }> = {
  red: {
    ring: 'ring-flag-red/25',
    chip: 'bg-flag-red/10 ring-flag-red/20',
    icon: 'text-flag-red',
    tint: 'active:bg-flag-red/5',
  },
  amber: {
    ring: 'ring-amber-300/60',
    chip: 'bg-amber-50 ring-amber-200',
    icon: 'text-amber-600',
    tint: 'active:bg-amber-50/60',
  },
  blue: {
    ring: 'ring-brand/25',
    chip: 'bg-brand/10 ring-brand/20',
    icon: 'text-brand-deep',
    tint: 'active:bg-brand/5',
  },
  green: {
    ring: 'ring-flag-green/25',
    chip: 'bg-flag-green/10 ring-flag-green/20',
    icon: 'text-flag-green',
    tint: 'active:bg-flag-green/5',
  },
  slate: {
    ring: 'ring-slate-200',
    chip: 'bg-slate-100 ring-slate-200',
    icon: 'text-slate-600',
    tint: 'active:bg-slate-50',
  },
}

/** The standard white surface. Everything that is not a button is one of these. */
export function Card({
  children,
  accent = 'slate',
  className = '',
  ...rest
}: {
  children: ReactNode
  accent?: Accent
  className?: string
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={`rounded-[20px] bg-white/95 p-4 shadow-sm ring-1 ${ACCENT[accent].ring} ${className}`}
      {...rest}
    >
      {children}
    </section>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="font-display text-sm font-bold text-slate-900">{children}</h2>
}

/** The rounded square an icon sits in. The design's one consistent motif. */
export function IconChip({
  accent,
  size = 'md',
  children,
}: {
  accent: Accent
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
}) {
  const box = size === 'lg' ? 'h-12 w-12 rounded-2xl' : size === 'sm' ? 'h-7 w-7 rounded-full' : 'h-9 w-9 rounded-full'
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center ring-1 ${box} ${ACCENT[accent].chip} ${ACCENT[accent].icon}`}
    >
      {children}
    </span>
  )
}

/** A big square entry point. Two of these sit side by side. */
export function Tile({
  accent,
  title,
  subtitle,
  icon,
  onClick,
}: {
  accent: Accent
  title: string
  subtitle: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex aspect-square flex-col items-center justify-center gap-2.5 rounded-3xl bg-white/95 p-4 text-center shadow-sm ring-1 transition ${ACCENT[accent].ring} ${ACCENT[accent].tint} active:scale-[0.98]`}
    >
      <IconChip accent={accent} size="lg">
        {icon}
      </IconChip>
      <span className="space-y-1">
        <span className="block font-display text-sm font-bold leading-snug text-slate-900">
          {title}
        </span>
        <span className="block text-[11px] leading-tight text-slate-500">{subtitle}</span>
      </span>
    </button>
  )
}

/** A full-width pill entry point, for the actions that do not deserve a tile. */
export function Row({
  accent,
  title,
  subtitle,
  icon,
  onClick,
}: {
  accent: Accent
  title: string
  subtitle: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-3 rounded-full bg-white/95 px-4 py-3 text-left shadow-sm ring-1 transition ${ACCENT[accent].ring} ${ACCENT[accent].tint} active:scale-[0.99]`}
    >
      <IconChip accent={accent}>{icon}</IconChip>
      <span className="min-w-0">
        <span className="block truncate font-display text-sm font-bold leading-tight text-slate-900">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{subtitle}</span>
      </span>
    </button>
  )
}

/** The amber strip at the top of the home screen. */
export function Notice({
  accent = 'amber',
  icon,
  children,
}: {
  accent?: Accent
  icon: ReactNode
  children: ReactNode
}) {
  const tone =
    accent === 'amber'
      ? 'bg-amber-50 ring-amber-200 text-amber-900'
      : accent === 'red'
        ? 'bg-flag-red/5 ring-flag-red/25 text-flag-red'
        : 'bg-brand/5 ring-brand/25 text-brand-deep'
  return (
    <div className={`flex items-center gap-2.5 rounded-[18px] px-3.5 py-2.5 ring-1 ${tone}`}>
      <IconChip accent={accent} size="sm">
        {icon}
      </IconChip>
      <p className="text-[11px] font-bold leading-snug">{children}</p>
    </div>
  )
}

/** The back bar every module page opens with. */
export function PageHeader({
  title,
  onBack,
  badge,
}: {
  title: string
  onBack: () => void
  badge?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 active:bg-slate-50"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5"
          aria-hidden="true"
        >
          <path d="M19 12H5M11 18l-6-6 6-6" />
        </svg>
        Home
      </button>
      <h1 className="min-w-0 flex-1 truncate font-display text-base font-extrabold tracking-tight text-slate-900">
        {title}
      </h1>
      {badge}
    </div>
  )
}

/* The icons the app uses, inlined.
 *
 * The design imports lucide-react. Adding a dependency the night before a
 * pitch to draw nine glyphs is a poor trade, and these ship inside the APK
 * with nothing to fetch. Same 24x24 grid and stroke weight as lucide so the
 * set still looks like one family. */

const s = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const Icon = {
  shieldAlert: (c = 'h-6 w-6') => (
    <svg {...s} className={c}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 01-.67 0C7.5 20.5 4 18 4 13V6a1 1 0 011-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 011.52 0C14.51 3.81 17 5 19 5a1 1 0 011 1z" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  ),
  cloudRain: (c = 'h-6 w-6') => (
    <svg {...s} className={c}>
      <path d="M4 14.9A7 7 0 1115.71 8h1.79a4.5 4.5 0 012.5 8.24" />
      <path d="M16 14v6M8 14v6M12 16v6" />
    </svg>
  ),
  alertTriangle: (c = 'h-4 w-4') => (
    <svg {...s} className={c}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  ),
  wrench: (c = 'h-4 w-4') => (
    <svg {...s} className={c}>
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </svg>
  ),
  activity: (c = 'h-3.5 w-3.5') => (
    <svg {...s} className={c}>
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  ),
  route: (c = 'h-6 w-6') => (
    <svg {...s} className={c}>
      <circle cx="6" cy="19" r="3" />
      <circle cx="18" cy="5" r="3" />
      <path d="M9 19h4a4 4 0 004-4V9" />
    </svg>
  ),
  phone: (c = 'h-4 w-4') => (
    <svg {...s} className={c}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.2 2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.36 1.9.7 2.81a2 2 0 01-.45 2.11L8.1 9.9a16 16 0 006 6l1.26-1.26a2 2 0 012.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0122 16.92z" />
    </svg>
  ),
  road: (c = 'h-6 w-6') => (
    <svg {...s} className={c}>
      <path d="M4 21 8 3M20 21l-4-18" />
      <path d="M12 5v3M12 12v3M12 19v2" />
    </svg>
  ),
  book: (c = 'h-6 w-6') => (
    <svg {...s} className={c}>
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
    </svg>
  ),
  camera: (c = 'h-4 w-4') => (
    <svg {...s} className={c}>
      <path d="M14.5 4h-5L8 6.5H4.5A1.5 1.5 0 003 8v10a1.5 1.5 0 001.5 1.5h15A1.5 1.5 0 0021 18V8a1.5 1.5 0 00-1.5-1.5H16z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
  ),
  check: (c = 'h-4 w-4') => (
    <svg {...s} className={c}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
}

/**
 * A labelled group of entry points.
 *
 * Seven buttons in a flat column is a list to be read; three groups of two
 * or three is a thing to be scanned. The heading is deliberately a plain
 * label rather than a card — it costs one line and no border, because the
 * grouping is the point, not the chrome around it.
 */
export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {children}
    </section>
  )
}
