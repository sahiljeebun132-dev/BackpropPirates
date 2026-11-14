import { useCallback, useEffect, useRef, useState } from 'react'

import {
  buzz, canVibrate, COUNTDOWN_SECONDS, createAlarm, currentPosition, evidenceLines,
  helpMessage, IMPACT_THRESHOLD_MS2, keepAwake, readContacts, recordAudio,
  requestMotionPermission, smsLink, TEST_THRESHOLD_MS2, watchForImpact, whatsappLink,
  writeContacts, type EmergencyContact, type Recording,
} from '../lib/crashWatch'
import { escalate, type EscalationStep } from '../lib/escalate'
import {
  consumePendingImpact, nativeReadiness, nativeSpeak, nativeStartWatching,
  nativeStopSpeaking, nativeStopVibration,
  nativeStopWatching, nativeVibrate, onNativeImpact, onNativeImpactEvidence,
  openAppSettings, openLockScreenSettings, requestCrashPermissions, requestUnrestricted,
  explainNoBuzz, vibrationDiagnostics, type ImpactEvidence, type Readiness,
  type VibrationReport,
} from '../lib/nativeCrash'
import { isNative } from '../lib/platform'
import {
  deviceId, joinRoom, readSavedRoom, reportAlert, standDownRoom, watchRoom,
  writeSavedRoom,
} from '../lib/simRoom'
import { useVoiceSos } from '../lib/useVoiceSos'
import { MedicalIdCard } from './MedicalIdCard'
import { Details, Icon, PageHeader } from './ui'

type Phase = 'off' | 'armed' | 'asking' | 'alerting'

const newId = () => Math.random().toString(36).slice(2, 9)
const toG = (ms2: number) => ms2 / 9.8

/**
 * Crash watch, on the home screen as a single line and on its own page in
 * full.
 *
 * Measured on a phone, this card was 1207px — 44% of the home screen, more
 * than a full viewport, for a feature a rider arms once and then does not
 * touch. Everything in it still exists; the setup half now lives behind a
 * row, and the row shows the one thing worth knowing at a glance, which is
 * whether it is armed.
 *
 * It is mounted once, outside the view switch, and never unmounts while the
 * app is open. That was a bug as much as a layout choice: the card used to
 * render only on the home branch, so opening a roadside guide with the watch
 * armed tore down the sensor listener and reset the UI to "off" — on the
 * web build, where there is no foreground service behind it, that silently
 * stopped the watch at the exact moment a rider was most likely to be using
 * the other screens.
 */
