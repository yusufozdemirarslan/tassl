import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { t } from '@/lib/i18n/t'
import type { LlmUsage } from '@/server/modules/admin/schema'

// UI-050's flags screen, second question: what has this deployment spent (NFR-016, D-065)?
//
// The same numbers the guardrail sums, on the same clock — a UTC day and a calendar month — so this
// panel and `LLM_BUDGET_EXCEEDED` can never disagree. Calls the built-in fixture provider answered
// are not counted, because nobody was billed for them (D-651): a deployment on the mock reads zero
// here, which is the true answer rather than an empty one.
//
// Read-only, like the flag table above it, and a server component: there is nothing to press.

const integers = new Intl.NumberFormat('en-US')
const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })

export function LlmUsageTable({ usage }: { usage: LlmUsage }) {
  const rows = [
    {
      name: t('admin.flags.usageCalls'),
      today: integers.format(usage.today.calls),
      month: integers.format(usage.month.calls),
    },
    {
      name: t('admin.flags.usageTokens'),
      today: integers.format(usage.today.tokens),
      month: integers.format(usage.month.tokens),
    },
    {
      name: t('admin.flags.usageCost'),
      today: `$${usd.format(usage.today.costUsd)}`,
      month: `$${usd.format(usage.month.costUsd)}`,
    },
  ]

  return (
    <>
      <Table className="min-w-2xl">
        <TableCaption>{t('admin.flags.usageCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('admin.flags.usageColumnMeasure')}</TableHead>
            <TableHead scope="col">{t('admin.flags.usageColumnToday')}</TableHead>
            <TableHead scope="col">{t('admin.flags.usageColumnMonth')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.name}>
              <TableHead scope="row" className="text-ink align-top">
                {row.name}
              </TableHead>
              <TableCell className="text-mono-sm align-top font-mono tabular-nums">
                {row.today}
              </TableCell>
              <TableCell className="text-mono-sm align-top font-mono tabular-nums">
                {row.month}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* The ceiling the month's tokens are actually measured against, and — separately — the
          per-person daily one, which the platform-wide day figure above is *not* comparable to.
          Saying so is cheaper than a reader deriving the wrong ratio from two numbers on one row. */}
      <p className="text-ink-muted text-body max-w-measure mt-4">
        {t('admin.flags.usageMonthlyBudget', {
          used: integers.format(usage.month.tokens),
          budget: integers.format(usage.budgets.globalMonthly),
          share: percent.format(
            usage.budgets.globalMonthly === 0
              ? 0
              : usage.month.tokens / usage.budgets.globalMonthly,
          ),
        })}
      </p>
      <p className="text-ink-muted text-body max-w-measure mt-3">
        {t('admin.flags.usageDailyBudget', {
          budget: integers.format(usage.budgets.userDaily),
        })}
      </p>
    </>
  )
}
