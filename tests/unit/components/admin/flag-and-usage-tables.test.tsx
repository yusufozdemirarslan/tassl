import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FlagTable } from '@/components/features/admin/flag-table'
import { LlmUsageTable } from '@/components/features/admin/llm-usage-table'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { AdminFlags, LlmUsage } from '@/server/modules/admin/schema'

// UI-050's two read-only panels: what this deployment is running with, and what it has spent
// (NFR-016, D-065). Neither takes an action or a router — they are server components that render
// their props — so this file mocks nothing.
//
// QA-035 took the `min-w-2xl` floor off both tables so their columns wrap on a phone instead of
// pushing a 672 px table sideways. Whether they wrap is a viewport question and belongs to the
// e2e; what belongs here is the other half of that change — that wrapping cost the panels no
// content. Every long sentence the flag table's meaning column carries, and every figure the usage
// table formats, is still drawn in full from the props.

const USAGE: LlmUsage = {
  today: { calls: 1234, tokens: 987654, costUsd: 12.5 },
  month: { calls: 20500, tokens: 250000, costUsd: 1234.56789 },
  budgets: { userDaily: 40000, globalMonthly: 1000000 },
}

const FLAGS: AdminFlags = {
  ai: true,
  sampleData: false,
  testControls: true,
  demoMode: false,
  effectiveLlmProvider: 'mimo-v2.5-pro',
  aiMode: 'live',
  assistantMode: 'live',
  llmUsage: USAGE,
}

/** The row a named measure or flag sits on, so a cell is read beside the thing it describes. */
function rowFor(name: string): HTMLElement {
  const row = screen.getAllByRole('row').find((candidate) => within(candidate).queryByText(name))
  expect(row).toBeDefined()
  return row as HTMLElement
}

describe('FlagTable (UI-050)', () => {
  it('draws every flag with the value it was handed, named by its environment variable', () => {
    render(<FlagTable flags={FLAGS} />)

    // The name is the variable an operator would set, not a prose paraphrase of it: this screen is
    // read next to a deployment's environment.
    expect(within(rowFor(enUS['admin.flags.ai'])).getByText(enUS['admin.flags.on'])).toBeVisible()
    expect(
      within(rowFor(enUS['admin.flags.sampleData'])).getByText(enUS['admin.flags.off']),
    ).toBeVisible()
    expect(
      within(rowFor(enUS['admin.flags.testControls'])).getByText(enUS['admin.flags.on']),
    ).toBeVisible()
    expect(
      within(rowFor(enUS['admin.flags.demoMode'])).getByText(enUS['admin.flags.off']),
    ).toBeVisible()
  })

  // A deployment with everything off must read as everything off. The badge takes its variant from
  // the same boolean as its word, so a default in either direction would print a reassuring "On"
  // for a flag nobody set.
  it('reads each value off the props rather than off a default', () => {
    const { unmount } = render(<FlagTable flags={{ ...FLAGS, ai: false, testControls: false }} />)
    expect(screen.getAllByText(enUS['admin.flags.off'])).toHaveLength(4)
    expect(screen.queryByText(enUS['admin.flags.on'])).not.toBeInTheDocument()
    unmount()

    render(<FlagTable flags={{ ...FLAGS, sampleData: true, demoMode: true }} />)
    expect(screen.getAllByText(enUS['admin.flags.on'])).toHaveLength(4)
    expect(screen.queryByText(enUS['admin.flags.off'])).not.toBeInTheDocument()
  })

  // The table is read-only on purpose: every one of these values comes from the environment, so a
  // switch here would be a lie about where the value lives, and the honest control is a deploy.
  // The source column says so on every row, and the panel offers nothing to press.
  it('names the environment as the source of every row, and offers no control to change one', () => {
    render(<FlagTable flags={FLAGS} />)

    expect(screen.getAllByText(enUS['admin.flags.source'])).toHaveLength(4)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryAllByRole('switch')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
  })

  // The meaning is the reason the row is worth reading, and it is a sentence rather than a word.
  // Now that the column wraps (QA-035) there is no width left to blame for shortening one, so each
  // is asserted whole.
  it('spells out what each flag changes, in full, beside it', () => {
    render(<FlagTable flags={FLAGS} />)

    expect(
      within(rowFor(enUS['admin.flags.ai'])).getByText(enUS['admin.flags.aiMeaning']),
    ).toBeVisible()
    expect(
      within(rowFor(enUS['admin.flags.sampleData'])).getByText(
        enUS['admin.flags.sampleDataMeaning'],
      ),
    ).toBeVisible()
    expect(
      within(rowFor(enUS['admin.flags.testControls'])).getByText(
        enUS['admin.flags.testControlsMeaning'],
      ),
    ).toBeVisible()
    expect(
      within(rowFor(enUS['admin.flags.demoMode'])).getByText(enUS['admin.flags.demoModeMeaning']),
    ).toBeVisible()
  })

  // `AdminFlags` also carries the effective provider, the runtime assistant mode (D-691) and the
  // spend, and each of those is a panel of its own on the screen. This table draws the four
  // environment flags and nothing else, so a field added to the payload cannot drift into it.
  it('draws the four environment flags only, and none of the payload around them', () => {
    render(<FlagTable flags={FLAGS} />)

    // The four flags plus the header row.
    expect(screen.getAllByRole('row')).toHaveLength(5)
    expect(screen.queryByText(FLAGS.effectiveLlmProvider)).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['admin.flags.usageTokens'])).not.toBeInTheDocument()
  })

  // The caption is the table's own label, and the scroll region takes its accessible name from it.
  // A narrow viewport still scrolls this table sideways, and a keyboard user who lands in that
  // region has to be told which table they are in.
  it('names its four columns and labels the scroll region with the caption', () => {
    render(<FlagTable flags={FLAGS} />)

    expect(screen.getByRole('region', { name: enUS['admin.flags.caption'] })).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual([
      enUS['admin.flags.columnFlag'],
      enUS['admin.flags.columnValue'],
      enUS['admin.flags.columnSource'],
      enUS['admin.flags.columnMeaning'],
    ])
  })
})

