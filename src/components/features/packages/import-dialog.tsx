'use client'

import { useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { toast } from 'sonner'
import { SubmitButton } from '@/components/features/account/form-feedback'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/lib/i18n/messages/package-import'
import { importPackageAction } from '@/server/modules/scenarios/actions'

// UI-041's second route (SYS-026): a package export somebody already wrote, pasted whole. It is a
// dialog on the press that opens it (B4, ./seed-form) and mounts already open, the same shape the
// roster's dialogs use.
//
// What this screen is really for is the refusals. `IMPORT_INVALID` and `PACKAGE_INVALID` both come
// back with `details` naming what the document got wrong — a schema issue at a path, a key the
// document references but never defines, a rule of `validatePackage` that the package breaks and
// the element keys at fault — and a person holding a 4,000-line JSON file cannot act on the code
// alone. So the refusal is rendered as the list of things to fix, in the document's own vocabulary
// (`C3`, `documents.2.body`), and not as one sentence with a request id.
//
// A successful import can still carry failures: `importPackage` returns the rule report rather than
// refusing, which is what lets an author bring in a half-finished package and finish it in the
// confirmation workspace. The dialog says which it was and links to the version either way.
//
// A refusal is written in the same grammar as the seed form's, because it is the same author on the
// same errand: it paints the field it belongs to — danger label, danger border, the sentence under
// the control with its icon, taking the hint's place — rather than standing off in a banner of its
// own. There is one field here, and everything that can be refused is something in it.

export type ImportPackageDialogProps = {
  /** The institution the package is written into; an export carries no tenant of its own. */
  orgId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** One thing wrong with the document, as the person has to go and fix it. */
type Problem = { id: string; code: string; message: string; where: string | null }

type Refusal = { headline: string; problems: Problem[] }

type Imported = { packageId: string; versionId: string; problems: Problem[] }

/** Beyond this the list stops being a list and becomes a wall; the rest are counted. */
const PROBLEM_LIMIT = 12

const versionHref = (packageId: string, versionId: string): Route => {
  const href: string = `/packages/${packageId}/versions/${versionId}`
  return href as Route
}

export function ImportPackageDialog({ orgId, open, onOpenChange }: ImportPackageDialogProps) {
  const [pastedExport, setPastedExport] = useState('')
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)
  const [imported, setImported] = useState<Imported | null>(null)

  const documentField = useRef<HTMLTextAreaElement>(null)

  /** The refusal belongs to the field, so the field is where the person is put to act on it. */
  function refuse(next: Refusal): void {
    setRefusal(next)
    documentField.current?.focus()
  }

  async function submit(): Promise<void> {
    if (pending) return
    setRefusal(null)

    const raw = pastedExport.trim()
    if (raw.length === 0) {
      refuse({ headline: t('packageImport.empty'), problems: [] })
      return
    }

    // The parse happens here, not on the server, so a stray character is answered without a round
    // trip and the sentence can say what the file should look like.
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      refuse({ headline: t('packageImport.notJson'), problems: [] })
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      refuse({ headline: t('packageImport.notObject'), problems: [] })
      return
    }

    setPending(true)
    const result = await importPackageAction({ orgId, document: parsed })
    setPending(false)

    if (!result.ok) {
      refuse(toRefusal(result.error.code, result.error.message, result.error.details))
      return
    }

    const problems = toValidationProblems(result.data.validation.failures)
    setImported({ packageId: result.data.packageId, versionId: result.data.versionId, problems })
    toast.success(
      problems.length === 0
        ? t('packageImport.done')
        : t('packageImport.doneWithFailures', { count: problems.length }),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('packageImport.title')}</DialogTitle>
          <DialogDescription>
            {imported === null
              ? t('packageImport.description')
              : t('packageImport.importedDescription')}
          </DialogDescription>
        </DialogHeader>

        {imported === null ? (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <Field data-invalid={refusal ? 'true' : undefined}>
              <FieldLabel htmlFor="package-import-document">
                {t('packageImport.documentLabel')}
              </FieldLabel>
              <Textarea
                id="package-import-document"
                ref={documentField}
                rows={10}
                spellCheck={false}
                className="text-mono-sm font-mono"
                aria-invalid={refusal ? true : undefined}
                aria-describedby={
                  refusal ? 'package-import-document-error' : 'package-import-document-hint'
                }
                value={pastedExport}
                onChange={(event) => setPastedExport(event.target.value)}
              />
              {refusal ? (
                <FieldError id="package-import-document-error">
                  <div className="flex flex-col gap-2">
                    <p>{refusal.headline}</p>
                    {refusal.problems.length > 0 && <ProblemList problems={refusal.problems} />}
                  </div>
                </FieldError>
              ) : (
                <FieldDescription id="package-import-document-hint">
                  {t('packageImport.documentHint')}
                </FieldDescription>
              )}
            </Field>

            <DialogFooter className="mt-6">
              <DialogClose render={<Button variant="secondary" disabled={pending} />}>
                {t('packageImport.cancel')}
              </DialogClose>
              <SubmitButton pending={pending}>
                {pending ? t('packageImport.pending') : t('packageImport.submit')}
              </SubmitButton>
            </DialogFooter>
          </form>
        ) : (
          <ImportedPanel imported={imported} />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** What the version now holds, and whether anything about it still has to be put right. */
function ImportedPanel({ imported }: { imported: Imported }) {
  return (
    <div className="flex flex-col gap-4">
      <div role="status" className="flex flex-col gap-3">
        <p className="text-ink text-body">
          {imported.problems.length === 0
            ? t('packageImport.importedClean')
            : t('packageImport.importedWithFailures')}
        </p>
        {imported.problems.length > 0 && (
          <div className="border-line bg-paper-sunken text-ink rounded-md border p-3">
            <ProblemList problems={imported.problems} />
          </div>
        )}
      </div>

      <DialogFooter>
        <DialogClose render={<Button variant="secondary" />}>
          {t('packageImport.close')}
        </DialogClose>
        <Link
          href={versionHref(imported.packageId, imported.versionId)}
          className={buttonVariants({ className: 'w-fit' })}
        >
          {t('packageImport.openVersion')}
        </Link>
      </DialogFooter>
    </div>
  )
}

/**
 * The list itself: the sentence to act on, then the rule code and where it applies in mono, because
 * that is the string the author searches the file for. Full ink throughout — under a refusal it is
 * the detail beneath a red sentence, and after an import it sits on a sunken wash, where DESIGN.md
 * allows no muted text either way.
 */
function ProblemList({ problems }: { problems: readonly Problem[] }): ReactNode {
  const shown = problems.slice(0, PROBLEM_LIMIT)
  const hidden = problems.length - shown.length

  return (
    <ul className="text-meta flex w-full flex-col gap-2">
      {shown.map((problem) => (
        <li key={problem.id} className="flex flex-col gap-0.5">
          <span className="text-ink">{problem.message}</span>
          <span className="text-ink text-mono-sm font-mono break-words">
            {problem.where === null ? problem.code : `${problem.code} · ${problem.where}`}
          </span>
        </li>
      ))}
      {hidden > 0 && (
        <li className="text-ink">{t('packageImport.moreProblems', { count: hidden })}</li>
      )}
    </ul>
  )
}

// ---------------------------------------------------------------------------------------------
// Reading `details` (10 §4 errors.ts): what each refusal carries, and nothing assumed about it
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** The four kinds of key an export cross-references (`writeImportedPackage`). */
function referenceKind(kind: string): string {
  switch (kind) {
    case 'document':
      return t('packageImport.kindDocument')
    case 'stakeholder':
      return t('packageImport.kindStakeholder')
    case 'claim':
      return t('packageImport.kindClaim')
    case 'variant':
      return t('packageImport.kindVariant')
    default:
      return kind
  }
}

/** A Zod issue path (`documents`, 2, `body`) as the author reads it in the file. */
function issuePath(path: unknown): string | null {
  if (!Array.isArray(path) || path.length === 0) return null
  const parts = path.filter(
    (part): part is string | number => typeof part === 'string' || typeof part === 'number',
  )
  if (parts.length === 0) return null
  return t('packageImport.problemAt', { path: parts.join('.') })
}

/** `PACKAGE_INVALID.details.failures`, and the same shape in a successful import's report. */
function toValidationProblems(failures: unknown): Problem[] {
  if (!Array.isArray(failures)) return []
  return failures.filter(isRecord).map((failure, index) => {
    const elementIds = Array.isArray(failure.elementIds)
      ? failure.elementIds.filter((id): id is string => typeof id === 'string')
      : []
    return {
      id: `rule-${index}`,
      code: asString(failure.code) ?? 'PACKAGE_INVALID',
      message: asString(failure.message) ?? t('packageImport.problemUnnamed'),
      where:
        elementIds.length > 0
          ? t('packageImport.problemElements', { keys: elementIds.join(', ') })
          : null,
    }
  })
}

/** `IMPORT_INVALID.details`: a schema parse, a key that names nothing, or a supersede loop. */
function toImportProblems(details: Record<string, unknown>): Problem[] {
  if (Array.isArray(details.issues)) {
    return details.issues.filter(isRecord).map((issue, index) => ({
      id: `issue-${index}`,
      code: asString(issue.code) ?? 'invalid',
      message: asString(issue.message) ?? t('packageImport.problemUnnamed'),
      where: issuePath(issue.path),
    }))
  }

  const reference = asString(details.reference)
  if (reference === null) return []

  if (Array.isArray(details.cycle)) {
    const keys = details.cycle.filter((key): key is string => typeof key === 'string')
    return [
      {
        id: 'cycle',
        code: 'IMPORT_INVALID',
        message: t('packageImport.documentCycle', { keys: keys.join(', ') }),
        where: null,
      },
    ]
  }

  const key = asString(details.key)
  if (key === null) return []
  return [
    {
      id: 'reference',
      code: 'IMPORT_INVALID',
      message: t('packageImport.unknownReference', { kind: referenceKind(reference), key }),
      where: null,
    },
  ]
}

/**
 * The refusal as the dialog states it. Two codes get a headline of their own because the person can
 * act on them; everything else keeps the service's own sentence, which is already written for a
 * reader (a permission refusal, a rate limit, a fault with a request id).
 */
function toRefusal(code: string, message: string, details: unknown): Refusal {
  if (code === 'CONFLICT') return { headline: t('packageImport.conflict'), problems: [] }

  if (code === 'PACKAGE_INVALID' && isRecord(details)) {
    return {
      headline: t('packageImport.invalidHeadline'),
      problems: toValidationProblems(details.failures),
    }
  }

  if (code === 'IMPORT_INVALID' && isRecord(details)) {
    return { headline: t('packageImport.refusedHeadline'), problems: toImportProblems(details) }
  }

  return { headline: message, problems: [] }
}
