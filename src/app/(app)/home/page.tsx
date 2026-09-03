import type { Metadata } from 'next'
import Link from 'next/link'
import { EmptyState } from '@/components/layout/empty-state'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'

export const metadata: Metadata = { title: t('home.title') }

// UI-009. The role panels arrive with their data in Phases 3 to 6; Phase 1 ships the empty state.
export default function HomePage() {
  return (
    <>
      <PageHeader title={t('home.title')} description={t('home.description')} />
      <Panel id="home-runs">
        <EmptyState
          title={t('home.emptyTitle')}
          body={t('home.emptyBody')}
          action={
            <Link href="/home" className={buttonVariants({ variant: 'secondary' })}>
              {t('home.emptyAction')}
            </Link>
          }
        />
      </Panel>
    </>
  )
}
