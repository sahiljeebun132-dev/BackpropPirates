import { useCallback, useEffect, useRef, useState } from 'react'

import {
  COUNTDOWN_SECONDS, currentPosition, helpMessage, IMPACT_THRESHOLD_MS2, keepAwake,
  readContacts, recordAudio, requestMotionPermission, smsLink, watchForImpact,
  whatsappLink, writeContacts, type EmergencyContact, type Recording,
} from '../lib/crashWatch'

type Phase = 'off' | 'armed' | 'asking' | 'alerting'

const newId = () => Math.random().toString(36).slice(2, 9)

export function CrashWatch() {
  const [phase, setPhase] = useState<Phase>('off')
  const [contacts, setContacts] = useState<EmergencyContact[]>(() => readContacts())
  const [peak, setPeak] = useState<number | null>(null)
  const [left, setLeft] = useState(COUNTDOWN_SECONDS)
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null)
  const [recording, setRecording] = useState<Recording | null>(null)
  const [recordingNow, setRecordingNow] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)

  const stopWatch = useRef<(() => void) | null>(null)
  const wakeLock = useRef<{ release: () => void } | null>(null)
  const stopRecording = useRef<(() => void) | null>(null)

  const disarm = useCallback(() => {
    stopWatch.current?.()
    stopWatch.current = null
    wakeLock.current?.release()
    wakeLock.current = null
    stopRecording.current?.()
    stopRecording.current = null
  }, [])

  useEffect(() => disarm, [disarm])

  const arm = async () => {
    const allowed = await requestMotionPermission()
    if (!allowed) {
      setNotice('Motion access was refused, so impacts cannot be detected. Everything else in the app still works.')
      return
    }
    wakeLock.current = await keepAwake()
    stopWatch.current = watchForImpact((g) => {
      setPeak(g)
      setPhase('asking')
      setLeft(COUNTDOWN_SECONDS)
      navigator.vibrate?.([400, 200, 400, 200, 400])
      void currentPosition().then(setPosition)
    })
    setNotice(null)
    setPhase('armed')
  }

  const standDown = () => {
    disarm()
    setPhase('off')
    setPeak(null)
    setRecording(null)
    setRecordingNow(false)
  }

  /** Run the alert on demand.
   *
   *  Worth having for its own sake: nobody should meet this screen for the
   *  first time while hurt, and knowing the countdown exists is what stops a
   *  false alarm becoming a panic. It also means the feature can be checked on
   *  a phone whose sensor is unavailable. */
  const rehearse = () => {
    setPeak(null)
    setLeft(COUNTDOWN_SECONDS)
    setPhase('asking')
    navigator.vibrate?.([200, 100, 200])
    void currentPosition().then(setPosition)
  }

  /** Nobody answered, so treat them as unable to. */
  const beginAlerting = useCallback(() => {
    setPhase('alerting')
    setRecordingNow(true)
    void recordAudio(
      (rec) => {
        setRecording(rec)
        setRecordingNow(false)
      },
      (message) => {
        setNotice(message)
        setRecordingNow(false)
      },
    ).then((stop) => {
      stopRecording.current = stop
    })
  }, [])

  // The countdown. The transition happens inside the timer rather than in the
  // effect body, so a render never triggers another render on its own.
  useEffect(() => {
    if (phase !== 'asking') return
    const t = setTimeout(() => {
      if (left <= 1) {
        setLeft(0)
        beginAlerting()
      } else {
        setLeft(left - 1)
      }
    }, 1000)
    return () => clearTimeout(t)
  }, [phase, left, beginAlerting])

  const imOk = () => {
    stopRecording.current?.()
    stopRecording.current = null
    setPhase('armed')
    setPeak(null)
    setRecording(null)
    setRecordingNow(false)
    // Re-arm: watchForImpact fires once, so a fresh listener is needed.
    stopWatch.current?.()
    stopWatch.current = watchForImpact((g) => {
      setPeak(g)
      setPhase('asking')
      setLeft(COUNTDOWN_SECONDS)
      navigator.vibrate?.([400, 200, 400])
      void currentPosition().then(setPosition)
    })
  }

  if (phase === 'asking' || phase === 'alerting') {
    return (
      <AlertOverlay
        phase={phase}
        left={left}
        peak={peak}
        position={position}
        contacts={contacts}
        recording={recording}
        recordingNow={recordingNow}
        notice={notice}
        onImOk={imOk}
        onStandDown={standDown}
      />
    )
  }

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Crash watch</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            {phase === 'armed'
              ? 'Watching for an impact. Keep this screen open and the phone mounted.'
              : 'Watches the phone’s motion sensor while you ride, and if it feels a heavy impact and you do not answer, it puts calling for help one tap away.'}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
            phase === 'armed' ? 'bg-flag-green/15 text-flag-green' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {phase === 'armed' ? 'On' : 'Off'}
        </span>
      </div>

      {notice && (
        <p className="mt-2 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 ring-1 ring-amber-200">
          {notice}
        </p>
      )}

      <button
        type="button"
        onClick={phase === 'armed' ? standDown : arm}
        className={`mt-3 w-full rounded-xl px-4 py-3.5 text-sm font-semibold ${
          phase === 'armed'
            ? 'bg-slate-100 text-slate-800 ring-1 ring-slate-200 active:bg-slate-200'
            : 'bg-ink text-white active:opacity-90'
        }`}
      >
        {phase === 'armed' ? 'Turn crash watch off' : 'Turn crash watch on'}
      </button>

      <button
        type="button"
        onClick={rehearse}
        className="mt-2 w-full rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 ring-1 ring-slate-200 active:bg-slate-100"
      >
        Show me what happens in a crash
      </button>

      <button
        type="button"
        onClick={() => setSetupOpen((o) => !o)}
        className="mt-2 w-full text-xs font-semibold text-brand-deep underline"
      >
        {contacts.length
          ? `People to alert (${contacts.length})`
          : 'Add someone to alert'}
      </button>

      {setupOpen && (
        <ContactEditor
          contacts={contacts}
          onChange={(next) => {
            setContacts(next)
            writeContacts(next)
          }}
        />
      )}

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
        Honest about the limits: this only works while the app is open on screen, because a phone
        browser suspends a page that is hidden. And a web page is not allowed to place a call or
        send a message by itself, so the last tap is always yours. It triggers above{' '}
        {(IMPACT_THRESHOLD_MS2 / 9.8).toFixed(1)}g, which a firm shake will reach — try it, that is
        how you check it works.
      </p>
    </section>
  )
}

