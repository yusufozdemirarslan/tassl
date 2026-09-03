import { t } from '@/lib/i18n/t'

export default function LandingPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-4 px-6">
      <h1 className="text-ink font-serif text-4xl font-semibold">{t('landing.title')}</h1>
      <p className="text-ink-muted text-lg">{t('landing.tagline')}</p>
    </main>
  )
}
