'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { zodResolver } from '@hookform/resolvers/zod'
import { Controller, useForm } from 'react-hook-form'
import {
  array,
  boolean,
  maxLength,
  minLength,
  object,
  refine,
  regex,
  string,
  trim,
  type output,
} from 'zod/mini'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import { Panel } from '@/components/layout/panel'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useDeferredModule } from '@/lib/hooks/use-deferred-module'
import { packageImport } from '@/lib/i18n/messages/package-import'
import { packageNew } from '@/lib/i18n/messages/package-new'
import { ui } from '@/lib/i18n/messages/ui'
import { scopedT } from '@/lib/i18n/scoped'
import { createPackageFromSeedAction } from '@/server/modules/scenarios/actions'

// The screen's own strings (packageNew), the two shared words a deferred chunk needs (ui), and the
// label on the import trigger — the trigger stays here so `./import-dialog` can be a chunk of its
// own, so `packageImport.trigger` is read on this side of the split (B4).
const t = scopedT(packageImport, packageNew, ui)

// UI-041 (FR-190). The one way a package family comes into being from a case an institution holds
// the rights to adapt: the family it belongs to, the concepts a run on it exercises, and the seed
// record — the case, its publisher, the license terms relied on, the author's confirmation that
// those terms permit adaptation, and the case text itself.
//
// Generation (AI-001) is Phase 12. "Create and generate" is on the screen and cannot act, with the
// reason attached to it: a control that vanishes leaves the person wondering whether they missed
// it, and the spec's two controls are what an author has been told to expect. The sentence beside
// it says what Tassl cannot do yet rather than which phase does it, because an author does not
// have a build plan; the same sentence is what the created state says, because that is the moment
// the question "and now what?" is asked. The control that *can* act is named for what it does
// ("Create the package"), not for the sibling it excludes.
//
// Three rules hold the form together, because six errors on a form this long are otherwise found
// only by scrolling:
//   1. One measure. The whole column is 72ch — the reading measure DESIGN.md sets — so panel
//      descriptions, prose and inputs all wrap at the same place, and the two short fields (the
//      mono family key and the concept entry) share one narrower width instead of inventing two.
//   2. An error replaces the hint it restates. A field shows its description or its error, never
//      both, so the rule is never stated twice and the stack never grows a line under refusal.
//   3. A refused submission is summarised where the press happened, above the buttons, with a link
//      to each field; focus lands there rather than on the first bad field far up the page.
//
// The bounds below are the ones `CreatePackageFromSeedSchema` states server-side, restated with
// zod/mini so the browser refuses sooner without pulling the module schema across the boundary
// (D-186). `LICENSE_NOT_CONFIRMED` and `CONFLICT` are the two refusals that belong to a field
// rather than to the form, so they land on the checkbox and on the family key.
//
// `package_created_from_seed` (AN-020) is emitted by the service; this form fires no analytics.

const NAME_MAX = 200
const TEXT_MAX = 4000
const FAMILY_KEY_MAX = 60
const CONCEPT_MIN_LENGTH = 2
const CONCEPT_MAX_LENGTH = 60
const CONCEPT_MIN_COUNT = 4
const SEED_TEXT_MIN = 200
/** 06 §3.3: the column refuses a longer seed text, so the counter counts down to the same number. */
const SEED_TEXT_MAX = 200_000

const FAMILY_KEY_PATTERN = /^[a-z0-9-]{3,60}$/

const numbers = new Intl.NumberFormat('en-US')

/**
 * The family key a title suggests: lowercase, ASCII, hyphens for everything else. It is a starting
 * point, not a rule — the field stays editable, and the derivation stops the moment it is edited.
 */
export function toFamilyKey(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, FAMILY_KEY_MAX)
    .replace(/-+$/, '')
}