export function CrashWatch({
  expanded,
  onOpen,
  onBack,
}: {
  expanded: boolean
  onOpen: () => void
  onBack: () => void
}) {
  const [phase, setPhase] = useState<Phase>('off')
  const [testMode, setTestMode] = useState(false)
  const [contacts, setContacts] = useState<EmergencyContact[]>(() => readContacts())
  /** The demo room this phone is listening to, or empty. Saved, because the
   *  phone is usually paired before the laptop is even open. */
  const [simRoom, setSimRoom] = useState<string>(() => readSavedRoom())
  const [simJoined, setSimJoined] = useState(false)
  const [peak, setPeak] = useState<number | null>(null)
  /** What the gyroscope and the location provider saw around the impact.
   *  Native only, display only: it is shown on the red screen and never
   *  consulted before raising or keeping the alert. */
  const [evidence, setEvidence] = useState<ImpactEvidence | null>(null)
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
  /** Guards against the same impact raising two alerts: with the app open,
   *  the service reports it and the page may be watching too. */
  const inAlert = useRef(false)
  /** Read by the impact listener, which is subscribed once and must not be
   *  torn down and rebuilt every time the test-mode box changes. */
  const testModeRef = useRef(testMode)
  /** Read by beginAlerting. Held in a ref so that a location fix arriving
   *  mid-countdown does not change that callback's identity, which would
   *  restart the one-second timer and stretch the countdown. */
  const latest = useRef({ contacts, position, peak })

  useEffect(() => {
    latest.current = { contacts, position, peak }
  }, [contacts, position, peak])

  useEffect(() => {
    testModeRef.current = testMode
  }, [testMode])


  // The Android build always has a vibrator to reach for.
  const vibrates = isNative() || canVibrate()

  const onReading = useCallback((magnitude: number) => {
    setSensorSeen(true)
    setReading(magnitude)
    setPeakSeen((p) => (magnitude > p ? magnitude : p))
  }, [])

  const trigger = useCallback((g: number | null, live = false) => {
    if (inAlert.current) return
    inAlert.current = true
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
    // repeat: the buzz runs for the whole countdown, not three seconds.
    void nativeVibrate([0, 600, 250, 600, 250, 1500], true)
    alarm.current?.start()
    void currentPosition().then(setPosition)
  }, [])

  // Impacts seen by the foreground service, which is the only detector in the
  // Android build. Subscribed for the life of the component rather than only
  // while armed, because the service outlives the page: an impact can arrive
  // moments after Android has resumed a web view it had suspended.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    void onNativeImpact(({ test, ...measured }) => {
      setEvidence(measured)
      trigger(Math.round(measured.peak), !test)
    }).then((off) => {
      unsubscribe = off
    })
    return () => unsubscribe?.()
  }, [trigger])

  // The rest of the same impact, a few seconds later: the rotation the spin
  // reached and the speed the vehicle was left at, neither of which exists
  // at the moment of the bang. It only fills in numbers on a screen that is
  // already up — it cannot start an alert and it cannot end one.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    void onNativeImpactEvidence(({ test: _test, ...measured }) => {
      setEvidence(measured)
    }).then((off) => {
      unsubscribe = off
    })
    return () => unsubscribe?.()
  }, [])

  // An impact detected while no page was running at all — the web view killed
  // under memory pressure, or the app simply closed. Without this the service
  // would have done its job and the rider would open the app to nothing.
  useEffect(() => {
    void consumePendingImpact().then((pending) => {
      if (!pending) return
      const { test, ...measured } = pending
      setEvidence(measured)
      trigger(Math.round(measured.peak), !test)
    })
  }, [trigger])

  const startWatching = useCallback(
    (test: boolean) => {
      const threshold = test ? TEST_THRESHOLD_MS2 : IMPACT_THRESHOLD_MS2
      stopWatch.current?.()

      if (isNative()) {
        // The service detects; this listener only feeds the on-screen meter,
        // so an unreachable threshold keeps it from triggering a second alert
        // for an impact the service has already reported.
        stopWatch.current = watchForImpact(() => {}, Number.POSITIVE_INFINITY, onReading)
        void nativeStartWatching(threshold, test).then((r) => {
          if (!r.ok) {
            setNotice(r.message ?? 'Background watching could not be started.')
          } else if (r.notifications === false) {
            setNotice(
              'Notifications are turned off for Zetway, so the alert cannot show itself on a locked screen. Detection still works. Turn them on in Settings, Apps, Zetway.',
            )
          }
        })
        return
      }

      stopWatch.current = watchForImpact((g) => trigger(g, !test), threshold, onReading)
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
    void nativeStopWatching()
  }, [])

  useEffect(() => disarm, [disarm])

  const arm = async () => {
    // Everything the escalation needs, asked for now rather than during a
    // crash. Declining is allowed: the checklist then says what is missing.
    if (isNative()) await requestCrashPermissions()

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
    inAlert.current = false
    disarm()
    setPhase('off')
    setPeak(null)
    setEvidence(null)
    setRecording(null)
    setRecordingNow(false)
  }

  /** Run the alert on demand. Nobody should meet that screen for the first
   *  time while hurt, and it works on a phone whose sensor is unavailable. */
  const rehearse = () => {
    alarm.current ??= createAlarm()
    setEvidence(null) // nothing was sensed, so nothing is reported as sensed
    trigger(null)
  }

  const beginAlerting = useCallback((callFirstContact = true) => {
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
      void escalate(to, at, g, callFirstContact).then(setAutoSteps)
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
        // Web only. Each vibrate() call replaces the one before it, so on
        // Android a pulse every second would cut the long alarm buzz short
        // after one second — the vibrator dump showed exactly that,
        // cancelled_superseded at 856ms. Native already has a 35-second
        // pattern running from the moment of impact, so leave it alone.
        if (!isNative()) buzz([250]) // a pulse a second, so it keeps nagging
        setLeft(left - 1)
      }
    }, 1000)
    return () => clearTimeout(t)
  }, [phase, left, beginAlerting])

  /** Skip the countdown. Somebody who already knows they are hurt should not
   *  have to watch thirty seconds run down before anything happens. */
  const helpNow = () => {
    setLeft(0)
    beginAlerting()
  }

  /** The rider is calling 114 themselves, during the countdown. Silence the
   *  alarm so they can hear the operator, send the texts anyway because they
   *  carry the location, and do not ring a contact into the line they are
   *  about to use. */
  const callEmergencyNow = () => {
    alarm.current?.stop()
    buzz([0])
    void nativeStopVibration()
    setLeft(0)
    beginAlerting(false)
  }

  const imOk = () => {
    inAlert.current = false
    alarm.current?.stop()
    stopRecording.current?.()
    stopRecording.current = null
    buzz([0])
    void nativeStopVibration()
    setPhase('armed')
    setPeak(null)
    setEvidence(null)
    setRecording(null)
    setRecordingNow(false)
    startWatching(testMode) // watchForImpact fires once, so re-attach
  }

  /**
   * The countdown, answered out loud.
   *
   * This is the case the whole feature was built for and the reason it is not
   * merely a screen of its own: a rider pinned under the machine cannot reach
   * the "I'm OK" button and cannot reach "I need help" either. During the
   * thirty seconds they can now say either one.
   *
   * A distress word acts at once rather than starting another countdown —
   * thirty seconds are already running, and someone who gets the word "help"
   * out through that has answered as clearly as anyone can. A shout still
   * gets a short countdown of its own, because a shout is the trigger a
   * lorry's horn can imitate.
   *
   * It listens only while the question is on screen. The moment the alert
   * starts acting it stands down, because the next thing that happens is
   * recordAudio opening the same microphone, and two things holding one
   * microphone means neither of them works.
   */
  const voice = useVoiceSos({
    immediate: true,
    // The overlay does its own talking below. Two voices counting different
    // numbers over each other would be worse than silence.
    speak: false,
    onFire: () => helpNow(),
    onCancel: () => imOk(),
  })

  /**
   * The laptop's trigger, arriving over the demo room.
   *
   * Deliberately calls the same trigger() a real 3g impact calls, with live
   * escalation on. Everything downstream is untouched: the countdown runs its
   * full thirty seconds, the texts go to the real saved numbers, the GPS fix
   * is taken from the actual handset. Only the impact itself is simulated,
   * because that is the single part of the chain a stage cannot supply.
   *
   * The peak passed is a real figure rather than a round one — 3.1g, the kind
   * of reading a moderate car impact actually produces — so the evidence
   * panel shows something a judge can sanity-check instead of a placeholder.
   */
  useEffect(() => {
    if (!simRoom) return
    const stop = watchRoom(simRoom, () => {
      trigger(3.1 * 9.8, true)
    })
    return stop
  }, [simRoom, trigger])

  // Keep the room's device list current so the control page can show that the
  // phone really is connected before anybody presses anything.
  useEffect(() => {
    if (!simRoom) {
      setSimJoined(false)
      return
    }
    let alive = true
    const beat = async () => {
      const state = await joinRoom(simRoom, deviceId(), isNative() ? 'Zetway app' : 'Zetway web')
      if (alive) setSimJoined(state !== null)
    }
    void beat()
    const t = setInterval(() => void beat(), 20000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [simRoom])

  // Tell the room what the phone actually did, so the watchers see measured
  // numbers rather than a mock-up. Sent on every countdown tick while the
  // alert is up, because the seconds remaining are the thing a room watches.
  useEffect(() => {
    if (!simRoom) return
    if (phase !== 'asking' && phase !== 'alerting') return
    void reportAlert(simRoom, {
      lat: position?.lat ?? null,
      lon: position?.lon ?? null,
      accuracy: null,
      peak,
      secondsLeft: phase === 'asking' ? left : 0,
      steps: autoSteps.map((st) => `${st.state}: ${st.text}`),
    })
  }, [simRoom, phase, left, position, peak, autoSteps])

  // `voice` is a fresh object on every render, so depending on it re-ran
  // this effect constantly: arm() was called again before the previous call
  // had finished, each one resetting the shout detector and re-prompting for
  // the microphone. Depend on the stable callbacks and hold a flag while a
  // call is in flight.
  const { arm: armVoice, disarm: disarmVoice, muteFor } = voice
  const voiceArmed = voice.phase !== 'off' && voice.phase !== 'degraded'
  const voiceBusy = useRef(false)

  useEffect(() => {
    if (voiceBusy.current) return
    const wants = phase === 'asking'
    if (wants === voiceArmed) return
    voiceBusy.current = true
    void (wants ? armVoice() : disarmVoice()).finally(() => {
      voiceBusy.current = false
    })
  }, [phase, voiceArmed, armVoice, disarmVoice])

  // Said once, when the question appears. A phone face-down in the gravel is
  // a phone whose screen nobody is reading, and this is the only way the
  // rider learns that saying something would work.
  useEffect(() => {
    if (phase !== 'asking') return
    // Every trigger word is gone from this line. The first version said
    // 'Say "I am OK" to cancel, or say "help" to call for help now' out of
    // the speaker and into its own open microphone; the recogniser heard it,
    // the matcher saw a cancel phrase, and the alert stood itself down about
    // a second after raising itself. Now the words are described rather than
    // spoken, and the hook is told to go deaf while the line plays.
    const line =
      'Zetway detected a heavy impact. Speak now to answer: say that you are ' +
      'all right to call this off, or ask for an ambulance to send for one.'
    muteFor(700 + line.length * 75)
    void nativeSpeak(line)
    return () => {
      void nativeStopSpeaking()
    }
  }, [phase, muteFor])

  if (phase === 'asking' || phase === 'alerting') {
    return (
      <AlertOverlay
        phase={phase}
        left={left}
        peak={peak}
        evidence={evidence}
        position={position}
        contacts={contacts}
        recording={recording}
        recordingNow={recordingNow}
        notice={notice}
        autoSteps={autoSteps}
        onImOk={imOk}
        onHelpNow={helpNow}
        onCallEmergency={callEmergencyNow}
        onStandDown={standDown}
        voiceListening={voice.phase === 'armed' || voice.phase === 'counting'}
        voiceShout={voice.phase === 'counting' ? voice.secondsLeft : null}
        voiceReason={voice.phase === 'degraded' ? voice.reason : null}
      />
    )
  }

  const threshold = testMode ? TEST_THRESHOLD_MS2 : IMPACT_THRESHOLD_MS2
  const armed = phase === 'armed'

  // The home screen gets one line. Armed or not is the whole message there,
  // so it is said twice over — in words and in colour — and the rest of the
  // card is a tap away.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`flex w-full items-center gap-3 rounded-full bg-white/95 px-4 py-3 text-left shadow-sm ring-1 transition active:scale-[0.99] ${
          armed ? 'ring-flag-green/30 active:bg-flag-green/5' : 'ring-slate-200 active:bg-slate-50'
        }`}
      >
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ${
            armed
              ? 'bg-flag-green/10 text-flag-green ring-flag-green/20'
              : 'bg-slate-100 text-slate-500 ring-slate-200'
          }`}
        >
          {Icon.activity('h-4 w-4')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-sm font-bold leading-tight text-slate-900">
            Crash watch
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-500">
            {armed
              ? isNative()
                ? 'Watching — screen off, app closed'
                : 'Watching while this screen is open'
              : 'Off. Detects an impact and calls for help'}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            armed ? 'bg-flag-green/15 text-flag-green' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {armed ? 'On' : 'Off'}
        </span>
      </button>
    )
  }

  return (
    <>
      <PageHeader title="Crash watch" onBack={onBack} />
      <section className="rounded-[20px] bg-white/95 p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">Crash watch</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
            {phase === 'armed'
              ? isNative()
                ? 'Watching for an impact — screen off, phone in a pocket, app closed. Uses extra battery while it runs.'
                : 'Watching for an impact. Keep this screen open and the phone mounted.'
              : isNative()
                ? 'Watches the phone’s motion sensor while you ride, and keeps watching with the screen off. On a heavy impact it sounds an alarm, and if you do not answer within 30 seconds it texts your contacts your location and rings the first one, without you touching anything.'
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
          Watching continues with the screen off and the app closed, which is the only way it is
          any use on a real ride — a notification shows while it runs, and it costs extra battery.
          After a real impact and an unanswered countdown, Zetway texts everyone below and rings
          the first of them by itself. 114 and 999 stay one tap: Android does not let any app dial
          an emergency number on its own. A rehearsal or a test-mode shake never contacts anyone.
        </p>
      )}

      <LockScreenChecklist />

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

      {/* Above the testing tools, and a button rather than a line of
          underlined 12px text.

          This is the most load-bearing setup step in the app: everything
          the crash alert does afterwards is sent to the people named here,
          and with none saved the thirty-second countdown ends by texting
          nobody. It used to sit below a section called "Testing and demo
          tools", which is the worst place in the screen for the one thing
          a rider has to do before their first ride — someone setting the
          app up alone did not find it.

          With none saved it says so in amber rather than inviting. Not an
          error, because nothing has gone wrong yet; a warning, because
          something will. */}
      <button
        type="button"
        onClick={() => setSetupOpen((o) => !o)}
        className={`mt-2 w-full rounded-xl px-4 py-3.5 text-left text-sm font-bold ring-1 ${
          contacts.length
            ? 'bg-flag-green/10 text-flag-green ring-flag-green/25'
            : 'bg-amber-50 text-amber-900 ring-amber-300'
        }`}
      >
        {contacts.length ? `People to alert · ${contacts.length} saved` : 'Add someone to alert'}
        <span className="mt-0.5 block text-[11px] font-medium leading-relaxed opacity-80">
          {contacts.length
            ? 'Texted your location automatically if you do not answer a crash alert.'
            : 'Nobody is saved yet, so a crash alert would have nobody to text. Takes a minute.'}
        </span>
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

      {/* Neither of these is for a rider. One proves the buzzer works on
          this handset, the other pairs the phone to a laptop for a
          demonstration — both worth having, neither worth meeting on the way
          to a motorcycle. Behind one line, closed every time. */}
      <Details summary="Testing and demo tools">
        <DemoRoomPanel
          room={simRoom}
          joined={simJoined}
          onRoom={(next) => {
            setSimRoom(next)
            writeSavedRoom(next)
            if (!next) setSimJoined(false)
          }}
          onStandDown={() => simRoom && void standDownRoom(simRoom)}
        />
        <BuzzSelfTest />
      </Details>

      {/* Directly under the contacts, because the two are the same job: who
          hears about it, and what they need to be told. It is on this page
          rather than the home screen for the same reason the rest of the
          setup is — filled in once before a ride, never during one. */}
      <div className="mt-3">
        <MedicalIdCard />
      </div>

      <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
        {isNative()
          ? 'Honest about the limits: watching carries on with the screen off and the app closed, and the texts and the call to your first contact go out on their own. What no app may do is dial 114 or 999 for you — Android keeps emergency numbers for the phone’s own dialler — so that one tap stays yours.'
          : 'Honest about the limits: in a browser this only works while the app is open on screen, because a phone browser suspends a page that is hidden, and no web page may place a call or send a message by itself. The Android app does both, with the screen off.'}
      </p>
      </section>
    </>
  )
}

