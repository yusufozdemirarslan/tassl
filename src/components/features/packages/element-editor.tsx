'use client'

import { useEffect, useRef, type ReactNode, type Ref } from 'react'
import { CircleAlertIcon, PencilLineIcon } from 'lucide-react'
import { StanceChip } from '@/components/features/run/stance-chip'
import { LabelChip } from '@/components/layout/label-chip'
import { Panel } from '@/components/layout/panel'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/messages/package-confirm'
import type {
  StanceValue,
  ValidationFailure,
  VariantKeyValue,
} from '@/server/modules/scenarios/schema'
import { ConfirmBar, type ConfirmBarPending } from './confirm-bar'
import {
  readBoolean,
  readString,
  readStringOrNull,
  type ElementIndex,
  type WorkspaceElement,
} from './element-model'
import { isNarrow } from './element-editors/field-spec'
import { EditorField } from './element-editors/fields'
import { fieldsFor } from './element-editors/specs'

// The right side of UI-043: one element, in the shape its own schema takes, with everything the
// author needs to sign it and nothing else.
//
// The order on the screen is the order of the questions being asked. *What is this?* — the type,
// the key, and the decision that stands on it. *Why can I not confirm it?* — the rules it fails,
// in full, with the code an author searches the export for. *What does it belong to?* — the claim a
// variant state reads, the two readings of a claim. Then the fields. Then the bar.
//
// Four states, and each one changes what the fields do rather than whether they are drawn:
//
//   draft        — editable; a change is unsaved until the bar saves it.
//   confirmed    — read-only, with "Reopen for editing" beside the reason. A confirmed element is
//                  a signature; unlocking it is a deliberate act, and saving after it records a new
//                  decision on top of the old one rather than replacing it.
//   rejected     — editable, because the only way out of a rejection before generation exists is to
//                  author the element by hand. The banner says so.
//   frozen       — the whole version is confirmed; nothing is editable and there is no bar at all.
//
// Read-only here is `readOnly`, not `disabled`, wherever the control has the choice: a confirmed
// package is *read* — a 2,000-word document body, a seed text — and 45 % opacity is not a reading
// surface. The sunken well says it cannot be typed into; full ink says it can be read.

export type ElementEditorProps = {
  element: WorkspaceElement
  values: Record<string, unknown>
  /** Server `fieldErrors`, keyed by the field names in `specs.ts`, plus the editor's own. */
  errors: Record<string, string>
  formError: string | null
  index: ElementIndex
  /** The `validatePackage` rules that name this element (FR-194). */
  failures: readonly ValidationFailure[]
  /** The version is confirmed: everything is the record of what was signed. */
  frozen: boolean
  canEdit: boolean
  canDecide: boolean
  /** The author has unlocked a confirmed element for another pass. */
  reopened: boolean
  dirty: boolean
  pending: ConfirmBarPending
  /** The claim a variant state reads; null for every other type. */
  claimText: string | null
  variantKey: VariantKeyValue | null
  /** The two readings of this claim; empty for every other type. */
  variantStates: readonly WorkspaceElement[]
  onFieldChange: (name: string, value: unknown) => void
  onReopen: () => void
  onOpenElement: (id: string) => void
  onSave: () => void
  onDiscard: () => void
  onConfirm: () => void
  onReject: (note: string) => void
}

/** A second level of grouping inside the panel: a heading and a hairline, never another panel. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-line flex flex-col items-start gap-3 border-t pt-5">
      <h3 className="text-h4">{title}</h3>
      {children}
    </section>
  )
}

/** The product's refusal shape: the sentence to act on in ink on the red wash, then the code. */
function Refusal({
  title,
  children,
  ref,
  ...container
}: {
  title?: string
  children: ReactNode
  ref?: Ref<HTMLDivElement>
  role?: 'alert'
  tabIndex?: -1
}) {
  return (
    <div
      ref={ref}
      {...container}
      className="border-red bg-red-soft text-ink text-body flex w-full max-w-[72ch] items-start gap-2 rounded-md border p-3 outline-none"
    >
      <CircleAlertIcon aria-hidden="true" className="text-red mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {title !== undefined && <p className="font-medium">{title}</p>}
        {children}
      </div>
    </div>
  )
}

