import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/lib/i18n/t'

export default function PublicLoading() {
  return (
    <>
      <p role="status" className="sr-only">
        {t('ui.loading')}
      </p>
      <div aria-busy="true" aria-hidden="true" className="space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    </>
  )
}