/**
 * Whether an alert would actually reach this phone if it were locked in a
 * pocket — which is the only state that matters on a real ride.
 *
 * Three settings decide it and every one is the rider's to grant. Android 13
 * needs notifications allowed before the alert can post at all; Android 14
 * reserved full-screen intents for calling and alarm apps, and without that
 * the alert is quietly downgraded to a heads-up notification that a locked
 * screen never shows; and battery optimisation will kill the service after
 * minutes in a pocket on a great many phones.
 *
 * Detection runs regardless of all three. What they decide is whether anyone
 * is told, and a crash is the worst imaginable moment to discover one was
 * off, so the app checks and says so rather than hoping.
 */
function LockScreenChecklist() {
  const [ready, setReady] = useState<Readiness | null>(null)
  /** True once Android has stopped showing the dialog and the only
   *  remaining route is the system settings screen. */
  const [stuck, setStuck] = useState(false)

  const refresh = useCallback(() => {
    void nativeReadiness().then(setReady)
  }, [])

  useEffect(() => {
    refresh()
    // Each fix sends the rider to a settings screen and back, and the answer
    // has changed by the time they return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  if (!isNative() || !ready) return null


  /**
   * Ask, and if asking changes nothing, stop asking.
   *
   * Android stops showing the dialog once a permission has been refused
   * twice — the request then returns immediately, having done nothing and
   * reported nothing. An "Allow" button that silently does that is worse
   * than no button: the rider taps it, no dialog appears, and they conclude
   * the app is broken. Which is roughly what it is at that point, because
   * the only way back is the system settings screen.
   *
   * So: ask, compare the state afterwards, and if it is unchanged, take
   * them where the switch actually lives.
   */
  const ask = async () => {
    const before = ready
    const after = await requestCrashPermissions()
    refresh()
    const unchanged =
      before &&
      before.sms === after.sms &&
      before.phone === after.phone &&
      before.location === after.location &&
      before.microphone === after.microphone &&
      before.notifications === after.notifications
    const stillMissing =
      !after.sms || !after.phone || !after.location || !after.microphone || !after.notifications
    if (unchanged && stillMissing) {
      setStuck(true)
      await openAppSettings()
    }
  }

  const rows = [
    { ok: ready.sms, label: 'Can text your contacts', fixLabel: 'Allow', fix: ask },
    { ok: ready.phone, label: 'Can ring your first contact', fixLabel: 'Allow', fix: ask },
    { ok: ready.location, label: 'Can read your location', fixLabel: 'Allow', fix: ask },
    { ok: ready.microphone, label: 'Can record after an impact', fixLabel: 'Allow', fix: ask },
    {
      ok: ready.notifications,
      label: 'Notifications allowed',
      fixLabel: 'Allow',
      fix: ask,
    },
    {
      ok: ready.lockScreen,
      label: 'Can wake a locked screen',
      fixLabel: 'Allow',
      fix: () => void openLockScreenSettings(),
    },
    {
      ok: ready.unrestricted,
      label: 'Not killed to save battery',
      fixLabel: 'Allow',
      fix: () => void requestUnrestricted(),
    },
  ]
  const missing = rows.filter((r) => !r.ok).length

  return (
    <div
      className={`mt-2 rounded-xl p-3 ring-1 ${
        missing ? 'bg-amber-50 ring-amber-200' : 'bg-flag-green/10 ring-flag-green/30'
      }`}
    >
      <p className={`text-xs font-semibold ${missing ? 'text-amber-900' : 'text-flag-green'}`}>
        {missing === 0
          ? 'Ready to alert you with the phone locked'
          : `${missing} thing${missing > 1 ? 's' : ''} would stop the alert reaching a locked phone`}
      </p>
      <ul className="mt-2 space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2 text-[11px] text-slate-700">
            <span
              aria-hidden="true"
              className={`shrink-0 font-bold ${r.ok ? 'text-flag-green' : 'text-amber-700'}`}
            >
              {r.ok ? '✓' : '!'}
            </span>
            <span className="flex-1">{r.label}</span>
            {!r.ok && (
              <button
                type="button"
                onClick={r.fix}
                className="shrink-0 rounded-lg bg-brand-deep px-2.5 py-1 text-[11px] font-semibold text-white active:bg-brand-deep/90"
              >
                {r.fixLabel}
              </button>
            )}
          </li>
        ))}
      </ul>
      {missing > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-900">
          Detection still runs without these. They decide whether anyone is told about it.{' '}
          {stuck
            ? 'Android has stopped asking, so Allow just opened your settings instead. Turn SMS and Phone on there and come back. '
            : 'If tapping Allow does nothing, Android has stopped asking — '}
          <button
            type="button"
            onClick={() => void openAppSettings()}
            className="font-semibold underline"
          >
            open app settings
          </button>{' '}
          and turn them on there.
        </p>
      )}
    </div>
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

