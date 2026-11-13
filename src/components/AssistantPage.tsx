import { useRef, useState } from 'react'

import { answer, ENGINE_NOTE, type AssistantTarget, type Answer } from '../lib/assistant'
import type { AppData } from '../lib/types'
import { Card, Icon, PageHeader } from './ui'

/**
 * Ask Zetway.
 *
 * It is not a chatbot and the screen says so. There is no model and no
 * network call: it reads the question, matches it against the places,
 * guides and tables the app already carries, and answers with the real
 * figure and the table it came from. That is a smaller promise than a
 * language model makes and it is one this app can keep in airplane mode,
 * which is the state the whole product is designed for.
 *
 * Saying "no" is a first-class answer here. A question it cannot match gets
 * told so, with what it can do instead, because a confident wrong answer
 * about which road is dangerous is worse than no answer at all.
 */

const SUGGESTIONS = [
  'My tyre is flat',
  'Is the road to Port Louis safe tonight?',
  'My chain came off',
  'Where is the nearest hospital?',
  'What number do I call?',
]

type Turn = { question: string; result: Answer }

export function AssistantPage({
  data,
  onBack,
  onGo,
}: {
  data: AppData
  onBack: () => void
  onGo?: (target: AssistantTarget) => void
}) {
  const [text, setText] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const endRef = useRef<HTMLDivElement | null>(null)

  const ask = (q: string) => {
    const question = q.trim()
    if (!question) return
    const result = answer(question, data)
    setTurns((t) => [...t, { question, result }])
    setText('')
    // Let the new turn paint before scrolling to it.
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }))
  }

  return (
    <>
      <PageHeader title="Ask Zetway" onBack={onBack} />

      <Card accent="blue">
        <p className="text-xs leading-relaxed text-slate-600">
          {ENGINE_NOTE}
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
          Which is why it still answers with no signal.
        </p>
      </Card>

      {turns.length === 0 && (
        <div className="space-y-2">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => ask(q)}
              className="w-full rounded-xl bg-white/95 px-4 py-3 text-left text-sm text-slate-800 shadow-sm ring-1 ring-slate-200 active:bg-slate-50"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {turns.map((t, i) => (
        <div key={i} className="space-y-2">
          <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-brand-deep px-3.5 py-2.5 text-sm text-white">
            {t.question}
          </p>

          <Card accent={t.result.confidence === 'low' ? 'amber' : 'slate'}>
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-800">
              {t.result.reply}
            </p>

            {/* The label names the destination rather than saying "Open it".
                A guide target lands on the roadside flow's safety questions
                first - where are you, is anyone hurt - and it should, because
                that gate is what stops the app handing someone repair steps
                on the hard shoulder of the M1. Promising the guide and
                delivering a question would read as a bug; saying "roadside
                help" is simply what happens. */}
            {t.result.goTo && onGo && (
              <button
                type="button"
                onClick={() => onGo(t.result.goTo!)}
                className="mt-3 w-full rounded-xl bg-brand-deep px-4 py-2.5 text-sm font-semibold text-white active:bg-brand-deep/90"
              >
                {t.result.goTo.view === 'result'
                  ? 'Open the full score'
                  : 'Open roadside help — safety questions first'}
              </button>
            )}

            {/* Every answer names where the figure came from, the same way the
                rest of the app does. An assistant that cannot cite itself is
                the thing this one is trying not to be. */}
            <p className="mt-2.5 border-t border-slate-100 pt-2 text-[11px] leading-relaxed text-slate-500">
              {t.result.source}
            </p>
          </Card>
        </div>
      ))}

      <div ref={endRef} />

      <form
        className="sticky bottom-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask(text)
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about a road, a breakdown, or who to call"
          aria-label="Ask Zetway a question"
          className="min-w-0 flex-1 rounded-full border-0 bg-white px-4 py-3 text-base text-slate-900 shadow-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-brand"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label="Ask"
          className="shrink-0 rounded-full bg-brand-deep px-4 py-3 text-white shadow-sm active:bg-brand-deep/90 disabled:bg-slate-300"
        >
          {Icon.activity('h-5 w-5')}
        </button>
      </form>
    </>
  )
}
