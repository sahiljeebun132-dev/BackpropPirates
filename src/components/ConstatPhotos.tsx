import { useEffect, useRef, useState } from 'react'

import { WHERE_PHRASE, type StoppedWhere } from '../lib/breakdown'
import { clockTime, CONSTAT_SHOTS, constatSummary, type ConstatShotId } from '../lib/constat'
import { Card, CardTitle, Icon, IconChip, Row } from './ui'

type Props = {
  /** Where the vehicle stopped, from the triage question. A live lane is no
   *  place to be composing a photograph. */
  where: StoppedWhere
  /** The fix the flow already holds. Asking for location a second time, from
   *  inside a card, would mean a second permission prompt for nothing. */
  position: { lat: number; lon: number } | null
  onUseGps: () => void
}

type Taken = { url: string; at: Date }

/**
 * The four-photograph checklist for a constat amiable.
 *
 * Closed by default and opened by the rider, because most people reaching
 * the roadside flow have a breakdown and not a collision, and a camera
 * checklist in front of someone with a flat tyre is noise.
 *
 * Everything here is local. The file input hands us a File, we hold an
 * object URL for the thumbnail, and that is the whole lifecycle — no canvas,
 * no upload, no storage. Photographs of another vehicle and of its
 * documents are someone else's personal data under the Data Protection Act
 * 2017, and the only honest way to handle that in a hackathon app is not to
 * collect it anywhere we would then have to defend.
 */
