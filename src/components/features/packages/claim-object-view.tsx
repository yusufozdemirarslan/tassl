import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { StanceChip } from '@/components/features/run/stance-chip'
import { LabelChip } from '@/components/layout/label-chip'
import { Badge } from '@/components/ui/badge'
import { t } from '@/lib/i18n/t'
import type {
  CarriedValue,
  ClaimExport,
  ClaimImportanceValue,
  ClaimSourceValue,
  ConsequenceLevelValue,
  EvidenceStatusValue,
  FailureFamilyValue,
  StanceValue,
  ValueUnitValue,
  VariantKeyValue,
  VerificationCostValue,
  VerificationPathsExport,
} from '@/server/modules/scenarios/schema'

// UI-044 → `ClaimObjectView` (FR-180): everything one claim is, what it deserved, and how it could
// have been checked. It is the answer key for a single claim, so it is drawn only on a screen the
// service already restricted to authors and reviewers — a student who could read this would be
// reading the defect placement before their run was scored.
//
// The claim's vocabulary — stances, evidence statuses, failure families, importance, consequence,
// cost, units — is declared here and reused by the claims table, because both are describing the
// same object and a word that differed between them would read as a different thing.
//
// The whole view is a server component reached by an address (`?claim=<key>`), the way UI-030's
// four sub-views are: the row is a link, the claim is bookmarkable and shareable, the back gesture
// works, and the route ships no JavaScript for any of it.

export type ClaimSourceDocument = {
  key: string
  title: string
  author: string
  /** ISO date; the document is dated to the day, which is what staleness turns on. */
  datedOn: string
}

/** One variant's reading of the claim, as the export carries it (references are element keys). */
export type ClaimVariantState = {
  variantKey: VariantKeyValue
  evidenceStatus: EvidenceStatusValue
  failureFamily: FailureFamilyValue | null
  warrantedStance: StanceValue
  planted: boolean
  verificationPaths: VerificationPathsExport
}

export type ClaimObjectViewProps = {
  claim: ClaimExport
  /** The document the claim quotes, resolved from its key; null when it quotes none. */
  sourceDocument: ClaimSourceDocument | null
  states: readonly ClaimVariantState[]
  /** Document titles by key, so a Source Trace path can name the document it points at. */
  documentTitles: ReadonlyMap<string, string>
  backHref: Route
}

/**
 * The claims panel's own id on the version view (`Panel id="claims"`), carried as a fragment by
 * every address that opens or closes a claim. Without it the App Router scrolls a nine-thousand
 * pixel page back to the top and the reader has to hunt for the thing they just clicked; with it
 * the browser lands on the panel and no JavaScript is involved.
 */
export const CLAIMS_PANEL_ANCHOR = '#claims'

// ---------------------------------------------------------------------------------------------
// The claim vocabulary (06 §3.3 enumerations, in the words an author reads)
// ---------------------------------------------------------------------------------------------

export const VARIANT_LABELS: Record<VariantKeyValue, () => string> = {
  defective: () => t('claimObject.variant.defective'),
  sound: () => t('claimObject.variant.sound'),
}

export const EVIDENCE_LABELS: Record<EvidenceStatusValue, () => string> = {
  sound: () => t('claimObject.evidence.sound'),
  defective: () => t('claimObject.evidence.defective'),
}

export const FAILURE_FAMILY_LABELS: Record<FailureFamilyValue, () => string> = {
  near_neighbor: () => t('claimObject.family.nearNeighbor'),
  unstated_assumption: () => t('claimObject.family.unstatedAssumption'),
  stale_evidence: () => t('claimObject.family.staleEvidence'),
  uncomputed_number: () => t('claimObject.family.uncomputedNumber'),
  extrapolation: () => t('claimObject.family.extrapolation'),
  reversal_to_agree: () => t('claimObject.family.reversalToAgree'),
  omitted_alternative: () => t('claimObject.family.omittedAlternative'),
  misapplied_method: () => t('claimObject.family.misappliedMethod'),
  misattributed_source: () => t('claimObject.family.misattributedSource'),
  unacceptable_route: () => t('claimObject.family.unacceptableRoute'),
}

