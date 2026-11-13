import type { ReactNode } from 'react'

import { Icon, Notice, Row, Tile } from './ui'

/**
 * The home screen, rebuilt to the supplied design.
 *
 * The design's own home is a launcher: a banner, a heading, two square tiles
 * and two pill rows, and nothing else. Adopting that wholesale would have
 * meant dropping the route planner, and the planner is the product — the
 * score, the fourteen black spots on your corridor and the government tables
 * behind every figure all hang off it. So the launcher is kept exactly as
 * drawn and the planner sits above it, which is also the order the demo runs
 * in: plan the route first, reach for the other four only when something has
 * already gone wrong.
 *
 * The amber strip is live or absent. The design ships it with a fixed string
 * of invented weather; here it renders only when there is a real advisory to
 * show, because a warning that is always on screen is one nobody reads.
 */
export function HomeDashboard({
  vigilance,
  planner,
  crashWatch,
  footer,
  onAccidents,
  onClimate,
  onReport,
  onRoadside,
}: {
  vigilance: string | null
  planner: ReactNode
  crashWatch: ReactNode
  footer: ReactNode
  onAccidents: () => void
  onClimate: () => void
  onReport: () => void
  onRoadside: () => void
}) {
  return (
    <>
      {vigilance && <Notice icon={Icon.cloudRain('h-3.5 w-3.5')}>{vigilance}</Notice>}

      {planner}

      <div className="pt-1 text-center">
        <h1 className="font-display text-[21px] font-extrabold leading-snug tracking-tight text-slate-900">
          Drive safe. Instant road help.
        </h1>
        <p className="mt-1.5 text-xs text-slate-500">Tap a tile for what you need now</p>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <Tile
          accent="red"
          icon={Icon.shieldAlert()}
          title="Accidents & road safety"
          subtitle="Black spots and what others report"
          onClick={onAccidents}
        />
        <Tile
          accent="amber"
          icon={Icon.cloudRain()}
          title="Climate & vigilance"
          subtitle="Light, rain and the forecast"
          onClick={onClimate}
        />
      </div>

      <Row
        accent="red"
        icon={Icon.alertTriangle()}
        title="Report a hazard"
        subtitle="Warn other riders about something on the road"
        onClick={onReport}
      />
      <Row
        accent="blue"
        icon={Icon.wrench()}
        title="Broken down or had a crash?"
        subtitle="Safety check first, then fifteen roadside guides"
        onClick={onRoadside}
      />

      {crashWatch}
      {footer}
    </>
  )
}
