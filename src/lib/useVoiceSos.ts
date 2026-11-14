import { useCallback, useEffect, useRef, useState } from 'react'

import {
  nativeSpeak,
  nativeStartListening,
  nativeStopListening,
  nativeStopSpeaking,
  nativeVoiceStatus,
  onHearConfig,
  onHearLevel,
  onHearStopped,
  onHearWordsLost,
  onHeard,
  type VoiceStatus,
} from './nativeCrash'
import { hearSos, matchedWord, ShoutDetector } from './sosVoice'
import {
  activeMargin, DEFAULT_MARGIN, high, marginFrom, median, readCalibration,
  writeCalibration, type Calibration,
} from './shoutCalibration'

/**
 * Hands-free help, as one piece of state two screens can share.
 *
 * The standalone screen arms this before a ride. The crash overlay arms it the
 * instant an impact is detected, which is the case it was built for: a rider
 * under the machine, phone in the gravel, thirty seconds on a countdown they
 * cannot see and cannot cancel. Both want identical behaviour, and behaviour
 * this consequential should not exist twice.
 *
 * THE PHONE MUST NOT HEAR ITSELF. This is the trap that very nearly shipped.
 * The countdown is spoken aloud — "I heard you. Getting help in ten seconds.
 * Say stop to cancel." — through a speaker, into a microphone this same hook
 * is holding open. The recogniser dutifully returned "say stop to cancel",
 * the matcher saw a cancel word, and the alarm stood itself down about a
 * second after raising itself. Every spoken line now opens a deaf window for
 * roughly as long as it takes to say, nothing heard inside it is acted on,
 * and no spoken line contains a trigger word any more either — two
 * independent guards, because one of them is a timer and timers are wrong.
 */

/** Seconds between hearing something and acting on it. */
const WORD_COUNTDOWN = 10
/** Longer, because loudness alone is the weaker evidence of the two. */
const SHOUT_COUNTDOWN = 15

/** Roughly how long a line takes to say, so the microphone can be ignored
 *  for exactly that long. Deliberately generous: being deaf half a second
 *  too long costs nothing, while being deaf half a second too short is the
 *  bug this exists to prevent. */
function speakingMs(text: string): number {
  return Math.min(9000, 700 + text.length * 75)
}

/** Android hands up every candidate the recogniser produced, so one cry can
 *  yield "help me" and something quite different a few hundred milliseconds
 *  apart. Once a verdict has been acted on, the rest of that utterance is
 *  ignored — otherwise the second alternative stands down what the first
 *  one raised. */
const VERDICT_LOCK_MS = 2000

export type VoicePhase = 'off' | 'armed' | 'counting' | 'firing' | 'degraded'

export type VoiceSos = {
  phase: VoicePhase
  reason: string | null
  secondsLeft: number | null
  trigger: 'word' | 'shout' | null
  heardWord: string | null
  transcript: string[]
  level: number
  quiet: number | null
  peakOver: number
  margin: number
  status: VoiceStatus | null
  language: string | null
  offline: boolean
  words: boolean
  /** True while the app's own voice is talking and the microphone is being
   *  deliberately ignored. On screen, so a deaf moment is explained. */
  deaf: boolean
  /** Which half of the measurement is running, or null. */
  calibrating: 'quiet' | 'shout' | null
  /** What this phone measured last time, if ever. */
  calibration: Calibration | null
  /** Measure the room and the rider's shout, and set the threshold from
   *  them. Needs to be listening already. */
  calibrate: () => Promise<void>
  arm: () => Promise<void>
  disarm: () => Promise<void>
  cancel: () => void
  /** Go deaf for a moment. For a caller that does its own talking: the
   *  crash overlay speaks through this phone's speaker into this hook's open
   *  microphone, and without telling the hook to stop listening first, the
   *  app hears its own prompt and acts on it. */
  muteFor: (ms: number) => void
}

