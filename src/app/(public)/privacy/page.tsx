import type { Metadata } from 'next'
import { LegalPage } from '@/components/features/legal/legal-page'
import { t } from '@/lib/i18n/t'
import { privacyDocument } from '@/lib/legal/privacy'
import { legalDeployment } from '../deployment'

export const metadata: Metadata = {
  title: t('legal.privacyTitle'),
  description: t('legal.privacy.summary'),
}

// UI-006 (SYS-007, D-017). A Server Component with no session read: the page is public, and a
// student must be able to read what is stored about them before they have an account.
//
// The document is built per request rather than at build time because `legalDeployment()` reads
// the environment this deployment is actually running with, and a preview and production build
// from the same commit do not have the same answer.
export const dynamic = 'force-dynamic'

export default function PrivacyPage() {
  return <LegalPage document={privacyDocument(legalDeployment())} />
}
