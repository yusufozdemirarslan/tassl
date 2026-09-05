'use client'

import { useState, type ReactNode } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { StanceChip } from '@/components/features/run/stance-chip'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/package-confirm'
import { countWords } from '@/lib/words'
import type { StanceValue } from '@/server/modules/scenarios/schema'
import type { FieldSpec, RowColumn, SelectOption } from './field-spec'

// The controls the element editor draws from a `FieldSpec` (UI-043).
//
// Three rules hold across all of them, and they are the reason this is one file rather than a
// control per element type:
//
//   1. Every control is labelled, and the label is visible. A `FieldLabel` points at the control's
//      own id; a group of controls (a list of phrases, a set of documents, the three verification
//      paths) is a `fieldset` with a `legend`, because a group of checkboxes with a floating
//      heading above it is a heading, not a name.
//   2. An error replaces the hint it restates, and is announced where it happened. `FieldError`
//      carries `role="alert"`, so a refusal arriving from the server is read out under the field
//      it belongs to rather than as a banner the author has to go looking for.
//   3. Locked is not disabled. A confirmed element and a frozen version are read, at length, by
//      the person deciding whether to reopen them: text keeps full ink and stays selectable
//      (`readOnly` plus the sunken well DESIGN.md gives an uneditable input), and only the
//      controls that have no read-only state — selects, checkboxes, the row buttons — are
//      disabled.
//
// Word counts run through `countWords` from `src/lib/words`, which is the same function
// `wordLimit` runs server-side: D-075 exists so the number under the textarea and the number the
// validator refuses on are the same number.

/** The value a nullable select carries when nothing is chosen; never a real id or key. */
const NONE = '__none'

export type FieldChange = (name: string, value: unknown) => void

export type EditorFieldProps = {
  spec: FieldSpec
  value: unknown
  /** The message under the field: a server `fieldErrors` entry, or a local refusal. */
  error: string | undefined
  locked: boolean
  idPrefix: string
  onChange: FieldChange
}

const lockedInput = (locked: boolean): string | undefined =>
  locked ? 'bg-paper-sunken cursor-default' : undefined

/**
 * Label, control, and one line beneath it that is either the hint or the refusal — never both, so
 * a rule is never stated twice and the stack never grows a line under refusal.
 */
function FieldShell({
  id,
  label,
  hint,
  error,
  meta,
  children,
}: {
  id: string
  label: string
  hint: string | undefined
  error: string | undefined
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <Field data-invalid={error ? 'true' : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 flex-1">
          {error ? (
            <FieldError id={`${id}-error`}>{error}</FieldError>
          ) : hint ? (
            <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>
          ) : null}
        </div>
        {meta}
      </div>
    </Field>
  )
}

/** A group of controls that share one name (a list, a set, a sub-object). */
function GroupShell({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint: string | undefined
  error: string | undefined
  children: ReactNode
  className?: string
}) {
  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-2', className)}>
      <legend className="text-meta text-ink mb-1 font-medium">{label}</legend>
      {hint && !error && <p className="text-ink-muted text-meta -mt-1">{hint}</p>}
      {error && (
        <p role="alert" className="text-meta text-red">
          {error}
        </p>
      )}
      {children}
    </fieldset>
  )
}

const describedBy = (id: string, hint: string | undefined, error: string | undefined): string =>
  error ? `${id}-error` : hint ? `${id}-hint` : ''

