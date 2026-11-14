import { useCallback, useState } from 'react'

import { currentPosition, readContacts } from '../lib/crashWatch'
import { escalate, type EscalationStep } from '../lib/escalate'
import { isNative } from '../lib/platform'
import { CANCEL_PHRASES, SOS_PHRASES } from '../lib/sosVoice'
import { useVoiceSos } from '../lib/useVoiceSos'
import { Card, CardTitle, Details, Icon, Notice, PageHeader } from './ui'

/**
 * Help without touching the phone.
 *
 * This screen exists for one picture: the rider is under the machine, awake,
 * and the phone is a metre away face-down in the gravel. Everything else in
 * Zetway assumes a free hand. Here there is none, so the only two inputs that
 * remain are a word and a shout, and the only output that reaches someone
 * lying on their back is a voice.
 *
 * It is armed deliberately rather than always on. A road-safety app that
 * listens continuously is one people uninstall, and rightly — so the
 * microphone opens when the rider says so, and the screen says plainly, in
 * the same breath, that nothing recorded leaves the phone.
 *
 * The honesty block near the bottom is not decoration. What this feature can
 * do varies more between phones than anything else in the app: whether there
 * is an on-device recogniser, whether a French model is installed, whether
 * the engine can speak at all. Those are asked of the operating system and
 * printed, because a rider who thinks the phone is listening and is wrong is
 * worse off than one who knows it is not.
 */