export const IMPORTANCE_LABELS: Record<ClaimImportanceValue, () => string> = {
  load_bearing: () => t('claimObject.importance.loadBearing'),
  supporting: () => t('claimObject.importance.supporting'),
}

export const CONSEQUENCE_LABELS: Record<ConsequenceLevelValue, () => string> = {
  low: () => t('claimObject.consequence.low'),
  medium: () => t('claimObject.consequence.medium'),
  high: () => t('claimObject.consequence.high'),
}

export const COST_LABELS: Record<VerificationCostValue, () => string> = {
  cheap: () => t('claimObject.cost.cheap'),
  moderate: () => t('claimObject.cost.moderate'),
  expensive: () => t('claimObject.cost.expensive'),
}

const SOURCE_KIND_LABELS: Record<ClaimSourceValue, () => string> = {
  assistant: () => t('claimObject.sourceKind.assistant'),
  document: () => t('claimObject.sourceKind.document'),
}

const UNIT_LABELS: Record<ValueUnitValue, () => string> = {
  percent: () => t('claimObject.unit.percent'),
  ratio: () => t('claimObject.unit.ratio'),
  months: () => t('claimObject.unit.months'),
  usd: () => t('claimObject.unit.usd'),
  count: () => t('claimObject.unit.count'),
  other: () => t('claimObject.unit.other'),
}

// ---------------------------------------------------------------------------------------------
// Small shared marks
// ---------------------------------------------------------------------------------------------

/**
 * Red is the product's colour for a defect, and it is never the only signal: the badge carries the
 * word as well, and a sound state takes the neutral wash rather than a second colour.
 */
export function EvidenceBadge({ status }: { status: EvidenceStatusValue }) {
  return (
    <Badge variant={status === 'defective' ? 'destructive' : 'secondary'}>
      {EVIDENCE_LABELS[status]()}
    </Badge>
  )
}

/**
 * The variant's one consequential planted defect (`DEFECTIVE_VARIANT_PLANT`) — the single most
 * consequential fact a package screen states, so it takes the product's danger treatment (red wash,
 * 2 px red edge, ink text, the flag icon) rather than the outline badge it wore, which drew the
 * loudest fact on the screen as its faintest mark.
 */
export function PlantedBadge() {
  return <LabelChip kind="planted" />
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-ink-muted text-meta">{label}</dt>
      <dd className="text-ink text-body break-words">{children}</dd>
    </div>
  )
}

// The heading ladder inside the claims panel, which is where the scale had stopped being a scale:
// the panel title is the Title style on an h2, a section is the Subtitle style on an h3 (serif
// 20/28), an h4 is serif 500 at the reading size (16/26), and an h5 is Sans 600 at the body size
// (14/22) in ink. Every level steps down in size and none of them steps down in colour: a heading
// is never `--ink-muted` and never smaller than the prose it introduces. The rung below h5 is not a
// heading at all — it is a bold-body paragraph (Sans 500 14/22), which is what names the three
// verification paths. `<h4>` inherits serif 500 ink from the base layer, so `text-reading` is the
// whole declaration.
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-line flex flex-col gap-3 border-t pt-5">
      <h3 className="text-h4">{title}</h3>
      {children}
    </section>
  )
}

/** A quoted passage: the words as the document has them, set to read rather than to scan. */
function Passage({ children }: { children: ReactNode }) {
  return (
    <blockquote className="border-line text-ink text-reading max-w-[72ch] border-l-2 pl-4">
      {children}
    </blockquote>
  )
}

function carriedValueLine(value: CarriedValue): string {
  const figure = t('claimObject.carriedValue', {
    value: value.value,
    unit: UNIT_LABELS[value.unit](),
  })
  return value.field_key === undefined
    ? figure
    : t('claimObject.carriedValueNamed', { field: value.field_key, figure })
}

