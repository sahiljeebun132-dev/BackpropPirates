/**
 * Hands-free help in a browser.
 *
 * The native build does this through Android's own recogniser and a raw
 * AudioRecord. None of that exists on the web, so the whole feature was
 * simply missing from the PWA — the screen said "only in the Android app"
 * and stopped. For the half of the world on an iPhone that is the entire
 * feature gone, and the shout trigger is exactly the part they could have
 * had.
 *
 * Because the loudness half needs nothing clever. getUserMedia and an
 * AnalyserNode are in every browser worth naming, Safari included, and the
 * arithmetic is the same arithmetic: root mean square over a frame, mapped
 * to the scale the detector already expects. That gives an iPhone the
 * trigger that matters most — shout and the phone acts — with no model, no
 * language and no network.
 *
 * The words half is best-effort. webkitSpeechRecognition exists in Chrome
 * and in the Android WebView; Safari has it behind a prefix on recent
 * versions and not at all before that. Where it is absent the screen says
 * so and the shout trigger carries on alone, which is the same honest
 * degradation the native side already does when a language pack is missing.
 *
 * What a browser cannot do, and this does not pretend otherwise: run with
 * the screen off, run in the background, or survive the tab being closed.
 * The PWA listens while it is open and in front of you. That is a smaller
 * promise than the app makes, and it is kept.
 */

type Handlers = {
  onHeard: (text: string, partial: boolean) => void
  onLevel: (level: number) => void
  onConfig: (language: string, onDevice: boolean) => void
  onWordsLost: (reason: string) => void
  onFailed: (reason: string) => void
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: unknown) => void) | null
  onerror: ((e: unknown) => void) | null
  onend: (() => void) | null
}

type WindowWithSpeech = Window & {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitAudioContext?: typeof AudioContext
}

let stream: MediaStream | null = null
let ctx: AudioContext | null = null
let raf: number | null = null
let recog: SpeechRecognitionLike | null = null
let running = false

export function webRecognitionAvailable(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as WindowWithSpeech
  return typeof (w.SpeechRecognition ?? w.webkitSpeechRecognition) === 'function'
}

export function webMicAvailable(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'
  )
}

/** Raw amplitude to the 0–10 scale the shout detector was tuned against.
 *  Matches ShoutWatch.toLevel on the native side: four decibels to the
 *  unit, zeroed around -40 dBFS. */
function toLevel(rms: number): number {
  if (rms <= 0.00003) return 0
  const dbfs = 20 * Math.log10(rms)
  const level = (dbfs + 40) / 4
  return Math.max(0, Math.min(10, level))
}

export async function startWebVoice(h: Handlers): Promise<boolean> {
  if (running) return true
  if (!webMicAvailable()) {
    h.onFailed('This browser will not give a page the microphone.')
    return false
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  } catch {
    h.onFailed('Microphone permission was refused.')
    return false
  }

  const w = window as WindowWithSpeech
  try {
    const Ctor = window.AudioContext ?? w.webkitAudioContext
    if (!Ctor) throw new Error('no AudioContext')
    ctx = new Ctor()
    if (ctx.state === 'suspended') await ctx.resume()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    source.connect(analyser)

    const buf = new Float32Array(analyser.fftSize)
    let last = 0
    const tick = () => {
      if (!running) return
      raf = requestAnimationFrame(tick)
      const now = Date.now()
      // Ten a second, to match what the native side reports and what the
      // detector's timings were measured against.
      if (now - last < 100) return
      last = now
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      h.onLevel(toLevel(Math.sqrt(sum / buf.length)))
    }
    running = true
    raf = requestAnimationFrame(tick)
  } catch {
    stopWebVoice()
    h.onFailed('This browser would not open an audio context.')
    return false
  }

  // Words, where the browser has them.
  const RecogCtor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!RecogCtor) {
    h.onConfig('shout-only', true)
    h.onWordsLost('This browser cannot recognise speech. Shouting still works.')
    return true
  }

  const open = () => {
    if (!running) return
    try {
      recog = new RecogCtor()
      // French, for the same reason as the native side: Kreol is
      // French-lexified and no browser ships a Morisyen model.
      recog.lang = 'fr-FR'
      recog.continuous = true
      recog.interimResults = true
      recog.maxAlternatives = 3
      recog.onresult = (e: unknown) => {
        const ev = e as {
          results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
          resultIndex: number
        }
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const result = ev.results[i]
          for (let a = 0; a < result.length; a++) {
            const t = result[a]?.transcript
            if (t && t.trim()) h.onHeard(t, !result.isFinal)
          }
        }
      }
      recog.onerror = () => {
        /* onend will restart it; a browser errors on every silence. */
      }
      recog.onend = () => {
        // Chrome ends the session constantly. Reopen for as long as the
        // screen wants to be listening.
        if (running) window.setTimeout(open, 300)
      }
      recog.start()
      h.onConfig('fr-FR', false)
    } catch {
      h.onWordsLost('Speech recognition would not start. Shouting still works.')
    }
  }
  open()

  return true
}

export function stopWebVoice(): void {
  running = false
  if (raf !== null) {
    cancelAnimationFrame(raf)
    raf = null
  }
  try {
    recog?.abort()
  } catch {
    /* already gone */
  }
  recog = null
  try {
    void ctx?.close()
  } catch {
    /* already closed */
  }
  ctx = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
}

export function webVoiceRunning(): boolean {
  return running
}

/** The browser's own voice, where it has one. Chrome does; the Android
 *  WebView does not, which is why the native build speaks through Java. */
export function webSpeak(text: string): boolean {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 0.95
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
    return true
  } catch {
    return false
  }
}

export function webStopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel()
  } catch {
    /* nothing to stop */
  }
}
