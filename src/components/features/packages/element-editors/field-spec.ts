import type { StanceValue } from '@/server/modules/scenarios/schema'

// What one field of one element looks like to the editor (UI-043).
//
// The workspace edits fifteen element types through one form, and the alternative to describing a
// field was fifteen hand-written forms with fifteen copies of the same label-hint-error-count
// scaffolding. So a field is data: `specs.ts` names the fields of each type, `fields.tsx` draws
// them, and adding a field to an element is a line rather than a component.
//
// What is deliberately *not* here is validation. `ELEMENT_PATCH_SCHEMAS` is the one schema a patch
// is judged by, it lives on the server, and a Client Component may not import it (D-186); the
// service answers `VALIDATION_ERROR` with `z.flattenError`'s `fieldErrors`, keyed by exactly the
// names below, and the editor puts each message under its field. `required` and `wordLimit` are the
// two exceptions, and they are here to refuse *sooner*, not differently: an empty required field
// and an over-long one are the two mistakes an author makes while typing, and a round trip to hear
// about them is a round trip too many.

export type SelectOption = {
  value: string
  label: string
  /** The element key, shown in mono beside the label where an author navigates by key. */
  caption?: string
}

type ColumnCommon = {
  name: string
  label: string
  /** How much of the row this column takes: `wide` spans both, `narrow` keeps a key column short. */
  width?: 'narrow' | 'wide'
}

export type RowColumn =
  | (ColumnCommon & { kind: 'text'; mono?: boolean })
  | (ColumnCommon & { kind: 'textarea' })
  | (ColumnCommon & { kind: 'number' })
  /**
   * `optional` offers a "None" choice that *removes* the key from the row rather than writing
   * `null` into it. It is spelled that way because the one column that has it — a carried value's
   * `field_key` — is `FieldKeySchema.optional()` in the schema, which accepts an absent key and
   * refuses a null one; a row column that needs a null would be a different flag.
   */
  | (ColumnCommon & { kind: 'select'; options: SelectOption[]; optional?: boolean })

type Common = {
  /** The key inside the element's values, and the key `fieldErrors` comes back under. */
  name: string
  label: string
  hint?: string
  required?: boolean
  /** Identity fields: the service refuses a patch that changes one, so the editor does not offer it. */
  immutable?: boolean
}

export type FieldSpec =
  | (Common & { kind: 'text'; mono?: boolean })
  | (Common & { kind: 'textarea'; rows?: number; reading?: boolean; wordLimit?: number })
  | (Common & { kind: 'number'; min?: number; max?: number; nullable?: boolean; unit?: string })
  | (Common & { kind: 'date' })
  | (Common & { kind: 'select'; options: SelectOption[]; nullable?: boolean })
  | (Common & { kind: 'stance'; options: readonly StanceValue[] })
  | (Common & { kind: 'checkbox' })
  /** A list of free strings: trigger phrases, disrupted assumption keys. */
  | (Common & { kind: 'strings'; itemName: string })
  /** A set of other elements, by id: supporting documents, the Turn's window claims. */
  | (Common & { kind: 'multi'; options: SelectOption[] })
  /** A jsonb object the author writes by hand; the only field in the package that is one. */
  | (Common & { kind: 'json' })
  /** A repeatable record: readiness options, carried values, the re-skin log. */
  | (Common & {
      kind: 'rows'
      itemName: string
      columns: RowColumn[]
      newRow: () => Record<string, unknown>
    })
  /** The three interrogation paths of a variant claim state. */
  | (Common & { kind: 'verificationPaths'; documents: SelectOption[] })
  /** `difficulty_profile`: an estimate, a note, and whether a cohort has ever run it. */
  | (Common & { kind: 'difficulty' })

/** A field that is one column of a two-column row on a wide editor; everything else is full width. */
export const isNarrow = (spec: FieldSpec): boolean =>
  spec.kind === 'date' ||
  spec.kind === 'number' ||
  spec.kind === 'checkbox' ||
  (spec.kind === 'text' && spec.mono === true) ||
  spec.kind === 'select' ||
  spec.kind === 'stance'
