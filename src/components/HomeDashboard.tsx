import type { ReactNode } from 'react'

import { Icon, Notice, Row, Section, Tile } from './ui'

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
  onAccidents,
  onClimate,
  onReport,
  onRoadside,
  onAsk,
}: {
  vigilance: string | null
  planner: ReactNode
  onAccidents: () => void
  onClimate: () => void
  onReport: () => void
  onRoadside: () => void
  onAsk: () => void
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

      {/* Grouped rather than stacked. Seven entry points in one column is a
          list you read top to bottom; three labelled groups is something you
          scan and skip. The split is by when you reach for it: planning a
          trip, something has gone wrong, or it runs by itself. */}
      <Section title="Check the road">
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
      </Section>

      <Section title="If something happens">
        <Row
          accent="blue"
          icon={Icon.wrench()}
          title="Broken down or had a crash"
          subtitle="Safety check first, then fifteen roadside guides"
          onClick={onRoadside}
        />
        <Row
          accent="red"
          icon={Icon.alertTriangle()}
          title="Report a hazard"
          subtitle="Warn other riders about something on the road"
          onClick={onReport}
        />
        <Row
          accent="green"
          icon={Icon.book('h-4 w-4')}
          title="Ask Zetway"
          subtitle="A question in your own words — works with no signal"
          onClick={onAsk}
        />
      </Section>

      {/* "Running while you ride" is rendered by App, not here. It holds the
          crash watch line, and that component is mounted once for the whole
          session so a trip through the roadside guides cannot tear down its
          sensor listener — which means it cannot live inside a branch that
          unmounts when the view changes. */}

    </>
  )
}