function ContactEditor({
  contacts, onChange,
}: {
  contacts: EmergencyContact[]
  onChange: (next: EmergencyContact[]) => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  return (
    <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      {contacts.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
              <span className="min-w-0 truncate text-sm text-slate-900">
                {c.name} <span className="text-slate-500">{c.phone}</span>
              </span>
              <button
                type="button"
                onClick={() => onChange(contacts.filter((x) => x.id !== c.id))}
                className="shrink-0 text-xs font-semibold text-flag-red"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {contacts.length < 3 && (
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-brand"
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone, for example 5xxx xxxx"
            className="w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-brand"
          />
          <button
            type="button"
            disabled={!name.trim() || phone.replace(/\D/g, '').length < 7}
            onClick={() => {
              onChange([...contacts, { id: newId(), name: name.trim(), phone: phone.trim() }])
              setName('')
              setPhone('')
            }}
            className="w-full rounded-lg bg-brand-deep px-3 py-2.5 text-sm font-semibold text-white disabled:bg-slate-300"
          >
            Add
          </button>
        </div>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
        Saved on this phone only. Nothing is uploaded, and nobody is contacted unless you tap to
        contact them.
      </p>
    </div>
  )
}

function AlertOverlay(props: {
  phase: 'asking' | 'alerting'
  left: number
  peak: number | null
  position: { lat: number; lon: number } | null
  contacts: EmergencyContact[]
  recording: Recording | null
  recordingNow: boolean
  notice: string | null
  onImOk: () => void
  onStandDown: () => void
}) {
  const { phase, left, peak, position, contacts, recording, recordingNow, notice, onImOk, onStandDown } = props
  const message = helpMessage(position, peak)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-flag-red px-4 py-[max(1rem,env(safe-area-inset-top))] text-white">
      <div className="mx-auto max-w-md space-y-3">
        {phase === 'asking' ? (
          <>
            <p className="text-center text-sm font-semibold uppercase tracking-wide text-white/80">
              Heavy impact detected
            </p>
            <p className="text-center text-7xl font-bold tabular-nums">{left}</p>
            <p className="text-center text-base leading-snug">
              Are you alright? If you do not answer, this screen will help you call for help.
            </p>
            <button
              type="button"
              onClick={onImOk}
              className="w-full rounded-2xl bg-white px-4 py-5 text-lg font-bold text-flag-red"
            >
              I&rsquo;m OK
            </button>
            {peak && (
              <p className="text-center text-xs text-white/70">
                Measured about {(peak / 9.8).toFixed(1)}g. A knock or a dropped phone can do this
                too, which is why it asks.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-center text-sm font-semibold uppercase tracking-wide text-white/80">
              No answer. Get help now
            </p>

            <a
              href="tel:114"
              className="block rounded-2xl bg-white px-4 py-5 text-center text-xl font-bold text-flag-red"
            >
              Call ambulance 114
            </a>
            <a
              href="tel:999"
              className="block rounded-xl bg-white/15 px-4 py-3.5 text-center text-base font-semibold text-white ring-1 ring-white/30"
            >
              Call police 999
            </a>

            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/75">
                Where you are
              </p>
              <p className="mt-1 text-sm leading-snug">
                {position
                  ? `${position.lat.toFixed(5)}, ${position.lon.toFixed(5)}`
                  : 'Still getting a fix. Read out any landmark or road sign you can see.'}
              </p>
              {position && (
                <a
                  href={`https://www.google.com/maps?q=${position.lat},${position.lon}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs font-semibold text-white underline"
                >
                  Open the map
                </a>
              )}
            </div>

            {contacts.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-white/75">
                  Tell someone
                </p>
                {contacts.map((c) => (
                  <div key={c.id} className="rounded-xl bg-white/10 p-3 ring-1 ring-white/20">
                    <p className="text-sm font-semibold">{c.name}</p>
                    <div className="mt-2 flex gap-2">
                      <a href={`tel:${c.phone}`} className="flex-1 rounded-lg bg-white px-3 py-2.5 text-center text-sm font-semibold text-flag-red">
                        Call
                      </a>
                      <a href={smsLink(c.phone, message)} className="flex-1 rounded-lg bg-white/15 px-3 py-2.5 text-center text-sm font-semibold text-white ring-1 ring-white/30">
                        Text
                      </a>
                      <a href={whatsappLink(c.phone, message)} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-white/15 px-3 py-2.5 text-center text-sm font-semibold text-white ring-1 ring-white/30">
                        WhatsApp
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-white/10 p-3 text-sm leading-relaxed ring-1 ring-white/20">
                No contacts saved. Add someone in crash watch so this screen can offer them next
                time.
              </p>
            )}

            <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/20">
              <p className="text-xs font-semibold uppercase tracking-wide text-white/75">
                {recordingNow ? 'Recording now' : recording ? 'Voice note' : 'Voice note'}
              </p>
              {recordingNow && (
                <p className="mt-1 flex items-center gap-2 text-sm">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                  Recording what is happening around you. Say where you are and what is wrong.
                </p>
              )}
              {recording && (
                <>
                  <audio controls src={recording.url} className="mt-2 w-full" />
                  <a
                    href={recording.url}
                    download="zetway-voice-note.webm"
                    className="mt-2 inline-block text-xs font-semibold text-white underline"
                  >
                    Save the recording ({recording.seconds}s)
                  </a>
                </>
              )}
              {notice && <p className="mt-1 text-sm">{notice}</p>}
            </div>

            <p className="rounded-xl bg-black/20 p-3 text-xs leading-relaxed text-white/85">
              Zetway cannot place the call or send the message for you. No web page is allowed to,
              on any phone. Everything above is prepared and waiting for one tap.
            </p>

            <button
              type="button"
              onClick={onImOk}
              className="w-full rounded-xl bg-white/15 px-4 py-3.5 text-center text-sm font-semibold text-white ring-1 ring-white/30"
            >
              False alarm, I&rsquo;m OK
            </button>
            <button
              type="button"
              onClick={onStandDown}
              className="w-full pb-4 text-center text-xs font-semibold text-white/70 underline"
            >
              Turn crash watch off
            </button>
          </>
        )}
      </div>
    </div>
  )
}
