import { useEffect, useState } from 'react'

import { canSpeak, speakLines, stopSpeaking } from '../lib/speech'

/** Reads a set of lines aloud, and stops when asked or when it leaves.
 *
 *  Renders nothing where the browser has no speech synthesis, which is the
 *  honest outcome: a button that silently does nothing is worse than no
 *  button, especially for the person most likely to be relying on it.
 */
export function SpeakButton({
  lines,
  label = 'Read this aloud',
  className = '',
}: {
  lines: string[]
  label?: string
  className?: string
}) {
  const [speaking, setSpeaking] = useState(false)

  // Leaving the screen mid-sentence should not leave a voice running.
  useEffect(() => () => stopSpeaking(), [])

  if (!canSpeak() || lines.length === 0) return null

  const toggle = () => {
    if (speaking) {
      stopSpeaking()
      setSpeaking(false)
      return
    }
    setSpeaking(true)
    speakLines(lines, () => setSpeaking(false))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={speaking}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold ring-1 transition ${
        speaking
          ? 'bg-brand-deep text-white ring-brand-deep'
          : 'bg-slate-50 text-brand-deep ring-slate-200 active:bg-slate-100'
      } ${className}`}
    >
      <span aria-hidden="true">{speaking ? '■' : '▶'}</span>
      {speaking ? 'Stop' : label}
    </button>
  )
}
