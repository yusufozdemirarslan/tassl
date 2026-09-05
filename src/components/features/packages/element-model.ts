import type {
  ConfirmationDecisionValue,
  ElementTypeValue,
  VariantKeyValue,
} from '@/server/modules/scenarios/schema'

// The vocabulary the element confirmation workspace is built on (UI-043, FR-192): what one element
// is to the screen, how the fifteen types become one navigable tree, and which other elements a
// given one is allowed to point at.
//
// It is deliberately free of JSX and of `t()`, so the tree can be built once on the server, walked
// by the keyboard handler, counted by the progress header and asserted by a unit test without any
// of them rendering anything.
//
// Every reference an editor offers — the document a claim is sourced from, the stakeholder a
// document belongs to, the claim a probe probes — is derived from the element list itself rather
// than fetched again: an element already carries its own id and its own key, so the list is its own
// index. That is also what keeps a reference select honest while the author edits: rename a
// document and the claim editor's source list says the new name on the next server render.

/** An element as the workspace holds it: addressable, valued, and carrying the decision that stands. */
export type WorkspaceElement = {
  /**
   * The element's address in this screen: `document:<uuid>`, `brief:`. It is the confirmation key
   * the service files decisions under (`element_confirmations`, 06 §3.3), so two elements can never
   * collide and a singleton is always the one row it should be.
   */
  id: string
  elementType: ElementTypeValue
  /**
   * The id a mutation addresses. A singleton element has no row id of its own, and the routes
   * address it with the all-zero uuid; the page resolves that once so nothing below has to know.
   */
  elementId: string
  /** The element's own name in the package: `D4`, `C3`, `defective:C3`, or the type for a singleton. */
  key: string
  /** The element in the shape its input schema takes; the editor reads and patches these. */
  values: Record<string, unknown>
  decision: ConfirmationDecisionValue | null
  decidedAt: string | null
  decidedByName: string
  note: string
  revision: number
}

/** The address of an element, the way a confirmation row is keyed (06 §3.3). */
export const elementAddress = (elementType: ElementTypeValue, elementId: string | null): string =>
  `${elementType}:${elementId ?? ''}`

/** A decision that stands as a confirmation: an explicit tick, or the author's own edit (10 §4). */
export const isSettled = (element: WorkspaceElement): boolean =>
  element.decision === 'confirmed' || element.decision === 'edited'

// ---------------------------------------------------------------------------------------------
// Reading values
//
// An element's values are `unknown` on the way out of the service, because fifteen schemas do not
// share a shape. These are the only place the screen narrows them, and each one answers with the
// empty value of its type rather than throwing: a field the server has not sent yet is an empty
// field, not a broken screen.
// ---------------------------------------------------------------------------------------------

export const readString = (values: Record<string, unknown>, field: string): string => {
  const value = values[field]
  return typeof value === 'string' ? value : ''
}

export const readStringOrNull = (values: Record<string, unknown>, field: string): string | null => {
  const value = values[field]
  return typeof value === 'string' ? value : null
}

