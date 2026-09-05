import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { Route } from 'next'
import { ConfirmWorkspace } from '@/components/features/packages/confirm-workspace'
import { ElementEditor } from '@/components/features/packages/element-editor'
import {
  buildIndex,
  elementAddress,
  type ElementIndex,
  type WorkspaceElement,
} from '@/components/features/packages/element-model'
import { fieldsFor } from '@/components/features/packages/element-editors/specs'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import {
  CarriedValueSchema,
  DOCUMENT_WORD_LIMIT,
  ELEMENT_PATCH_SCHEMAS,
  ELEMENT_TYPES,
  SINGLETON_ELEMENT_ID,
  type ElementTypeValue,
  type ValidationFailure,
} from '@/server/modules/scenarios/schema'
import { validatePackage, type ValidatedReadinessItem } from '@/server/modules/scenarios/validate'

// Step 5.5, UI-043 → the room where a package is signed: the per-type refusals an author meets, the
// places they have to arrive to be acted on, and the things the room must never let follow the
// author from one element to the next.
//
// Three refusals reach the field from three different distances, and the first half of the file is
// arranged by that:
//
//   *The browser's own.* A word limit is counted here, while the author types, because a round trip
//   to be told a body is nine words too long is a round trip too many. The number under the textarea
//   and the number the server refuses on must be the same number (D-075), so each test that asserts
//   the message also asserts that `ELEMENT_PATCH_SCHEMAS` agrees about the same string.
//
//   *The schema's.* `updateElement` answers a bad patch with `z.flattenError`'s `fieldErrors`, keyed
//   by field name; the editor puts each message under the field of that name. That contract is only
//   as good as the names matching, so a test walks all fifteen types and checks every field the
//   editor draws against the shape of the schema that judges it.
//
//   *The package's.* `validatePackage` writes its own sentences about rules no single field can
//   satisfy — sixteen readiness items, four options each. They arrive with the element they name,
//   and the messages asserted below are the validator's real output rather than copies of it.
//
// The editor is rendered the way the workspace renders it: `values` held above it and written back
// through `onFieldChange`, because it is a controlled form and a test that let it hold its own
// values would be testing a component the product does not ship.
//
// The second half renders the whole `ConfirmWorkspace`, because the four things it protects are
// only true of the two components together: a note typed against one element is never filed against
// another, a row of the tree says what state it is in, a refusal from the server reaches the person
// who pressed the button, and a save shows what the server actually returned rather than what it
// was hoped to have returned.

const CONCEPTS = ['payback_period', 'segmentation', 'retention_cohorts', 'ai_verification']

