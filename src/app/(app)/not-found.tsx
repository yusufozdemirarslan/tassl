import Link from 'next/link'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'

// UI-007 inside the shell: notFound() from a page under (app) keeps the header and rail, so the
// reader still has every way out. The page h1 names the state; the panel carries the sentence and
// the link home (heading, sentence, action).
export default function AppNotFound() {
  return (
    <>
      <PageHeader title={t('notFound.title')} />
      <Panel>
        <EmptyState
          body={t('notFound.body')}
          action={
            <Link href="/home" className={buttonVariants({ variant: 'secondary' })}>
              {t('notFound.home')}
            </Link>
          }
        />
      </Panel>
    </>
  )
}
