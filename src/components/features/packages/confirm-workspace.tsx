'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { ArrowRightIcon, CircleAlertIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Panel } from '@/components/layout/panel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { t } from '@/lib/i18n/messages/package-confirm'
import { countWords } from '@/lib/words'
import { regenerateElementAction } from '@/server/modules/authoring/actions'
import {
  confirmVersionAction,
  decideElementAction,
  updateElementAction,
} from '@/server/modules/scenarios/actions'
import type { ValidationFailure, ValidationResult } from '@/server/modules/scenarios/schema'
import type { ConfirmBarPending } from './confirm-bar'
import { ElementEditor } from './element-editor'
import { ElementList } from './element-list'
import {
  buildIndex,
  buildTree,
  countDecided,
  isSettled,
  leavesOf,
  readString,
  readStringOrNull,
  type TreeNode,
  type WorkspaceElement,
} from './element-model'
import { fieldsFor } from './element-editors/specs'

// UI-043 (FR-192, FR-027, FR-198). The room where an author signs a scenario element by element.
//
// What the screen is for shapes everything below it. Sixty-odd decisions in one sitting is the
// task, so the three things that matter are: the next undecided element is always one press away,
// what changed is always visible, and an edit is never lost.
//
//   *Next undecided.* The screen opens on the first element with no decision, a decision moves to
//   the next one, the header carries a button back to it from anywhere, and the list filters to
//   what is still undecided. Nobody should have to hunt for their own place in a package.
//
//   *What changed.* An element with unsaved edits is marked in the tree, not just in the editor, so
//   an author who wandered off mid-edit can see where they left something. The header's count is
//   the same arithmetic `confirmVersion` performs, so "58 of 61" on the screen and the refusal the
//   server would give name the same three elements.
//
//   *Never lost.* Edits live in a draft per element, kept when the selection moves — switching
//   elements is navigation, not a discard — and the browser asks before a reload takes them. The
//   bar refuses to record a decision while the form and the server disagree, because a confirmation
//   filed against values the author cannot see is the one failure this screen must not have.
//
// `opened_at` is the measure, not decoration (FR-198). It is stamped when an element is *selected*
// — which is the only moment the browser knows and the server cannot — and travels with the
// decision; a second decision on the same element restarts it, because the second review is its own
// review. `updateElement` takes no `openedAt` by design (07 §6): an edit is timed by the server.
//
// State comes from the server on every render. An action's answer is applied locally so the screen
// does not wait for the round trip, and the props take an element back the moment they carry a
// decision the local copy has not seen — the server is the record, the override is only the gap.

export type ConfirmWorkspaceProps = {
  packageId: string
  versionId: string
  version: number
  /** The version is confirmed: the whole screen is the record of what was signed. */
  frozen: boolean
  teachingNoteChecked: boolean
  validation: ValidationResult
  canEdit: boolean
  canConfirm: boolean
  /** 10 §5: the version is a draft and this seat may send an element back to the pipeline. */
  canRegenerate: boolean
  conceptSet: readonly string[]
  elements: readonly WorkspaceElement[]
  versionHref: Route
  /**
   * The element to open, from `?element=<uuid>` — how a rule failure on the generation screen
   * hands an author the element it is about (UI-042). An id this version does not hold is ignored
   * and the screen opens where it always does: on the first element still waiting for a decision.
   */
  initialElementId?: string | undefined
}

type Drafts = Record<string, Record<string, unknown>>

/** UI-042's interval, for the same reason: the server materializes the outcome, the client reads. */
const REGENERATION_POLL_MS = 5_000

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** One element still waiting on a decision, as `ELEMENTS_UNCONFIRMED` carries it (10 §4). */
type UnconfirmedElement = { elementType: string; elementId: string | null; key: string }

function readUnconfirmed(details: unknown): UnconfirmedElement[] {
  if (typeof details !== 'object' || details === null) return []
  const elements = (details as { elements?: unknown }).elements
  if (!Array.isArray(elements)) return []
  return elements.flatMap((entry): UnconfirmedElement[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const { elementType, elementId, key } = entry as Record<string, unknown>
    if (typeof elementType !== 'string' || typeof key !== 'string') return []
    return [{ elementType, elementId: typeof elementId === 'string' ? elementId : null, key }]
  })
}

function readFailures(details: unknown): ValidationFailure[] {
  if (typeof details !== 'object' || details === null) return []
  const failures = (details as { failures?: unknown }).failures
  if (!Array.isArray(failures)) return []
  return failures.flatMap((entry): ValidationFailure[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const { code, message, elementIds } = entry as Record<string, unknown>
    if (typeof code !== 'string' || typeof message !== 'string') return []
    return [
      {
        code,
        message,
        elementIds: Array.isArray(elementIds)
          ? elementIds.filter((id): id is string => typeof id === 'string')
          : [],
      },
    ]
  })
}

