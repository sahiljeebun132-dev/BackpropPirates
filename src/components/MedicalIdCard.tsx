import { useState } from 'react'

import {
  clearMedicalId, isMedicalIdEmpty, medicalSummary, MEDICAL_SMS_LIMIT, readMedicalId,
  writeMedicalId, type MedicalId,
} from '../lib/medicalId'
import { Card, CardTitle } from './ui'

/**
 * The card a rider fills in once so the crash text can speak for them.
 *
 * Collapsed by default, like the legal panel, because it is setup: it is
 * filled in at a kitchen table and then never touched again, and crash watch
 * has already been shown to lose the home screen to cards nobody opens twice.
 * The closed row still says whether anything is saved, which is the one thing
 * worth knowing at a glance.
 *
 * Every field is optional and the Save button is always live, so a rider who
 * will write down an allergy but not a year of birth is not stuck. The same
 * reason the fields are few: this is health data, and asking for more than a
 * first responder will act on is not caution, it is collecting.
 *
 * The preview is the honest part. Rather than describing what gets sent, it
 * shows the exact lines, built by the same function the message uses, so what
 * is on screen is what a contact will read.
 */
export function MedicalIdCard() {
  const [saved, setSaved] = useState<MedicalId>(() => readMedicalId())
  const [draft, setDraft] = useState<MedicalId>(saved)
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const empty = isMedicalIdEmpty(saved)
  const preview = medicalSummary(draft)

  const set = (field: keyof MedicalId) => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }))
    setNote(null)
  }

  const save = () => {
    writeMedicalId(draft)
    setSaved(draft)
    setConfirmDelete(false)
    setNote('Saved on this phone.')
  }

  const remove = () => {
    clearMedicalId()
    setSaved({})
    setDraft({})
    setConfirmDelete(false)
    setNote('Deleted. Nothing of it is left on this phone.')
  }

  return (
    <Card accent="red">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="min-w-0">
          <CardTitle>Medical summary</CardTitle>
          <span className="mt-0.5 block text-xs leading-relaxed text-slate-600">
            {empty
              ? 'Nothing saved. Add what an ambulance crew would need if you could not speak.'
              : 'Goes out in the crash text, after your location.'}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
            empty ? 'bg-slate-100 text-slate-500' : 'bg-flag-red/10 text-flag-red'
          }`}
        >
          {empty ? 'Empty' : 'Saved'}
        </span>
      </button>

      {open && (
        <div className="mt-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="space-y-2">
            <Field
              label="Allergies"
              value={draft.allergies}
              onChange={set('allergies')}
              placeholder="for example penicillin, peanuts"
            />
            <Field
              label="Blood group"
              value={draft.bloodGroup}
              onChange={set('bloodGroup')}
              placeholder="for example O+"
            />
            <Field
              label="Conditions"
              value={draft.conditions}
              onChange={set('conditions')}
              placeholder="for example asthma, epilepsy"
            />
            <Field
              label="Medication"
              value={draft.medications}
              onChange={set('medications')}
              placeholder="for example warfarin"
            />
            <Field
              label="Year of birth"
              value={draft.birthYear}
              onChange={set('birthYear')}
              placeholder="for example 1991"
              inputMode="numeric"
            />
            <Field
              label="Next of kin"
              value={draft.kinName}
              onChange={set('kinName')}
              placeholder="Name"
            />
            <Field
              label="Their number"
              value={draft.kinPhone}
              onChange={set('kinPhone')}
              placeholder="for example 5xxx xxxx"
              inputMode="tel"
            />
          </div>

          <button
            type="button"
            onClick={save}
            className="mt-3 w-full rounded-lg bg-brand-deep px-3 py-2.5 text-sm font-semibold text-white"
          >
            Save on this phone
          </button>

          {note && <p className="mt-2 text-[11px] font-semibold text-slate-600">{note}</p>}

          {preview && (
            <div className="mt-3 border-t border-slate-200 pt-3">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                What a contact would read
              </p>
              {/* The real output of the real function, not a description of
                  it. If the cap trims a line, the rider sees the trim here
                  rather than discovering it after a crash. */}
              <p className="mt-1 whitespace-pre-line rounded-lg bg-white p-2.5 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
                {preview}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {preview.length} of {MEDICAL_SMS_LIMIT} characters. Your location and the impact
                reading come first, above these lines.
              </p>
            </div>
          )}

          {!isMedicalIdEmpty(saved) && (
            <div className="mt-3">
              {confirmDelete ? (
                <div className="rounded-lg bg-white p-2.5 ring-1 ring-flag-red/30">
                  <p className="text-xs leading-relaxed text-slate-700">
                    Delete your medical summary from this phone? It cannot be undone.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={remove}
                      className="flex-1 rounded-lg bg-flag-red px-3 py-2 text-xs font-semibold text-white"
                    >
                      Delete it
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="flex-1 rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
                    >
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="text-xs font-semibold text-flag-red"
                >
                  Delete everything above
                </button>
              )}
            </div>
          )}

          {/* The Data Protection Act 2017 answer, in the three sentences a
              rider needs: where it lives, who ever sees it, and when. Health
              data under the Act, on the same vital-interests basis as the
              crash recording — see "Your data, and the law here". */}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            Saved in this app on this phone only. We have no account system and no server, so
            there is nowhere for it to be uploaded to. It leaves the phone in one case and one
            only: inside the crash message, to the contacts you saved yourself, after a real
            impact when the countdown has gone unanswered. Tapping &ldquo;I&rsquo;m OK&rdquo;
            sends nothing. Delete it above whenever you like.
          </p>
        </div>
      )}
    </Card>
  )
}

function Field({
  label, value, onChange, placeholder, inputMode,
}: {
  label: string
  value: string | undefined
  onChange: (value: string) => void
  placeholder: string
  inputMode?: 'numeric' | 'tel'
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-slate-600">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        // Capped at the same figure the message is capped at, so the field
        // cannot accept text the text message would only throw away.
        maxLength={MEDICAL_SMS_LIMIT}
        className="mt-1 w-full rounded-lg border-0 bg-white px-3 py-2.5 text-sm ring-1 ring-slate-200 focus:ring-2 focus:ring-brand"
      />
    </label>
  )
}
