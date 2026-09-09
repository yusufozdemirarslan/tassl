import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { t } from '@/lib/i18n/t'
import type { AdminFlags } from '@/server/modules/admin/schema'

// UI-050's flag table: the deployment flags and, under it, the provider the run loop would
// actually call. A read-only table on purpose — every one of these comes from the environment, so
// the honest control is a deploy and a switch here would be a lie about where the value lives. The
// one runtime switch the screen has, the assistant mode (D-691), is its own panel with its own
// form, because it is the one value that does *not* live in the environment.
//
// A server component: there is nothing to press.
export function FlagTable({ flags }: { flags: AdminFlags }) {
  const rows = [
    { name: t('admin.flags.ai'), value: flags.ai, meaning: t('admin.flags.aiMeaning') },
    {
      name: t('admin.flags.sampleData'),
      value: flags.sampleData,
      meaning: t('admin.flags.sampleDataMeaning'),
    },
    {
      name: t('admin.flags.testControls'),
      value: flags.testControls,
      meaning: t('admin.flags.testControlsMeaning'),
    },
    {
      name: t('admin.flags.demoMode'),
      value: flags.demoMode,
      meaning: t('admin.flags.demoModeMeaning'),
    },
  ]

  return (
    <Table className="min-w-2xl">
      <TableCaption>{t('admin.flags.caption')}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">{t('admin.flags.columnFlag')}</TableHead>
          <TableHead scope="col">{t('admin.flags.columnValue')}</TableHead>
          <TableHead scope="col">{t('admin.flags.columnSource')}</TableHead>
          <TableHead scope="col">{t('admin.flags.columnMeaning')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableHead scope="row" className="text-ink text-mono-sm align-top font-mono">
              {row.name}
            </TableHead>
            <TableCell className="align-top">
              <Badge variant={row.value ? 'default' : 'secondary'}>
                {row.value ? t('admin.flags.on') : t('admin.flags.off')}
              </Badge>
            </TableCell>
            <TableCell className="text-ink-muted align-top whitespace-nowrap">
              {t('admin.flags.source')}
            </TableCell>
            <TableCell className="align-top whitespace-normal">{row.meaning}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