export function EditorField({ spec, value, error, locked, idPrefix, onChange }: EditorFieldProps) {
  const id = `${idPrefix}-${spec.name}`
  const description = describedBy(id, spec.hint, error)
  const aria = {
    ...(error ? { 'aria-invalid': true as const } : {}),
    ...(description ? { 'aria-describedby': description } : {}),
  }

  switch (spec.kind) {
    case 'text':
      return (
        <FieldShell id={id} label={spec.label} hint={spec.hint} error={error}>
          <Input
            id={id}
            autoComplete="off"
            readOnly={locked}
            spellCheck={spec.mono ? false : undefined}
            className={cn(spec.mono && 'font-mono', lockedInput(locked))}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(spec.name, event.target.value)}
            {...aria}
          />
        </FieldShell>
      )

    case 'date':
      return (
        <FieldShell id={id} label={spec.label} hint={spec.hint} error={error}>
          <Input
            id={id}
            type="date"
            readOnly={locked}
            className={cn('w-fit min-w-48 font-mono tabular-nums', lockedInput(locked))}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(spec.name, event.target.value)}
            {...aria}
          />
        </FieldShell>
      )

    case 'number':
      return (
        <FieldShell id={id} label={spec.label} hint={spec.hint} error={error}>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            readOnly={locked}
            min={spec.min}
            max={spec.max}
            className={cn('w-fit min-w-32 font-mono tabular-nums', lockedInput(locked))}
            value={typeof value === 'number' ? String(value) : ''}
            onChange={(event) => {
              const raw = event.target.value
              if (raw === '') {
                onChange(spec.name, spec.nullable === true ? null : '')
                return
              }
              const parsed = Number(raw)
              onChange(spec.name, Number.isFinite(parsed) ? parsed : raw)
            }}
            {...aria}
          />
        </FieldShell>
      )

    case 'textarea':
      return (
        <WordCountedTextarea
          id={id}
          spec={spec}
          value={typeof value === 'string' ? value : ''}
          error={error}
          locked={locked}
          onChange={onChange}
          aria={aria}
        />
      )

    case 'select':
      return (
        <FieldShell id={id} label={spec.label} hint={spec.hint} error={error}>
          <OptionSelect
            id={id}
            options={spec.options}
            nullable={spec.nullable === true}
            value={typeof value === 'string' ? value : null}
            locked={locked}
            onValueChange={(next) => onChange(spec.name, next)}
            aria={aria}
          />
        </FieldShell>
      )

    case 'stance':
      return (
        <FieldShell id={id} label={spec.label} hint={spec.hint} error={error}>
          <StanceSelect
            id={id}
            options={spec.options}
            value={typeof value === 'string' ? (value as StanceValue) : null}
            locked={locked}
            onValueChange={(next) => onChange(spec.name, next)}
            aria={aria}
          />
        </FieldShell>
      )

    case 'checkbox':
      return (
        <Field orientation="horizontal" data-invalid={error ? 'true' : undefined}>
          <Checkbox
            id={id}
            checked={value === true}
            disabled={locked}
            onCheckedChange={(checked: boolean) => onChange(spec.name, checked)}
            aria-labelledby={`${id}-label`}
            {...aria}
          />
          <FieldContent>
            <FieldLabel id={`${id}-label`} htmlFor={id}>
              {spec.label}
            </FieldLabel>
            {error ? (
              <FieldError id={`${id}-error`}>{error}</FieldError>
            ) : spec.hint ? (
              <FieldDescription id={`${id}-hint`}>{spec.hint}</FieldDescription>
            ) : null}
          </FieldContent>
        </Field>
      )

    case 'strings':
      return (
        <StringListField
          idPrefix={id}
          spec={spec}
          values={
            Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
          }
          error={error}
          locked={locked}
          onChange={onChange}
        />
      )

    case 'multi':
      return (
        <MultiSelectField
          idPrefix={id}
          spec={spec}
          selected={
            Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
          }
          error={error}
          locked={locked}
          onChange={onChange}
        />
      )

    case 'json':
      return (
        <JsonField
          id={id}
          spec={spec}
          value={value}
          error={error}
          locked={locked}
          onChange={onChange}
        />
      )

    case 'rows':
      return (
        <RowsField
          idPrefix={id}
          spec={spec}
          rows={readRows(value)}
          error={error}
          locked={locked}
          onChange={onChange}
        />
      )

    case 'verificationPaths':
      return (
        <VerificationPathsField
          idPrefix={id}
          spec={spec}
          value={readObject(value)}
          error={error}
          locked={locked}
          onChange={onChange}
        />
      )

    case 'difficulty':
      return (
        <DifficultyField
          idPrefix={id}
          value={readObject(value)}
          error={error}
          locked={locked}
          onChange={onChange}
        />
      )
  }
}

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------

type AriaProps = { 'aria-invalid'?: true; 'aria-describedby'?: string }

