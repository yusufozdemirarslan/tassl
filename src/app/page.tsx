import { t } from '@/lib/i18n/t'

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
      <h1 className="font-serif text-4xl font-semibold text-ink">{t('landing.title')}</h1>
      <p className="text-lg text-ink-muted">{t('landing.tagline')}</p>
    </main>
  )
}