describe('LlmUsageTable (UI-050)', () => {
  it('prints each measure for both windows, grouped in thousands and priced in dollars', () => {
    render(<LlmUsageTable usage={USAGE} />)

    const calls = within(rowFor(enUS['admin.flags.usageCalls']))
    expect(calls.getByText('1,234')).toBeVisible()
    expect(calls.getByText('20,500')).toBeVisible()

    const tokens = within(rowFor(enUS['admin.flags.usageTokens']))
    expect(tokens.getByText('987,654')).toBeVisible()
    expect(tokens.getByText('250,000')).toBeVisible()

    // Two fraction digits at the least, so a round figure still reads as money, and four at the
    // most, because a token price is quoted in fractions of a cent and rounding it to two would
    // report a day's real spend as nothing.
    const cost = within(rowFor(enUS['admin.flags.usageCost']))
    expect(cost.getByText('$12.50')).toBeVisible()
    expect(cost.getByText('$1,234.5679')).toBeVisible()
  })

  // A deployment answering every call from the built-in fixture was billed for nothing (D-651), so
  // its true spend is zero. Zero is printed as zero: an empty cell or a dash would read as "not
  // measured", which is a different and wrong answer to what this deployment has spent.
  it('prints a fixture-only deployment as zero rather than as blank', () => {
    render(
      <LlmUsageTable
        usage={{
          today: { calls: 0, tokens: 0, costUsd: 0 },
          month: { calls: 0, tokens: 0, costUsd: 0 },
          budgets: USAGE.budgets,
        }}
      />,
    )

    expect(within(rowFor(enUS['admin.flags.usageCalls'])).getAllByText('0')).toHaveLength(2)
    expect(within(rowFor(enUS['admin.flags.usageCost'])).getAllByText('$0.00')).toHaveLength(2)
  })

  // The sentence measures the month's tokens against the one ceiling they are actually measured
  // against, using the same figure the row above it prints — the panel and `LLM_BUDGET_EXCEEDED`
  // cannot be allowed to disagree about how much of the month is gone.
  it('builds the monthly budget sentence from the month it just printed', () => {
    render(<LlmUsageTable usage={USAGE} />)

    expect(
      screen.getByText(
        t('admin.flags.usageMonthlyBudget', {
          used: '250,000',
          budget: '1,000,000',
          share: '25%',
        }),
      ),
    ).toBeVisible()
  })

  // The per-person daily ceiling is a separate sentence because it is not comparable to the
  // platform-wide day above it. The day is therefore never given a share: 987,654 tokens against a
  // 40,000-token personal ceiling is 2,469.1%, and printing that would be an invented crisis.
  it('states the per-person daily ceiling without giving the platform day a share of it', () => {
    render(<LlmUsageTable usage={USAGE} />)

    expect(screen.getByText(t('admin.flags.usageDailyBudget', { budget: '40,000' }))).toBeVisible()
    expect(screen.queryAllByText(/2,469\.1%/)).toHaveLength(0)
  })

  // The schema requires a positive ceiling, so this is a deployment configured wrongly rather than
  // one running normally — but the panel is drawn from whatever the route hands it, and an
  // operations screen that prints `NaN%` teaches its reader to distrust the figures beside it.
  it('prints no share at all when the monthly ceiling is zero', () => {
    render(<LlmUsageTable usage={{ ...USAGE, budgets: { userDaily: 40000, globalMonthly: 0 } }} />)

    expect(
      screen.getByText(
        t('admin.flags.usageMonthlyBudget', { used: '250,000', budget: '0', share: '0%' }),
      ),
    ).toBeVisible()
    expect(screen.queryAllByText(/NaN/)).toHaveLength(0)
  })

  // Both windows are named by the clock the budget counts on — a UTC day and a calendar month —
  // because a reader comparing this panel with a refused call needs to know which day is meant.
  it('names each window by the clock the budget is counted on, and labels its scroll region', () => {
    render(<LlmUsageTable usage={USAGE} />)

    expect(
      screen.getByRole('region', { name: enUS['admin.flags.usageCaption'] }),
    ).toBeInTheDocument()
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent)
    expect(headers).toEqual([
      enUS['admin.flags.usageColumnMeasure'],
      enUS['admin.flags.usageColumnToday'],
      enUS['admin.flags.usageColumnMonth'],
    ])
  })
})
