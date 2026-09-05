import Link from 'next/link'
import { RunList } from '@/components/features/run/run-list'
import type { RunListRow } from '@/components/features/run/run-rows'
import { EmptyState } from '@/components/layout/empty-state'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'

// UI-009 "Your runs": the top of the runs list, on the screen a student lands on.
//
// It draws the same rows with the same component as `/runs` rather than a lighter summary of them.
// The point of the panel is the next action — Start, Continue, Read the debrief — and the next
// action is exactly the part a summary would have had to reimplement, so a second implementation
// would be a second chance to disagree with the state machine about where a run continues.
//
// Three states, and the two empty ones are told apart because they ask for different things: a
// person with no institution is waiting on an invitation, and a member with nothing assigned is
// waiting on a course.
//
// Outline: the page h1, this panel's h2, the empty state's h3.

/** As many rows as fit above the fold without the panel becoming the page; the rest are one link away. */
const HOME_ROWS = 5

export type HomeRunsPanelProps = {
  hasMembership: boolean
  rows: readonly RunListRow[]
}

export function HomeRunsPanel({ hasMembership, rows }: HomeRunsPanelProps) {
  const shown = rows.slice(0, HOME_ROWS)

  return (
    <Panel
      id="home-runs"
      title={t('home.runsTitle')}
      headingLevel={2}
      {...(rows.length > shown.length
        ? {
            actions: (
              <Link href="/runs" className={buttonVariants({ variant: 'secondary' })}>
                {t('run.homeMore')}
              </Link>
            ),
          }
        : {})}
    >
      {shown.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title={hasMembership ? t('home.emptyTitle') : t('home.noMembershipsTitle')}
          body={hasMembership ? t('home.emptyBody') : t('home.noMemberships')}
        />
      ) : (
        <RunList rows={shown} nextCursor={null} />
      )}
    </Panel>
  )
}
