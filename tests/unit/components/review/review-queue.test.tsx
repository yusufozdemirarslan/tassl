import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReviewQueue, type ReviewQueueRunRow } from '@/components/features/review/review-queue'
import { enUS } from '@/lib/i18n/en-US'

// UI-034's queue. A held run — `scoring_status = 'held'`, nothing could place its bands — reads
// "Under review" on the assignment page, and it has to read the same here: a reviewer who saw
// "Defense complete" on the queue and "Under review" one click later was being told two things
// about one run (FR-140).

const HELD: ReviewQueueRunRow = {
  id: '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a034',
  studentName: 'Student One',
  attemptNo: 1,
  state: 'defense_complete',
  underReview: true,
  decisionsMade: 0,
  latestExportVersion: null,
}

const SCORED: ReviewQueueRunRow = {
  id: '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a035',
  studentName: 'Student Two',
  attemptNo: 1,
  state: 'scored',
  underReview: false,
  decisionsMade: 3,
  latestExportVersion: null,
}

describe('ReviewQueue (UI-034)', () => {
  it('reads "Under review" on a held run and the state word on every other', () => {
    render(<ReviewQueue illustrative={[]} runs={[HELD, SCORED]} />)

    const rows = screen.getAllByRole('row').slice(1)
    const held = rows.find((row) => within(row).queryByText('Student One'))
    const scored = rows.find((row) => within(row).queryByText('Student Two'))
    expect(held).toBeDefined()
    expect(scored).toBeDefined()

    const heldChip = within(held as HTMLElement).getByText(enUS['run.stateUnderReview'])
    expect(heldChip.closest('[data-state]')).toHaveAttribute('data-state', 'under_review')
    expect(
      within(held as HTMLElement).queryByText(enUS['run.stateDefenseComplete']),
    ).not.toBeInTheDocument()

    const scoredChip = within(scored as HTMLElement).getByText(enUS['run.stateScored'])
    expect(scoredChip.closest('[data-state]')).toHaveAttribute('data-state', 'scored')
  })
})
