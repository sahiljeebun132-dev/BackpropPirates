import { useCallback, useEffect, useRef, useState } from 'react'

import { hearHazard, EXAMPLE_PHRASES, KIND_LABEL, type HeardHazard } from '../lib/kreol'
import {
  nativeStartListening, nativeStopListening, nativeVoiceStatus, onHearConfig, onHeard,
} from '../lib/nativeCrash'
import { submitReport } from '../lib/reports'
import type { AppData } from '../lib/types'
import { Card, CardTitle, Details } from './ui'

/**
 * Reporting a hazard without taking a hand off the bars.
 *
 * Typing a hazard report is the one interaction in this app that is
 * impossible at the moment it matters. You have just ridden past standing
 * water; the next rider is ninety seconds behind you; you are not stopping
 * to use a keyboard. So the modal opens listening.
 *
 * Kreol is matched here the same way it is everywhere else in this app, and
 * for the same reason: no phone ships a Morisyen speech model, so the
 * recogniser is asked for French and the matching is done on roots. "Delo
 * lor sime" comes back mangled and the water and the road still survive it.
 *
 * Nothing is posted without being shown first. The screen states what it
 * heard, what it concluded and which words decided it, and the rider
 * presses the button. A hazard pin is read by strangers who will act on it,
 * and a wrong one is worse than none — so the app does not get to decide
 * on its own that it understood.
 */
export function ReportByVoice({
  data,
  position,
  onPosted,
  onClose,
}: {
  data: AppData
  position: { lat: number; lon: number } | null
  onPosted: () => void
  onClose: () => void
}) {
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState<HeardHazard | null>(null)
  const [transcript, setTranscript] = useState<string>('')
  const [language, setLanguage] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const unsubs = useRef<(() => void)[]>([])

  const stop = useCallback(() => {
    void nativeStopListening()
    setListening(false)
  }, [])

  // Opens listening, because that is the whole point of the screen.
  useEffect(() => {
    let alive = true
    void (async () => {
      const offHeard = await onHeard(({ text }) => {
        if (!alive) return
        setTranscript(text)
        const got = hearHazard(text, data.places.places)
        if (got) {
          setHeard(got)
          setNote(got.note)
        }
      })
      const offConfig = await onHearConfig(({ language: lang }) => {
        if (alive) setLanguage(lang)
      })
      if (!alive) {
        offHeard()
        offConfig()
        return
      }
      unsubs.current = [offHeard, offConfig]

      const status = await nativeVoiceStatus()
      if (!status.microphone && !status.recognizerAvailable) {
        setProblem('This phone will not let the app listen. Type it instead.')
        return
      }
      const started = await nativeStartListening()
      if (alive) {
        setListening(started.ok)
        if (!started.ok) setProblem(started.message ?? 'Could not start listening.')
      }
    })()

    return () => {
      alive = false
      unsubs.current.forEach((u) => u())
      void nativeStopListening()
    }
  }, [data.places.places])

  const where = heard?.place ?? null
  const at = where
    ? { lat: where.lat, lon: where.lon }
    : position
      ? { lat: position.lat, lon: position.lon }
      : null

  const send = async () => {
    if (!heard || !at) return
    setBusy(true)
    setProblem(null)
    try {
      await submitReport({ kind: heard.kind, lat: at.lat, lon: at.lon, note: note.slice(0, 140) })
      stop()
      setDone(true)
      onPosted()
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not send that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="zw-page">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-lg font-extrabold text-slate-900">Say what you saw</h1>
        <button
          type="button"
          onClick={() => {
            stop()
            onClose()
          }}
          className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
        >
          Close
        </button>
      </div>

      {done ? (
        <Card>
          <CardTitle>Sent</CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Every rider who plans a route through here in the next four hours
            will see it. Then it expires, because a hazard nobody has
            confirmed since lunchtime is not news.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${listening ? 'animate-pulse bg-flag-red' : 'bg-slate-300'}`}
                aria-hidden="true"
              />
              <CardTitle>{listening ? 'Listening' : 'Not listening'}</CardTitle>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
              Speak normally. Kreol, French or English.
              {language === 'fr-FR' && ' Matched through French, which is how Kreol is heard.'}
              {language === 'shout-only' &&
                ' This phone has no speech recogniser, so type it below instead.'}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLE_PHRASES.map((p) => (
                <span
                  key={p}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] text-slate-600"
                >
                  {p}
                </span>
              ))}
            </div>
          </Card>

          {transcript && (
            <Card>
              <CardTitle>What it heard</CardTitle>
              <p className="mt-1 text-sm leading-snug text-slate-900">&ldquo;{transcript}&rdquo;</p>
            </Card>
          )}

          {heard && (
            <Card>
              <CardTitle>What it understood</CardTitle>
              <p className="mt-1 text-xl font-extrabold text-flag-red">{KIND_LABEL[heard.kind]}</p>
              <p className="mt-0.5 text-xs text-slate-600">
                {where
                  ? `at ${where.name}, because you named it`
                  : position
                    ? 'at your current position, because you did not name a place'
                    : 'no position — turn location on, or name a town out loud'}
                {heard.confidence === 'unsure' && ' · only one word matched, so check it'}
              </p>

              <Details summary="Why it decided that">
                <p className="text-[11px] leading-relaxed text-slate-600">
                  Matched on: {heard.matched.join(', ')}. The whole vocabulary is a
                  table of about forty roots in three languages — no model, nothing
                  learned, nothing that can surprise you. If it got this wrong,
                  correct the note below or close without sending.
                </p>
              </Details>

              <label className="mt-2 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                Note other riders will read
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={140}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />

              <button
                type="button"
                onClick={() => void send()}
                disabled={busy || !at}
                className="mt-3 w-full rounded-2xl bg-flag-red px-4 py-4 text-base font-bold text-white disabled:opacity-50"
              >
                {busy ? 'Sending…' : `Warn riders near ${where?.name ?? 'here'}`}
              </button>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Nothing is sent until you press that. A pin is read by strangers
                who will act on it, so the app does not get to decide on its own
                that it understood you.
              </p>
            </Card>
          )}

          {problem && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
              {problem}
            </p>
          )}
        </>
      )}
    </div>
  )
}
