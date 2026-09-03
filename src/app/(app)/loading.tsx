import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/lib/i18n/t'

// The status region announces "Loading" once; the skeleton itself is marked busy and hidden from
// the accessibility tree so nothing else is read out.
export default function AppLoading() {
  return (
    <>
      <p role="status" className="sr-only">
        {t('ui.loading')}
      </p>
      <div aria-busy="true" aria-hidden="true" className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-11 w-64" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
        <div className="border-line bg-paper-raised space-y-3 rounded-md border p-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-5/6" />
        </div>
      </div>
    </>
  )
}
