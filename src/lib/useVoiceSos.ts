import { useCallback, useEffect, useRef, useState } from 'react'

import {
  nativeSpeak,
  nativeStartListening,
  nativeStopListening,
  nativeStopSpeaking,
  nativeVoiceStatus,
  onHearConfig,
  onHearLevel,
  onHearWordsLost,
  onHearStopped,
  onHeard,
  type VoiceStatus,
} from './nativeCrash'
import { hearSos, matchedWord, ShoutDetector } from './sosVoice'

/**
 * Hands-free help, as one piece of state two screens can share.
 *
 * The standalone screen arms this before a ride. The crash overlay arms it the
 * instant an impact is detected, which is the case it was built for: a rider
 * under the machine, phone in the gravel, thirty seconds on a countdown they
 * cannot see and cannot cancel. Both want identical behaviour, and behaviour
 * this consequential should not exist twice.
 *
 * The countdown is the safety valve. Nothing here dials anything on hearing a
 * noise; a trigger starts a spoken countdown that any cancel word stops. The
 * shout trigger gets longer than the word trigger because it is the one that
 * can be set off by a lorry's horn, and a wrong ambulance is a real crew taken
 * away from a real emergency.
 */

/** Seconds between hearing something and acting on it. */
const WORD_COUNTDOWN = 10
/** Longer, because loudness alone is the weaker evidence of the two. */
const SHOUT_COUNTDOWN = 15

export type VoicePhase =
  /** Switched off. */
  | 'off'
  /** Listening, nothing heard. */
  | 'armed'
  /** Something heard; counting down, cancellable. */
  | 'counting'
  /** Countdown finished; the caller is escalating. */
  | 'firing'
  /** Cannot listen on this phone, with a reason. */
  | 'degraded'

export type VoiceSos = {
  phase: VoicePhase
  /** Why it stopped, when degraded. */
  reason: string | null
  /** Seconds left on the countdown, or null. */
  secondsLeft: number | null
  /** What set the countdown off, for the screen to show. */
  trigger: 'word' | 'shout' | null
  /** The exact words that matched, when it was a word. */
  heardWord: string | null
  /** The last few things the recogniser thought it heard. */
  transcript: string[]
  /** Live loudness 0–10, and the background it is being judged against. */
  level: number
  quiet: number | null
  /** What this phone can actually do, asked of the OS rather than assumed. */
  status: VoiceStatus | null
  /** The language listening actually settled on, which may not be the one
   *  asked for. Null until a session has opened. */
  language: string | null
  /** Whether that session runs on the phone, so it works with no signal. */
  offline: boolean
  /** False when only the shout trigger is left. The screen stops inviting
   *  the rider to say a word that nothing is listening for. */
  words: boolean
  arm: () => Promise<void>
  disarm: () => Promise<void>
  /** Stop a running countdown — the on-screen equivalent of saying "stop". */
  cancel: () => void
}