export const readNumber = (values: Record<string, unknown>, field: string): number | null => {
  const value = values[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export const readBoolean = (values: Record<string, unknown>, field: string): boolean =>
  values[field] === true

// ---------------------------------------------------------------------------------------------
// The index of what an element may point at
// ---------------------------------------------------------------------------------------------

export type ElementOption = {
  id: string
  /** The mono key, when the element has one an author navigates by. */
  key: string
  /** The human line: a document's title, a stakeholder's name, a claim's text. */
  label: string
}

export type ElementIndex = {
  documents: ElementOption[]
  stakeholders: ElementOption[]
  claims: ElementOption[]
  namedFields: ElementOption[]
  /** Variant id to its key, so a state can say which reading of the scenario it is. */
  variantKeys: Map<string, VariantKeyValue>
  conceptSet: readonly string[]
}

const byPosition = (a: WorkspaceElement, b: WorkspaceElement): number =>
  (readNumber(a.values, 'position') ?? 0) - (readNumber(b.values, 'position') ?? 0)

const optionsOf = (
  elements: readonly WorkspaceElement[],
  elementType: ElementTypeValue,
  labelField: string,
): ElementOption[] =>
  elements
    .filter((element) => element.elementType === elementType)
    .sort(byPosition)
    .map((element) => ({
      id: element.elementId,
      key: element.key,
      label: readString(element.values, labelField),
    }))

const VARIANT_KEYS = new Set<string>(['defective', 'sound'])

export function buildIndex(
  elements: readonly WorkspaceElement[],
  conceptSet: readonly string[],
): ElementIndex {
  const variantKeys = new Map<string, VariantKeyValue>()
  for (const element of elements) {
    if (element.elementType !== 'variant_claim_state') continue
    const variantId = readStringOrNull(element.values, 'variantId')
    // A state's own key is `<variant>:<claim>`, which is the only place the variant's key travels
    // with the variant's id — the version view publishes neither.
    const [variantKey] = element.key.split(':')
    if (variantId && variantKey && VARIANT_KEYS.has(variantKey)) {
      variantKeys.set(variantId, variantKey as VariantKeyValue)
    }
  }
  return {
    documents: optionsOf(elements, 'document', 'title'),
    stakeholders: optionsOf(elements, 'stakeholder', 'name'),
    claims: optionsOf(elements, 'claim', 'text'),
    namedFields: optionsOf(elements, 'named_field', 'label'),
    variantKeys,
    conceptSet,
  }
}

// ---------------------------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------------------------

export type TreeLeaf = {
  kind: 'leaf'
  id: string
  /** The line that names it: a document's title, a claim's text, a singleton's own name. */
  label: string
  /** The element key, shown in mono beside the label; absent for a singleton, whose key is its type. */
  caption: string | null
  element: WorkspaceElement
}

export type TreeGroup = {
  kind: 'group'
  id: string
  label: string
  caption: string | null
  children: TreeNode[]
}

export type TreeNode = TreeLeaf | TreeGroup

/** The order 10 §4 lists the element types in, which is the order `elementUnits` emits them. */
export const ELEMENT_GROUP_ORDER = [
  'brief',
  'document',
  'stakeholder',
  'answer_space_position',
  'named_field',
  'claim',
  'probe',
  'turn',
  'defense_question',
  'readiness_item',
  'counterfactual',
  'general_escalation_reply',
  'clock_and_difficulty',
  'seed_reskin',
] as const satisfies readonly ElementTypeValue[]

/** The seven types a version has at most one of; they are leaves, not groups of one. */
const SINGLETONS = new Set<ElementTypeValue>([
  'brief',
  'probe',
  'turn',
  'counterfactual',
  'general_escalation_reply',
  'clock_and_difficulty',
  'seed_reskin',
])

/** The field whose value names a leaf of each listed type. */
const LABEL_FIELD: Partial<Record<ElementTypeValue, string>> = {
  document: 'title',
  stakeholder: 'name',
  answer_space_position: 'summary',
  named_field: 'label',
  defense_question: 'template',
  readiness_item: 'stem',
}

/** A long body on one line: the tree is an index, so a leaf says enough to be recognised. */
export function oneLine(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/** Strings the tree needs; passed in so this module reads no namespace of the catalogue. */
export type TreeLabels = {
  group: (elementType: ElementTypeValue) => string
  type: (elementType: ElementTypeValue) => string
  claimBase: string
  claimVariant: (variantKey: VariantKeyValue) => string
}

/**
 * The fifteen element types as one tree.
 *
 * Two shapes, for two reasons. A singleton is a leaf at the top level: "Brief" *is* the element,
 * and a group of one with a disclosure triangle would cost a keystroke to say nothing. A claim is a
 * group of three, because a claim and the two readings of it are three elements with three separate
 * decisions (`elementUnits`) — listing them apart would put a claim's own states eight rows away
 * from it, and an author reviews a claim by reading all three together.
 */
export function buildTree(
  elements: readonly WorkspaceElement[],
  index: ElementIndex,
  labels: TreeLabels,
): TreeNode[] {
  const byType = new Map<ElementTypeValue, WorkspaceElement[]>()
  for (const element of elements) {
    const list = byType.get(element.elementType)
    if (list) list.push(element)
    else byType.set(element.elementType, [element])
  }

  const statesByClaim = new Map<string, WorkspaceElement[]>()
  for (const state of byType.get('variant_claim_state') ?? []) {
    const claimId = readStringOrNull(state.values, 'claimId') ?? ''
    const list = statesByClaim.get(claimId)
    if (list) list.push(state)
    else statesByClaim.set(claimId, [state])
  }

  const leafOf = (element: WorkspaceElement): TreeLeaf => {
    const field = LABEL_FIELD[element.elementType]
    const named = field ? oneLine(readString(element.values, field)) : ''
    return {
      kind: 'leaf',
      id: element.id,
      label: named.length > 0 ? named : labels.type(element.elementType),
      caption: SINGLETONS.has(element.elementType) ? null : element.key,
      element,
    }
  }

  const nodes: TreeNode[] = []
  for (const elementType of ELEMENT_GROUP_ORDER) {
    const found = (byType.get(elementType) ?? []).slice().sort(byPosition)
    if (found.length === 0) continue

    if (SINGLETONS.has(elementType)) {
      for (const element of found) nodes.push(leafOf(element))
      continue
    }

    if (elementType === 'claim') {
      nodes.push({
        kind: 'group',
        id: `group:claim`,
        label: labels.group('claim'),
        caption: null,
        children: found.map((claim) => ({
          kind: 'group' as const,
          id: `group:claim:${claim.elementId}`,
          label: oneLine(readString(claim.values, 'text')),
          caption: claim.key,
          children: [
            { ...leafOf(claim), label: labels.claimBase, caption: null },
            ...(statesByClaim.get(claim.elementId) ?? [])
              .slice()
              .sort((a, b) => a.key.localeCompare(b.key))
              .map((state) => {
                const variantId = readStringOrNull(state.values, 'variantId') ?? ''
                const variantKey = index.variantKeys.get(variantId) ?? 'sound'
                return {
                  kind: 'leaf' as const,
                  id: state.id,
                  label: labels.claimVariant(variantKey),
                  caption: null,
                  element: state,
                }
              }),
          ],
        })),
      })
      continue
    }

    nodes.push({
      kind: 'group',
      id: `group:${elementType}`,
      label: labels.group(elementType),
      caption: null,
      children: found.map(leafOf),
    })
  }

  // A state whose claim is gone is drawn on its own rather than dropped. `CLAIM_STATE_MISSING`
  // already names the fault, but the element still has to be decided before the version can be
  // confirmed — and an element that blocks a confirmation and cannot be reached is the one thing
  // this screen must never produce.
  const claimIds = new Set((byType.get('claim') ?? []).map((claim) => claim.elementId))
  const orphans = (byType.get('variant_claim_state') ?? []).filter(
    (state) => !claimIds.has(readStringOrNull(state.values, 'claimId') ?? ''),
  )
  if (orphans.length > 0) {
    nodes.push({
      kind: 'group',
      id: 'group:variant_claim_state',
      label: labels.group('variant_claim_state'),
      caption: null,
      children: orphans.map((state) => ({
        kind: 'leaf' as const,
        id: state.id,
        label: labels.type('variant_claim_state'),
        caption: state.key,
        element: state,
      })),
    })
  }
  return nodes
}

/** Every leaf under a node, in the order they are drawn. */
export function leavesOf(nodes: readonly TreeNode[]): TreeLeaf[] {
  const out: TreeLeaf[] = []
  const walk = (list: readonly TreeNode[]): void => {
    for (const node of list) {
      if (node.kind === 'leaf') out.push(node)
      else walk(node.children)
    }
  }
  walk(nodes)
  return out
}

/** How far a group has got: what the list shows beside its name, and the progress bar's arithmetic. */
export function countDecided(nodes: readonly TreeNode[]): { decided: number; total: number } {
  const leaves = leavesOf(nodes)
  return { decided: leaves.filter((leaf) => isSettled(leaf.element)).length, total: leaves.length }
}
