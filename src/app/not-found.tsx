import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { t } from '@/lib/i18n/t'

// UI-007: serif "Not found", one sentence, a link home.
export default function NotFound() {
  return (
    <main
      id="main"
      tabIndex={-1}
      className="bg-paper text-ink flex min-h-dvh flex-col items-center justify-center px-4 py-12 outline-none"
    >
      <div className="border-line bg-paper-raised w-full max-w-md rounded-md border p-6">
        <h1 className="text-h2">{t('notFound.title')}</h1>
        <p className="text-ink-muted text-body mt-3">{t('notFound.body')}</p>
        <Link href="/" className={`${buttonVariants({ variant: 'primary' })} mt-6`}>
          {t('notFound.home')}
        </Link>
      </div>
    </main>
  )
}
