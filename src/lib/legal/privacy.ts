// The privacy page (UI-006, SYS-007, D-017, D-018, FR-006).
//
// Generated from `06-data-model.md` and from the code under it, not from a template. Every row of
// the table below was checked against a column that exists:
//
//   account            `user` (name, email, email_verified) and `account.password`, hashed by
//                      Better Auth — 06 §3.1
//   signed-in devices  `session.ip_address`, `session.user_agent` — 06 §3.1
//   Google             `account.access_token / refresh_token / id_token / scope` — 06 §3.1
//   seats              `member.role`, `section_memberships.role` — 06 §3.1, §3.2
//   the run            `run_frames`, `run_delegations.request_text / response_text`,
//                      `claim_stances`, `run_briefs`, `run_turn_responses`, `run_defense_answers`,
//                      `run_events` — 06 §3.4
//   what it produced   `run_bands` and the review decisions on them, `run_exports` — 06 §3.5
//   notifications      `notifications` — 06 §3.6
//   model calls        `llm_calls` — 06 §3.6; it carries no prompt and no completion text
//                      (`src/server/llm/calls.ts`), only a sha-256 digest of the prompt
//   rate limits        `rate_limit_buckets` (the app's own) and `rate_limit` (Better Auth's);
//                      both key on the account id, or on the client address when nobody is signed
//                      in (`src/server/http/define-route.ts` `clientIp`)
//   audit              `audit_logs` — 06 §3.6, DATA-048
//
// and the retention lines against `src/server/modules/identity/retention.ts` (`PURGE_AFTER_DAYS`),
// the purge job (`src/server/jobs/handlers/purge-deleted-accounts.ts`) and the SQL it calls
// (`drizzle/0010_repoint_user_references.sql`, which nulls `audit_logs.actor_id` and
// `llm_calls.user_id` and repoints `runs.student_id` to the institution's placeholder), and
// `src/server/rate-limit/sliding-window.ts`, which deletes a bucket three windows after it closes.
//
// The one thing the page says that a reader might expect the opposite of is `rights.exportGap`:
// `exportUserData` returns `runs: []` today, so the page says so and points at the run's own record
// download instead of claiming an export that does not carry it (D-574).
import { t } from '@/lib/i18n/messages/legal'
import {
  blocks,
  rows,
  type LegalDeployment,
  type LegalDocument,
  type LegalSection,
} from './document'

/**
 * The last time a person read this page against the code (D-017; `15-cicd-deployment.md` §10 row
 * 11 makes it a release-checklist item and the reviewer records the date in the release PR).
 */
export const LAST_REVIEWED = '2026-09-07'

function collected(deployment: LegalDeployment): LegalSection {
  return {
    id: 'collected',
    heading: t('legal.privacy.collected.heading'),
    blocks: [
      {
        kind: 'table',
        caption: t('legal.privacy.collected.caption'),
        columns: [
          t('legal.privacy.collected.columnWhat'),
          t('legal.privacy.collected.columnDetail'),
          t('legal.privacy.collected.columnSource'),
        ],
        rows: rows(
          [
            t('legal.privacy.collected.account'),
            t('legal.privacy.collected.accountDetail'),
            t('legal.privacy.collected.accountSource'),
          ],
          [
            t('legal.privacy.collected.sessions'),
            t('legal.privacy.collected.sessionsDetail'),
            t('legal.privacy.collected.sessionsSource'),
          ],
          deployment.googleSignIn
            ? [
                t('legal.privacy.collected.google'),
                t('legal.privacy.collected.googleDetail'),
                t('legal.privacy.collected.googleSource'),
              ]
            : null,
          [
            t('legal.privacy.collected.seats'),
            t('legal.privacy.collected.seatsDetail'),
            t('legal.privacy.collected.seatsSource'),
          ],
          [
            t('legal.privacy.collected.run'),
            t('legal.privacy.collected.runDetail'),
            t('legal.privacy.collected.runSource'),
          ],
          [
            t('legal.privacy.collected.result'),
            t('legal.privacy.collected.resultDetail'),
            t('legal.privacy.collected.resultSource'),
          ],
          [
            t('legal.privacy.collected.notifications'),
            t('legal.privacy.collected.notificationsDetail'),
            t('legal.privacy.collected.notificationsSource'),
          ],
          [
            t('legal.privacy.collected.model'),
            t('legal.privacy.collected.modelDetail'),
            t('legal.privacy.collected.modelSource'),
          ],
          [
            t('legal.privacy.collected.limits'),
            t('legal.privacy.collected.limitsDetail'),
            t('legal.privacy.collected.limitsSource'),
          ],
          [
            t('legal.privacy.collected.audit'),
            t('legal.privacy.collected.auditDetail'),
            t('legal.privacy.collected.auditSource'),
          ],
        ),
      },
      { kind: 'paragraph', text: t('legal.privacy.collected.absent') },
    ],
  }
}

