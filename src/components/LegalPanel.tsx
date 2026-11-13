import { useState } from 'react'

/**
 * What Zetway does with data, and what the law here requires of the rider.
 *
 * Written after checking two things rather than assuming them.
 *
 * The Data Protection Act 2017 came into force on 15 January 2018 and is
 * aligned with the GDPR. It lists "recording" as processing and defines a
 * voice recording as personal data, which matters because crash watch
 * records after an impact and a bystander has consented to nothing. The
 * answer is not to drop the feature: the Act, like the GDPR, allows
 * processing to protect someone's vital interests, and a rider who cannot
 * answer their phone after a crash is exactly that. What it does require is
 * that the processing be minimal, disclosed, and no wider than the purpose
 * — so the recording is capped, announced on screen while it happens, and
 * never leaves the handset unless the rider chooses to send it.
 *
 * The Road Traffic Act makes using a hand-held phone while driving an
 * offence, and since the penalty-points system began in January 2026 it
 * carries points. Mounted and hands-free use is permitted. That shapes the
 * product, not just this notice: everything Zetway asks of a rider happens
 * before they set off or after they have stopped, and the one feature that
 * runs while moving — crash watch — is armed beforehand and then needs no
 * interaction at all.
 *
 * None of this is legal advice and we are not lawyers. It is what we
 * checked, with the sources named, so a judge or a rider can check it too.
 */
export function LegalPanel() {
  const [open, setOpen] = useState(false)

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-sm font-semibold text-slate-900">Your data, and the law here</span>
        <span className="shrink-0 text-xs font-semibold text-brand-deep">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Never in your hand while you ride
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              Using a hand-held phone while driving is an offence under the Road Traffic Act, and
              since the penalty-points system began in January 2026 it carries points against your
              licence. Mounted and hands-free use is allowed.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-700">
              Zetway is built around that. Plan the journey before you set off. Arm crash watch
              before you move and it needs nothing from you afterwards — it watches with the screen
              off and the phone in a pocket. The roadside guides are for when you have already
              stopped. If you are moving, put it down.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              What stays on your phone
            </h3>
            <ul className="mt-1 space-y-1 text-xs leading-relaxed text-slate-700">
              <li>
                <span className="font-semibold">Your emergency contacts.</span> Stored only in this
                browser or app, never sent to us. We have no account system and no server that
                knows who you are.
              </li>
              <li>
                <span className="font-semibold">Any crash recording.</span> Capped at 45 seconds,
                announced on screen while it runs, and kept on the handset. It is never uploaded.
                You choose whether to send it to anyone.
              </li>
              <li>
                <span className="font-semibold">Your location.</span> Used to work out what is near
                you and to put a map link in the message your contacts get. It is not logged by us.
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              What leaves your phone
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              Only a hazard report, and only when you tap to send one. A report carries the kind of
              hazard, a position, a short note and a timestamp. It carries no name, no device
              identifier and nothing that ties it to you, and every report is deleted after four
              hours because it is no use to anyone after that.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Recording after a crash
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              The Data Protection Act 2017 treats a voice recording as personal data and recording
              as processing, and someone standing at the roadside has agreed to nothing. The Act
              also permits processing to protect a person’s vital interests, which is the basis
              this rests on: it only ever runs after an impact has been detected and a 30-second
              countdown has gone unanswered. It is capped, it is announced, and it stays on the
              phone. If you would rather it did not happen at all, refuse the microphone permission
              and everything else still works.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Where the data comes from
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-700">
              Road casualty tables: Open Data Mauritius and Statistics Mauritius, CC-BY-SA 4.0, via
              data.govmu.org. Garages and filling stations: OpenStreetMap contributors, ODbL.
              Vehicle models: Wikidata, CC0. Forecast: Open-Meteo. Each is credited where it is
              used, and the licences allow what we do with them.
            </p>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            We are a student team, not lawyers, and this is not legal advice. It is a plain account
            of what the app does and the two laws we checked it against — the Data Protection Act
            2017 and the Road Traffic Act — so that you can check it yourself.
          </p>
        </div>
      )}
    </section>
  )
}