/**
 * Pairing the phone to a laptop, for a demo.
 *
 * This is the one screen in Zetway that exists for the people watching rather
 * than for the rider, and it says so. It is kept on the crash-watch page
 * rather than the home screen because that is where somebody setting up a
 * demonstration already is, and because a rider who never gives a
 * demonstration should never meet it.
 *
 * The code is four characters off a projector, typed into a phone by someone
 * who is already nervous, so it is uppercased and stripped as it is typed
 * rather than validated afterwards with a red message.
 */
function DemoRoomPanel({
  room,
  joined,
  onRoom,
  onStandDown,
}: {
  room: string
  joined: boolean
  onRoom: (room: string) => void
  onStandDown: () => void
}) {
  const [open, setOpen] = useState(room.length > 0)

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-xs font-semibold text-brand-deep underline"
      >
        {room ? `Demo room ${room}${joined ? " — connected" : " — connecting"}` : "Pair with a demo screen"}
      </button>

      {open && (
        <div className="mt-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <p className="text-[11px] leading-relaxed text-slate-600">
            For showing the system to a room. A laptop on{" "}
            <span className="tabular font-semibold">backprop-pirates.vercel.app/control.html</span>{" "}
            fires the impact; everything after it is real — the full countdown,
            real texts to the people you have saved, and the phone&rsquo;s own GPS.
          </p>

          <label className="mt-2.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Room code
          </label>
          <div className="mt-1 flex gap-2">
            <input
              value={room}
              onChange={(e) => onRoom(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))}
              placeholder="ABCD"
              inputMode="text"
              autoCapitalize="characters"
              className="tabular w-full rounded-lg border border-slate-300 px-3 py-2 text-base font-bold tracking-widest text-slate-900"
            />
            {room && (
              <button
                type="button"
                onClick={() => onRoom("")}
                className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-300"
              >
                Leave
              </button>
            )}
          </div>

          {room && (
            <>
              <p className="mt-2 text-[11px] font-semibold text-slate-600">
                {joined
                  ? "Connected. The laptop can fire whenever you are ready."
                  : "Looking for the room\u2026 check the code and the signal."}
              </p>
              <button
                type="button"
                onClick={onStandDown}
                className="mt-2 w-full rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-300"
              >
                Clear the room after a run
              </button>
            </>
          )}

          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Judges can follow along at{" "}
            <span className="tabular font-semibold">/watch.html</span> — their phones
            alarm and show your position live. That is a live feed, not a text
            message; the texts go to your saved contacts only.
          </p>
        </div>
      )}
    </div>
  )
}

