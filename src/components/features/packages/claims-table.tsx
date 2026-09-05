import Link from 'next/link'
import type { Route } from 'next'
import { StanceChip } from '@/components/features/run/stance-chip'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/t'
import type {
  ClaimImportanceValue,
  ConsequenceLevelValue,
  VariantKeyValue,
  VerificationCostValue,
} from '@/server/modules/scenarios/schema'
import {
  CLAIMS_PANEL_ANCHOR,
  CONSEQUENCE_LABELS,
  COST_LABELS,
  EvidenceBadge,
  FAILURE_FAMILY_LABELS,
  IMPORTANCE_LABELS,
  PlantedBadge,
  VARIANT_LABELS,
  type ClaimVariantState,
} from './claim-object-view'

// UI-044 → the claims table: every claim the assistant can state in this scenario, what it weighs,
// and what each variant makes of it. One row per claim, one column per variant, because the whole
// point of a variant pair is that the same claim is sound in one and defective in the other, and
// reading them side by side is how an author checks that the pair still says that.
//
// A row is a link to the claim object (FR-180) at `?claim=<key>#claims` on this same route: the key
// is unique inside a version and safe in an address, so the claim object is bookmarkable and the
// back gesture works, and the fragment lands the reader on the panel they clicked in rather than at
// the top of the page. Nothing here is interactive beyond the link, so the table stays a server
// component and the route downloads no JavaScript for it.

export type ClaimSummary = {
  key: string
  text: string
  importance: ClaimImportanceValue
  consequenceLevel: ConsequenceLevelValue
  verificationCost: VerificationCostValue
  states: readonly ClaimVariantState[]
}

export type ClaimsTableProps = {
  claims: readonly ClaimSummary[]
  /** The variants this version has, in the order the columns take them. */
  variantKeys: readonly VariantKeyValue[]
  /** The route this table is drawn on; a row links to `?claim=<key>#claims` on it. */
  basePath: string
}

// The fragment lands the reader on the claims panel instead of the top of a page that is nine
// thousand pixels tall (`CLAIMS_PANEL_ANCHOR` is the panel's own id on the version view).
function claimHref(basePath: string, key: string): Route {
  const href: string = `${basePath}?claim=${encodeURIComponent(key)}${CLAIMS_PANEL_ANCHOR}`
  return href as Route
}

// The claim is what the row is about, so it stays in view while the variant columns scroll under
// it (DESIGN.md §Layout: a dense table that scrolls sideways keeps a sticky first column). The seam
// is a pseudo-element rather than `border-r`: a border on a sticky cell of a `border-collapse`
// table is painted with the table and scrolls away with it. The column is capped narrow enough to
// leave the variants reachable on a 360 px screen, and widens to its reading measure from `sm` up.
const STICKY_CLAIM_COLUMN =
  "bg-paper-raised sticky left-0 z-10 after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-line after:content-['']"

/**
 * One variant's reading of one claim, in the cell under that variant's column.
 *
 * The planted defect leads: it is the one fact here that decides whether this variant is the
 * defective one, and it read as an afterthought at the bottom of the stack. Then what the evidence
 * is, then the stance that evidence warranted — the stance is a mark, not a line of metadata, so a
 * reader can find every claim that deserved a Challenge by colour and icon and still read the word.
 */
function StateCell({ state }: { state: ClaimVariantState | undefined }) {
  if (state === undefined) {
    return (
      <>
        <span aria-hidden="true" className="text-ink-faint">
          —
        </span>
        <span className="sr-only">{t('packageVersion.claimNoState')}</span>
      </>
    )
  }

  return (
    <span className="flex flex-col items-start gap-1">
      {state.planted && <PlantedBadge />}
      <EvidenceBadge status={state.evidenceStatus} />
      <StanceChip stance={state.warrantedStance} srLabel={t('claimObject.stanceLabel')} />
      {state.failureFamily !== null && (
        <span className="text-ink-muted text-meta">
          {FAILURE_FAMILY_LABELS[state.failureFamily]()}
        </span>
      )}
    </span>
  )
}

export function ClaimsTable({ claims, variantKeys, basePath }: ClaimsTableProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* The one thing a reader has to know before the table starts moving, said in text rather
          than left to a hover shadow: it is here for a keyboard reader, a screen-reader user and
          anyone who never drags the table at all. */}
      <p className="text-ink-muted text-meta">{t('packageVersion.claimsScrollHint')}</p>
      <Table className="min-w-4xl">
        <TableCaption>{t('packageVersion.claimsCaption')}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className={STICKY_CLAIM_COLUMN}>
              {t('packageVersion.columnClaim')}
            </TableHead>
            <TableHead scope="col">{t('packageVersion.columnImportance')}</TableHead>
            <TableHead scope="col">{t('packageVersion.columnConsequence')}</TableHead>
            <TableHead scope="col">{t('packageVersion.columnCost')}</TableHead>
            {variantKeys.map((variantKey) => (
              <TableHead key={variantKey} scope="col">
                {t('packageVersion.columnVariant', { variant: VARIANT_LABELS[variantKey]() })}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        {/* Every cell in a row starts at the top: a claim that wraps to three lines used to leave
            the chips beside it floating in the middle of the row, against text they belong to. */}
        <TableBody>
          {claims.map((claim) => (
            <TableRow key={claim.key}>
              <TableCell
                className={cn(
                  STICKY_CLAIM_COLUMN,
                  'max-w-[15rem] align-top whitespace-normal sm:max-w-[52ch]',
                )}
              >
                {/* The link's own text is its accessible name (WCAG 2.5.3): the key and the claim,
                    behind a hidden verb, so it reads as "Open claim C3 …" and still matches what a
                    speech-input user can see. */}
                <Link
                  href={claimHref(basePath, claim.key)}
                  className="text-primary focus-visible:outline-focus flex flex-col gap-0.5 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <span className="sr-only">{t('packageVersion.openClaim')}</span>
                  <span className="font-mono font-medium">{claim.key}</span>
                  <span className="text-ink underline underline-offset-4">{claim.text}</span>
                </Link>
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                {IMPORTANCE_LABELS[claim.importance]()}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                {CONSEQUENCE_LABELS[claim.consequenceLevel]()}
              </TableCell>
              <TableCell className="align-top whitespace-normal">
                {COST_LABELS[claim.verificationCost]()}
              </TableCell>
              {variantKeys.map((variantKey) => (
                <TableCell key={variantKey} className="align-top whitespace-normal">
                  <StateCell state={claim.states.find((row) => row.variantKey === variantKey)} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