export function HandsFree({ onBack }: { onBack: () => void }) {
  const [steps, setSteps] = useState<EscalationStep[] | null>(null)

  const fire = useCallback(() => {
    void (async () => {
      const contacts = readContacts()
      const at = await currentPosition()
      setSteps(await escalate(contacts, at, null, true))
    })()
  }, [])

  const voice = useVoiceSos({ onFire: fire })
  const s = voice.status

  const listening = voice.phase === 'armed' || voice.phase === 'counting'
  const counting = voice.phase === 'counting'

  // The meter is the gap above the background, not the raw level, because the
  // gap is what the detector actually judges. Showing the raw number would
  // have a rider next to a running engine think it was about to fire.
  const over = voice.quiet === null ? 0 : Math.max(0, voice.level - voice.quiet)
  const meter = Math.min(100, (over / 6) * 100)

  return (
    <div className="zw-page">
      <PageHeader title="Hands-free help" onBack={onBack} />

      {!isNative() && (
        <Notice accent="amber" icon={Icon.alertTriangle('h-3.5 w-3.5')}>
          This only works in the Android app. A web page is not allowed to keep
          a microphone open in the background, and could not call anyone if it
          heard you.
        </Notice>
      )}

      <Card>
        <CardTitle>If you cannot reach your phone</CardTitle>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
          Turn this on before you ride. Zetway listens for a shout or for the
          word <span className="font-semibold">help</span>, then counts down out
          loud and texts your contacts with your location. Say{' '}
          <span className="font-semibold">stop</span> at any point and it stops.
        </p>

        <button
          type="button"
          onClick={() => void (listening ? voice.disarm() : voice.arm())}
          disabled={!isNative()}
          aria-pressed={listening}
          className={[
            'mt-3 w-full rounded-2xl px-4 py-4 text-center text-base font-bold transition',
            'disabled:cursor-not-allowed disabled:opacity-50',
            listening
              ? 'bg-flag-red text-white'
              : 'bg-brand-deep text-white',
          ].join(' ')}
        >
          {listening ? 'Listening — tap to stop' : 'Start listening'}
        </button>

        {listening && !voice.words && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-900 ring-1 ring-amber-200">
            Words are not working on this phone &mdash; {voice.reason} Shouting
            still works, and it is the trigger that needs no signal. Shout and
            keep shouting.
          </p>
        )}

        {listening && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
              <span>How loud, against the background</span>
              <span className="tabular">{over.toFixed(1)}</span>
            </div>
            <div
              className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-200"
              role="meter"
              aria-valuenow={Math.round(meter)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Shout level"
            >
              <div
                className={meter > 50 ? 'h-full bg-flag-red' : 'h-full bg-brand-deep'}
                style={{ width: `${meter}%` }}
              />
            </div>
            {voice.deaf && (
              <p className="mt-1 text-[11px] font-semibold text-slate-500">
                Not listening for a moment &mdash; the phone is talking, and it
                must not hear itself.
              </p>
            )}
            <p className="mt-1 text-[11px] text-slate-500">
              A shout has to clear the background by{' '}
              <span className="font-semibold tabular">{voice.margin.toFixed(1)}</span> for about a
              second. A horn or a door slam is too short.
            </p>

            {/* Measuring beats arguing. The threshold was a single number
                applied to two audio sources that report on different scales,
                on hardware it had never been tried against; three seconds of
                this room and three of your voice settles it properly. */}
            {voice.calibrating ? (
              <div className="mt-3 rounded-xl bg-brand-deep px-4 py-4 text-center text-white">
                <p className="text-lg font-extrabold">
                  {voice.calibrating === 'quiet' ? 'Stay quiet\u2026' : 'Shout now!'}
                </p>
                <p className="mt-1 text-xs opacity-90">
                  {voice.calibrating === 'quiet'
                    ? 'Measuring how loud this room is.'
                    : 'Keep going until it stops.'}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void voice.calibrate()}
                className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-800 ring-1 ring-slate-300"
              >
                {voice.calibration
                  ? 'Measure my shout again'
                  : 'Measure my shout \u2014 takes six seconds'}
              </button>
            )}

            {voice.calibration && !voice.calibrating && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">
                Measured on this phone: your shout came in{' '}
                <span className="tabular font-semibold">
                  {voice.calibration.gap.toFixed(1)}
                </span>{' '}
                above the room, so the threshold is set to{' '}
                <span className="tabular font-semibold">
                  {voice.calibration.margin.toFixed(1)}
                </span>
                . A little over half the gap, because the shout that matters
                will be muffled by a helmet and worse than the one you
                practised.
              </p>
            )}

            {/* The number, kept, because nobody can read a moving meter while
                they are shouting. If a real shout does not get this above the
                figure beside it, the threshold is wrong for this phone and no
                amount of shouting will help. */}
            <div className="mt-2 flex items-baseline justify-between rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <span className="text-[11px] font-semibold text-slate-600">
                Loudest shout so far
              </span>
              <span
                className={[
                  'tabular text-lg font-extrabold',
                  voice.peakOver >= voice.margin ? 'text-emerald-600' : 'text-slate-400',
                ].join(' ')}
              >
                {voice.peakOver.toFixed(1)}
                <span className="ml-1 text-[11px] font-semibold text-slate-400">
                  / {voice.margin.toFixed(1)} needed
                </span>
              </span>
            </div>
          </div>
        )}
      </Card>

      {counting && (
        <div
          role="alertdialog"
          aria-live="assertive"
          className="rounded-2xl bg-flag-red p-4 text-white"
        >
          <p className="text-sm font-semibold">
            {voice.trigger === 'word'
              ? `Heard “${voice.heardWord}”.`
              : 'Heard shouting.'}
          </p>
          <p className="mt-1 text-3xl font-extrabold tabular">
            Getting help in {voice.secondsLeft}s
          </p>
          <p className="mt-1 text-xs opacity-90">
            Say “stop” — or any of: {CANCEL_PHRASES.join(', ')}.
          </p>
          <button
            type="button"
            onClick={voice.cancel}
            className="mt-3 w-full rounded-xl bg-white px-4 py-3 text-sm font-bold text-flag-red"
          >
            I&rsquo;m all right — stop
          </button>
        </div>
      )}

      {voice.phase === 'degraded' && (
        <Notice accent="red" icon={Icon.alertTriangle('h-3.5 w-3.5')}>
          Stopped listening. {voice.reason} Use the call buttons on the roadside
          help screen instead.
        </Notice>
      )}

      {steps && (
        <Card>
          <CardTitle>What Zetway did</CardTitle>
          <ol className="mt-2 space-y-1.5">
            {steps.map((step, i) => (
              <li key={i} className="text-xs leading-relaxed text-slate-700">
                <span
                  className={[
                    'mr-1.5 font-bold',
                    step.state === 'done'
                      ? 'text-emerald-600'
                      : step.state === 'failed'
                        ? 'text-flag-red'
                        : 'text-slate-500',
                  ].join(' ')}
                >
                  {step.state === 'done' ? '✓' : step.state === 'failed' ? '✕' : '•'}
                </span>
                {step.text}
              </li>
            ))}
          </ol>
          <a
            href="tel:114"
            className="mt-3 block rounded-xl bg-flag-red px-4 py-3 text-center text-sm font-bold text-white"
          >
            Call 114 — ambulance
          </a>
        </Card>
      )}

      <Card>
        <CardTitle>What it listens for</CardTitle>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SOS_PHRASES.map((p) => (
            <span
              key={p}
              className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-flag-red ring-1 ring-red-100"
            >
              {p}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
          Kreol is matched through French, because no phone sells with a
          Morisyen speech model — &ldquo;oskour&rdquo; reaches the recogniser as
          something near &ldquo;au secours&rdquo;, and that is close enough to
          match on. If it mishears you entirely, shouting still works: that
          trigger uses no words at all.
        </p>
      </Card>

      <Card>
        <CardTitle>What this phone can do</CardTitle>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
          {voice.offline
            ? 'Words and shouting both work on this phone with no signal.'
            : voice.words
              ? 'Shouting works with no signal. Words need a connection on this phone.'
              : 'Shouting works with no signal.'}{' '}
          Nothing it hears is uploaded, saved or sent anywhere.
        </p>

        {/* Everything below is the working behind that sentence. True,
            useful to a judge, and not what anybody needs while they are
            standing beside a broken motorcycle. */}
        <Details summary="The detail, phone by phone">
        <dl className="mt-1 space-y-1.5">
          <Fact
            label="Listening in"
            ok={voice.language !== null}
            yes={
              voice.language === 'fr-FR'
                ? 'French — which is how Kreol is matched'
                : voice.language === 'default'
                  ? "This phone's own language"
                  : `${voice.language} — no French pack on this phone, so Kreol words may not land`
            }
            no="Not listening yet"
          />
          <Fact
            label="Running on this phone"
            ok={voice.offline}
            yes="Yes — no signal needed"
            no="Not yet — turn listening on to find out"
          />
          <Fact
            label="Hear you with no signal"
            ok={s?.onDeviceAvailable ?? false}
            yes="Yes — the recogniser runs on this phone"
            no="No — this phone's recogniser needs the internet, so only the shout trigger works offline"
          />
          <Fact
            label="Word trigger live now"
            ok={voice.words && listening}
            yes="Yes"
            no={listening ? 'No — shouting only' : 'Not listening yet'}
          />
          <Fact
            label="Understand words at all"
            ok={s?.recognizerAvailable ?? false}
            yes="Yes"
            no="No speech recogniser is installed"
          />
          <Fact
            label="Speak back to you"
            ok={s?.canSpeak ?? false}
            yes="Yes"
            no="No speech engine on this phone — the countdown is on screen only"
          />
          <Fact
            label="Shout measured on this phone"
            ok={voice.calibration !== null}
            yes={`Yes \u2014 threshold ${voice.margin.toFixed(1)}, from your own voice`}
            no={`Not yet \u2014 using the default ${voice.margin.toFixed(1)}, which was never measured against a real microphone`}
          />
          <Fact
            label="Microphone allowed"
            ok={s?.microphone ?? false}
            yes="Yes"
            no="Not yet — it is asked for when you start listening"
          />
        </dl>

        {voice.transcript.length > 0 && (
          <>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-slate-500">
              Last few things it heard
            </p>
            <ol className="mt-1 space-y-1">
              {voice.transcript.map((t, i) => (
                <li key={i} className="truncate text-[11px] text-slate-500">
                  {t}
                </li>
              ))}
            </ol>
          </>
        )}

        <p className="mt-2.5 text-[11px] leading-relaxed text-slate-500">
          The audio is matched against the short word list above and
          discarded; only the text message you can read in &ldquo;What Zetway
          did&rdquo; ever leaves the phone.
        </p>
        </Details>
      </Card>
    </div>
  )
}

function Fact({
  label,
  ok,
  yes,
  no,
}: {
  label: string
  ok: boolean
  yes: string
  no: string
}) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-[11px] font-semibold text-slate-700">{label}</dt>
      <dd
        className={[
          'min-w-0 flex-1 text-right text-[11px]',
          ok ? 'text-emerald-700' : 'text-slate-500',
        ].join(' ')}
      >
        {ok ? yes : no}
      </dd>
    </div>
  )
}
