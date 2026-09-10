import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConfirmationRecord } from '@/components/features/packages/confirmation-record'
import type { ElementConfirmationView } from '@/server/modules/scenarios/schema'

// UI-044's confirmation record (FR-195, FR-198). A row element is named by the key the workspace
// shows it under — C3, D1, defective:C3 — because a reader of the record is looking for the claim
// they know, not for the uuid the confirmation row was written against.

const CLAIM_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e03'
const DOCUMENT_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e01'
const STATE_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e13'

function row(over: Partial<ElementConfirmationView> & { id: string }): ElementConfirmationView {
  return {
    elementType: 'claim',
    elementId: CLAIM_ID,
    elementKey: 'C3',
    revision: 1,
    decision: 'confirmed',
    note: '',
    openedAt: '2026-09-05T10:00:00.000Z',
    decidedAt: '2026-09-05T10:01:00.000Z',
    decidedBy: 'user_1',
    decidedByName: 'Ada Instructor',
    ...over,
  }
}

describe('ConfirmationRecord (UI-044)', () => {
  it('names each element by its key, never by the confirmation row id', () => {
    render(
      <ConfirmationRecord
        rows={[
          // An edit is an exception, so this row is drawn in the exceptions table as well.
          row({ id: 'c1', decision: 'edited', revision: 2 }),
          row({ id: 'c2', elementType: 'document', elementId: DOCUMENT_ID, elementKey: 'D1' }),
          row({
            id: 'c3',
            elementType: 'variant_claim_state',
            elementId: STATE_ID,
            elementKey: 'defective:C3',
          }),
          row({ id: 'c4', elementType: 'brief', elementId: null, elementKey: null }),
        ]}
      />,
    )

    // Once in the exceptions table and once behind the disclosure.
    expect(screen.getAllByText('C3')).toHaveLength(2)
    expect(screen.getByText('D1')).toBeInTheDocument()
    expect(screen.getByText('defective:C3')).toBeInTheDocument()
    for (const id of [CLAIM_ID, DOCUMENT_ID, STATE_ID]) {
      expect(screen.queryByText(id)).not.toBeInTheDocument()
    }
  })

  it('falls back to the id only when the view carries no key at all', () => {
    const { elementKey: _dropped, ...withoutKey } = row({ id: 'c1' })
    void _dropped
    render(<ConfirmationRecord rows={[withoutKey]} />)
    expect(screen.getByText(CLAIM_ID)).toBeInTheDocument()
  })
})
