import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RunList } from '@/components/features/run/run-list'
import type { RunListRow } from '@/components/features/run/run-rows'
import { enUS } from '@/lib/i18n/en-US'
import type { RunStateValue } from '@/server/modules/runs/schema'

// UI-020's Next column. The word on the control is the step the student is about to take: a run
// that has been offered and not begun sits in `assigned`, whose screen is "Before you begin", so it
// says Start exactly as the row with no attempt yet does; Continue is for a run already under way.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a020'
const ASSIGNMENT_ID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e20'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
// The real module drags the runs service and the database into jsdom.
vi.mock('@/server/modules/runs/actions', () => ({ startRunAction: vi.fn() }))

function row(state: RunStateValue, label: string): RunListRow {
  return {
    key: `${RUN_ID}-${state}`,
    assignmentId: ASSIGNMENT_ID,
    assignmentLabel: label,
    isWalkthrough: false,
    opensAt: null,
    run: {
      id: RUN_ID,
      attemptNo: 1,
      state,
      underReview: false,
      nextHref: `/runs/${RUN_ID}/begin`,
    },
    reoffer: null,
  }
}

describe('RunList next action (UI-020)', () => {
  it('offers Start on a run that has been assigned and not begun', () => {
    render(<RunList rows={[row('assigned', 'Decision Run 1')]} nextCursor={null} />)
    const link = screen.getByRole('link', {
      name: `${enUS['run.actionStart']} · Decision Run 1`,
    })
    expect(link).toHaveTextContent(enUS['run.actionStart'])
    expect(link).toHaveAttribute('href', `/runs/${RUN_ID}/begin`)
    expect(screen.queryByText(enUS['run.actionContinue'])).not.toBeInTheDocument()
  })

  it.each(['readiness', 'framing', 'working', 'paused', 'decision_locked'] as const)(
    'keeps Continue for a run in %s',
    (state) => {
      render(<RunList rows={[row(state, 'Decision Run 1')]} nextCursor={null} />)
      expect(
        screen.getByRole('link', { name: `${enUS['run.actionContinue']} · Decision Run 1` }),
      ).toHaveTextContent(enUS['run.actionContinue'])
    },
  )

  it('offers Start as a button on an assignment with no attempt yet', () => {
    render(
      <RunList
        rows={[
          {
            key: ASSIGNMENT_ID,
            assignmentId: ASSIGNMENT_ID,
            assignmentLabel: 'Decision Run 1',
            isWalkthrough: false,
            opensAt: null,
            run: null,
            reoffer: null,
          },
        ]}
        nextCursor={null}
      />,
    )
    expect(
      screen.getByRole('button', { name: `${enUS['run.actionStart']} Decision Run 1` }),
    ).toHaveTextContent(enUS['run.actionStart'])
  })
})