function WordCountedTextarea({
  id,
  spec,
  value,
  error,
  locked,
  onChange,
  aria,
}: {
  id: string
  spec: Extract<FieldSpec, { kind: 'textarea' }>
  value: string
  error: string | undefined
  locked: boolean
  onChange: FieldChange
  aria: AriaProps
}) {
  const limit = spec.wordLimit
  const words = limit === undefined ? 0 : countWords(value)
  const over = limit !== undefined && words > limit
  return (
    <FieldShell
      id={id}
      label={spec.label}
      hint={spec.hint}
      error={error ?? (over ? t('confirm.wordLimit', { limit, count: words }) : undefined)}
      meta={
        limit === undefined ? null : (
          <span
            className={cn(
              'text-mono-sm shrink-0 font-mono tabular-nums',
              over ? 'text-red' : 'text-ink-muted',
            )}
          >
            {t('confirm.wordCount', { count: words, limit })}
          </span>
        )
      }
    >
      <Textarea
        id={id}
        rows={spec.rows ?? 4}
        readOnly={locked}
        className={cn(
          spec.reading === true && 'text-reading max-w-[72ch]',
          lockedInput(locked),
          over && 'border-red',
        )}
        value={value}
        onChange={(event) => onChange(spec.name, event.target.value)}
        {...aria}
      />
    </FieldShell>
  )
}

