// The terms page (UI-006, SYS-007, D-017, FR-006).
//
// Shorter than the privacy page and held to the same rule: every sentence is about something the
// product does. The two that could have been boilerplate are not —
//
//   `account.sessions`   a password change ends every other session (`revokeSessionsOnPasswordReset`
//                        in `src/server/auth/auth.ts`) and a platform-role change signs the person
//                        out everywhere (`admin.setPlatformRole`, 10 §16);
//   `decisions.bands`    the seven bands are drafted and an instructor confirms or changes each one
//                        (10 §11, §12), and the course maps confirmed bands to points (FR-202) —
//                        which is why the page can say the product assigns no grade.
//
// The no-misconduct sentence is the same string the privacy page renders: FR-006 is one commitment,
// not two that could drift apart.
import { t } from '@/lib/i18n/messages/legal'
import type { LegalDeployment, LegalDocument } from './document'

/** The last time a person read this page against the code (D-017). */
export const LAST_REVIEWED = '2026-09-07'

export function termsDocument(deployment: LegalDeployment): LegalDocument {
  return {
    title: t('legal.termsTitle'),
    summary: t('legal.terms.summary'),
    lastReviewed: LAST_REVIEWED,
    sections: [
      {
        id: 'agreement',
        heading: t('legal.terms.agreement.heading'),
        blocks: [
          { kind: 'paragraph', text: t('legal.terms.agreement.body') },
          { kind: 'paragraph', text: t('legal.terms.agreement.changes') },
        ],
      },
      {
        id: 'account',
        heading: t('legal.terms.account.heading'),
        blocks: [
          { kind: 'paragraph', text: t('legal.terms.account.body') },
          { kind: 'paragraph', text: t('legal.terms.account.sessions') },
        ],
      },
      {
        id: 'use',
        heading: t('legal.terms.use.heading'),
        blocks: [
          {
            kind: 'list',
            items: [
              t('legal.terms.use.material'),
              t('legal.terms.use.boundaries'),
              t('legal.terms.use.outsideTools'),
            ],
          },
        ],
      },
      {
        id: 'decisions',
        heading: t('legal.terms.decisions.heading'),
        blocks: [
          { kind: 'paragraph', text: t('legal.terms.decisions.bands') },
          { kind: 'paragraph', text: t('legal.terms.decisions.appeal') },
          { kind: 'paragraph', text: t('legal.noMisconductFindings') },
        ],
      },
      {
        id: 'ending',
        heading: t('legal.terms.ending.heading'),
        blocks: [
          { kind: 'paragraph', text: t('legal.terms.ending.institution') },
          { kind: 'paragraph', text: t('legal.terms.ending.self') },
        ],
      },
      {
        id: 'liability',
        heading: t('legal.terms.liability.heading'),
        blocks: [{ kind: 'paragraph', text: t('legal.terms.liability.body') }],
      },
      {
        id: 'contact',
        heading: t('legal.contactHeading'),
        blocks: [
          { kind: 'paragraph', text: t('legal.contactBody', { email: deployment.contactEmail }) },
          { kind: 'paragraph', text: t('legal.lastReviewedNote') },
        ],
      },
    ],
  }
}