/** One concept per entry; a pasted "a, b, c" becomes three rather than one long one. */
function splitConcepts(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

const seedSchema = object({
  title: string().check(
    trim(),
    minLength(1, { error: t('packageNew.validation.title') }),
    maxLength(NAME_MAX, { error: t('packageNew.validation.titleTooLong') }),
  ),
  familyKey: string().check(
    trim(),
    minLength(1, { error: t('packageNew.validation.familyKey') }),
    regex(FAMILY_KEY_PATTERN, { error: t('packageNew.validation.familyKeyFormat') }),
  ),
  conceptSet: array(string()).check(
    minLength(CONCEPT_MIN_COUNT, { error: t('packageNew.validation.concepts') }),
  ),
  caseTitle: string().check(
    trim(),
    minLength(1, { error: t('packageNew.validation.caseTitle') }),
    maxLength(NAME_MAX, { error: t('packageNew.validation.caseTitleTooLong') }),
  ),
  publisher: string().check(
    trim(),
    minLength(1, { error: t('packageNew.validation.publisher') }),
    maxLength(NAME_MAX, { error: t('packageNew.validation.publisherTooLong') }),
  ),
  licenseTerms: string().check(
    trim(),
    minLength(1, { error: t('packageNew.validation.licenseTerms') }),
    maxLength(TEXT_MAX, { error: t('packageNew.validation.licenseTermsTooLong') }),
  ),
  // A plain boolean with a check rather than a literal: the output type stays `boolean`, so the
  // field starts unticked and the message is the sentence the author has to agree to.
  licensePermitsAdaptation: boolean().check(
    refine((value: boolean) => value, { error: t('packageNew.validation.license') }),
  ),
  seedText: string().check(
    minLength(SEED_TEXT_MIN, { error: t('packageNew.validation.seedText') }),
    maxLength(SEED_TEXT_MAX, { error: t('packageNew.validation.seedTextTooLong') }),
  ),
})

type SeedValues = output<typeof seedSchema>

const EMPTY: SeedValues = {
  title: '',
  familyKey: '',
  conceptSet: [],
  caseTitle: '',
  publisher: '',
  licenseTerms: '',
  licensePermitsAdaptation: false,
  seedText: '',
}

/** The dialog is a second route to a package, not part of what this screen paints (B4, 16 §3.2). */
const loadImportDialog = () => import('./import-dialog')

type CreatedPackage = { packageId: string; versionId: string; title: string }

const versionHref = (packageId: string, versionId: string): Route => {
  const href: string = `/packages/${packageId}/versions/${versionId}`
  return href as Route
}

export function SeedForm({ orgId }: { orgId: string }) {
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedPackage | null>(null)

  const {
    control,
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SeedValues>({
    resolver: zodResolver(seedSchema),
    defaultValues: EMPTY,
    // The summary takes the focus a refusal earns; react-hook-form's own jump would send the
    // person to a field a screen and a half above the button they pressed, with no account of
    // what else is wrong.
    shouldFocusError: false,
  })

  // The family key follows the title until the author touches it, and picks the title up again if
  // they empty the field: an author who clears a key they did not want is asking for the default.
  const [familyKeyEdited, setFamilyKeyEdited] = useState(false)
  const [seedLength, setSeedLength] = useState(0)
  const [refusals, setRefusals] = useState(0)

  const summary = useRef<HTMLDivElement>(null)

  const titleField = register('title')
  const familyKeyField = register('familyKey')
  const seedTextField = register('seedText')

  // The summary is rendered by the same pass that records the refusal, so focus is taken after it
  // exists rather than in the handler that counted it.
  useEffect(() => {
    if (refusals > 0) summary.current?.focus()
  }, [refusals])

  async function onSubmit(values: SeedValues): Promise<void> {
    setFormError(null)
    const result = await createPackageFromSeedAction({
      orgId,
      title: values.title,
      familyKey: values.familyKey,
      conceptSet: values.conceptSet,
      seed: {
        caseTitle: values.caseTitle,
        publisher: values.publisher,
        licenseTerms: values.licenseTerms,
        licensePermitsAdaptation: values.licensePermitsAdaptation,
        seedText: values.seedText,
      },
    })

    if (!result.ok) {
      // Both refusals belong to one field, so they are shown there rather than under the form: the
      // key is the thing to change, and the tick is the thing to reconsider.
      if (result.error.code === 'CONFLICT') {
        setError(
          'familyKey',
          { message: t('packageNew.error.familyKeyTaken') },
          { shouldFocus: true },
        )
        return
      }
      if (result.error.code === 'LICENSE_NOT_CONFIRMED') {
        setError('licensePermitsAdaptation', { message: t('packageNew.validation.license') })
        return
      }
      setFormError(result.error.message)
      return
    }

    setCreated({ ...result.data, title: values.title })
    toast.success(t('packageNew.created', { title: values.title }))
  }

  if (created !== null) return <CreatedPanel created={created} />

  // Every field the summary can name, in the order the form asks for them.
  const listed = [
    { id: 'seed-title', label: t('packageNew.titleLabel'), message: errors.title?.message },
    {
      id: 'seed-family-key',
      label: t('packageNew.familyKeyLabel'),
      message: errors.familyKey?.message,
    },
    {
      id: 'seed-concepts',
      label: t('packageNew.conceptsLabel'),
      message: errors.conceptSet?.message,
    },
    {
      id: 'seed-case-title',
      label: t('packageNew.caseTitleLabel'),
      message: errors.caseTitle?.message,
    },
    {
      id: 'seed-publisher',
      label: t('packageNew.publisherLabel'),
      message: errors.publisher?.message,
    },
    {
      id: 'seed-license-terms',
      label: t('packageNew.licenseTermsLabel'),
      message: errors.licenseTerms?.message,
    },
    {
      id: 'seed-license',
      label: t('packageNew.licenseCheckboxLabel'),
      message: errors.licensePermitsAdaptation?.message,
    },
    { id: 'seed-text', label: t('packageNew.seedTextLabel'), message: errors.seedText?.message },
  ].filter((entry): entry is { id: string; label: string; message: string } =>
    Boolean(entry.message),
  )

  return (
    <form
      noValidate
      onSubmit={(event) => void handleSubmit(onSubmit, () => setRefusals((n) => n + 1))(event)}
    >
      {/* One measure for the whole form: the panels wrap where their prose and their inputs do. */}
      <div className="flex max-w-[72ch] flex-col gap-6">
        <Panel
          id="seed-package-panel"
          title={t('packageNew.packageTitle')}
          description={t('packageNew.packageDescription')}
          headingLevel={2}
        >
          <div className="flex flex-col gap-5">
            <Field data-invalid={errors.title ? 'true' : undefined}>
              <FieldLabel htmlFor="seed-title">{t('packageNew.titleLabel')}</FieldLabel>
              <Input
                id="seed-title"
                autoComplete="off"
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={errors.title ? 'seed-title-error' : 'seed-title-hint'}
                {...titleField}
                onChange={(event) => {
                  void titleField.onChange(event)
                  if (!familyKeyEdited) {
                    setValue('familyKey', toFamilyKey(event.target.value))
                  }
                }}
              />
              {errors.title ? (
                <FieldError id="seed-title-error">{errors.title.message}</FieldError>
              ) : (
                <FieldDescription id="seed-title-hint">
                  {t('packageNew.titleHint')}
                </FieldDescription>
              )}
            </Field>

            <Field data-invalid={errors.familyKey ? 'true' : undefined}>
              <FieldLabel htmlFor="seed-family-key">{t('packageNew.familyKeyLabel')}</FieldLabel>
              <Input
                id="seed-family-key"
                autoComplete="off"
                spellCheck={false}
                className="max-w-[40ch] font-mono"
                aria-invalid={errors.familyKey ? true : undefined}
                aria-describedby={
                  errors.familyKey ? 'seed-family-key-error' : 'seed-family-key-hint'
                }
                {...familyKeyField}
                onChange={(event) => {
                  setFamilyKeyEdited(event.target.value.length > 0)
                  void familyKeyField.onChange(event)
                }}
              />
              {/* The error states the rule the hint states; showing both said it twice. */}
              {errors.familyKey ? (
                <FieldError id="seed-family-key-error">{errors.familyKey.message}</FieldError>
              ) : (
                <FieldDescription id="seed-family-key-hint">
                  {t('packageNew.familyKeyHint')}
                </FieldDescription>
              )}
            </Field>

            <Controller
              control={control}
              name="conceptSet"
              render={({ field }) => (
                <ConceptField
                  concepts={field.value}
                  onChange={field.onChange}
                  error={errors.conceptSet?.message}
                />
              )}
            />
          </div>
        </Panel>

        {/* `seed-case-panel`, not `seed-case`: Panel derives its heading id from this one, and
            `seed-case-title` is already the id of the case title field inside it. */}
        <Panel
          id="seed-case-panel"
          title={t('packageNew.seedTitle')}
          description={t('packageNew.seedDescription')}
          headingLevel={2}
        >
          <div className="flex flex-col gap-5">
            <Field data-invalid={errors.caseTitle ? 'true' : undefined}>
              <FieldLabel htmlFor="seed-case-title">{t('packageNew.caseTitleLabel')}</FieldLabel>
              <Input
                id="seed-case-title"
                autoComplete="off"
                aria-invalid={errors.caseTitle ? true : undefined}
                aria-describedby={errors.caseTitle ? 'seed-case-title-error' : undefined}
                {...register('caseTitle')}
              />
              <FieldError id="seed-case-title-error">{errors.caseTitle?.message}</FieldError>
            </Field>

            <Field data-invalid={errors.publisher ? 'true' : undefined}>
              <FieldLabel htmlFor="seed-publisher">{t('packageNew.publisherLabel')}</FieldLabel>
              <Input
                id="seed-publisher"
                autoComplete="off"
                aria-invalid={errors.publisher ? true : undefined}
                aria-describedby={errors.publisher ? 'seed-publisher-error' : undefined}
                {...register('publisher')}
              />
              <FieldError id="seed-publisher-error">{errors.publisher?.message}</FieldError>
            </Field>

            <Field data-invalid={errors.licenseTerms ? 'true' : undefined}>
              <FieldLabel htmlFor="seed-license-terms">
                {t('packageNew.licenseTermsLabel')}
              </FieldLabel>
              <Textarea
                id="seed-license-terms"
                rows={3}
                aria-invalid={errors.licenseTerms ? true : undefined}
                aria-describedby={
                  errors.licenseTerms ? 'seed-license-terms-error' : 'seed-license-terms-hint'
                }
                {...register('licenseTerms')}
              />
              {errors.licenseTerms ? (
                <FieldError id="seed-license-terms-error">{errors.licenseTerms.message}</FieldError>
              ) : (
                <FieldDescription id="seed-license-terms-hint">
                  {t('packageNew.licenseTermsHint')}
                </FieldDescription>
              )}
            </Field>

            {/* Base UI names the toggle from the label only after hydration, so the checkbox
                also points at the label by id (DESIGN.md §Inputs / Fields → Toggles). The error
                takes the description's place rather than sitting under it: an error indented
                past the sentence it answers was the one place in this form where the two did not
                share a left edge. */}
            <Controller
              control={control}
              name="licensePermitsAdaptation"
              render={({ field }) => (
                <Field
                  orientation="horizontal"
                  data-invalid={errors.licensePermitsAdaptation ? 'true' : undefined}
                >
                  <Checkbox
                    id="seed-license"
                    name={field.name}
                    checked={field.value}
                    aria-labelledby="seed-license-label"
                    aria-invalid={errors.licensePermitsAdaptation ? true : undefined}
                    aria-describedby={
                      errors.licensePermitsAdaptation ? 'seed-license-error' : 'seed-license-hint'
                    }
                    onCheckedChange={(next: boolean) => field.onChange(next)}
                  />
                  <FieldContent>
                    <FieldLabel id="seed-license-label" htmlFor="seed-license">
                      {t('packageNew.licenseCheckboxLabel')}
                    </FieldLabel>
                    {errors.licensePermitsAdaptation ? (
                      <FieldError id="seed-license-error">
                        {errors.licensePermitsAdaptation.message}
                      </FieldError>
                    ) : (
                      <FieldDescription id="seed-license-hint">
                        {t('packageNew.licenseCheckboxHint')}
                      </FieldDescription>
                    )}
                  </FieldContent>
                </Field>
              )}
            />

            {/* No maxLength on the control: the browser truncates a paste against it silently,
                and a case that arrives 400 characters short of its ending is worse than one the
                counter says is too long. The count is read from the value on every change, so a
                paste moves it in one step. `min-h-64` rather than `rows`: the textarea recipe
                sizes to its content, so rows never showed, and a field asking for a whole case
                cannot be the height of the two-line license box. */}
            <Field data-invalid={errors.seedText ? 'true' : undefined}>
              <FieldLabel htmlFor="seed-text">{t('packageNew.seedTextLabel')}</FieldLabel>
              <Textarea
                id="seed-text"
                rows={10}
                spellCheck={false}
                className="text-reading min-h-64"
                aria-invalid={errors.seedText ? true : undefined}
                aria-describedby={
                  errors.seedText
                    ? 'seed-text-error seed-text-count'
                    : 'seed-text-hint seed-text-count'
                }
                {...seedTextField}
                onChange={(event) => {
                  void seedTextField.onChange(event)
                  setSeedLength(event.target.value.length)
                }}
              />
              {errors.seedText ? (
                <FieldError id="seed-text-error">{errors.seedText.message}</FieldError>
              ) : (
                <FieldDescription id="seed-text-hint">
                  {t('packageNew.seedTextHint')}
                </FieldDescription>
              )}
              <FieldDescription
                id="seed-text-count"
                className="text-mono-sm font-mono tabular-nums"
              >
                {t('packageNew.seedTextCount', {
                  count: numbers.format(seedLength),
                  max: numbers.format(SEED_TEXT_MAX),
                })}
              </FieldDescription>
            </Field>
          </div>
        </Panel>

        {listed.length > 0 && <ErrorSummary ref={summary} entries={listed} />}
        <FormAlert message={formError} />

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pending={isSubmitting}>
              {isSubmitting ? t('packageNew.createPending') : t('packageNew.createSubmit')}
            </SubmitButton>
            {/* Phase 12 turns this on. Until then it keeps its name, stays reachable by
                keyboard, and carries the reason it cannot act (as UI-032's blocked control
                does), because an absent control tells nobody anything. */}
            <Button
              type="button"
              variant="secondary"
              aria-disabled="true"
              aria-describedby="seed-generate-reason"
              onClick={(event) => event.preventDefault()}
            >
              {t('packageNew.generateSubmit')}
            </Button>
          </div>
          <p id="seed-generate-reason" className="text-ink-muted text-body">
            {t('packageNew.generateUnavailable')}
          </p>
        </div>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------------------------
// What a refusal costs on a form this long: one place that names every field still to be put right
// ---------------------------------------------------------------------------------------------

type SummaryEntry = { id: string; label: string; message: string }

function ErrorSummary({
  entries,
  ref,
}: {
  entries: readonly SummaryEntry[]
  ref: Ref<HTMLDivElement>
}) {
  return (
    // The refusal box the rest of the product uses, made the focus target of the press that
    // earned it: it sits beside the button, so nobody is scrolled away from what they just did.
    <div
      ref={ref}
      tabIndex={-1}
      className="focus-visible:outline-focus rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <FormAlert
        message={t('packageNew.errorSummaryTitle')}
        action={
          <ul className="flex list-disc flex-col gap-1 pl-4">
            {entries.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className="focus-visible:outline-focus rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                  onClick={(event) => {
                    event.preventDefault()
                    document.getElementById(entry.id)?.focus()
                  }}
                >
                  {t('packageNew.errorSummaryItem', {
                    label: entry.label,
                    message: entry.message,
                  })}
                </a>
              </li>
            ))}
          </ul>
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Concepts (a tag input; at least four)
// ---------------------------------------------------------------------------------------------

function ConceptField({
  concepts,
  onChange,
  error,
}: {
  concepts: readonly string[]
  onChange: (next: string[]) => void
  error: string | undefined
}) {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  function add(raw: string): void {
    const candidates = splitConcepts(raw)
    if (candidates.length === 0) return

    const accepted: string[] = [...concepts]
    for (const candidate of candidates) {
      if (candidate.length < CONCEPT_MIN_LENGTH || candidate.length > CONCEPT_MAX_LENGTH) {
        setNotice(t('packageNew.validation.conceptLength'))
        return
      }
      if (accepted.some((held) => held.toLowerCase() === candidate.toLowerCase())) {
        setNotice(t('packageNew.conceptsDuplicate', { concept: candidate }))
        return
      }
      accepted.push(candidate)
    }

    setNotice(null)
    setDraft('')
    onChange(accepted)
  }

  function remove(concept: string): void {
    setNotice(null)
    onChange(concepts.filter((held) => held !== concept))
  }

  // What the entry field is described by, in the order it is read: the refusal or the hint, then
  // whatever the last press answered, then the count. The notice used to be announced by its own
  // `role="alert"` and belong to nothing; a person on the field never heard why their concept was
  // refused.
  const describedBy = [
    error ? 'seed-concepts-error' : 'seed-concepts-hint',
    ...(notice !== null ? ['seed-concepts-notice'] : []),
    'seed-concepts-count',
  ].join(' ')

  return (
    <Field data-invalid={error ? 'true' : undefined}>
      <FieldLabel htmlFor="seed-concepts">{t('packageNew.conceptsLabel')}</FieldLabel>
      <div className="flex flex-wrap items-start gap-2">
        <Input
          id="seed-concepts"
          autoComplete="off"
          className="max-w-[40ch] flex-1"
          value={draft}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              // Enter in a text field submits the form by default, and this one is adding a tag.
              event.preventDefault()
              add(draft)
              return
            }
            if (event.key === 'Backspace' && draft.length === 0 && concepts.length > 0) {
              event.preventDefault()
              onChange(concepts.slice(0, -1))
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={() => add(draft)}>
          {t('packageNew.conceptsAdd')}
        </Button>
      </div>

      {concepts.length > 0 && (
        <ul className="flex flex-wrap gap-2 pt-1">
          {concepts.map((concept) => (
            <li
              key={concept}
              className="border-line bg-paper-sunken text-ink text-meta flex items-center gap-1 rounded-sm py-1 pr-1 pl-2"
            >
              <span>{concept}</span>
              <button
                type="button"
                aria-label={t('packageNew.conceptsRemove', { concept })}
                onClick={() => remove(concept)}
                className="text-ink-muted hover:text-ink focus-visible:outline-focus relative grid size-5 place-content-center rounded-sm after:absolute after:-inset-2.5 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <FieldError id="seed-concepts-error">{error}</FieldError>
      ) : (
        <FieldDescription id="seed-concepts-hint">{t('packageNew.conceptsHint')}</FieldDescription>
      )}
      {notice !== null && <FieldError id="seed-concepts-notice">{notice}</FieldError>}
      <FieldDescription id="seed-concepts-count" role="status">
        {concepts.length === 0
          ? t('packageNew.conceptsEmpty')
          : t('packageNew.conceptsCount', { count: concepts.length })}
      </FieldDescription>
    </Field>
  )
}

// ---------------------------------------------------------------------------------------------
// The second route to a package: an export somebody already wrote
// ---------------------------------------------------------------------------------------------

/**
 * The control that opens the import dialog, for the page header rather than the foot of the form.
 *
 * Import is the only way to reach a populated version in this build, so a person arriving with an
 * export in hand should not have to read eight fields and a case-sized textarea to find it. It
 * lives beside the page title on `/packages/new` — and belongs beside "New package from a seed
 * case" on `/packages` — while the dialog behind it stays a deferred chunk fetched on the press
 * (B4, 16 §3.2). What the import does is said in the dialog's own description, where the person
 * reading it is about to paste.
 */
export function ImportPackageTrigger({ orgId }: { orgId: string }) {
  const [open, setOpen] = useState(false)
  const { loaded, status, request } = useDeferredModule(loadImportDialog)
  const ImportPackageDialog = loaded?.ImportPackageDialog

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        aria-busy={open && status === 'loading'}
        onClick={() => {
          request()
          setOpen(true)
        }}
      >
        {t('packageImport.trigger')}
      </Button>
      {/* The whole dialog is the deferred chunk, so there is no frame to hold a fallback in:
          the wait, and a failure to arrive, are stated beside the control that started it. */}
      {open && status === 'loading' && (
        <p role="status" className="text-ink-muted text-meta">
          {t('ui.loading')}
        </p>
      )}
      {status === 'failed' && (
        <p role="alert" className="text-red text-meta">
          {t('ui.actionLoadFailed')}
        </p>
      )}

      {ImportPackageDialog && open && (
        <ImportPackageDialog orgId={orgId} open onOpenChange={setOpen} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Created (UI-041 state "created")
// ---------------------------------------------------------------------------------------------

function CreatedPanel({ created }: { created: CreatedPackage }) {
  const heading = useRef<HTMLHeadingElement>(null)

  // The form the person was working in is gone; focus follows the answer rather than resetting to
  // the top of the document.
  useEffect(() => {
    heading.current?.focus()
  }, [])

  // The heading is written out rather than passed to Panel's `title`: focus has to land on it, and
  // a ref reaches it only from here.
  return (
    <Panel id="seed-created" className="max-w-[72ch]">
      <div className="flex flex-col items-start gap-3">
        <h2
          ref={heading}
          tabIndex={-1}
          className="text-h4 focus-visible:outline-focus rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('packageNew.createdTitle', { title: created.title })}
        </h2>
        <p className="text-ink-muted text-body">{t('packageNew.createdBody')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <Link
            href={versionHref(created.packageId, created.versionId)}
            className={buttonVariants({ className: 'w-fit' })}
          >
            {t('packageNew.createdOpen')}
          </Link>
          <Link
            href="/packages"
            className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}
          >
            {t('packageNew.createdBack')}
          </Link>
        </div>
      </div>
    </Panel>
  )
}
