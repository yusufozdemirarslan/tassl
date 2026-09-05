'use client'

import { useId, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { t } from '@/lib/i18n/messages/workspace'
import type { ClaimView } from '@/server/modules/reliance/schema'
import { StanceChip } from './stance-chip'

// UI-023: one claim object, as the student meets it (FR-051, FR-052, DATA-033).
//
// **The card says nothing about the claim.** It carries the author's text, character for character,
// and around it: which claim it is, the stance the student has taken on it, and whether they marked
// it used. There is no reliability mark, no source badge, no "verified" tick, no confidence, and no
// ordering by anything the product knows — the evidence status, the failure family, the warranted
// stance and the planted flag are not in the payload that reaches this file and are not shown to a
// student before their run is scored (12 §8.1, CLAIM invariants in CLAUDE.md). What a claim
// deserved is the debrief's to say, afterwards.
//
// It is an `article` with a heading because that is what it is: a discrete object a student reads,
// positions themselves on, and comes back to. UI-023 asks for exactly that, and it is what lets a
// screen-reader user step through a reply by heading and land on each claim rather than on one wall
// of prose.
//
// **It is not a card inside a card.** DESIGN.md's One-Layer Rule keeps raised, bordered surfaces
// from nesting, and this always renders inside a `Panel`. So the claim object reads as a sunken
// well — the same paper the product uses for a highlight — with no border and no shadow.
//
// The stance control is a *slot*. Phase 8 brings `StanceControl`, the five-chip radio group of
// FR-080, and passes it in here; until then the seat says plainly that Tassl cannot take a stance
// yet, which is the line the rest of this screen takes about a thing it cannot do. A disabled radio
// group with five real stances in it would be a control that cannot act, and this screen does not
// draw those.

export type ClaimCardProps = {
  claim: ClaimView
  /**
   * `StanceControl` (Phase 8). Absent, the seat carries the sentence that says why there is no
   * control in it — never a dead one.
   */
  stanceControl?: ReactNode
  /** The reply's cards sit under the panel's h2; the Turn's window claims sit a level deeper. */
  headingLevel?: 3 | 4
}

export function ClaimCard({ claim, stanceControl, headingLevel = 3 }: ClaimCardProps) {
  const headingId = useId()
  const Heading = `h${headingLevel}` as const

  return (
    <article
      aria-labelledby={headingId}
      data-claim-id={claim.id}
      className="bg-paper-sunken flex flex-col gap-3 rounded-md p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading id={headingId} className="text-mono-sm text-ink-muted font-mono">
          {t('workspace.claimHeading', { key: claim.key })}
        </Heading>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {claim.stance !== null && <StanceChip stance={claim.stance} />}
          {claim.usedMarked && (
            <Badge variant="secondary">
              {t('workspace.claimUsed')}
              <span className="sr-only"> {t('workspace.claimUsedExplain')}</span>
            </Badge>
          )}
        </div>
      </div>

      {/* The author's words, and the one thing on this screen a student may treat as evidence. */}
      <p className="text-ink text-reading max-w-[72ch]">{claim.text}</p>

      <div>
        {stanceControl ?? (
          <p className="text-ink-muted text-meta">{t('workspace.claimStancePending')}</p>
        )}
      </div>
    </article>
  )
}