/** `z.flattenError` output, as `VALIDATION_ERROR` carries it into the envelope. */
function readFieldErrors(details: unknown): {
  fields: Record<string, string>
  form: string | null
} {
  if (typeof details !== 'object' || details === null) return { fields: {}, form: null }
  const { fieldErrors, formErrors } = details as {
    fieldErrors?: unknown
    formErrors?: unknown
  }
  const fields: Record<string, string> = {}
  if (typeof fieldErrors === 'object' && fieldErrors !== null) {
    for (const [name, messages] of Object.entries(fieldErrors)) {
      const first = Array.isArray(messages) ? messages[0] : messages
      // A patch's errors are keyed by the field; a nested one arrives as `verificationPaths.0.…`,
      // and the field it belongs to is the part before the first dot.
      if (typeof first === 'string') fields[name.split('.')[0] ?? name] = first
    }
  }
  const form = Array.isArray(formErrors) && typeof formErrors[0] === 'string' ? formErrors[0] : null
  return { fields, form }
}

/** One line of what is about to be signed: the thing, and where it stands. */
function SigningLine({ term, value, mono }: { term: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-ink-muted text-meta">{term}</dt>
      <dd
        className={
          mono === true ? 'text-ink text-mono-sm font-mono tabular-nums' : 'text-ink text-body'
        }
      >
        {value}
      </dd>
    </div>
  )
}

