/** Reading the screen out loud.
 *
 * Two people need this and neither is an edge case. Someone who cannot read
 * a small screen — in the dark, without their glasses, or at all — and
 * someone kneeling beside a bike with both hands busy and oil on them. The
 * steps are no use if you have to keep picking the phone up to see the next
 * one.
 *
 * Built on the browser's own speech synthesis in a browser, and on Android's
 * own engine inside the app. That second path is not a nicety: speechSynthesis
 * is undefined in the Android WebView — not empty, not unsupported, absent —
 * so for as long as this rested on it alone, the read-aloud button correctly
 * rendered nothing on the one build where someone is actually kneeling beside
 * a bike. The feature was shipped and invisible at the same time.
 *
 * Everything still degrades to the text that was always there, and the button
 * simply does not appear where neither path exists.
 */
import { isNative } from './platform'
import { nativeSpeak, nativeStopSpeaking } from './nativeCrash'

export function canSpeak(): boolean {
  // The app always can, through Java. A browser can if it says so.
  if (isNative()) return true
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/** Prefer a British or Mauritian English voice if the device has one: the
 *  place names and the phrasing are closer, and a US voice reads "Quatre
 *  Bornes" worse than a British one does. */
function pickVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis.getVoices()
    if (!voices.length) return null
    return (
      voices.find((v) => v.lang === 'en-MU') ??
      voices.find((v) => v.lang === 'en-GB') ??
      voices.find((v) => v.lang.startsWith('en')) ??
      null
    )
  } catch {
    return null
  }
}

/**
 * Speak a sequence of lines, with a pause between them.
 *
 * Takes the lines separately rather than one joined string so each step gets
 * a real gap. Someone following instructions needs the space to do the thing
 * before the next one starts.
 */
export function speakLines(lines: string[], onDone?: () => void): void {
  if (!canSpeak()) return

  if (isNative()) {
    // Android's engine queues and paces for itself, and one utterance keeps
    // the full-stop pauses between steps without this having to schedule
    // them. Joined with a blank line so the engine treats each step as its
    // own sentence rather than running them together.
    const text = lines.map((l) => l.trim()).filter(Boolean).join('. ')
    if (!text) return
    void nativeSpeak(text).then(() => onDone?.())
    return
  }

  const synth = window.speechSynthesis
  synth.cancel()

  const voice = pickVoice()
  const usable = lines.map((l) => l.trim()).filter(Boolean)
  if (usable.length === 0) return

  usable.forEach((line, i) => {
    const u = new SpeechSynthesisUtterance(line)
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? 'en-GB'
    // A shade slower than default. These are instructions, not prose, and
    // the default rate is brisk for someone trying to follow along.
    u.rate = 0.94
    u.pitch = 1
    if (i === usable.length - 1 && onDone) u.onend = onDone
    synth.speak(u)
  })
}

export function stopSpeaking(): void {
  if (!canSpeak()) return
  if (isNative()) {
    void nativeStopSpeaking()
    return
  }
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Nothing to stop is the outcome we wanted anyway.
  }
}