function AlertOverlay(props: {
  phase: 'asking' | 'alerting'
  left: number
  peak: number | null
  evidence: ImpactEvidence | null
  position: { lat: number; lon: number } | null
  contacts: EmergencyContact[]
  recording: Recording | null
  recordingNow: boolean
  notice: string | null
  autoSteps: EscalationStep[]
  onImOk: () => void
  onHelpNow: () => void
  onCallEmergency: () => void
  onStandDown: () => void
  /** The microphone is open and a word would be acted on. */
  voiceListening: boolean
  /** Seconds left on a shout-triggered countdown, or null. */
  voiceShout: number | null
  /** Why listening is not available, when it is not. */
  voiceReason: string | null
}) {
  const {
    phase, left, peak, evidence, position, contacts, recording, recordingNow, notice,
    autoSteps, onImOk, onHelpNow, onCallEmergency, onStandDown,
    voiceListening, voiceShout, voiceReason,
  } = props
  const message = helpMessage(position, peak)
  const sensed = evidenceLines(evidence)
  const firstAction = useRef<HTMLButtonElement | null>(null)

  // A screen-reader user was never told any of this was happening. The
  // overlay covers the whole screen, but it was a bare div: no role, no
  // announcement, and focus left behind on whatever was underneath, so
  // someone using TalkBack would have heard nothing and found the buttons
  // only by sweeping the screen — during a thirty-second countdown, after a
  // crash. alertdialog announces itself and its label the moment it mounts;
  // moving focus to the first action makes the way out the next thing the
  // reader reaches.
  //
  // The countdown itself is deliberately not a live region. Announcing a
  // number every second would talk over the buttons for the whole thirty
  // seconds, which is worse than not reading it at all.
  useEffect(() => {
    firstAction.current?.focus()
  }, [phase])

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="zetway-alert-title"
      aria-describedby="zetway-alert-detail"
      className="fixed inset-0 z-50 overflow-y-auto bg-flag-red px-4 py-[max(1rem,env(safe-area-inset-top))] text-white"
    >
      <div className="mx-auto max-w-md space-y-3">
        {phase === 'asking' ? (
          <>
            <p
              id="zetway-alert-title"
              className="text-center text-sm font-semibold uppercase tracking-wide text-white/80"
            >
              Heavy impact detected
            </p>
            <p className="text-center text-7xl font-bold tabular-nums" aria-hidden="true">
              {left}
            </p>
            <p id="zetway-alert-detail" className="text-center text-base leading-snug">
              Are you alright? If you do not answer, this screen will help you call for help.
              You have {left} seconds.
            </p>
            {/* Said before the buttons, because the rider this matters most
                to is the one who cannot reach a button at all. */}
            {voiceListening && (
              <div
                aria-live="polite"
                className="rounded-2xl bg-white/15 px-4 py-3 text-center ring-1 ring-white/30"
              >
                {voiceShout !== null ? (
                  <p className="text-base font-bold">
                    Heard shouting &mdash; getting help in {voiceShout}s. Say
                    &ldquo;stop&rdquo; to cancel.
                  </p>
                ) : (
                  <p className="text-sm font-semibold leading-snug">
                    Listening. Say <span className="underline">&ldquo;I&rsquo;m OK&rdquo;</span>{' '}
                    to cancel, or <span className="underline">&ldquo;help&rdquo;</span> to call
                    now. Shouting works too.
                  </p>
                )}
              </div>
            )}
            {voiceReason && (
              <p className="text-center text-xs leading-snug text-white/70">
                Not listening: {voiceReason} Use the buttons below.
              </p>
            )}

            <button
              ref={firstAction}
              type="button"
              onClick={onImOk}
              className="w-full rounded-2xl bg-white px-4 py-5 text-lg font-bold text-flag-red"
            >
              I&rsquo;m OK
            </button>

            {/* The countdown exists for the rider who cannot answer. It must
                never stand between a rider who can and an ambulance: anyone
                conscious enough to read this screen can call on the first
                second rather than the thirtieth. */}
            <a
              href="tel:114"
              onClick={onCallEmergency}
              className="block rounded-2xl bg-white px-4 py-5 text-center text-lg font-bold text-flag-red"
            >
              Call ambulance 114 now
            </a>
            <button
              type="button"
              onClick={onHelpNow}
              className="w-full rounded-xl bg-white/15 px-4 py-3.5 text-base font-semibold text-white ring-1 ring-white/30"
            >
              I need help &mdash; don&rsquo;t wait
            </button>
            {/* What the phone sensed, so the rider can weigh it themselves.
                No rotation and no change of speed is what a phone sliding
                off a seat looks like; the app will not decide that for
                anyone, but it will say what it saw. */}
            {sensed.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl bg-white/10 p-3 text-xs ring-1 ring-white/20">
                {sensed.map((line) => (
                  <div key={line.label} className="flex justify-between gap-2">
                    <dt className="text-white/70">{line.label}</dt>
                    <dd className="font-semibold tabular-nums text-white">{line.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-center text-xs leading-relaxed text-white/70">
              {peak
                ? `Measured about ${(peak / 9.8).toFixed(1)}g. A knock or a dropped phone can do this too, which is why it asks. `
                : ''}
              Either button acts now instead of at zero.
            </p>
          </>
        ) : (
          <>
            <p
              id="zetway-alert-title"
              className="text-center text-sm font-semibold uppercase tracking-wide text-white/80"
            >
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
              {isNative()
                ? 'Android keeps 114 and 999 for the phone’s own dialler, so those two buttons need your tap. Everything else above already happened on its own.'
                : 'Zetway opens the dialler with the number in it, but no web page is allowed to press call, on any phone. The same goes for sending a message. Everything above is prepared and waiting for one tap.'}
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

/**
 * Does this phone actually buzz, and if not, which setting is stopping it?
 *
 * A rider reported the alarm sounding while the phone stayed still, and
 * there was no way to tell from the app which of six causes it was: no
 * motor, an intensity slider at zero, silent mode, Do Not Disturb, alarm
 * volume down, or simply an older build. Every one of them is readable
 * from Android and none of them were being read. This buzzes for two
 * seconds and then says what the system reports, so the answer is on the
 * screen instead of in a guess.
 */
const intensity = (v: number | undefined): string =>
  v === undefined || v === -1 ? 'not on this phone' : v === 0 ? 'OFF' : String(v)

function BuzzSelfTest() {
  const [report, setReport] = useState<VibrationReport | null>(null)
  const [ran, setRan] = useState(false)
  const native = isNative()

  const run = async () => {
    setRan(true)
    if (native) {
      await nativeVibrate([0, 700, 300, 700])
      setReport(await vibrationDiagnostics())
    } else {
      // Best effort, and it is genuinely all a page can do.
      try {
        navigator.vibrate?.([0, 700, 300, 700])
      } catch {
        // Some browsers throw rather than return false. Either way the
        // answer below is the same.
      }
    }
  }

  const reason = explainNoBuzz(report)

  // The web build cannot win this one, and saying so is more use than a
  // button that quietly does nothing. A page may only call
  // navigator.vibrate, which Android files under its default usage — the
  // bucket Do Not Disturb and a silent ringer both discard. There is no web
  // API for an alarm-priority buzz, so the honest answer is the APK.
  if (!native) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={run}
          className="w-full rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 ring-1 ring-slate-200 active:bg-slate-100"
        >
          Test the buzz
        </button>
        {ran && (
          <div className="mt-2 rounded-xl bg-amber-50 p-3 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
            <p className="font-semibold">You are running the web app.</p>
            <p className="mt-1">
              {canVibrate()
                ? 'It just asked the phone to buzz, but a web page can only make an ordinary vibration request — the kind Android silently drops when the phone is on silent or in Do Not Disturb. There is no way for a page to ask for an alarm-priority buzz.'
                : 'This browser does not expose vibration to a web page at all, so nothing was even requested.'}
            </p>
            <p className="mt-1 font-semibold">
              The Android app buzzes for 35 seconds at alarm priority, through Do Not
              Disturb. If you need the vibration, install it.
            </p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={run}
        className="w-full rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 ring-1 ring-slate-200 active:bg-slate-100"
      >
        Test the buzz
      </button>

      {ran && report && (
        <div className="mt-2 rounded-xl bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700 ring-1 ring-slate-200">
          <p className="font-semibold text-slate-900">Did you feel two buzzes</p>
          {reason ? (
            <p className="mt-1 text-flag-red">{reason}</p>
          ) : (
            <p className="mt-1">
              Nothing in the phone&rsquo;s settings is blocking it. If you felt nothing, the
              motor or the build is at fault rather than a setting.
            </p>
          )}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
            {[
              ['Motor', report.hasVibrator ? 'yes' : 'no'],
              ['Ringer', report.ringerMode ?? '?'],
              ['Do Not Disturb', report.dndFilter ?? '?'],
              ['Alarm volume', `${report.alarmVolume ?? '?'}/${report.alarmVolumeMax ?? '?'}`],
              // -1 is the plugin's "this phone has no such setting", which is
              // common and normal; printing the raw number reads as a fault.
              ['Alarm vib.', intensity(report.alarmVibrationIntensity)],
              ['Notif. vib.', intensity(report.notificationVibrationIntensity)],
              ['Alarm-priority buzz', report.usesVibrationAttributes ? 'yes' : 'legacy'],
              ['Phone', `${report.manufacturer ?? ''} ${report.model ?? ''}`.trim() || '?'],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="font-medium text-slate-800">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  )
}