export function ConfirmWorkspace(props: ConfirmWorkspaceProps) {
  const { packageId, versionId, version, frozen, canEdit, canConfirm, versionHref } = props
  const router = useRouter()

  // The server is the record; an override is the gap between an action's answer and the render
  // that follows it. The props take the element back when they carry a decision the override has
  // not seen — and only then. A revision that has merely caught up is not the props catching up:
  // `updateElement` records no confirmation at all when the actor holds a platform role rather
  // than the institution's own authority, and none when the schema normalised the edit away, so a
  // saved element comes back at the revision it went in at. Retiring the override there deleted
  // the draft, said "Saved", and put the pre-save values back on the screen.
  const [overrides, setOverrides] = useState<Record<string, WorkspaceElement>>({})
  const elements = useMemo(
    () =>
      props.elements.map((element) => {
        const override = overrides[element.id]
        if (override === undefined) return element
        return element.revision > override.revision ? element : override
      }),
    [props.elements, overrides],
  )

  // Once the props say the same thing the override says, the override is a copy rather than a gap;
  // it is left in place rather than swept, because there is at most one per element in the version
  // and the sweep would be a `setState` in an effect for no visible difference. What it does cost
  // is that a change made to this element in *another* session, at the same revision, stays behind
  // it until this page is loaded again — which is the trade this screen already makes: nothing here
  // is live, and the props only move when this author's own action revalidates them.

  const index = useMemo(() => buildIndex(elements, props.conceptSet), [elements, props.conceptSet])
  const nodes = useMemo(
    () =>
      buildTree(elements, index, {
        group: (elementType) => t(`confirm.group.${elementType}` as 'confirm.group.brief'),
        type: (elementType) => t(`confirm.type.${elementType}` as 'confirm.type.brief'),
        claimBase: t('confirm.claimBase'),
        claimVariant: (variantKey) =>
          t('confirm.claimVariant', {
            variant:
              variantKey === 'defective'
                ? t('confirm.variantDefective')
                : t('confirm.variantSound'),
          }),
      }),
    [elements, index],
  )

  const leaves = useMemo(() => leavesOf(nodes), [nodes])
  const firstUndecided = useMemo(
    () => leaves.find((leaf) => !isSettled(leaf.element))?.id ?? null,
    [leaves],
  )

  // Where the screen opens: the element the address names, then the first one still waiting for a
  // decision, then the top of the tree. Only the address can carry the first — a rule failure on
  // the generation screen names an element by its row id, which is the id the workspace addresses
  // a mutation by (D-542).
  const openingId = useMemo(() => {
    const requested =
      props.initialElementId === undefined
        ? undefined
        : leaves.find((leaf) => leaf.element.elementId === props.initialElementId)?.id
    return requested ?? firstUndecided ?? leaves[0]?.id ?? null
  }, [props.initialElementId, leaves, firstUndecided])

  const [selectedId, setSelectedId] = useState<string | null>(() => openingId)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(expandedFor(nodes, openingId)),
  )
  // The address is read once, on mount, and that is enough: every link that carries `?element=`
  // lives on the *generation* screen, so following a second one is a route change and this
  // component is mounted again with it. A screen-to-screen handoff, not a live parameter (D-542).
  const [onlyUndecided, setOnlyUndecided] = useState(false)
  const [drafts, setDrafts] = useState<Drafts>({})
  const [reopened, setReopened] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState<ConfirmBarPending>(null)

  /** The element being rewritten, until the work that owns it finishes (FR-194). */
  const [regenerating, setRegenerating] = useState<{ id: string; key: string } | null>(null)
  /**
   * The drafts as they stand when the new draft lands, not as they stood when it was asked for.
   * The poll below must not restart on every keystroke, so it reads them through a ref — the same
   * shape `useRunPoll` uses for its `onChange`.
   */
  const draftsNow = useRef<Drafts>({})

  const [teachingNote, setTeachingNote] = useState(props.teachingNoteChecked)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [versionError, setVersionError] = useState<string | null>(null)
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedElement[]>([])
  // The version's own rules come from the server on every render; a refused confirmation overlays
  // the list it answered with, and the next write to any element retires that overlay — the
  // package has changed, so the last refusal is no longer what it is refused for.
  const [attemptFailures, setAttemptFailures] = useState<ValidationFailure[] | null>(null)
  const ruleFailures = attemptFailures ?? props.validation.failures
  // The confirmation freezes the version. The revalidated props say so a moment later; this says so
  // now, so nothing on the screen invites an edit the server has already stopped taking.
  const [justConfirmed, setJustConfirmed] = useState(false)
  const isFrozen = frozen || justConfirmed

  const teachingNoteBox = useRef<HTMLButtonElement>(null)
  const backToVersion = useRef<HTMLAnchorElement>(null)
  /**
   * Where focus goes when the confirmation dialog closes and the trigger is not the answer: the
   * teaching-note tick the version was refused for. The other case — a confirmation, which takes
   * the trigger away with the rest of the editing block — is handled below, because at the moment
   * the dialog is told to close the element that replaces it does not exist yet.
   */
  const focusOnClose = useRef<HTMLElement | null>(null)
  /** When the open element was opened, which is what FR-198 measures the review span from. */
  const openedAt = useRef<string>(new Date().toISOString())

  // A confirmed version has no editing block and so no trigger for the dialog to return focus to.
  // It goes to the one control that replaced it rather than to the document, which is nowhere.
  useEffect(() => {
    if (justConfirmed) backToVersion.current?.focus()
  }, [justConfirmed])

  const selected = useMemo(
    () => elements.find((element) => element.id === selectedId) ?? null,
    [elements, selectedId],
  )

  const values = useMemo(
    () => (selected === null ? {} : (drafts[selected.id] ?? selected.values)),
    [selected, drafts],
  )
  const dirty = selected !== null && drafts[selected.id] !== undefined

  useEffect(() => {
    draftsNow.current = drafts
  }, [drafts])

  // An edit that has not reached the server is lost by a reload; the browser is the only thing
  // that can ask first.
  useEffect(() => {
    if (Object.keys(drafts).length === 0) return undefined
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [drafts])

  const select = useCallback((id: string): void => {
    setSelectedId(id)
    setErrors({})
    setFormError(null)
    // FR-198: the review of this element starts now. A second visit is a second review.
    openedAt.current = new Date().toISOString()
  }, [])

  /** Open the way to an element in the tree and select it, leaving the filter as it stands. */
  const reveal = useCallback(
    (id: string): void => {
      setExpanded((current) => new Set([...current, ...expandedFor(nodes, id)]))
      select(id)
    },
    [nodes, select],
  )

  /**
   * Reached from outside the list — a rule failure, the header's own button, a variant summary —
   * so the filter comes off: what is being asked for may already carry a decision.
   */
  const openElement = useCallback(
    (id: string): void => {
      setOnlyUndecided(false)
      reveal(id)
    },
    [reveal],
  )

  /** The next element still waiting on a decision after this one, wrapping round to the top. */
  const nextUndecidedAfter = useCallback(
    (id: string): string | null => {
      const at = leaves.findIndex((leaf) => leaf.id === id)
      const order = at === -1 ? leaves : [...leaves.slice(at + 1), ...leaves.slice(0, at)]
      return order.find((leaf) => leaf.id !== id && !isSettled(leaf.element))?.id ?? null
    },
    [leaves],
  )

  const onFieldChange = useCallback(
    (name: string, value: unknown): void => {
      if (selected === null) return
      setErrors((current) => {
        if (current[name] === undefined) return current
        const next = { ...current }
        delete next[name]
        return next
      })
      setDrafts((current) => {
        const base = current[selected.id] ?? selected.values
        const next = { ...base, [name]: value }
        const copy = { ...current }
        // A field edited back to what the server holds is not an edit; the mark goes away with it.
        if (same(next, selected.values)) delete copy[selected.id]
        else copy[selected.id] = next
        return copy
      })
    },
    [selected],
  )

  const discard = useCallback((): void => {
    if (selected === null) return
    setDrafts((current) => {
      const copy = { ...current }
      delete copy[selected.id]
      return copy
    })
    setErrors({})
    setFormError(null)
    toast.success(t('confirm.discardedToast', { name: selected.key }))
  }, [selected])

  const applyElement = useCallback((element: WorkspaceElement): void => {
    setOverrides((current) => ({ ...current, [element.id]: element }))
  }, [])

  const save = useCallback(async (): Promise<void> => {
    if (selected === null) return
    const draft = drafts[selected.id]
    if (draft === undefined) return

    const patch: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(draft)) {
      if (!same(value, selected.values[name])) patch[name] = value
    }

    // A required field emptied on the way past is the one mistake worth catching before the round
    // trip: the schema's own answer to it is "expected string, received undefined", which is true
    // and useless. Only the fields being changed are checked, so an element that was already short
    // of something can still be saved on the way to fixing it.
    const missing: Record<string, string> = {}
    for (const spec of fieldsFor(selected.elementType, draft, index)) {
      if (spec.required !== true || !(spec.name in patch)) continue
      const value = patch[spec.name]
      const empty =
        value === null ||
        value === undefined ||
        (typeof value === 'string' && value.trim().length === 0)
      if (empty) missing[spec.name] = t('confirm.fieldRequired')
    }
    if (Object.keys(missing).length > 0) {
      setErrors(missing)
      setFormError(null)
      return
    }

    setPending('save')
    setErrors({})
    setFormError(null)
    const result = await updateElementAction({
      packageId,
      versionId,
      elementType: selected.elementType,
      elementId: selected.elementId,
      patch,
    })
    setPending(null)

    if (!result.ok) {
      if (result.error.code === 'VALIDATION_ERROR') {
        const { fields, form } = readFieldErrors(result.error.details)
        setErrors(translateFieldErrors(fields, selected, draft, index))
        setFormError(form ?? (Object.keys(fields).length === 0 ? result.error.message : null))
        return
      }
      setFormError(result.error.message)
      return
    }

    const saved = toWorkspaceElement(selected, result.data)
    applyElement(saved)
    setAttemptFailures(null)
    setUnconfirmed([])
    setDrafts((current) => {
      const copy = { ...current }
      delete copy[selected.id]
      return copy
    })
    setReopened((current) => {
      const copy = new Set(current)
      copy.delete(selected.id)
      return copy
    })
    // Saving *is* a decision — but only for the institution's own confirming authority, and only
    // for an edit that changed something the schema kept. The toast says which of the three
    // happened rather than claiming the first one every time.
    toast.success(
      result.data.confirmation !== null
        ? t('confirm.savedToast', { name: selected.key })
        : isSettled(saved)
          ? t('confirm.savedDecisionStandsToast', { name: selected.key })
          : t('confirm.savedUndecidedToast', { name: selected.key }),
    )
  }, [selected, drafts, packageId, versionId, index, applyElement])

  const decide = useCallback(
    async (decision: 'confirmed' | 'rejected', note: string): Promise<void> => {
      if (selected === null) return
      setPending(decision === 'confirmed' ? 'confirm' : 'reject')
      setFormError(null)
      const result = await decideElementAction({
        packageId,
        versionId,
        elementType: selected.elementType,
        elementId: selected.elementId,
        decision,
        note,
        openedAt: openedAt.current,
      })
      setPending(null)

      if (!result.ok) {
        setFormError(result.error.message)
        return
      }

      setAttemptFailures(null)
      setUnconfirmed([])
      applyElement({
        ...selected,
        decision: result.data.decision,
        decidedAt: result.data.decidedAt,
        decidedByName: result.data.decidedByName,
        note: result.data.note,
        revision: result.data.revision,
      })
      setReopened((current) => {
        const copy = new Set(current)
        copy.delete(selected.id)
        return copy
      })
      toast.success(
        decision === 'confirmed'
          ? t('confirm.confirmedElementToast', { name: selected.key })
          : t('confirm.rejectedToast', { name: selected.key }),
      )
      // The review loop closes here. Sixty-odd decisions in one sitting is the task, and a decision
      // that leaves the screen where it was costs a scroll and a re-aim for every one of them; the
      // next element still waiting is where the author was going anyway. The filter stays as it is,
      // because a filtered list is the author saying that is the list they are working down.
      const next = nextUndecidedAfter(selected.id)
      if (next !== null) reveal(next)
      // Either way the measure restarts: a second visit to an element is a second review.
      else openedAt.current = new Date().toISOString()
    },
    [selected, packageId, versionId, applyElement, nextUndecidedAfter, reveal],
  )

  /**
   * Send one element back to the step that wrote it (FR-194, UI-043).
   *
   * The action queues a job and answers; the new draft arrives on the server a moment later. So
   * the screen holds the element it asked about, polls the generation status while a step is
   * running — the same five-second poll UI-042 makes, for the same reason: the server materializes
   * the outcome, the client only reads it — and asks the route to render again when it stops.
   *
   * The overrides go with it. An override is this screen's local echo of an action's answer, and a
   * regenerated element is a different element under the same key; a stale echo would win over the
   * fresh props on revision alone. Drafts are *not* swept: an author's unsaved typing is theirs,
   * and the tree keeps saying it is unsaved.
   */
  const regenerate = useCallback(
    async (restatedRule: string): Promise<void> => {
      if (selected === null) return
      setPending('regenerate')
      setFormError(null)
      const result = await regenerateElementAction({
        packageId,
        versionId,
        elementType: selected.elementType,
        elementId: selected.elementId,
        ...(restatedRule.length > 0 ? { restatedRule } : {}),
      })
      setPending(null)

      if (!result.ok) {
        setFormError(result.error.message)
        return
      }
      setRegenerating({ id: selected.id, key: selected.key })
      toast.success(t('confirm.regenerateQueuedToast', { name: selected.key }))
    },
    [selected, packageId, versionId],
  )

  useEffect(() => {
    if (regenerating === null) return undefined
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (state: string): void => {
      setRegenerating(null)
      setOverrides({})
      // A step that did not finish wrote nothing, and a screen that announced a new draft anyway
      // would be lying about the one thing the author is waiting for.
      if (state === 'failed') {
        setFormError(t('confirm.regenerateStopped', { name: regenerating.key }))
        return
      }
      // D-546 keeps an author's unsaved typing, which means the values on the screen are still
      // theirs and not the ones that just arrived. Saying "the new draft is on the screen" there
      // would be false; the sentence says where the new draft actually is instead.
      toast.success(
        draftsNow.current[regenerating.id] === undefined
          ? t('confirm.regenerateDoneToast', { name: regenerating.key })
          : t('confirm.regenerateDoneDraftToast', { name: regenerating.key }),
      )
      router.refresh()
    }

    const poll = async (): Promise<void> => {
      if (stopped) return
      try {
        const response = await fetch(`/api/v1/package-versions/${versionId}/generation`, {
          cache: 'no-store',
        })
        if (stopped) return
        if (response.ok) {
          const body = (await response.json()) as { state: string }
          if (body.state !== 'running') {
            finish(body.state)
            return
          }
        }
      } catch {
        // Offline, or the request was cut off; ask again on the next tick.
      }
      if (!stopped) timer = setTimeout(() => void poll(), REGENERATION_POLL_MS)
    }

    timer = setTimeout(() => void poll(), REGENERATION_POLL_MS)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [regenerating, versionId, router])

  const confirmVersion = useCallback(async (): Promise<void> => {
    setConfirming(true)
    setVersionError(null)
    setUnconfirmed([])
    const result = await confirmVersionAction({
      packageId,
      versionId,
      teachingNoteChecked: teachingNote,
    })
    setConfirming(false)
    // Either answer belongs to the screen behind the dialog: the refusal names elements to open and
    // rules to read, and the confirmation freezes everything the dialog was standing in front of.
    setConfirmOpen(false)

    if (!result.ok) {
      setVersionError(result.error.message)
      if (result.error.code === 'ELEMENTS_UNCONFIRMED') {
        setUnconfirmed(readUnconfirmed(result.error.details))
      }
      if (result.error.code === 'PACKAGE_INVALID') {
        setAttemptFailures(readFailures(result.error.details))
      }
      focusOnClose.current =
        result.error.code === 'TEACHING_NOTE_UNCHECKED' ? teachingNoteBox.current : null
      return
    }
    setAttemptFailures([])
    setJustConfirmed(true)
    focusOnClose.current = null
    toast.success(t('confirm.confirmedToast', { version }))
  }, [packageId, versionId, teachingNote, version])

  const progress = countDecided(nodes)
  const remaining = progress.total - progress.decided
  const rejectedCount = elements.filter((element) => element.decision === 'rejected').length
  const dirtyIds = useMemo(() => new Set(Object.keys(drafts)), [drafts])

  // The rules that name the open element, so a refusal arrives with the element it is about.
  const failuresForSelected = useMemo(
    () =>
      selected === null
        ? []
        : ruleFailures.filter((failure) => failure.elementIds.includes(selected.elementId)),
    [ruleFailures, selected],
  )

  const variantStates = useMemo(
    () =>
      selected === null || selected.elementType !== 'claim'
        ? []
        : elements.filter(
            (element) =>
              element.elementType === 'variant_claim_state' &&
              readStringOrNull(element.values, 'claimId') === selected.elementId,
          ),
    [elements, selected],
  )

  const claimContext = useMemo(() => {
    if (selected === null || selected.elementType !== 'variant_claim_state') {
      return { text: null, variantKey: null }
    }
    const claimId = readStringOrNull(selected.values, 'claimId')
    const claim = elements.find(
      (element) => element.elementType === 'claim' && element.elementId === claimId,
    )
    return {
      text: claim ? readString(claim.values, 'text') : null,
      variantKey:
        index.variantKeys.get(readStringOrNull(selected.values, 'variantId') ?? '') ?? null,
    }
  }, [selected, elements, index])

  return (
    <div className="flex flex-col gap-6">
      <Panel id="confirm-progress" title={t('confirm.progressTitle', { version })} headingLevel={2}>
        <div className="flex flex-col gap-5">
          <Progress
            value={progress.decided}
            max={Math.max(progress.total, 1)}
            aria-labelledby="confirm-progress-label"
          >
            <ProgressLabel id="confirm-progress-label">{t('confirm.progressLabel')}</ProgressLabel>
            <ProgressValue>
              {() =>
                t('confirm.progressCount', {
                  decided: progress.decided,
                  total: progress.total,
                })
              }
            </ProgressValue>
          </Progress>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-ink-muted text-body">
              {remaining === 0
                ? t('confirm.progressComplete')
                : remaining === 1
                  ? t('confirm.progressRemainingOne')
                  : t('confirm.progressRemaining', { count: remaining })}
              {rejectedCount > 0 && ` · ${t('confirm.progressRejected', { count: rejectedCount })}`}
            </p>
            {firstUndecided !== null && firstUndecided !== selectedId && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openElement(firstUndecided)}
              >
                {t('confirm.nextUndecided')}
                <ArrowRightIcon aria-hidden="true" />
              </Button>
            )}
          </div>

          {/* A new draft is being written for a whole set of elements, not for the one on the
              screen, so the band that says so belongs to the version and not to the editor: an
              author who wandered to another element while it ran could otherwise save an edit that
              the step was about to overwrite. It is amber because the state is provisional, with
              ink text and the amber on the border and the icon (DESIGN.md, the Amber-Is-Not-Text
              rule). It carries no live region of its own: both ends of the wait — the press and the
              arrival — are announced by their toasts, and a second region that appears with its own
              text is the announcement assistive technology is least likely to read. */}
          <div className="w-full empty:hidden">
            {regenerating !== null && (
              <section className="border-amber bg-amber-soft text-ink text-body max-w-measure flex w-full items-start gap-2 rounded-md border p-3">
                <Loader2Icon
                  aria-hidden="true"
                  className="text-amber mt-0.5 size-4 shrink-0 animate-spin"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-medium">{t('confirm.regenerateQueuedTitle')}</p>
                  <p>{t('confirm.regenerateQueuedBody', { name: regenerating.key })}</p>
                </div>
              </section>
            )}
          </div>

          {ruleFailures.length > 0 && (
            <section className="border-red bg-red-soft text-ink text-body max-w-measure flex w-full items-start gap-2 rounded-md border p-3">
              <CircleAlertIcon aria-hidden="true" className="text-red mt-0.5 size-4 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <p className="font-medium">{t('confirm.rulesTitle')}</p>
                <ul className="text-meta flex flex-col gap-2">
                  {ruleFailures.map((failure) => (
                    <li key={failure.code} className="flex flex-col gap-0.5">
                      <span className="text-ink">{failure.message}</span>
                      <span className="text-ink text-mono-sm font-mono break-words">
                        {failure.elementIds.length === 0
                          ? failure.code
                          : `${failure.code} · ${t('confirm.ruleElements', {
                              keys: failure.elementIds.map((id) => keyOf(elements, id)).join(', '),
                            })}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {unconfirmed.length > 0 && (
            <section className="flex flex-col items-start gap-2">
              <h3 className="text-h4">{t('confirm.unconfirmedTitle')}</h3>
              <ul className="flex flex-wrap gap-2">
                {unconfirmed.map((entry) => (
                  <li key={`${entry.elementType}:${entry.elementId ?? ''}`}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openElement(`${entry.elementType}:${entry.elementId ?? ''}`)}
                    >
                      <span className="font-mono">{entry.key}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!isFrozen && canEdit && (
            <div className="border-line flex flex-col items-start gap-4 border-t pt-5">
              <Field orientation="horizontal">
                <Checkbox
                  id="confirm-teaching-note"
                  ref={teachingNoteBox}
                  checked={teachingNote}
                  disabled={!canConfirm}
                  aria-labelledby="confirm-teaching-note-label"
                  onCheckedChange={(next: boolean) => setTeachingNote(next)}
                />
                <FieldContent>
                  <FieldLabel id="confirm-teaching-note-label" htmlFor="confirm-teaching-note">
                    {t('confirm.teachingNoteLabel')}
                  </FieldLabel>
                  <FieldDescription>{t('confirm.teachingNoteHint')}</FieldDescription>
                </FieldContent>
              </Field>

              {versionError !== null && (
                <p role="alert" className="text-red text-body">
                  {versionError}
                </p>
              )}

              {/* The most consequential press in the authoring half of the product: it freezes a
                  version for good. It gets the gesture the product already reserves for smaller
                  acts, and the dialog says what is being signed — how many elements, how many of
                  them rejected, whether the rules pass, and the attestation the tick stands for —
                  rather than leaving all of that on a screen the author has scrolled past. */}
              {canConfirm ? (
                <AlertDialog
                  open={confirmOpen}
                  onOpenChange={(next: boolean) => {
                    if (confirming) return
                    if (next) focusOnClose.current = null
                    setConfirmOpen(next)
                  }}
                >
                  <AlertDialogTrigger render={<Button type="button" className="w-fit" />}>
                    {t('confirm.confirmVersion')}
                  </AlertDialogTrigger>
                  <AlertDialogContent finalFocus={() => focusOnClose.current ?? true}>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t('confirm.confirmDialogTitle', { version })}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t('confirm.confirmDialogBody', { version })}
                      </AlertDialogDescription>
                    </AlertDialogHeader>

                    <dl className="flex flex-col gap-3">
                      <SigningLine
                        term={t('confirm.confirmDialogElements')}
                        value={t('confirm.confirmDialogElementsValue', {
                          decided: progress.decided,
                          total: progress.total,
                        })}
                        mono
                      />
                      {rejectedCount > 0 && (
                        <SigningLine
                          term={t('confirm.confirmDialogRejected')}
                          value={t('confirm.confirmDialogRejectedValue', { count: rejectedCount })}
                          mono
                        />
                      )}
                      <SigningLine
                        term={t('confirm.confirmDialogRules')}
                        value={
                          ruleFailures.length === 0
                            ? t('confirm.confirmDialogRulesPass')
                            : t('confirm.confirmDialogRulesFailing', {
                                count: ruleFailures.length,
                              })
                        }
                      />
                      <SigningLine
                        term={t('confirm.confirmDialogTeachingNote')}
                        value={
                          teachingNote
                            ? t('confirm.confirmDialogTeachingNoteChecked')
                            : t('confirm.confirmDialogTeachingNoteUnchecked')
                        }
                      />
                    </dl>

                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={confirming}>
                        {t('confirm.confirmDialogCancel')}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={confirming}
                        aria-busy={confirming}
                        onClick={() => {
                          if (!confirming) void confirmVersion()
                        }}
                      >
                        {confirming && <Loader2Icon aria-hidden="true" className="animate-spin" />}
                        {confirming
                          ? t('confirm.confirmVersionPending')
                          : t('confirm.confirmDialogSubmit')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <>
                  <Button type="button" aria-disabled>
                    {t('confirm.confirmVersion')}
                  </Button>
                  <p className="text-ink-muted text-meta max-w-measure">
                    {t('confirm.readOnlyBody')}
                  </p>
                </>
              )}
            </div>
          )}

          {isFrozen && (
            <Link
              ref={backToVersion}
              href={versionHref}
              className="text-primary text-body focus-visible:outline-focus w-fit rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {t('confirm.backToVersion', { version })}
            </Link>
          )}
        </div>
      </Panel>

      {/* The split is at `xl`, and the tree track is 18 rem, because both numbers are the editor's
          (D-628). Where there is room for it the tree stays in view: the editor beside it is
          sixteen rows long for a claim and forty for a document, and a list that scrolls away with
          the form makes every decision a round trip to find the next element. But it had been
          splitting at `lg` against a 20 rem track, and one pixel of window then cost the editor
          344 of them — 751 px at 1023 and 407 at 1024 — which put the author's own writing surface
          at about 42 characters a line, well under DESIGN.md's measure, and made the window wider
          to make the work narrower. That is the shape D-310 ruled a bug rather than a breakpoint,
          on the run workspace, for the same reason. `xl` with an 18 rem tree is the first
          arrangement where the editor still clears the ~682 px its measure and its padding need:
          1280 - 224 (rail) - 48 (gutter) - 288 (tree) - 24 (gap) = 696. Below it the tree is the
          native select `ElementList` already draws, and the editor runs full width. */}
      <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)] xl:items-start">
        <Panel
          id="element-list"
          title={t('confirm.listTitle')}
          headingLevel={2}
          className="xl:sticky xl:top-6"
        >
          <ElementList
            nodes={nodes}
            selectedId={selectedId}
            dirtyIds={dirtyIds}
            expanded={expanded}
            onExpandedChange={setExpanded}
            onSelect={select}
            onlyUndecided={onlyUndecided}
            onOnlyUndecidedChange={setOnlyUndecided}
          />
        </Panel>

        {selected === null ? (
          <Panel id="element-editor" title={t('confirm.editorNoneTitle')} headingLevel={2}>
            <p className="text-ink-muted text-body max-w-measure">{t('confirm.editorNoneBody')}</p>
          </Panel>
        ) : (
          <ElementEditor
            // The editor is *this* element's editor. Anything inside it holding state of its own —
            // the rejection note being composed, the JSON box holding half-typed text — belongs to
            // the element it was typed against, and without this key React keeps that state across
            // a change of selection and files it against whatever is open now. A note written about
            // C3 and recorded against D4 is the one failure this screen must not have.
            key={selected.id}
            element={selected}
            values={values}
            errors={errors}
            formError={formError}
            index={index}
            failures={failuresForSelected}
            frozen={isFrozen}
            canEdit={canEdit}
            canDecide={canConfirm}
            canRegenerate={props.canRegenerate && !isFrozen}
            regenerationRunning={regenerating !== null}
            reopened={reopened.has(selected.id)}
            dirty={dirty}
            pending={pending}
            claimText={claimContext.text}
            variantKey={claimContext.variantKey}
            variantStates={variantStates}
            onFieldChange={onFieldChange}
            onReopen={() => setReopened((current) => new Set([...current, selected.id]))}
            onOpenElement={openElement}
            onSave={() => void save()}
            onDiscard={discard}
            onConfirm={() => void decide('confirmed', '')}
            onReject={(note) => void decide('rejected', note)}
            onRegenerate={(restatedRule) => void regenerate(restatedRule)}
          />
        )}
      </div>
    </div>
  )
}

/** Every group between the root and a leaf, so opening an element opens the way to it. */
function expandedFor(nodes: readonly TreeNode[], leafId: string | null): string[] {
  if (leafId === null) return []
  const path: string[] = []
  const walk = (list: readonly TreeNode[], trail: string[]): boolean => {
    for (const node of list) {
      if (node.kind === 'leaf') {
        if (node.id === leafId) {
          path.push(...trail)
          return true
        }
        continue
      }
      if (walk(node.children, [...trail, node.id])) return true
    }
    return false
  }
  walk(nodes, [])
  return path
}

/** The key an author knows an element by, from the id a rule failure names. */
function keyOf(elements: readonly WorkspaceElement[], elementId: string): string {
  return elements.find((element) => element.elementId === elementId)?.key ?? elementId
}

/** `updateElement`'s answer, in the shape the workspace holds an element. */
function toWorkspaceElement(
  previous: WorkspaceElement,
  view: {
    values: Record<string, unknown>
    confirmation: {
      decision: 'confirmed' | 'edited' | 'rejected'
      decidedAt: string
      decidedByName: string
      note: string
      revision: number
    } | null
  },
): WorkspaceElement {
  if (view.confirmation === null) return { ...previous, values: view.values }
  return {
    ...previous,
    values: view.values,
    decision: view.confirmation.decision,
    decidedAt: view.confirmation.decidedAt,
    decidedByName: view.confirmation.decidedByName,
    note: view.confirmation.note,
    revision: view.confirmation.revision,
  }
}

/**
 * `wordLimit` sends the code `WORD_LIMIT` rather than a sentence, on purpose: the number belongs to
 * the field, and the words belong to the screen (`src/lib/words.ts`). This is where the two meet.
 */
function translateFieldErrors(
  fields: Record<string, string>,
  element: WorkspaceElement,
  draft: Record<string, unknown>,
  index: Parameters<typeof fieldsFor>[2],
): Record<string, string> {
  const specs = fieldsFor(element.elementType, draft, index)
  const out: Record<string, string> = {}
  for (const [name, message] of Object.entries(fields)) {
    if (message !== 'WORD_LIMIT') {
      out[name] = message
      continue
    }
    const spec = specs.find((candidate) => candidate.name === name)
    const limit = spec?.kind === 'textarea' ? spec.wordLimit : undefined
    const value = draft[name]
    out[name] =
      limit === undefined
        ? message
        : t('confirm.wordLimit', {
            limit,
            count: countWords(typeof value === 'string' ? value : ''),
          })
  }
  return out
}