/**
 * The one refusal in this panel that *arrives* rather than stands.
 *
 * Everything else on the red wash is a statement about the element as it is — the rules it fails,
 * the note on its rejection — read where it sits. This one is the server's answer to a press, and
 * the press can be sixteen rows below it: `KEY_IMMUTABLE`, `SOURCE_DOCUMENT_MISSING`,
 * `VERSION_FROZEN` and the reference refusals all land here, and without this the spinner stopped
 * and nothing appeared to happen. So it is an `alert`, and it takes the focus — which scrolls it
 * into view — so the sentence reaches the person who asked for it. The call site keys it by the
 * message, so a different refusal is a new arrival and announces itself again.
 */
function ServerRefusal({ message }: { message: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    box.current?.focus()
  }, [])
  return (
    <Refusal ref={box} role="alert" tabIndex={-1}>
      {message}
    </Refusal>
  )
}

function DecisionChip({ element, frozen }: { element: WorkspaceElement; frozen: boolean }) {
  if (frozen) return <LabelChip kind="confirmed" label={t('confirm.frozenTitle')} />
  if (element.decision === 'confirmed') {
    return <LabelChip kind="confirmed" label={t('confirm.statusConfirmed')} />
  }
  if (element.decision === 'edited') {
    return <LabelChip kind="confirmed" label={t('confirm.statusEdited')} />
  }
  if (element.decision === 'rejected') {
    return <LabelChip kind="warning" label={t('confirm.statusRejected')} />
  }
  return <LabelChip kind="unreviewed" label={t('confirm.statusUndecided')} />
}