export function useVoiceSos(options: {
  onFire: () => void
  /** Run when a cancel word is heard. The standalone screen only needs to
   *  stop its own countdown; the crash overlay has a whole alert to stand
   *  down, and that is its business rather than this hook's. */
  onCancel?: () => void
  /** Spoken aloud. Off for the crash overlay, which does its own talking. */
  speak?: boolean
  /** Act the instant a distress word is heard, with no countdown of this
   *  hook's own, because the crash overlay already has thirty seconds
   *  running above it. Shouting still gets a countdown even here, because
   *  shouting is the trigger a horn can fake. */
  immediate?: boolean
}): VoiceSos {
  const { onFire, onCancel, speak = true, immediate = false } = options

  const [phase, setPhase] = useState<VoicePhase>('off')
  const [reason, setReason] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [trigger, setTrigger] = useState<'word' | 'shout' | null>(null)
  const [heardWord, setHeardWord] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<string[]>([])
  const [level, setLevel] = useState(0)
  const [quiet, setQuiet] = useState<number | null>(null)
  const [peakOver, setPeakOver] = useState(0)
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [words, setWords] = useState(true)
  const [deaf, setDeaf] = useState(false)
  const [calibrating, setCalibrating] = useState<'quiet' | 'shout' | null>(null)
  const [calibration, setCalibration] = useState<Calibration | null>(() =>
    readCalibration(),
  )

  const detector = useRef(new ShoutDetector(activeMargin()))
  /** While a measurement is running, readings go here instead of to the
   *  detector, so calibrating cannot set its own alarm off. */
  const sampling = useRef<number[] | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const phaseRef = useRef<VoicePhase>('off')
  const onFireRef = useRef(onFire)
  const onCancelRef = useRef(onCancel)
  /** Nothing heard before this moment is acted on. */
  const muteUntil = useRef(0)
  /** When a verdict was last acted on. */
  const lastVerdictAt = useRef(0)

  useEffect(() => {
    onFireRef.current = onFire
    onCancelRef.current = onCancel
  }, [onFire, onCancel])

  const setPhaseBoth = useCallback((p: VoicePhase) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  /** Say something, and go deaf for as long as it takes to say it. */
  const say = useCallback(
    (text: string) => {
      if (!speak) return
      const ms = speakingMs(text)
      muteUntil.current = Date.now() + ms
      setDeaf(true)
      window.setTimeout(() => {
        if (Date.now() >= muteUntil.current) setDeaf(false)
      }, ms)
      void nativeSpeak(text)
    },
    [speak],
  )

  const muteFor = useCallback((ms: number) => {
    muteUntil.current = Math.max(muteUntil.current, Date.now() + ms)
    setDeaf(true)
    window.setTimeout(() => {
      if (Date.now() >= muteUntil.current) setDeaf(false)
    }, ms)
  }, [])

  const cancel = useCallback(() => {
    clearTimer()
    setSecondsLeft(null)
    setTrigger(null)
    setHeardWord(null)
    void nativeStopSpeaking()
    if (phaseRef.current === 'counting') {
      say('Called off. Still listening.')
      setPhaseBoth('armed')
    }
    // Called even when nothing was counting, because the crash overlay has
    // its own thirty seconds running above this hook, and a rider saying
    // they are all right must stand that down too.
    onCancelRef.current?.()
  }, [clearTimer, say, setPhaseBoth])

  const begin = useCallback(
    (kind: 'word' | 'shout', word: string | null) => {
      if (phaseRef.current !== 'armed') return

      lastVerdictAt.current = Date.now()

      if (immediate && kind === 'word') {
        setTrigger(kind)
        setHeardWord(word)
        setPhaseBoth('firing')
        onFireRef.current()
        return
      }

      const total = kind === 'word' ? WORD_COUNTDOWN : SHOUT_COUNTDOWN
      setTrigger(kind)
      setHeardWord(word)
      setSecondsLeft(total)
      setPhaseBoth('counting')

      // Not one trigger word in either line. The deaf window should cover
      // them regardless, but a prompt that could not cancel the alert even
      // if it were heard is one less thing resting on a timer being right.
      say(
        kind === 'word'
          ? `I heard you. Getting help in ${total} seconds. Say the word fine to call it off.`
          : `I heard shouting. Getting help in ${total} seconds. Say the word fine to call it off.`,
      )

      clearTimer()
      timer.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s === null) return null
          const next = s - 1
          if (next <= 0) {
            clearTimer()
            setPhaseBoth('firing')
            say('Getting help now.')
            onFireRef.current()
            // Keep listening afterwards. Sticking in 'firing' left the
            // microphone open while the screen offered to start it, and
            // meant a second emergency in the same session was unhearable.
            window.setTimeout(() => {
              if (phaseRef.current === 'firing') setPhaseBoth('armed')
            }, 4000)
            return 0
          }
          if (next <= 3) say(String(next))
          return next
        })
      }, 1000)
    },
    [clearTimer, immediate, say, setPhaseBoth],
  )

  useEffect(() => {
    let alive = true
    const unsubs: (() => void)[] = []

    void (async () => {
      const offHeard = await onHeard(({ text }) => {
        if (!alive) return
        setTranscript((t) => [text, ...t].slice(0, 4))

        // The phone's own voice, arriving back through its own microphone.
        if (Date.now() < muteUntil.current) return
        // A later alternative of an utterance already acted on.
        if (Date.now() - lastVerdictAt.current < VERDICT_LOCK_MS) return

        const verdict = hearSos(text)
        if (verdict === 'cancel') {
          lastVerdictAt.current = Date.now()
          cancel()
          return
        }
        if (verdict === 'distress') {
          begin('word', matchedWord(text) ?? text)
        }
      })

      const offLevel = await onHearLevel((l) => {
        if (!alive) return
        setLevel(l)
        // The app's own speech is loud and would otherwise read as a shout.
        if (Date.now() < muteUntil.current) return
        if (sampling.current) {
          sampling.current.push(l)
          return
        }
        const fired = detector.current.push(l, Date.now())
        setQuiet(detector.current.quietLevel)
        setPeakOver(detector.current.peakOver)
        if (fired) begin('shout', null)
      })

      const offConfig = await onHearConfig(({ language: lang, onDevice }) => {
        if (!alive) return
        setLanguage(lang)
        setOffline(onDevice)
        // The two level sources are not the same scale, so a baseline learnt
        // from one is nonsense against the other. Start again.
        detector.current = new ShoutDetector(activeMargin())
        setPeakOver(0)
        setQuiet(null)
      })

      const offWordsLost = await onHearWordsLost((r) => {
        if (!alive) return
        setWords(false)
        setReason(r)
        // Still armed, deliberately: the microphone is open and a shout will
        // still be heard. Only the words are gone.
      })

      const offStopped = await onHearStopped((r) => {
        if (!alive) return
        // A countdown must not outlive the thing that was listening to it.
        clearTimer()
        setSecondsLeft(null)
        setTrigger(null)
        setReason(r)
        setPhaseBoth('degraded')
      })

      if (!alive) {
        offHeard()
        offLevel()
        offConfig()
        offWordsLost()
        offStopped()
        return
      }
      unsubs.push(offHeard, offLevel, offConfig, offWordsLost, offStopped)
    })()

    return () => {
      alive = false
      unsubs.forEach((u) => u())
    }
  }, [begin, cancel, clearTimer, setPhaseBoth])

  /**
   * Three seconds of the room, three seconds of shouting, and the difference
   * is the threshold. Measured rather than assumed, because the assumption
   * was a single number applied to two audio sources that report on
   * different scales, on hardware nobody had ever tested it against.
   */
  const calibrate = useCallback(async () => {
    if (phaseRef.current !== 'armed') return

    const listen = (ms: number) =>
      new Promise<number[]>((resolve) => {
        sampling.current = []
        window.setTimeout(() => {
          const got = sampling.current ?? []
          sampling.current = null
          resolve(got)
        }, ms)
      })

    const afterSpeaking = () =>
      new Promise<void>((resolve) =>
        window.setTimeout(resolve, Math.max(0, muteUntil.current - Date.now()) + 150),
      )

    setCalibrating('quiet')
    say('Stay quiet for three seconds.')
    await afterSpeaking()
    const quietSamples = await listen(3000)

    setCalibrating('shout')
    say('Now shout, until I stop you.')
    await afterSpeaking()
    const shoutSamples = await listen(3000)

    setCalibrating(null)

    // Too few readings means the microphone was not delivering; saying so
    // beats storing a threshold derived from nothing.
    if (quietSamples.length < 5 || shoutSamples.length < 5) {
      setReason('Could not measure — the microphone sent almost no readings.')
      say('I could not measure that. Try again.')
      return
    }

    const quiet = median(quietSamples)
    const shout = high(shoutSamples)
    const next: Calibration = {
      quiet,
      gap: Math.max(0, shout - quiet),
      margin: marginFrom(quiet, shout),
      at: new Date().toISOString(),
    }
    writeCalibration(next)
    setCalibration(next)
    detector.current = new ShoutDetector(next.margin)
    setPeakOver(0)
    setQuiet(null)
    say('Got it. Your shout is set.')
  }, [say])

  const arm = useCallback(async () => {
    // A countdown left running from a previous session would fire into a
    // screen that no longer shows it and offers no way to stop it.
    clearTimer()
    setSecondsLeft(null)
    setTrigger(null)
    setHeardWord(null)

    setStatus(await nativeVoiceStatus())
    // Rebuilt rather than reset, so a measurement taken since last time is
    // picked up without needing a reload.
    detector.current = new ShoutDetector(activeMargin())
    setCalibration(readCalibration())
    setPeakOver(0)
    setTranscript([])
    setReason(null)
    setWords(true)

    const started = await nativeStartListening()
    if (!started.ok) {
      setReason(started.message ?? 'This phone would not start listening.')
      setPhaseBoth('degraded')
      return
    }
    setPhaseBoth('armed')
    setStatus(await nativeVoiceStatus())
    say('Listening.')
  }, [clearTimer, say, setPhaseBoth])

  const disarm = useCallback(async () => {
    clearTimer()
    setSecondsLeft(null)
    setTrigger(null)
    setLevel(0)
    setQuiet(null)
    detector.current.reset()
    setPeakOver(0)
    await nativeStopListening()
    void nativeStopSpeaking()
    setPhaseBoth('off')
    setStatus(await nativeVoiceStatus())
  }, [clearTimer, setPhaseBoth])

  useEffect(() => {
    void nativeVoiceStatus().then(setStatus)
  }, [])

  // Leaving the screen must not leave the microphone open.
  useEffect(() => {
    return () => {
      clearTimer()
      void nativeStopListening()
    }
  }, [clearTimer])

  return {
    phase,
    reason,
    secondsLeft,
    trigger,
    heardWord,
    transcript,
    level,
    quiet,
    peakOver,
    // From state, not from the detector's ref. Reading a ref during render
    // means the screen keeps showing the old threshold after a measurement
    // until something else happens to re-render it.
    margin: calibration?.margin ?? DEFAULT_MARGIN,
    status,
    language,
    offline,
    words,
    deaf,
    calibrating,
    calibration,
    calibrate,
    arm,
    disarm,
    cancel,
    muteFor,
  }
}
