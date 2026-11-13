import { useCallback, useEffect, useRef, useState } from 'react'

import {
  buzz, canVibrate, COUNTDOWN_SECONDS, createAlarm, currentPosition, helpMessage,
  IMPACT_THRESHOLD_MS2, keepAwake, readContacts, recordAudio, requestMotionPermission,
  smsLink, TEST_THRESHOLD_MS2, watchForImpact, whatsappLink, writeContacts,
  type EmergencyContact, type Recording,
} from '../lib/crashWatch'
import { escalate, type EscalationStep } from '../lib/escalate'
import { nativeStopVibration, nativeVibrate } from '../lib/nativeCrash'
import { isNative } from '../lib/platform'

type Phase = 'off' | 'armed' | 'asking' | 'alerting'

const newId = () => Math.random().toString(36).slice(2, 9)
const toG = (ms2: number) => ms2 / 9.8

export function CrashWatch() {
  const [phase, setPhase] = useState<Phase>('off')
  const [testMode, setTestMode] = useState(false)
  const [contacts, setContacts] = useState<EmergencyContact[]>(() => readContacts())
  const [peak, setPeak] = useState<number | null>(null)
  const [left, setLeft] = useState(COUNTDOWN_SECONDS)
  const [position, setPosition] = useState<{ lat: number; lon: number } | null>(null)
  const [recording, setRecording] = useState<Recording | null>(null)
  const [recordingNow, setRecordingNow] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(false)

  // Live sensor readout, so a rider can see the thing is actually listening.
  const [reading, setReading] = useState(0)
  const [peakSeen, setPeakSeen] = useState(0)
  const [sensorSeen, setSensorSeen] = useState(false)
  /** True only when the sensor fired for real, at the real threshold. A
   *  rehearsal and a test-mode shake must never reach for the dialler. */
  const [liveIncident, setLiveIncident] = useState(false)
  const [autoSteps, setAutoSteps] = useState<EscalationStep[]>([])

  const stopWatch = useRef<(() => void) | null>(null)
  const wakeLock = useRef<{ release: () => void } | null>(null)
  const stopRecording = useRef<(() => void) | null>(null)
  const alarm = useRef<ReturnType<typeof createAlarm>>(null)
  /** Read by beginAlerting. Held in a ref so that a location fix arriving
   *  mid-countdown does not change that callback's identity, which would
   *  restart the one-second timer and stretch the countdown. */
  const latest = useRef({ contacts, position, peak })

  useEffect(() => {
    latest.current = { contacts, position, peak }
  }, [contacts, position, peak])

  // The Android build always has a vibrator to reach for.
  const vibrates = isNative() || canVibrate()

  const onReading = useCallback((magnitude: number) => {
    setSensorSeen(true)
    setReading(magnitude)
    setPeakSeen((p) => (magnitude > p ? magnitude : p))
  }, [])

  const trigger = useCallback((g: number | null, live = false) => {
    setLiveIncident(live)
    setAutoSteps([])
    setPeak(g)
    setLeft(COUNTDOWN_SECONDS)
    setPhase('asking')
    // Both at once: vibration reaches a phone in a pocket, sound reaches an
    // iPhone, which cannot vibrate from a web page at all.
    buzz([600, 200, 600, 200, 600])
    // In the Android build this is the one that actually fires: a web view
    // does not reliably expose navigator.vibrate, and iOS never has.
    void nativeVibrate([0, 600, 250, 600, 250, 1500])
    alarm.current?.start()
    void currentPosition().then(setPosition)
  }, [])

  const startWatching = useCallback(
    (test: boolean) => {
      stopWatch.current?.()
      stopWatch.current = watchForImpact(
        (g) => trigger(g, !test),
        test ? TEST_THRESHOLD_MS2 : IMPACT_THRESHOLD_MS2,
        onReading,
      )
    },
    [trigger, onReading],
  )

  const disarm = useCallback(() => {
    stopWatch.current?.()
    stopWatch.current = null
    wakeLock.current?.release()
    wakeLock.current = null
    stopRecording.current?.()
    stopRecording.current = null
    alarm.current?.stop()
    alarm.current = null
  }, [])

  useEffect(() => disarm, [disarm])

  const arm = async () => {
    const allowed = await requestMotionPermission()
    if (!allowed) {
      setNotice(
        'This phone refused motion access, so an impact cannot be detected. On an iPhone, check Settings, Safari, Motion and Orientation Access. Everything else in the app still works.',
      )
      return
    }
    // Created now, while we are inside the tap: a browser will not let a page
    // make a sound until the user has interacted with it.
    alarm.current = createAlarm()
    wakeLock.current = await keepAwake()
    setSensorSeen(false)
    setPeakSeen(0)
    startWatching(testMode)
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

  /** Run the alert on demand. Nobody should meet that screen for the first
   *  time while hurt, and it works on a phone whose sensor is unavailable. */
  const rehearse = () => {
    alarm.current ??= createAlarm()
    trigger(null)
  }

  const beginAlerting = useCallback(() => {
    setPhase('alerting')
    setRecordingNow(true)

    // Everything that can happen without the rider touching anything happens
    // here. In the Android build that is a text to every contact and a call to
    // the first of them; in a browser it is nothing at all, and the screen says
    // so rather than letting someone believe help is already on its way.
    // Skipped entirely for a rehearsal or a test-mode shake: a false alarm that
    // rings your mother is a mistake nobody forgives twice.
    if (liveIncident) {
      const { contacts: to, position: at, peak: g } = latest.current
      void escalate(to, at, g).then(setAutoSteps)
    }
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
  }, [liveIncident])

  // The countdown. The transition happens inside the timer rather than in the
  // effect body, so a render never triggers another render on its own.
  useEffect(() => {
    if (phase !== 'asking') return
    const t = setTimeout(() => {
      if (left <= 1) {
        setLeft(0)
        beginAlerting()
      } else {
        buzz([250]) // a pulse a second, so it keeps nagging
        void nativeVibrate([0, 250])
        setLeft(left - 1)
      }
    }, 1000)
    return () => clearTimeout(t)
  }, [phase, left, beginAlerting])

  const imOk = () => {
    alarm.current?.stop()
    stopRecording.current?.()
    stopRecording.current = null
    buzz([0])
    void nativeStopVibration()
    setPhase('armed')
    setPeak(null)
    setRecording(null)
    setRecordingNow(false)
    startWatching(testMode) // watchForImpact fires once, so re-attach
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
        autoSteps={autoSteps}
        onImOk={imOk}
        onStandDown={standDown}
      />
    )
  }

  const threshold = testMode ? TEST_THRESHOLD_MS2 : IMPACT_THRESHOLD_MS2

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Crash watch</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            {phase === 'armed'
              ? 'Watching for an impact. Keep this screen open and the phone mounted.'
              : isNative()
                ? 'Watches the phone’s motion sensor while you ride. On a heavy impact it sounds an alarm, and if you do not answer within 30 seconds it texts your contacts your location and rings the first one, without you touching anything.'
                : 'Watches the phone’s motion sensor while you ride. On a heavy impact it sounds an alarm, and if you do not answer it puts calling for help one tap away.'}
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

      {phase === 'armed' && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Sensor right now</span>
            <span className="text-xs tabular-nums text-slate-500">
              fires at {toG(threshold).toFixed(1)}g
            </span>
          </div>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-slate-900">
            {toG(reading).toFixed(2)}
            <span className="ml-1 text-sm font-medium text-slate-500">g</span>
            <span className="ml-3 text-sm font-medium text-slate-500">
              peak {toG(peakSeen).toFixed(2)}g
            </span>
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className={`h-full rounded-full transition-all ${
                reading >= threshold ? 'bg-flag-red' : 'bg-flag-green'
              }`}
              style={{ width: `${Math.min(100, (reading / threshold) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
            {sensorSeen
              ? 'Shake the phone and watch this move. If it reaches the bar, the alarm fires.'
              : 'No readings yet. If this stays at zero, the phone is not giving the page its motion sensor.'}
          </p>
        </div>
      )}

      <label className="mt-3 flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={testMode}
          onChange={(e) => {
            setTestMode(e.target.checked)
            if (phase === 'armed') startWatching(e.target.checked)
          }}
          className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[var(--color-flag-red)]"
        />
        <span className="text-xs leading-relaxed text-slate-700">
          <span className="font-semibold">Test mode</span> — fires at{' '}
          {toG(TEST_THRESHOLD_MS2).toFixed(1)}g so a hard shake sets it off, instead of the{' '}
          {toG(IMPACT_THRESHOLD_MS2).toFixed(1)}g a real crash needs.
          <span className="block text-slate-500">
            Use it to check the alarm works, then turn it off before you ride.
          </span>
        </span>
      </label>

      {testMode && phase === 'armed' && (
        <p className="mt-2 rounded-xl bg-flag-red/10 p-2.5 text-xs font-semibold text-flag-red ring-1 ring-flag-red/30">
          Test mode is on. A bump could set this off.
        </p>
      )}

      {isNative() && phase !== 'armed' && (
        <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
          After a real impact and an unanswered countdown, Zetway texts everyone below and rings
          the first of them by itself. 114 and 999 stay one tap: Android does not let any app dial
          an emergency number on its own. A rehearsal or a test-mode shake never contacts anyone.
        </p>
      )}

      {!vibrates && (
        <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-600 ring-1 ring-slate-200">
          This phone does not let a web page vibrate, which iPhones never have. The alarm will
          sound instead, so keep the volume up and the silent switch off.
        </p>
      )}

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
        {contacts.length ? `People to alert (${contacts.length})` : 'Add someone to alert'}
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
        send a message by itself, so the last tap is always yours.
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
  autoSteps: EscalationStep[]
  onImOk: () => void
  onStandDown: () => void
}) {
  const { phase, left, peak, position, contacts, recording, recordingNow, notice, autoSteps, onImOk, onStandDown } = props
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

            {autoSteps.length > 0 && (
              <ul className="space-y-2 rounded-xl bg-white/15 p-3 ring-1 ring-white/30">
                {autoSteps.map((step) => (
                  <li key={step.text} className="flex gap-2 text-sm leading-relaxed">
                    <span aria-hidden="true" className="shrink-0 font-bold">
                      {step.state === 'done'
                        ? '✓'
                        : step.state === 'doing'
                          ? '•'
                          : step.state === 'failed'
                            ? '!'
                            : '→'}
                    </span>
                    <span>{step.text}</span>
                  </li>
                ))}
              </ul>
            )}
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
                Voice note
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
              Zetway opens the dialler with the number in it, but no web page is allowed to press
              call, on any phone. The same goes for sending a message. Everything above is prepared
              and waiting for one tap.
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