const actions = vi.hoisted(() => ({
  updateElementAction: vi.fn(),
  decideElementAction: vi.fn(),
  confirmVersionAction: vi.fn(),
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

// Server Actions: importing the real module would pull the scenarios service, the database client
// and `server-only` into jsdom.
vi.mock('@/server/modules/scenarios/actions', () => actions)
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

/** `n` words, exactly, under `countWords`' rule that a word is a run of non-whitespace. */
const words = (n: number): string => Array.from({ length: n }, (_unused, at) => `w${at}`).join(' ')

function draft(
  elementType: ElementTypeValue,
  key: string,
  values: Record<string, unknown>,
): WorkspaceElement {
  const elementId = `${key}-id`
  return {
    id: elementAddress(elementType, elementId),
    elementType,
    elementId,
    key,
    values,
    decision: null,
    decidedAt: null,
    decidedByName: '',
    note: '',
    revision: 0,
  }
}

const documentDraft = (body: string): WorkspaceElement =>
  draft('document', 'D2', {
    title: 'Retention memo, premium cohort',
    author: 'Priya Raman',
    datedOn: '2025-06-01',
    role: 'supporting',
    position: 1,
    supersededByDocumentId: null,
    stakeholderId: null,
    body,
  })

const OPTION_KEYS = ['a', 'b', 'c', 'd']

const optionRows = (count: number): { key: string; text: string }[] =>
  OPTION_KEYS.slice(0, count).map((key) => ({
    key,
    text: `Answer ${key} for the payback question`,
  }))

const readinessDraft = (options: { key: string; text: string }[]): WorkspaceElement =>
  draft('readiness_item', 'R1', {
    category: 'foundation',
    conceptKey: 'payback_period',
    stem: 'Payback period measures which of the following?',
    options,
    answerKey: 'd',
    position: 0,
  })

const variantStateDraft = (): WorkspaceElement =>
  draft('variant_claim_state', 'defective:C3', {
    variantId: '11111111-1111-4111-8111-111111111111',
    claimId: '22222222-2222-4222-8222-222222222222',
    evidenceStatus: 'defective',
    failureFamily: 'stale_evidence',
    warrantedStance: 'challenge',
    planted: true,
    verificationPaths: {},
  })

type HarnessProps = {
  element: WorkspaceElement
  errors?: Record<string, string>
  failures?: readonly ValidationFailure[]
  index?: ElementIndex
}

const noop = (): void => {}

/** The editor as the workspace mounts it: the draft lives above, the editor writes into it. */
function Harness({ element, errors = {}, failures = [], index }: HarnessProps) {
  const [values, setValues] = useState<Record<string, unknown>>(element.values)
  return (
    <ElementEditor
      element={element}
      values={values}
      errors={errors}
      formError={null}
      index={index ?? buildIndex([element], CONCEPTS)}
      failures={failures}
      frozen={false}
      canEdit
      canDecide
      reopened={false}
      dirty={false}
      pending={null}
      claimText={null}
      variantKey={null}
      variantStates={[]}
      onFieldChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
      onReopen={noop}
      onOpenElement={noop}
      onSave={noop}
      onDiscard={noop}
      onConfirm={noop}
      onReject={noop}
    />
  )
}

const rowLabel = (itemName: string, index: number): string =>
  t('confirm.rowLabel', { name: itemName, index })

describe('ElementEditor — the word limit a document body carries (UI-043)', () => {
  it('counts a body up to the limit without refusing it', () => {
    const body = words(DOCUMENT_WORD_LIMIT)
    render(<Harness element={documentDraft(body)} />)

    expect(screen.getByLabelText(enUS['confirm.field.body'])).toHaveValue(body)
    expect(
      screen.getByText(
        t('confirm.wordCount', { count: DOCUMENT_WORD_LIMIT, limit: DOCUMENT_WORD_LIMIT }),
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refuses the next word, in the field, with the count that made it too long', async () => {
    const user = userEvent.setup()
    render(<Harness element={documentDraft(words(DOCUMENT_WORD_LIMIT))} />)
    const body = screen.getByLabelText(enUS['confirm.field.body'])

    await user.type(body, ' spillover')

    const refusal = t('confirm.wordLimit', {
      limit: DOCUMENT_WORD_LIMIT,
      count: DOCUMENT_WORD_LIMIT + 1,
    })
    expect(await screen.findByText(refusal)).toBeInTheDocument()
    // The refusal is announced where it happened rather than as a banner to go looking for.
    expect(screen.getByRole('alert')).toHaveTextContent(refusal)
    // And the counter says the same number the sentence says.
    expect(
      screen.getByText(
        t('confirm.wordCount', { count: DOCUMENT_WORD_LIMIT + 1, limit: DOCUMENT_WORD_LIMIT }),
      ),
    ).toBeInTheDocument()
  })

  it('draws the line where the schema draws it (D-075)', () => {
    // The counter above is worth nothing unless it counts what `wordLimit` counts: one word more
    // than the editor accepts is one word more than the server accepts, on the same string.
    const schema = ELEMENT_PATCH_SCHEMAS.document
    expect(schema.safeParse({ body: words(DOCUMENT_WORD_LIMIT) }).success).toBe(true)
    expect(schema.safeParse({ body: `${words(DOCUMENT_WORD_LIMIT)} spillover` }).success).toBe(
      false,
    )
  })
})

describe('ElementEditor — a readiness item without four options (UI-043, FR-194)', () => {
  /** Sixteen items split 6 / 4 / 6, which is the only split `READINESS_SPLIT` is silent about. */
  function readinessItems(): ValidatedReadinessItem[] {
    const categories = [
      ...Array<string>(6).fill('foundation'),
      ...Array<string>(4).fill('defect_concept'),
      ...Array<string>(6).fill('ai_behavior'),
    ]
    return categories.map((category, at) => ({
      id: `item-${String(at + 1)}`,
      key: `R${String(at + 1)}`,
      category,
      stem: `Readiness stem ${String(at + 1)}`,
      options: optionRows(4),
      answerKey: 'd',
    }))
  }

  /** The rule's own sentence for an item carrying three options, from the validator itself. */
  function optionsFailure(): ValidationFailure {
    const items = readinessItems()
    items[0] = { ...items[0]!, options: optionRows(3) }
    const result = validatePackage({
      conceptSet: CONCEPTS,
      brief: '',
      turnDelaySeconds: 90,
      generalEscalationReply: '',
      debriefCounterfactual: '',
      documents: [],
      stakeholders: [],
      answerSpacePositions: [],
      namedFields: [],
      claims: [],
      variants: [],
      defenseQuestions: [],
      readinessItems: items,
    })
    const failure = result.failures.find((candidate) => candidate.code === 'READINESS_SPLIT')
    if (failure === undefined) throw new Error('validatePackage did not report READINESS_SPLIT')
    return failure
  }

  it('states the rule, its code, and the element it names', () => {
    const failure = optionsFailure()
    // The split and the count are right, so the only thing the rule has to say is the option count.
    expect(failure.message).toBe(
      'Item R1 needs 4 distinctly keyed options and an answer key naming one of them.',
    )
    expect(failure.elementIds).toEqual(['item-1'])

    render(<Harness element={readinessDraft(optionRows(3))} failures={[failure]} />)

    expect(screen.getByText(enUS['confirm.elementRulesTitle'])).toBeInTheDocument()
    expect(screen.getByText(failure.message)).toBeInTheDocument()
    // The code is on the screen because it is what an author searches the export for.
    expect(screen.getByText('READINESS_SPLIT')).toBeInTheDocument()
  })

  it('shows the three options it has, and no fourth', () => {
    render(<Harness element={readinessDraft(optionRows(3))} failures={[optionsFailure()]} />)

    const option = enUS['confirm.field.option']
    for (const index of [1, 2, 3]) {
      expect(screen.getByText(rowLabel(option, index))).toBeInTheDocument()
    }
    expect(screen.queryByText(rowLabel(option, 4))).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('confirm.addRow', { name: option }) }),
    ).toBeInTheDocument()
  })

  it('leaves an answer key no option carries readable rather than blank', () => {
    // The item answers `d` and its fourth option is gone. A control that emptied itself would hide
    // the fault the rule above is naming; the key an author searches by stays on the screen.
    render(<Harness element={readinessDraft(optionRows(3))} failures={[optionsFailure()]} />)

    expect(screen.getByLabelText(enUS['confirm.field.answerKey'])).toHaveTextContent('d')
  })
})

describe('ElementEditor — a refusal the schema wrote (UI-043)', () => {
  it('lands a stance outside the five under the stance field, and marks it', () => {
    // What `updateElement` answers with when a patch carries a stance the vocabulary has no room
    // for: `VALIDATION_ERROR`, `fieldErrors` keyed by the field, which is what the editor reads.
    const parsed = ELEMENT_PATCH_SCHEMAS.variant_claim_state.safeParse({ warrantedStance: 'agree' })
    expect(parsed.success).toBe(false)
    const message = z.flattenError(parsed.error!).fieldErrors.warrantedStance?.[0]
    expect(message).toBeDefined()

    render(
      <Harness element={variantStateDraft()} errors={{ warrantedStance: message as string }} />,
    )

    const stance = screen.getByLabelText(enUS['confirm.field.warrantedStance'])
    expect(stance).toHaveAttribute('aria-invalid', 'true')
    const describedBy = stance.getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(message as string)
  })
})

describe('ElementEditor — the field names a refusal is keyed by (UI-043)', () => {
  it('draws no field the element schema does not hold, for any of the fifteen types', () => {
    // A server message is keyed by the field it belongs to and put under the field of that name; a
    // field the editor spelled its own way would leave the refusal on the screen with nothing to
    // attach it to. The element key is deliberately not a field — it is the element's identity and
    // `updateElement` refuses a patch that changes one — so nothing checks the other direction.
    const index = buildIndex([], CONCEPTS)
    // The values that turn on every conditional field at once: the successor of a superseded
    // document, the family of a defective state, the reply of an escalatable claim.
    const showEverything = { role: 'superseded', evidenceStatus: 'defective', escalatable: true }

    for (const elementType of ELEMENT_TYPES) {
      const shape = Object.keys(ELEMENT_PATCH_SCHEMAS[elementType].shape)
      for (const spec of fieldsFor(elementType, showEverything, index)) {
        expect(shape, `${elementType}.${spec.name}`).toContain(spec.name)
      }
    }
  })
})

// ---------------------------------------------------------------------------------------------
// The workspace: what must not follow the author from one element to the next
// ---------------------------------------------------------------------------------------------

const D1_ID = '44444444-4444-4444-8444-444444444441'
const Q1_ID = '33333333-3333-4333-8333-333333333331'
const Q2_ID = '33333333-3333-4333-8333-333333333332'
const PROBE_ID = '55555555-5555-4555-8555-555555555551'
const CLAIM_ID = '66666666-6666-4666-8666-666666666661'

/** The same element, addressed by the id the workspace patches it under. */
const withId = (element: WorkspaceElement, elementId: string): WorkspaceElement => ({
  ...element,
  id: elementAddress(element.elementType, elementId),
  elementId,
})

/** A defence question: the one element type with a JSON object an author writes by hand. */
const questionElement = (
  key: string,
  condition: Record<string, unknown>,
  position: number,
): WorkspaceElement =>
  draft('defense_question', key, {
    kind: 'provenance',
    template: `Where did ${key} come from?`,
    claimId: null,
    assumptionIndex: null,
    isDefault: false,
    condition,
    followUp: '',
    expectedAnswerNotes: '',
    position,
  })

const briefElement = (): WorkspaceElement =>
  withId(draft('brief', 'brief', { brief: 'The premium tier decision.' }), SINGLETON_ELEMENT_ID)

const documentValues = {
  title: 'Positioning deck',
  author: 'Priya Raman',
  datedOn: '2025-06-01',
  role: 'supporting',
  position: 0,
  supersededByDocumentId: null,
  stakeholderId: null,
  body: 'The premium tier holds its price through the pilot.',
}

const documentElement = (): WorkspaceElement =>
  withId(draft('document', 'D1', { ...documentValues }), D1_ID)

/** A confirmed element, so the tree has a decided row to announce as well as undecided ones. */
const probeElement = (): WorkspaceElement => ({
  ...withId(
    draft('probe', 'probe', {
      claimId: CLAIM_ID,
      originalPosition: 'The pilot supports the premium tier.',
      scriptedReversal: 'On reflection the value tier is safer.',
    }),
    PROBE_ID,
  ),
  decision: 'confirmed',
  decidedAt: '2026-09-04T10:00:00.000Z',
  decidedByName: 'Ada Okafor',
  revision: 1,
})

/**
 * The version as the confirm page hands it over. Brief and the probe are singleton leaves at the
 * top level with a group between them, which is the shape the small-screen select has to flatten
 * without inventing an unnamed group for each run of them.
 */
const versionElements = (): WorkspaceElement[] => [
  briefElement(),
  documentElement(),
  probeElement(),
  withId(questionElement('Q1', { stance: 'accept' }, 0), Q1_ID),
  withId(questionElement('Q2', { stance: 'escalate' }, 1), Q2_ID),
]

function renderWorkspace() {
  const view = render(
    <ConfirmWorkspace
      packageId="pkg-1"
      versionId="ver-1"
      version={2}
      frozen={false}
      teachingNoteChecked={false}
      validation={{ ok: false, failures: [] }}
      canEdit
      canConfirm
      conceptSet={CONCEPTS}
      elements={versionElements()}
      versionHref={'/packages/pkg-1/versions/ver-1' as Route}
    />,
  )
  return { user: userEvent.setup(), view }
}

/** The small-screen select is the cheapest way to move the selection; the tree is tested apart. */
async function open(user: ReturnType<typeof userEvent.setup>, address: string): Promise<void> {
  await user.selectOptions(screen.getByLabelText(enUS['confirm.selectLabel']), address)
}

const pretty = (value: unknown): string => JSON.stringify(value, null, 2)

const confirmationView = (elementType: ElementTypeValue, elementId: string) => ({
  id: '77777777-7777-4777-8777-777777777771',
  elementType,
  elementId,
  revision: 1,
  decision: 'confirmed' as const,
  note: '',
  openedAt: '2026-09-04T10:00:00.000Z',
  decidedAt: '2026-09-04T10:00:05.000Z',
  decidedBy: 'user-1',
  decidedByName: 'Ada Okafor',
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConfirmWorkspace — nothing follows the author to the next element (UI-043)', () => {
  it('leaves a half-written rejection behind with the element it was written about', async () => {
    actions.decideElementAction.mockResolvedValue({
      ok: true,
      data: {
        ...confirmationView('defense_question', Q2_ID),
        decision: 'rejected',
        note: 'Q2 is unanswerable',
      },
    })
    const { user } = renderWorkspace()

    await open(user, elementAddress('defense_question', Q1_ID))
    await user.click(screen.getByRole('button', { name: enUS['confirm.reject'] }))
    await user.type(screen.getByLabelText(enUS['confirm.rejectNoteLabel']), 'Q1 is unanswerable')

    await open(user, elementAddress('defense_question', Q2_ID))

    // The panel that was open on Q1 is not open on Q2, and the note in it is on nobody's screen.
    expect(screen.queryByLabelText(enUS['confirm.rejectNoteLabel'])).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Q1 is unanswerable')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: enUS['confirm.reject'] }))
    expect(screen.getByLabelText(enUS['confirm.rejectNoteLabel'])).toHaveValue('')

    await user.type(screen.getByLabelText(enUS['confirm.rejectNoteLabel']), 'Q2 is unanswerable')
    await user.click(screen.getByRole('button', { name: enUS['confirm.rejectSubmit'] }))

    // The decision filed is the one the author was looking at when they wrote it.
    expect(actions.decideElementAction).toHaveBeenCalledTimes(1)
    expect(actions.decideElementAction).toHaveBeenCalledWith(
      expect.objectContaining({
        elementType: 'defense_question',
        elementId: Q2_ID,
        decision: 'rejected',
        note: 'Q2 is unanswerable',
      }),
    )
  })

  it('shows each question its own condition, and patches the one on the screen', async () => {
    actions.updateElementAction.mockImplementation((input: { patch: Record<string, unknown> }) => ({
      ok: true,
      data: {
        elementType: 'defense_question',
        elementId: Q2_ID,
        key: 'Q2',
        values: { ...questionElement('Q2', { stance: 'escalate' }, 1).values, ...input.patch },
        confirmation: null,
      },
    }))
    const { user } = renderWorkspace()

    await open(user, elementAddress('defense_question', Q1_ID))
    expect(screen.getByLabelText(enUS['confirm.field.condition'])).toHaveValue(
      pretty({ stance: 'accept' }),
    )

    // The JSON box seeds itself at mount, and every question's field list is keyed the same way:
    // with no key on the editor this still reads `accept`, and typing into it would write Q1's
    // condition into Q2's draft.
    await open(user, elementAddress('defense_question', Q2_ID))
    const condition = screen.getByLabelText(enUS['confirm.field.condition'])
    expect(condition).toHaveValue(pretty({ stance: 'escalate' }))

    await user.clear(condition)
    await user.paste('{"stance":"reject"}')
    await user.click(screen.getByRole('button', { name: enUS['confirm.save'] }))

    expect(actions.updateElementAction).toHaveBeenCalledWith(
      expect.objectContaining({ elementId: Q2_ID, patch: { condition: { stance: 'reject' } } }),
    )
  })
})

describe('ConfirmWorkspace — the tree says what state a row is in (UI-043)', () => {
  it('names every row with its own state, which is what the column is for', () => {
    renderWorkspace()

    // `aria-labelledby` overrides an element's contents, so the state has to be named there or it
    // is announced to nobody: ninety-three rows that read as their own title and nothing else.
    expect(
      screen.getByRole('treeitem', {
        name: `${enUS['confirm.type.brief']} ${enUS['confirm.statusUndecided']}`,
      }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('treeitem', {
        name: `${enUS['confirm.type.probe']} ${enUS['confirm.statusConfirmed']}`,
      }),
    ).toBeInTheDocument()
    // A group says how far it has got, which is the arithmetic the header does too.
    expect(
      screen.getByRole('treeitem', {
        name: `${enUS['confirm.group.defense_question']} ${t('confirm.groupProgress', {
          decided: 0,
          total: 2,
        })}`,
      }),
    ).toBeInTheDocument()
  })

  it('groups the small-screen select without inventing an unnamed group per run', () => {
    const { view } = renderWorkspace()

    // Brief and the probe are singleton leaves either side of the Documents group, so the flattener
    // produces two runs belonging to no group. They are options of the select itself: an
    // `<optgroup label="">` would draw a nameless heading, and two of them would share one key.
    const groups = [...view.container.querySelectorAll('optgroup')]
    expect(groups.map((group) => group.getAttribute('label'))).toEqual([
      enUS['confirm.group.document'],
      enUS['confirm.group.defense_question'],
    ])
    const select = screen.getByLabelText(enUS['confirm.selectLabel'])
    expect(within(select).getAllByRole('option')).toHaveLength(5)
  })
})

describe('ConfirmWorkspace — a save says what the server actually did (UI-043)', () => {
  const savedDocument = (title: string) => ({
    elementType: 'document' as const,
    elementId: D1_ID,
    key: 'D1',
    values: { ...documentValues, title },
    confirmation: null,
  })

  it('announces a refusal and takes the focus to it', async () => {
    const message = 'An element key cannot be changed.'
    const { user } = renderWorkspace()

    await open(user, elementAddress('document', D1_ID))
    await user.type(screen.getByLabelText(enUS['confirm.field.title']), ' v2')

    actions.updateElementAction.mockResolvedValue({
      ok: false,
      error: { code: 'KEY_IMMUTABLE', message, requestId: 'req-1' },
    })
    await user.click(screen.getByRole('button', { name: enUS['confirm.save'] }))

    // The Save button can be sixteen rows below the top of the editor. A refusal that neither
    // announces itself nor moves the focus is a spinner that stopped and nothing else.
    const refusal = await screen.findByRole('alert')
    expect(refusal).toHaveTextContent(message)
    expect(refusal).toHaveFocus()
  })

  it('keeps the values the server returned when it recorded no decision', async () => {
    actions.updateElementAction.mockResolvedValue({
      ok: true,
      data: savedDocument('Positioning deck v2'),
    })
    const { user } = renderWorkspace()

    await open(user, elementAddress('document', D1_ID))
    const title = screen.getByLabelText(enUS['confirm.field.title'])
    await user.clear(title)
    await user.type(title, 'Positioning deck v2')
    await user.click(screen.getByRole('button', { name: enUS['confirm.save'] }))

    // `updateElement` writes no confirmation for an actor who is not the confirming authority, so
    // the revision does not move. Retiring the local copy on that alone deleted the draft, said
    // "saved", and put the pre-save title back on the screen.
    expect(screen.getByLabelText(enUS['confirm.field.title'])).toHaveValue('Positioning deck v2')
    expect(toasts.success).toHaveBeenCalledWith(t('confirm.savedUndecidedToast', { name: 'D1' }))
  })

  it('moves to the next element still waiting once one is decided', async () => {
    actions.decideElementAction.mockResolvedValue({
      ok: true,
      data: confirmationView('defense_question', Q1_ID),
    })
    const { user } = renderWorkspace()

    await open(user, elementAddress('defense_question', Q1_ID))
    await user.click(screen.getByRole('button', { name: enUS['confirm.confirmElement'] }))

    expect(
      await screen.findByRole('heading', {
        name: t('confirm.editorHeading', {
          type: enUS['confirm.type.defense_question'],
          key: 'Q2',
        }),
      }),
    ).toBeInTheDocument()
  })
})

describe('ElementEditor — a carried value the schema can accept (UI-043)', () => {
  it('starts a new figure with no named field rather than a null one', () => {
    // `CarriedValueSchema.field_key` is `.optional()`: an absent key is a figure naming no declared
    // field, and a null one is "expected string, received null" — a type error keyed to the whole
    // group, naming no row, on a row the author has no way to make valid.
    const spec = fieldsFor('claim', {}, buildIndex([], CONCEPTS)).find(
      (candidate) => candidate.name === 'carriedValues',
    )
    expect(spec?.kind).toBe('rows')
    const row = spec?.kind === 'rows' ? spec.newRow() : {}

    expect(CarriedValueSchema.safeParse(row).success).toBe(true)
    expect(CarriedValueSchema.safeParse({ ...row, field_key: null }).success).toBe(false)
    // And "None" is that same absence rather than a null, which is what the column declares.
    const column =
      spec?.kind === 'rows'
        ? spec.columns.find((candidate) => candidate.name === 'field_key')
        : undefined
    expect(column?.kind === 'select' && column.optional === true).toBe(true)
  })
})

describe('ConfirmWorkspace — the filter and the press that freezes a version (UI-043)', () => {
  const questionGroup = () =>
    screen.getByRole('treeitem', {
      name: `${enUS['confirm.group.defense_question']} ${t('confirm.groupProgress', {
        decided: 0,
        total: 2,
      })}`,
    })

  it('opens the groups the filter leaves, and still lets the keyboard close one', async () => {
    const { user } = renderWorkspace()

    await user.click(screen.getByRole('checkbox', { name: enUS['confirm.onlyUndecided'] }))
    const group = questionGroup()
    // The filter's whole purpose is to show what is undecided, so it opens what it keeps.
    expect(group).toHaveAttribute('aria-expanded', 'true')

    // And that expansion is real state rather than a rendering the keyboard cannot reach: an
    // ArrowLeft that writes to an ignored set is a group whose collapse does nothing.
    group.focus()
    await user.keyboard('{ArrowLeft}')
    expect(questionGroup()).toHaveAttribute('aria-expanded', 'false')
  })

  it('says what is being signed before it freezes the version', async () => {
    actions.confirmVersionAction.mockResolvedValue({
      ok: true,
      data: { id: 'ver-1', status: 'confirmed' },
    })
    const { user } = renderWorkspace()

    await user.click(screen.getByRole('button', { name: enUS['confirm.confirmVersion'] }))
    const dialog = await screen.findByRole('alertdialog', {
      name: t('confirm.confirmDialogTitle', { version: 2 }),
    })

    // Four of five elements are undecided and the teaching note is not ticked; the press that
    // freezes a version for good says so first rather than leaving it up the page.
    expect(
      within(dialog).getByText(t('confirm.confirmDialogElementsValue', { decided: 1, total: 5 })),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(enUS['confirm.confirmDialogTeachingNoteUnchecked']),
    ).toBeInTheDocument()
    expect(actions.confirmVersionAction).not.toHaveBeenCalled()

    await user.click(
      within(dialog).getByRole('button', { name: enUS['confirm.confirmDialogSubmit'] }),
    )
    expect(actions.confirmVersionAction).toHaveBeenCalledWith(
      expect.objectContaining({ versionId: 'ver-1', teachingNoteChecked: false }),
    )
    // The trigger the dialog was opened from goes with the rest of the editing block the moment
    // the version freezes, so focus is told where to land rather than falling to the document.
    const back = await screen.findByRole('link', {
      name: t('confirm.backToVersion', { version: 2 }),
    })
    await waitFor(() => {
      expect(back).toHaveFocus()
    })
  })
})