function processors(deployment: LegalDeployment): LegalSection {
  const model = deployment.llmProvider !== 'mock'
  return {
    id: 'processors',
    heading: t('legal.privacy.processors.heading'),
    blocks: blocks(
      { kind: 'paragraph', text: t('legal.deploymentNote') },
      {
        kind: 'table',
        caption: t('legal.privacy.processors.caption'),
        columns: [
          t('legal.privacy.processors.columnService'),
          t('legal.privacy.processors.columnHandles'),
          t('legal.privacy.processors.columnWhy'),
        ],
        rows: rows(
          deployment.managedHosting
            ? [
                t('legal.privacy.processors.database'),
                t('legal.privacy.processors.databaseHandles'),
                t('legal.privacy.processors.databaseWhy'),
              ]
            : [
                t('legal.privacy.processors.databaseLocal'),
                t('legal.privacy.processors.databaseLocalHandles'),
                t('legal.privacy.processors.databaseLocalWhy'),
              ],
          deployment.managedHosting
            ? [
                t('legal.privacy.processors.hosting'),
                t('legal.privacy.processors.hostingHandles'),
                t('legal.privacy.processors.hostingWhy'),
              ]
            : null,
          deployment.emailDelivery
            ? [
                t('legal.privacy.processors.email'),
                t('legal.privacy.processors.emailHandles'),
                t('legal.privacy.processors.emailWhy'),
              ]
            : null,
          deployment.googleSignIn
            ? [
                t('legal.privacy.processors.google'),
                t('legal.privacy.processors.googleHandles'),
                t('legal.privacy.processors.googleWhy'),
              ]
            : null,
          deployment.analytics
            ? [
                t('legal.privacy.processors.analytics'),
                t('legal.privacy.processors.analyticsHandles'),
                t('legal.privacy.processors.analyticsWhy'),
              ]
            : null,
          deployment.errorMonitoring
            ? [
                t('legal.privacy.processors.monitoring'),
                t('legal.privacy.processors.monitoringHandles'),
                t('legal.privacy.processors.monitoringWhy'),
              ]
            : null,
          model
            ? [
                t('legal.privacy.processors.model', {
                  provider: deployment.llmProvider,
                  model: deployment.llmModel,
                }),
                t('legal.privacy.processors.modelHandles'),
                t('legal.privacy.processors.modelWhy'),
              ]
            : null,
        ),
      },
      model ? null : { kind: 'paragraph', text: t('legal.privacy.processors.modelNone') },
    ),
  }
}

/** The privacy page, as this deployment can honestly describe itself (UI-006). */
export function privacyDocument(deployment: LegalDeployment): LegalDocument {
  return {
    title: t('legal.privacyTitle'),
    summary: t('legal.privacy.summary'),
    lastReviewed: LAST_REVIEWED,
    sections: [
      {
        id: 'scope',
        heading: t('legal.privacy.scope.heading'),
        blocks: [
          { kind: 'paragraph', text: t('legal.privacy.scope.body') },
          { kind: 'paragraph', text: t('legal.privacy.scope.controller') },
        ],
      },
      collected(deployment),
      {
        id: 'purposes',
        heading: t('legal.privacy.purposes.heading'),
        blocks: [
          {
            kind: 'list',
            items: [
              t('legal.privacy.purposes.run'),
              t('legal.privacy.purposes.bands'),
              t('legal.privacy.purposes.record'),
              t('legal.privacy.purposes.email'),
              t('legal.privacy.purposes.operate'),
            ],
          },
          { kind: 'paragraph', text: t('legal.privacy.purposes.never') },
        ],
      },
      {
        id: 'limits',
        heading: t('legal.privacy.limits.heading'),
        blocks: [
          { kind: 'paragraph', text: t('legal.noMisconductFindings') },
          { kind: 'paragraph', text: t('legal.privacy.limits.declaration') },
          { kind: 'paragraph', text: t('legal.privacy.limits.noTotals') },
          { kind: 'paragraph', text: t('legal.privacy.limits.hidden') },
        ],
      },
      processors(deployment),
      {
        id: 'retention',
        heading: t('legal.privacy.retention.heading'),
        blocks: [
          {
            kind: 'list',
            items: [
              t('legal.privacy.retention.business'),
              t('legal.privacy.retention.sessions'),
              t('legal.privacy.retention.limits'),
              t('legal.privacy.retention.deletion'),
              t('legal.privacy.retention.logs'),
            ],
          },
        ],
      },
      {
        id: 'rights',
        heading: t('legal.privacy.rights.heading'),
        blocks: [
          {
            kind: 'list',
            items: [
              t('legal.privacy.rights.correct'),
              t('legal.privacy.rights.devices'),
              t('legal.privacy.rights.export'),
              t('legal.privacy.rights.delete'),
            ],
          },
          { kind: 'paragraph', text: t('legal.privacy.rights.exportGap') },
          { kind: 'paragraph', text: t('legal.privacy.rights.institution') },
        ],
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