function OptionSelect({
  id,
  options,
  nullable,
  value,
  locked,
  onValueChange,
  aria,
}: {
  id: string
  options: readonly SelectOption[]
  nullable: boolean
  value: string | null
  locked: boolean
  onValueChange: (value: string | null) => void
  aria: AriaProps
}) {
  const items = [
    ...(nullable ? [{ value: NONE, label: t('confirm.optionNone') }] : []),
    ...options.map((option) => ({ value: option.value, label: option.label })),
  ]
  // A stored value whose element has since been renamed away still has to show as something; the
  // key is what an author searches the export for, so the key is what an orphan reads as.
  const known = value === null || items.some((item) => item.value === value)
  const resolved = value === null ? (nullable ? NONE : null) : value

  return (
    <Select
      items={known ? items : [...items, { value, label: value }]}
      value={resolved}
      disabled={locked}
      onValueChange={(next: string | null) => {
        if (next === null) return
        onValueChange(next === NONE ? null : next)
      }}
    >
      <SelectTrigger id={id} className="w-full max-w-md" disabled={locked} {...aria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {nullable && <SelectItem value={NONE}>{t('confirm.optionNone')}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="min-w-0 truncate">{option.label}</span>
              {option.caption !== undefined && (
                <span className="text-ink-muted text-mono-sm shrink-0 font-mono">
                  {option.caption}
                </span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The warranted stance, drawn with the product's one stance mark (DESIGN.md's Labelled-Stance
 * Rule): the colour never appears without the label and the icon, in the trigger and in the list
 * alike, so the five readings are told apart without colour vision.
 */
function StanceSelect({
  id,
  options,
  value,
  locked,
  onValueChange,
  aria,
}: {
  id: string
  options: readonly StanceValue[]
  value: StanceValue | null
  locked: boolean
  onValueChange: (value: StanceValue) => void
  aria: AriaProps
}) {
  return (
    <Select
      value={value}
      disabled={locked}
      onValueChange={(next: string | null) => {
        if (next !== null) onValueChange(next as StanceValue)
      }}
    >
      <SelectTrigger id={id} className="w-fit min-w-56" disabled={locked} {...aria}>
        <SelectValue>
          {(selected: unknown) =>
            typeof selected === 'string' ? <StanceChip stance={selected as StanceValue} /> : null
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((stance) => (
          <SelectItem key={stance} value={stance}>
            <StanceChip stance={stance} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StringListField({
  idPrefix,
  spec,
  values,
  error,
  locked,
  onChange,
}: {
  idPrefix: string
  spec: Extract<FieldSpec, { kind: 'strings' }>
  values: readonly string[]
  error: string | undefined
  locked: boolean
  onChange: FieldChange
}) {
  const write = (next: string[]): void => onChange(spec.name, next)
  return (
    <GroupShell label={spec.label} hint={spec.hint} error={error}>
      {values.length === 0 && <p className="text-ink-muted text-meta">{t('confirm.emptyRows')}</p>}
      <ul className="flex flex-col gap-2">
        {values.map((entry, index) => {
          const id = `${idPrefix}-${String(index)}`
          return (
            <li key={id} className="flex items-center gap-2">
              <label htmlFor={id} className="sr-only">
                {t('confirm.rowLabel', { name: spec.itemName, index: index + 1 })}
              </label>
              <Input
                id={id}
                readOnly={locked}
                className={lockedInput(locked)}
                value={entry}
                onChange={(event) =>
                  write(values.map((old, at) => (at === index ? event.target.value : old)))
                }
              />
              {!locked && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => write(values.filter((_, at) => at !== index))}
                >
                  <XIcon aria-hidden="true" />
                  <span className="sr-only">
                    {t('confirm.removeRow', {
                      name: `${spec.itemName} ${String(index + 1)}`,
                    })}
                  </span>
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {!locked && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-fit"
          onClick={() => write([...values, ''])}
        >
          <PlusIcon aria-hidden="true" />
          {t('confirm.addRow', { name: spec.itemName })}
        </Button>
      )}
    </GroupShell>
  )
}

function MultiSelectField({
  idPrefix,
  spec,
  selected,
  error,
  locked,
  onChange,
}: {
  idPrefix: string
  spec: Extract<FieldSpec, { kind: 'multi' }>
  selected: readonly string[]
  error: string | undefined
  locked: boolean
  onChange: FieldChange
}) {
  if (spec.options.length === 0) {
    return (
      <GroupShell label={spec.label} hint={spec.hint} error={error}>
        <p className="text-ink-muted text-meta">{t('confirm.emptyRows')}</p>
      </GroupShell>
    )
  }
  return (
    <GroupShell label={spec.label} hint={spec.hint} error={error}>
      <ul className="flex flex-col gap-2">
        {spec.options.map((option) => {
          const id = `${idPrefix}-${option.value}`
          const checked = selected.includes(option.value)
          return (
            <li key={option.value}>
              <Field orientation="horizontal">
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={locked}
                  aria-labelledby={`${id}-label`}
                  onCheckedChange={(next: boolean) =>
                    onChange(
                      spec.name,
                      next
                        ? [...selected, option.value]
                        : selected.filter((entry) => entry !== option.value),
                    )
                  }
                />
                <FieldContent>
                  <FieldLabel id={`${id}-label`} htmlFor={id} className="flex-wrap gap-x-2">
                    <span>{option.label}</span>
                    {option.caption !== undefined && (
                      <span className="text-ink-muted text-mono-sm font-mono">
                        {option.caption}
                      </span>
                    )}
                  </FieldLabel>
                </FieldContent>
              </Field>
            </li>
          )
        })}
      </ul>
    </GroupShell>
  )
}

/**
 * The one jsonb object an author writes by hand (`defense_questions.condition`).
 *
 * The text is held here while it is being typed — a half-written object does not parse, and
 * reparsing on every keystroke would delete what is being typed — and the parsed value is written
 * up on every change that is valid JSON, so nothing is lost between here and the save.
 *
 * The held text is *not* a second copy of the value. `from` records the stored object the text was
 * last in step with, and the moment the element's own value moves away from it — the author
 * discarded the edits, a save came back normalised, or the editor is showing a different question
 * of the same shape — the box goes back to saying what the element says. Only while the two agree
 * does the box stay ahead, which is the whole reason it exists.
 */
function JsonField({
  id,
  spec,
  value,
  error,
  locked,
  onChange,
}: {
  id: string
  spec: Extract<FieldSpec, { kind: 'json' }>
  value: unknown
  error: string | undefined
  locked: boolean
  onChange: FieldChange
}) {
  const stored = JSON.stringify(value ?? {}, null, 2)
  const [typed, setTyped] = useState<{ text: string; from: string; malformed: boolean } | null>(
    null,
  )
  const live = typed !== null && typed.from === stored
  const text = live ? typed.text : stored
  const malformed = live && typed.malformed

  return (
    <FieldShell
      id={id}
      label={spec.label}
      hint={spec.hint}
      error={error ?? (malformed ? t('confirm.jsonInvalid') : undefined)}
    >
      <Textarea
        id={id}
        rows={4}
        readOnly={locked}
        spellCheck={false}
        className={cn('text-mono font-mono', lockedInput(locked), malformed && 'border-red')}
        value={text}
        onChange={(event) => {
          const next = event.target.value
          const parsed = parseObject(next)
          if (parsed === null) {
            setTyped({ text: next, from: stored, malformed: true })
            return
          }
          // The value the element is about to hold, so the echo of this keystroke does not read as
          // someone else changing it underneath the box.
          setTyped({ text: next, from: JSON.stringify(parsed, null, 2), malformed: false })
          onChange(spec.name, parsed)
        }}
        aria-invalid={error || malformed ? true : undefined}
        aria-describedby={error || malformed ? `${id}-error` : spec.hint ? `${id}-hint` : undefined}
      />
    </FieldShell>
  )
}

/** A JSON object, or null for anything else — a half-written one, an array, a bare number. */
function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const readRows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      )
    : []

const readObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

/** One cell of a repeatable row; the row's own label names it for assistive technology. */
function RowCell({
  id,
  column,
  value,
  locked,
  onChange,
}: {
  id: string
  column: RowColumn
  value: unknown
  locked: boolean
  onChange: (value: unknown) => void
}) {
  switch (column.kind) {
    case 'textarea':
      return (
        <Textarea
          id={id}
          rows={2}
          readOnly={locked}
          className={lockedInput(locked)}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          readOnly={locked}
          className={cn('font-mono tabular-nums', lockedInput(locked))}
          value={typeof value === 'number' ? String(value) : ''}
          onChange={(event) => {
            const parsed = Number(event.target.value)
            onChange(event.target.value === '' || !Number.isFinite(parsed) ? 0 : parsed)
          }}
        />
      )
    case 'select':
      return (
        <OptionSelect
          id={id}
          options={column.options}
          nullable={column.optional === true}
          value={typeof value === 'string' ? value : null}
          locked={locked}
          onValueChange={onChange}
          aria={{}}
        />
      )
    case 'text':
      return (
        <Input
          id={id}
          autoComplete="off"
          readOnly={locked}
          className={cn(column.mono === true && 'font-mono', lockedInput(locked))}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
        />
      )
  }
}

/**
 * A repeatable record: the four options of a readiness item, the figures a claim carries, the
 * entries of the re-skin log. Rows are separated by a hairline rather than boxed — the editor is
 * already inside a panel, and DESIGN.md's One-Layer Rule leaves whitespace and a rule as the second
 * level of grouping.
 */
function RowsField({
  idPrefix,
  spec,
  rows,
  error,
  locked,
  onChange,
}: {
  idPrefix: string
  spec: Extract<FieldSpec, { kind: 'rows' }>
  rows: readonly Record<string, unknown>[]
  error: string | undefined
  locked: boolean
  onChange: FieldChange
}) {
  const write = (next: Record<string, unknown>[]): void => onChange(spec.name, next)

  /**
   * One cell of one row. An `optional` select answers `null` for its None choice, and the key is
   * *deleted* rather than set to null: the schema behind such a column spells the field
   * `.optional()`, so an absent key is the shape it accepts and a null one is the shape it refuses
   * with "expected string, received null" — a type error naming no row, on a row the author has no
   * way to make valid.
   */
  const writeCell = (at: number, column: RowColumn, next: unknown): void =>
    write(
      rows.map((old, index) => {
        if (index !== at) return old
        if (next === null && column.kind === 'select' && column.optional === true) {
          const without = { ...old }
          delete without[column.name]
          return without
        }
        return { ...old, [column.name]: next }
      }),
    )

  return (
    <GroupShell label={spec.label} hint={spec.hint} error={error}>
      {rows.length === 0 && <p className="text-ink-muted text-meta">{t('confirm.emptyRows')}</p>}
      <ul className="flex flex-col">
        {rows.map((row, index) => (
          <li
            key={`${idPrefix}-${String(index)}`}
            className="border-line flex flex-col gap-3 border-t py-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-ink text-meta font-medium">
                {t('confirm.rowLabel', { name: spec.itemName, index: index + 1 })}
              </p>
              {!locked && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => write(rows.filter((_, at) => at !== index))}
                >
                  <XIcon aria-hidden="true" />
                  {t('confirm.removeRow', {
                    name: `${spec.itemName} ${String(index + 1)}`,
                  })}
                </Button>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {spec.columns.map((column) => {
                const id = `${idPrefix}-${String(index)}-${column.name}`
                return (
                  <div
                    key={column.name}
                    className={cn(
                      'flex min-w-0 flex-col gap-1',
                      column.kind === 'textarea' || column.width === 'wide'
                        ? 'sm:col-span-2'
                        : undefined,
                      column.width === 'narrow' ? 'sm:max-w-32' : undefined,
                    )}
                  >
                    <label htmlFor={id} className="text-ink-muted text-meta font-medium">
                      {column.label}
                    </label>
                    <RowCell
                      id={id}
                      column={column}
                      value={row[column.name]}
                      locked={locked}
                      onChange={(next) => writeCell(index, column, next)}
                    />
                  </div>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
      {!locked && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="w-fit"
          onClick={() => write([...rows, spec.newRow()])}
        >
          <PlusIcon aria-hidden="true" />
          {t('confirm.addRow', { name: spec.itemName })}
        </Button>
      )}
    </GroupShell>
  )
}

/**
 * The three interrogation paths of one variant claim state (`verification_paths`, DATA-021). The
 * keys stay snake_case because this object travels into the trace and the export exactly as it is
 * stored; a path that is switched off is deleted rather than emptied, because an empty Source Trace
 * and no Source Trace are different answers to "what does verifying this claim return?".
 */
function VerificationPathsField({
  idPrefix,
  spec,
  value,
  error,
  locked,
  onChange,
}: {
  idPrefix: string
  spec: Extract<FieldSpec, { kind: 'verificationPaths' }>
  value: Record<string, unknown>
  error: string | undefined
  locked: boolean
  onChange: FieldChange
}) {
  const sourceTrace = readObject(value['source_trace'])
  const replication = readObject(value['replication_check'])
  const decomposition = readObject(value['decomposition_check'])
  const steps = readRows(decomposition['steps'])

  const writePath = (path: string, next: Record<string, unknown> | null): void => {
    const copy = { ...value }
    if (next === null) delete copy[path]
    else copy[path] = next
    onChange(spec.name, copy)
  }

  const toggle = (path: string, present: boolean, empty: Record<string, unknown>): ReactNode => {
    const id = `${idPrefix}-${path}`
    return (
      <Field orientation="horizontal">
        <Checkbox
          id={id}
          checked={present}
          disabled={locked}
          aria-labelledby={`${id}-label`}
          onCheckedChange={(next: boolean) => writePath(path, next ? empty : null)}
        />
        <FieldContent>
          <FieldLabel id={`${id}-label`} htmlFor={id}>
            {t('confirm.field.pathOn')}
          </FieldLabel>
        </FieldContent>
      </Field>
    )
  }

  const hasTrace = 'source_trace' in value
  const hasReplication = 'replication_check' in value
  const hasDecomposition = 'decomposition_check' in value

  return (
    <GroupShell label={spec.label} hint={spec.hint} error={error} className="gap-4">
      <fieldset className="border-line flex flex-col gap-3 border-t pt-4">
        <legend className="text-ink text-body mb-1 font-medium">
          {t('confirm.field.sourceTrace')}
        </legend>
        {toggle('source_trace', hasTrace, {
          document_id: '',
          passage: '',
          dated_on: '',
          author: '',
        })}
        {hasTrace && (
          <div className="grid gap-4 sm:grid-cols-2">
            <EditorField
              spec={{
                kind: 'select',
                name: 'document_id',
                label: t('confirm.field.traceDocument'),
                options: spec.documents,
              }}
              value={sourceTrace['document_id']}
              error={undefined}
              locked={locked}
              idPrefix={`${idPrefix}-trace`}
              onChange={(name, next) => writePath('source_trace', { ...sourceTrace, [name]: next })}
            />
            <EditorField
              spec={{ kind: 'date', name: 'dated_on', label: t('confirm.field.traceDatedOn') }}
              value={sourceTrace['dated_on']}
              error={undefined}
              locked={locked}
              idPrefix={`${idPrefix}-trace`}
              onChange={(name, next) => writePath('source_trace', { ...sourceTrace, [name]: next })}
            />
            <div className="sm:col-span-2">
              <EditorField
                spec={{ kind: 'text', name: 'author', label: t('confirm.field.traceAuthor') }}
                value={sourceTrace['author']}
                error={undefined}
                locked={locked}
                idPrefix={`${idPrefix}-trace`}
                onChange={(name, next) =>
                  writePath('source_trace', { ...sourceTrace, [name]: next })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <EditorField
                spec={{
                  kind: 'textarea',
                  name: 'passage',
                  label: t('confirm.field.tracePassage'),
                  rows: 3,
                }}
                value={sourceTrace['passage']}
                error={undefined}
                locked={locked}
                idPrefix={`${idPrefix}-trace`}
                onChange={(name, next) =>
                  writePath('source_trace', { ...sourceTrace, [name]: next })
                }
              />
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="border-line flex flex-col gap-3 border-t pt-4">
        <legend className="text-ink text-body mb-1 font-medium">
          {t('confirm.field.replicationCheck')}
        </legend>
        {toggle('replication_check', hasReplication, { result: '' })}
        {hasReplication && (
          <EditorField
            spec={{
              kind: 'textarea',
              name: 'result',
              label: t('confirm.field.replicationResult'),
              rows: 3,
            }}
            value={replication['result']}
            error={undefined}
            locked={locked}
            idPrefix={`${idPrefix}-replication`}
            onChange={(name, next) => writePath('replication_check', { [name]: next })}
          />
        )}
      </fieldset>

      <fieldset className="border-line flex flex-col gap-3 border-t pt-4">
        <legend className="text-ink text-body mb-1 font-medium">
          {t('confirm.field.decompositionCheck')}
        </legend>
        {toggle('decomposition_check', hasDecomposition, { steps: [] })}
        {hasDecomposition && (
          <EditorField
            spec={{
              kind: 'rows',
              name: 'steps',
              label: t('confirm.field.decompositionCheck'),
              itemName: t('confirm.field.decompositionStep'),
              newRow: () => ({ label: '', result: '' }),
              columns: [
                { kind: 'text', name: 'label', label: t('confirm.field.stepLabel') },
                { kind: 'textarea', name: 'result', label: t('confirm.field.stepResult') },
              ],
            }}
            value={steps}
            error={undefined}
            locked={locked}
            idPrefix={`${idPrefix}-decomposition`}
            onChange={(_name, next) => writePath('decomposition_check', { steps: next })}
          />
        )}
      </fieldset>
    </GroupShell>
  )
}

/** `difficulty_profile`: the estimate, the note behind it, and whether a cohort has ever run it. */
function DifficultyField({
  idPrefix,
  value,
  error,
  locked,
  onChange,
}: {
  idPrefix: string
  value: Record<string, unknown>
  error: string | undefined
  locked: boolean
  onChange: FieldChange
}) {
  const write = (field: string, next: unknown): void =>
    onChange('difficultyProfile', { ...value, [field]: next })
  return (
    <GroupShell label={t('confirm.field.difficultyProfile')} hint={undefined} error={error}>
      <EditorField
        spec={{ kind: 'text', name: 'estimate', label: t('confirm.field.difficultyEstimate') }}
        value={value['estimate']}
        error={undefined}
        locked={locked}
        idPrefix={idPrefix}
        onChange={write}
      />
      <EditorField
        spec={{
          kind: 'textarea',
          name: 'note',
          label: t('confirm.field.difficultyNote'),
          rows: 3,
        }}
        value={value['note']}
        error={undefined}
        locked={locked}
        idPrefix={idPrefix}
        onChange={write}
      />
      <EditorField
        spec={{
          kind: 'checkbox',
          name: 'uncalibrated',
          label: t('confirm.field.difficultyUncalibrated'),
          hint: t('confirm.field.difficultyUncalibratedHint'),
        }}
        value={value['uncalibrated']}
        error={undefined}
        locked={locked}
        idPrefix={idPrefix}
        onChange={write}
      />
    </GroupShell>
  )
}