/** What one variant makes of a claim, beside what the other makes of it (UI-043). */
function VariantSummary({
  state,
  variantKey,
  onOpen,
}: {
  state: WorkspaceElement
  variantKey: VariantKeyValue
  onOpen: () => void
}) {
  const evidence = readString(state.values, 'evidenceStatus')
  const family = readStringOrNull(state.values, 'failureFamily')
  const stance = readString(state.values, 'warrantedStance')
  const planted = readBoolean(state.values, 'planted')
  const variantName =
    variantKey === 'defective' ? t('confirm.variantDefective') : t('confirm.variantSound')

  return (
    <div className="border-line flex min-w-0 flex-1 basis-64 flex-col gap-3 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-reading">{t('confirm.claimVariant', { variant: variantName })}</h4>
        {planted && <LabelChip kind="planted" />}
      </div>
      <dl className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <dt className="text-ink-muted text-meta">{t('confirm.field.evidenceStatus')}</dt>
          <dd className="text-ink text-body">
            {evidence === 'defective'
              ? t('confirm.evidence.defective')
              : t('confirm.evidence.sound')}
          </dd>
        </div>
        {family !== null && (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <dt className="text-ink-muted text-meta">{t('confirm.field.failureFamily')}</dt>
            <dd className="text-ink text-mono-sm font-mono break-words">{family}</dd>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2">
          <dt className="text-ink-muted text-meta">{t('confirm.field.warrantedStance')}</dt>
          <dd>
            {stance.length > 0 && (
              <StanceChip
                stance={stance as StanceValue}
                srLabel={t('confirm.field.warrantedStance')}
              />
            )}
          </dd>
        </div>
      </dl>
      <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={onOpen}>
        {t('confirm.openVariant', { variant: variantName })}
      </Button>
    </div>
  )
}

export function ElementEditor(props: ElementEditorProps) {
  const {
    element,
    values,
    errors,
    formError,
    index,
    failures,
    frozen,
    canEdit,
    canDecide,
    reopened,
    dirty,
    pending,
    claimText,
    variantKey,
    variantStates,
    onFieldChange,
    onReopen,
    onOpenElement,
  } = props

  const settled = element.decision === 'confirmed' || element.decision === 'edited'
  const locked = frozen || !canEdit || (settled && !reopened)
  const specs = fieldsFor(element.elementType, values, index)
  const typeName = t(`confirm.type.${element.elementType}` as 'confirm.type.brief')
  const isSingleton = element.key === element.elementType
  const heading = isSingleton
    ? typeName
    : t('confirm.editorHeading', { type: typeName, key: element.key })

  return (
    <Panel id="element-editor" title={heading} headingLevel={2}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <DecisionChip element={element} frozen={frozen} />
          {element.decidedAt !== null && (
            <p className="text-ink-muted text-meta">
              {element.decidedByName.length > 0
                ? t('confirm.decidedBy', {
                    name: element.decidedByName,
                    date: formatDateTime(element.decidedAt),
                  })
                : t('confirm.decidedByUnknown', { date: formatDateTime(element.decidedAt) })}
              {element.revision > 1 && (
                <span className="ml-2 font-mono tabular-nums">
                  {t('confirm.revision', { revision: element.revision })}
                </span>
              )}
            </p>
          )}
        </div>

        {formError !== null && <ServerRefusal key={formError} message={formError} />}

        {failures.length > 0 && (
          <Refusal title={t('confirm.elementRulesTitle')}>
            <ul className="flex flex-col gap-2">
              {failures.map((failure) => (
                <li key={failure.code} className="flex flex-col gap-0.5">
                  <span>{failure.message}</span>
                  <span className="text-mono-sm font-mono break-words">{failure.code}</span>
                </li>
              ))}
            </ul>
          </Refusal>
        )}

        {frozen ? (
          <p className="text-ink-muted text-body max-w-[72ch]">{t('confirm.frozenBody')}</p>
        ) : settled && !reopened ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-ink-muted text-body max-w-[72ch]">{t('confirm.lockedBody')}</p>
            {canEdit && (
              <Button type="button" variant="secondary" onClick={onReopen}>
                <PencilLineIcon aria-hidden="true" />
                {t('confirm.reopen')}
              </Button>
            )}
          </div>
        ) : element.decision === 'rejected' ? (
          <Refusal title={t('confirm.rejectedTitle')}>
            <p>{t('confirm.rejectedBody')}</p>
            {element.note.length > 0 && (
              <p className="text-ink">{t('confirm.rejectedNote', { note: element.note })}</p>
            )}
          </Refusal>
        ) : null}

        {claimText !== null && (
          <Section title={t('confirm.contextTitle')}>
            <p className="text-ink text-reading max-w-[72ch]">{claimText}</p>
            {variantKey !== null && (
              <p className="text-ink-muted text-meta">
                {t('confirm.claimVariant', {
                  variant:
                    variantKey === 'defective'
                      ? t('confirm.variantDefective')
                      : t('confirm.variantSound'),
                })}
              </p>
            )}
          </Section>
        )}

        {/* A claim has eighteen fields, half of them a date, an enum or a tick. Two columns from
            `xl` puts the short ones side by side and keeps the writing at one measure: a body, a
            brief and a seed text stay full width, where the 72ch measure can hold. */}
        <div className="grid gap-x-8 gap-y-5 xl:grid-cols-2">
          {specs.map((spec) => (
            <div key={spec.name} className={cn('min-w-0', !isNarrow(spec) && 'xl:col-span-2')}>
              <EditorField
                spec={spec}
                value={values[spec.name]}
                error={errors[spec.name]}
                locked={locked}
                idPrefix={`element-${element.elementType}`}
                onChange={onFieldChange}
              />
            </div>
          ))}
        </div>

        {variantStates.length > 0 && (
          <Section title={t('confirm.variantsTitle')}>
            <p className="text-ink-muted text-body max-w-[72ch]">{t('confirm.variantsBody')}</p>
            <div className="flex w-full flex-wrap gap-4">
              {variantStates.map((state) => {
                const key =
                  index.variantKeys.get(readStringOrNull(state.values, 'variantId') ?? '') ??
                  'sound'
                return (
                  <VariantSummary
                    key={state.id}
                    state={state}
                    variantKey={key}
                    onOpen={() => onOpenElement(state.id)}
                  />
                )
              })}
            </div>
          </Section>
        )}

        {!frozen && canEdit && (
          <ConfirmBar
            elementName={heading}
            dirty={dirty}
            locked={settled && !reopened}
            canDecide={canDecide}
            pending={pending}
            onSave={props.onSave}
            onDiscard={props.onDiscard}
            onConfirm={props.onConfirm}
            onReject={props.onReject}
          />
        )}
      </div>
    </Panel>
  )
}