export function useVoiceSos(options: {
  /** Run when a countdown completes. This is where calls and texts happen;
   *  the hook deliberately knows nothing about them. */
  onFire: () => void
  /** Run when a cancel word is heard. The standalone screen only needs to
   *  stop its own countdown, but the crash overlay has a whole alert to
   *  stand down, and that is its business rather than this hook's. */
  onCancel?: () => void
  /** Spoken aloud. Off for the crash overlay, which does its own talking and
   *  must not have two voices counting different numbers at once. */
  speak?: boolean
  /** Act the instant a distress word is heard, with no countdown of this
   *  hook's own. Set by the crash overlay, where a thirty-second countdown is
   *  already running: a rider who manages to say "help" through it has given
   *  the clearest answer there is, and making them wait out a second,
   *  nested countdown would be absurd. Shouting still gets a countdown even
   *  here, because shouting is the trigger a horn can fake. */
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
  const [status, setStatus] = useState<VoiceStatus | null>(null)
  const [language, setLanguage] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [words, setWords] = useState(true)

  const detector = useRef(new ShoutDetector())
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  // Phase is read inside listener callbacks that were registered once, so it
  // has to live somewhere those callbacks can see the current value.
  const phaseRef = useRef<VoicePhase>('off')
  const onFireRef = useRef(onFire)
  const onCancelRef = useRef(onCancel)

  useEffect(() => {
    onFireRef.current = onFire
    onCancelRef.current = onCancel
  }, [onFire, onCancel])

  const setPhaseBoth = useCallback((p: VoicePhase) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  const say = useCallback(
    (text: string) => {
      if (speak) void nativeSpeak(text)
    },
    [speak],
  )

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const cancel = useCallback(() => {
    clearTimer()
    setSecondsLeft(null)
    setTrigger(null)
    setHeardWord(null)
    void nativeStopSpeaking()
    if (phaseRef.current === 'counting') {
      say('Cancelled. Still listening.')
      setPhaseBoth('armed')
    }
    onCancelRef.current?.()
  }, [clearTimer, say, setPhaseBoth])

  const begin = useCallback(
    (kind: 'word' | 'shout', word: string | null) => {
      // A countdown already running is not restarted by more of the same.
      // Someone shouting repeatedly should not keep pushing their own rescue
      // further away.
      if (phaseRef.current !== 'armed') return

      // No countdown of our own where one is already running above us.
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

      say(
        kind === 'word'
          ? `I heard you. Getting help in ${total} seconds. Say stop to cancel.`
          : `I heard shouting. Getting help in ${total} seconds. Say stop to cancel.`,
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
            return 0
          }
          // Counted aloud near the end only. A voice reciting fifteen numbers
          // is a voice the rider cannot talk over to cancel.
          if (next <= 3) say(String(next))
          return next
        })
      }, 1000)
    },
    [clearTimer, immediate, say, setPhaseBoth],
  )

  // One set of listeners for the life of the component. They are registered
  // whether or not listening is on, because arming and disarming the
  // microphone is a native concern and re-subscribing on every toggle loses
  // events in the gap.
  useEffect(() => {
    let alive = true
    const unsubs: (() => void)[] = []

    void (async () => {
      const offHeard = await onHeard(({ text, partial }) => {
        if (!alive) return
        setTranscript((t) => [text, ...t].slice(0, 4))

        const verdict = hearSos(text)
        if (verdict === 'cancel') {
          cancel()
          return
        }
        if (verdict === 'distress') {
          // Partial results are acted on. Waiting for a final result means
          // waiting for a pause, and someone in pain may not make one.
          begin('word', matchedWord(text) ?? text)
        }
        void partial
      })

      const offLevel = await onHearLevel((l) => {
        if (!alive) return
        setLevel(l)
        const fired = detector.current.push(l, Date.now())
        setQuiet(detector.current.quietLevel)
        if (fired) begin('shout', null)
      })

      const offConfig = await onHearConfig(({ language: lang, onDevice }) => {
        if (!alive) return
        setLanguage(lang)
        setOffline(onDevice)
      })

      const offWordsLost = await onHearWordsLost((r) => {
        if (!alive) return
        setWords(false)
        setReason(r)
        // Still armed, deliberately. The microphone is open and a shout will
        // still be heard; only the words are gone.
      })

      const offStopped = await onHearStopped((r) => {
        if (!alive) return
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
  }, [begin, cancel, setPhaseBoth])

  const arm = useCallback(async () => {
    const before = await nativeVoiceStatus()
    setStatus(before)
    detector.current.reset()
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
    say('Listening. Shout, or say help.')
  }, [say, setPhaseBoth])

  const disarm = useCallback(async () => {
    clearTimer()
    setSecondsLeft(null)
    setTrigger(null)
    setLevel(0)
    setQuiet(null)
    detector.current.reset()
    await nativeStopListening()
    void nativeStopSpeaking()
    setPhaseBoth('off')
    setStatus(await nativeVoiceStatus())
  }, [clearTimer, setPhaseBoth])

  // Read what the phone can do once, so a screen can say so before the rider
  // has turned anything on.
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
    status,
    language,
    offline,
    words,
    arm,
    disarm,
    cancel,
  }
}
