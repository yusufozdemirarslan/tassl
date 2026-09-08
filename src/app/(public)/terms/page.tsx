import type { Metadata } from 'next'
import { LegalPage } from '@/components/features/legal/legal-page'
import { t } from '@/lib/i18n/t'
import { termsDocument } from '@/lib/legal/terms'
import { legalDeployment } from '../deployment'

export const metadata: Metadata = {
  title: t('legal.termsTitle'),
  description: t('legal.terms.summary'),
}

// UI-006 (SYS-007, D-017). Public, like /privacy, and built from the same deployment facts so the
// contact address on both pages is the one this installation actually sends from.
export const dynamic = 'force-dynamic'

export default function TermsPage() {
  return <LegalPage document={termsDocument(legalDeployment())} />
}