/** What an interrogation action returns for this claim in this variant, path by path. */
function VerificationPaths({
  paths,
  documentTitles,
}: {
  paths: VerificationPathsExport
  documentTitles: ReadonlyMap<string, string>
}) {
  const trace = paths.source_trace
  const replication = paths.replication_check
  const decomposition = paths.decomposition_check

  const empty = trace === undefined && replication === undefined && decomposition === undefined

  return (
    <div className="flex flex-col gap-4">
      <h5 className="text-ink text-body font-semibold">{t('claimObject.pathsTitle')}</h5>

      {empty && <p className="text-ink-muted text-body max-w-[72ch]">{t('claimObject.noPaths')}</p>}

      {trace !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="text-ink text-body font-medium">{t('claimObject.pathSourceTrace')}</p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Fact label={t('claimObject.pathDocumentLabel')}>
              {documentTitles.get(trace.document_key) ?? trace.document_key}
            </Fact>
            <Fact label={t('claimObject.pathAuthorLabel')}>{trace.author}</Fact>
            <Fact label={t('claimObject.pathDatedLabel')}>
              <span className="font-mono tabular-nums">{trace.dated_on}</span>
            </Fact>
          </dl>
          <Passage>{trace.passage}</Passage>
        </div>
      )}

      {replication !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="text-ink text-body font-medium">{t('claimObject.pathReplication')}</p>
          <p className="text-ink text-reading max-w-[72ch]">{replication.result}</p>
        </div>
      )}

      {decomposition !== undefined && (
        <div className="flex flex-col gap-2">
          <p className="text-ink text-body font-medium">{t('claimObject.pathDecomposition')}</p>
          <ol className="flex flex-col gap-2">
            {decomposition.steps.map((step, index) => (
              <li key={`${String(index)}-${step.label}`} className="flex flex-col gap-0.5">
                <span className="text-ink text-body font-medium">{step.label}</span>
                <span className="text-ink-muted text-body max-w-[72ch]">{step.result}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

export function ClaimObjectView({
  claim,
  sourceDocument,
  states,
  documentTitles,
  backHref,
}: ClaimObjectViewProps) {
  return (
    <div className="flex flex-col gap-5">
      <Link
        href={`${backHref}${CLAIMS_PANEL_ANCHOR}` as Route}
        className="text-primary focus-visible:outline-focus text-meta w-fit rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {t('claimObject.back')}
      </Link>

      <Passage>{claim.text}</Passage>

      <Section title={t('claimObject.sourceTitle')}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('claimObject.sourceKindLabel')}>
            {SOURCE_KIND_LABELS[claim.sourceKind]()}
          </Fact>
          {sourceDocument !== null && (
            <>
              <Fact
                label={
                  claim.sourceKind === 'assistant'
                    ? t('claimObject.tracedDocumentLabel')
                    : t('claimObject.documentLabel')
                }
              >
                <span className="flex flex-col gap-0.5">
                  <span>{sourceDocument.title}</span>
                  <span className="text-ink-muted text-mono-sm font-mono">
                    {sourceDocument.key}
                  </span>
                </span>
              </Fact>
              <Fact label={t('claimObject.documentAuthorLabel')}>{sourceDocument.author}</Fact>
              <Fact label={t('claimObject.documentDatedLabel')}>
                <span className="font-mono tabular-nums">{sourceDocument.datedOn}</span>
              </Fact>
            </>
          )}
        </dl>
        {sourceDocument === null ? (
          <p className="text-ink-muted text-body max-w-[72ch]">{t('claimObject.noDocument')}</p>
        ) : claim.sourcePassage.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h4 className="text-reading">{t('claimObject.passageLabel')}</h4>
            <Passage>{claim.sourcePassage}</Passage>
          </div>
        ) : (
          <p className="text-ink-muted text-body max-w-[72ch]">
            {claim.sourceKind === 'assistant'
              ? t('claimObject.noPassageAssistant')
              : t('claimObject.noPassage')}
          </p>
        )}
      </Section>

      <Section title={t('claimObject.weightTitle')}>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={t('claimObject.importanceLabel')}>
            {IMPORTANCE_LABELS[claim.importance]()}
          </Fact>
          <Fact label={t('claimObject.consequenceLabel')}>
            {CONSEQUENCE_LABELS[claim.consequenceLevel]()}
          </Fact>
          <Fact label={t('claimObject.costLabel')}>{COST_LABELS[claim.verificationCost]()}</Fact>
          <Fact label={t('claimObject.conceptLabel')}>
            <span className="font-mono">{claim.conceptKey}</span>
          </Fact>
          <Fact label={t('claimObject.weaklySourcedLabel')}>
            {claim.weaklySourced ? t('claimObject.yes') : t('claimObject.no')}
          </Fact>
          <Fact label={t('claimObject.volatileLabel')}>
            {claim.volatile ? t('claimObject.yes') : t('claimObject.no')}
          </Fact>
        </dl>
        <div className="flex flex-col gap-2">
          <h4 className="text-reading">{t('claimObject.carriedValuesLabel')}</h4>
          {claim.carriedValues.length === 0 ? (
            <p className="text-ink-muted text-body max-w-[72ch]">
              {t('claimObject.noCarriedValues')}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {claim.carriedValues.map((value, index) => (
                <li
                  key={`${value.field_key ?? 'value'}-${String(index)}`}
                  className="text-ink font-mono tabular-nums"
                >
                  {carriedValueLine(value)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section title={t('claimObject.triggersTitle')}>
        {claim.triggerDescription.length > 0 && (
          <p className="text-ink text-reading max-w-[72ch]">{claim.triggerDescription}</p>
        )}
        {claim.triggerPhrases.length === 0 ? (
          <p className="text-ink-muted text-body max-w-[72ch]">{t('claimObject.noTriggers')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {claim.triggerPhrases.map((phrase) => (
              <li key={phrase}>
                <Badge variant="outline">{phrase}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('claimObject.escalationTitle')}>
        <p className="text-ink-muted text-body max-w-[72ch]">
          {claim.escalatable ? t('claimObject.escalatableYes') : t('claimObject.escalatableNo')}
        </p>
        {claim.escalationReply !== null && claim.escalationReply.length > 0 && (
          <div className="flex flex-col gap-2">
            <h4 className="text-reading">{t('claimObject.escalationReplyLabel')}</h4>
            <Passage>{claim.escalationReply}</Passage>
          </div>
        )}
      </Section>

      <Section title={t('claimObject.rationaleTitle')}>
        {claim.rationale.length > 0 ? (
          <p className="text-ink text-reading max-w-[72ch]">{claim.rationale}</p>
        ) : (
          <p className="text-ink-muted text-body max-w-[72ch]">{t('claimObject.noRationale')}</p>
        )}
      </Section>

      <Section title={t('claimObject.statesTitle')}>
        {states.length === 0 ? (
          <p className="text-ink-muted text-body max-w-[72ch]">{t('claimObject.noStates')}</p>
        ) : (
          <div className="flex flex-col gap-6">
            {states.map((state) => (
              <div key={state.variantKey} className="flex flex-col gap-3">
                <h4 className="text-reading">
                  {t('claimObject.variantHeading', { variant: VARIANT_LABELS[state.variantKey]() })}
                </h4>
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Fact label={t('claimObject.evidenceLabel')}>
                    <EvidenceBadge status={state.evidenceStatus} />
                  </Fact>
                  <Fact label={t('claimObject.familyLabel')}>
                    {state.failureFamily === null
                      ? t('claimObject.familyNone')
                      : FAILURE_FAMILY_LABELS[state.failureFamily]()}
                  </Fact>
                  <Fact label={t('claimObject.stanceLabel')}>
                    <StanceChip stance={state.warrantedStance} />
                  </Fact>
                  <Fact label={t('claimObject.plantedLabel')}>
                    {state.planted ? <PlantedBadge /> : t('claimObject.no')}
                  </Fact>
                </dl>
                <VerificationPaths
                  paths={state.verificationPaths}
                  documentTitles={documentTitles}
                />
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