export function ConstatPhotos({ where, position, onUseGps }: Props) {
  const [open, setOpen] = useState(false)
  const [shots, setShots] = useState<Partial<Record<ConstatShotId, Taken>>>({})
  const [confirmClear, setConfirmClear] = useState(false)
  const [note, setNote] = useState('')

  // Blob URLs are not garbage collected on their own, and four phone
  // photographs is tens of megabytes held by a tab the rider has moved on
  // from. A ref, because the cleanup must see the latest set and must still
  // run only once, when the card goes away.
  const held = useRef(shots)
  useEffect(() => {
    held.current = shots
  }, [shots])
  useEffect(
    () => () => {
      for (const s of Object.values(held.current)) if (s) URL.revokeObjectURL(s.url)
    },
    [],
  )

  const taken = CONSTAT_SHOTS.flatMap((s) => {
    const t = shots[s.id]
    return t ? [{ id: s.id, at: t.at }] : []
  })
  const count = taken.length
  const next = CONSTAT_SHOTS.find((s) => !shots[s.id])

  function keep(id: ConstatShotId, file: File | undefined) {
    if (!file) return
    // Revoked out here rather than inside the state updater: an updater may
    // be called twice, and the second call would revoke a URL we had just
    // handed to an <img>.
    const previous = shots[id]
    if (previous) URL.revokeObjectURL(previous.url)
    setShots({ ...shots, [id]: { url: URL.createObjectURL(file), at: new Date() } })
    setNote('')
  }

  function clearAll() {
    for (const s of Object.values(shots)) if (s) URL.revokeObjectURL(s.url)
    setShots({})
    setConfirmClear(false)
    setNote('Removed. Nothing of them is left in the app.')
  }

  const summary = constatSummary(taken, position)
  const canShare = typeof navigator.share === 'function'

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary)
      setNote('Copied.')
    } catch {
      setNote('This phone would not give the app the clipboard. The text above can be selected and copied by hand.')
    }
  }

  async function share() {
    try {
      await navigator.share({ text: summary })
    } catch {
      // Cancelling the share sheet lands here too, so there is nothing worth
      // saying to the rider either way.
    }
  }

  if (!open) {
    return (
      <Row
        accent="blue"
        title="Another vehicle was involved"
        subtitle="Four photographs to take before anything moves"
        icon={Icon.camera()}
        onClick={() => setOpen(true)}
      />
    )
  }

  const risky = where === 'motorway' || where === 'main-road'

  return (
    <Card accent="blue">
      <div className="flex items-start justify-between gap-3">
        <CardTitle>Before the cars move</CardTitle>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 text-xs font-semibold text-brand-deep underline"
        >
          Hide
        </button>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        You and the other driver fill in one paper constat together and you both sign it. It is a
        shared statement of the facts — where the vehicles were, what hit what, who was there.
        Signing it is not admitting fault and it is not a claim.
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-700">
        These four photographs are the ones people wish they had taken. Once the cars are pushed
        aside the positions are gone, and the form has no way of proving them. Zetway sends
        nothing and files nothing — the photographs go with the form, they do not stand in for it.
      </p>

      {risky && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200">
          You said you are {WHERE_PHRASE[where]}. None of this is worth standing in a live lane
          for. Get everyone behind a barrier first, and if a shot cannot be taken from somewhere
          safe, skip it and write down what you saw instead.
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-brand transition-all"
            style={{ width: `${Math.max(2, (count / CONSTAT_SHOTS.length) * 100)}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
          {count} of {CONSTAT_SHOTS.length}
        </span>
      </div>

      <ol className="mt-3 space-y-2">
        {CONSTAT_SHOTS.map((shot, i) => {
          const t = shots[shot.id]
          const isNext = next?.id === shot.id
          return (
            <li
              key={shot.id}
              className={`rounded-2xl p-3 ring-1 ${
                t ? 'bg-flag-green/5 ring-flag-green/25' : isNext ? 'bg-white ring-brand/30' : 'bg-slate-50 ring-slate-200'
              }`}
            >
              <div className="flex gap-3">
                {t ? (
                  <IconChip accent="green" size="sm">
                    {Icon.check('h-3.5 w-3.5')}
                  </IconChip>
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-slate-500 ring-1 ring-slate-200"
                  >
                    {i + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold leading-snug text-slate-900">{shot.label}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{shot.why}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{shot.how}</p>
                </div>
                {t && (
                  <img
                    src={t.url}
                    alt={`Your photograph: ${shot.label.toLowerCase()}`}
                    className="h-14 w-14 shrink-0 rounded-xl object-cover ring-1 ring-slate-200"
                  />
                )}
              </div>

              <label className="mt-2 block">
                <span
                  className={`flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold ${
                    t
                      ? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'
                      : 'bg-brand-deep text-white'
                  }`}
                >
                  {Icon.camera('h-4 w-4')}
                  {t ? `Take it again · ${clockTime(t.at)}` : 'Take this photo'}
                </span>
                {/* A plain file input with capture: it opens the camera inside
                    the Android app and in a phone browser, and falls back to
                    the picker on a laptop, with no plugin to keep working. */}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  aria-label={t ? `Retake: ${shot.label}` : `Take photo: ${shot.label}`}
                  onChange={(e) => {
                    keep(shot.id, e.currentTarget.files?.[0])
                    // Cleared so that picking the same file twice still fires.
                    e.currentTarget.value = ''
                  }}
                />
              </label>
            </li>
          )
        })}
      </ol>

      {count > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
            What to write down or send
          </h3>
          <textarea
            readOnly
            value={summary}
            rows={8}
            aria-label="Summary of the photographs you have taken"
            className="mt-1.5 w-full resize-none rounded-xl border-0 bg-slate-50 px-3 py-2.5 text-xs leading-relaxed text-slate-800 ring-1 ring-slate-200"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="flex-1 rounded-xl bg-brand-deep px-3 py-2.5 text-sm font-semibold text-white active:bg-brand-deep/90"
            >
              Copy this text
            </button>
            {canShare && (
              <button
                type="button"
                onClick={() => void share()}
                className="flex-1 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-800 ring-1 ring-slate-200 active:bg-slate-200"
              >
                Share it
              </button>
            )}
          </div>
          {!position && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
              No location in it, because location is off.{' '}
              <button type="button" onClick={onUseGps} className="font-semibold text-brand-deep underline">
                Use my location
              </button>
            </p>
          )}
          {note && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{note}</p>}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
        The photographs stay in this app on this phone. They are not uploaded, they are not sent to
        us, and closing the app loses them — so move the ones you want into your gallery, or take
        them with your camera app as well. Pictures of someone else{"'"}s vehicle and documents are
        their personal data under the Data Protection Act 2017, which is why we keep none of it.
      </p>

      {count > 0 &&
        (confirmClear ? (
          <div className="mt-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs leading-relaxed text-slate-700">
              Remove all {count} photographs from the app? They are not saved anywhere else.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={clearAll}
                className="flex-1 rounded-lg bg-flag-red px-3 py-2 text-xs font-semibold text-white"
              >
                Remove them
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
              >
                Keep them
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="mt-2 text-xs font-semibold text-brand-deep underline"
          >
            Remove the photographs
          </button>
        ))}

      {count === 0 && note && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-600">{note}</p>
      )}
    </Card>
  )
}
