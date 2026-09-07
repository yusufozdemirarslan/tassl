import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Route } from 'next'
import { BadgeCheckIcon } from 'lucide-react'
import { ClaimObjectView } from '@/components/features/packages/claim-object-view'
import {
  BandDecisionControl,
  ConfirmRemaining,
} from '@/components/features/review/band-decision-control'
import { DelegationFlag } from '@/components/features/review/delegation-flag'
import { EvidenceDrawer } from '@/components/features/review/evidence-drawer'
import { ExportsList } from '@/components/features/review/exports-list'
import { ManualBandsForm } from '@/components/features/review/manual-bands-form'
import { NeutralizeDialog } from '@/components/features/review/neutralize-dialog'
import { PackageView } from '@/components/features/review/package-view'
import { ReplayTrace } from '@/components/features/review/replay-trace'
import { TestControls } from '@/components/features/review/test-controls'
import { VoidDialog } from '@/components/features/review/void-dialog'
import { ConceptMap } from '@/components/features/run/concept-map'
import { RunStateChip } from '@/components/features/run/run-state-chip'
import { StanceChip } from '@/components/features/run/stance-chip'
import { ClockTimeline, ConfidenceLine, GraphFrame, StanceMatrix } from '@/components/graphs'
import { FrameBesideDecision } from '@/components/graphs/frame-beside-decision'
import { EmptyState } from '@/components/layout/empty-state'
import { LabelChip } from '@/components/layout/label-chip'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
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
import { isAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format/date-time'
import { bandRationaleText, unassessedReasonText } from '@/lib/band-prose'
import { t } from '@/lib/i18n/t'
import { getReplay, type ReplayBundle } from '@/server/modules/review'
import { RunIdParamsSchema } from '@/server/modules/review/schema'
import type { ReplayObservationValue } from '@/server/modules/review'
import { RUN_EVENT_TYPES, type RunEventTypeValue } from '@/server/modules/trace/schema'
import type { BandView } from '@/server/modules/scoring'
import type { VariantKeyValue } from '@/server/modules/scenarios/schema'
import { getViewer } from '../../../viewer'

// UI-033, the faculty replay (FR-180 to FR-185, FR-118, FR-003, FR-008, FR-253).
//
// **This is the reviewer's document and no student reaches any of it.** It carries the warranted
// stance of every claim, the evidence status and failure family of both variants, the planted
// defect, the probe, the expected-answer notes and the reviewer-only band evidence — all of them
// things 12 §8.1 keeps out of a student payload in every state. The gate is the page's own: a
// refusal from `getReplay` renders the not-found page rather than the error boundary, so a
// classmate and the run's own student learn nothing from the address, and the E2E suite drives a
// student seat at this route and asserts the 404 rather than trusting the service's test.
//
// **The five views are five addresses** (`?tab=…`), the way UI-030's four sub-views are and for the
// same reasons: each is a link a reviewer can send and come back to, the whole screen stays a
// Server Component, and "keyboard operable" costs nothing because a link already is. Only the four
// controls that write — the band decision, the void, the correction, the test control and the
// hand-banding — are Client Components, and `recharts` reaches the two graphs that need it through
// `@/components/graphs`'s `next/dynamic` shim (16 §3.2, D-074, D-282).
//
// **The points sentence shows the arithmetic** (FR-202, FR-131). There is no composite anywhere in
// this product: what the run holds is seven bands, and what the course does with them is a sum and
// a division the reviewer can read. The total comes from `scoring.priceBands` through the service
// (D-445) and the terms are the mapping applied to the bands on this page, so the sentence and the
// exported file cannot disagree.

type ReviewPageProps = {
  params: Promise<{ runId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const TABS = ['overview', 'bands', 'trace', 'package', 'actions'] as const
type Tab = (typeof TABS)[number]

const TAB_LABELS: Record<Tab, string> = {
  overview: t('review.tabOverview'),
  bands: t('review.tabBands'),
  trace: t('review.tabTrace'),
  package: t('review.tabPackage'),
  actions: t('review.tabActions'),
}

const DIMENSION_LABELS: Record<BandView['dimension'], string> = {
  framing: t('band.dimension.framing'),
  delegation: t('band.dimension.delegation'),
  verification: t('band.dimension.verification'),
  calibration: t('band.dimension.calibration'),
  decision_quality: t('band.dimension.decision_quality'),
  adaptation: t('band.dimension.adaptation'),
  ownership: t('band.dimension.ownership'),
}

const BAND_LABELS: Record<'novice' | 'developing' | 'proficient' | 'professional', string> = {
  novice: t('band.novice'),
  developing: t('band.developing'),
  proficient: t('band.proficient'),
  professional: t('band.professional'),
}

const GRAPH_TITLES: Record<string, string> = {
  confidence_line: t('graph.confidenceLine.title'),
  clock_timeline: t('graph.clockTimeline.title'),
  stance_matrix: t('graph.stanceMatrix.title'),
  frame_beside_decision: t('graph.frameBesideDecision.title'),
}

const BASIS_SENTENCES: Record<BandView['basis'], string> = {
  trace: t('review.bandBasisTrace'),
  defense_only: t('review.bandBasisDefenseOnly'),
  categorical_only: t('review.bandBasisCategoricalOnly'),
  none: t('review.bandBasisNone'),
}

const DECISION_LABELS: Record<'confirmed' | 'overridden' | 'unassessed', string> = {
  confirmed: t('review.bandDecisionConfirmed'),
  overridden: t('review.bandDecisionOverridden'),
  unassessed: t('review.bandDecisionUnassessed'),
}

/** The guard marks a delegation can carry (10 §8), as sentences rather than analytics keys. */
const GUARD_MARKS: Record<string, string> = {
  rebuilt: t('review.guardMark.rebuilt'),
  no_commentary: t('review.guardMark.no_commentary'),
  probe: t('review.guardMark.probe'),
  discarded_late: t('review.guardMark.discarded_late'),
  out_of_scenario: t('review.guardMark.out_of_scenario'),
}

const OBSERVATION_SENTENCES: Record<ReplayObservationValue, string> = {
  nothing_answered: t('review.observation.nothingAnswered'),
  all_novice: t('review.observation.allNovice'),
  all_professional: t('review.observation.allProfessional'),
  speed_outlier: t('review.observation.speedOutlier'),
  readiness_submit_failed: t('review.observation.readinessNotSubmitted'),
  forced_failure_armed: t('review.observation.outageArmed'),
}

/** The six correction reasons, in the words the dialog that files one uses. */
const NEUTRALIZE_REASONS: Record<string, string> = {
  unintended_defect: t('review.neutralizeReason.unintendedDefect'),
  wrong_verification_result: t('review.neutralizeReason.wrongVerification'),
  misbehaving_material: t('review.neutralizeReason.misbehavingMaterial'),
  adaptation_failed: t('review.neutralizeReason.adaptation'),
  record_lost: t('review.neutralizeReason.recordLost'),
  other: t('review.neutralizeReason.other'),
}

const POLICY_SENTENCES: Record<'open' | 'declared' | 'in_environment_only', string> = {
  open: t('review.policyOpen'),
  declared: t('review.policyDeclared'),
  in_environment_only: t('review.policyInEnvironmentOnly'),
}

const VARIANT_LABELS: Record<VariantKeyValue, string> = {
  defective: t('review.variantDefective'),
  sound: t('review.variantSound'),
}

const bandName = (band: BandView['band']): string =>
  band === null ? t('band.unassessed') : BAND_LABELS[band]

/** A run the reader may not see is the not-found page, never the error boundary. */
function isMissing(error: unknown): boolean {
  return isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')
}

/** `generateMetadata` and the render both need the replay; `cache` makes that one read (D-178). */
const loadReplay = cache(async (runId: string): Promise<ReplayBundle | null> => {
  const { actor } = await getViewer()
  try {
    return await getReplay(actor, runId)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
})

function readTab(value: string | string[] | undefined): Tab {
  return TABS.find((tab) => tab === value) ?? 'overview'
}

function readEventFilter(value: string | string[] | undefined): RunEventTypeValue | null {
  return RUN_EVENT_TYPES.find((type) => type === value) ?? null
}

export async function generateMetadata({ params }: ReviewPageProps): Promise<Metadata> {
  const { runId } = await params
  if (!RunIdParamsSchema.safeParse({ runId }).success) {
    return { title: t('review.metaTitleFallback') }
  }
  const replay = await loadReplay(runId)
  // A title must not confirm that an id exists, so a run the reader may not see keeps the generic
  // one; the page itself answers 404.
  if (!replay) return { title: t('review.metaTitleFallback') }
  return { title: t('review.metaTitle', { student: replay.run.studentName }) }
}

export default async function FacultyReplayPage({ params, searchParams }: ReviewPageProps) {
  const [{ runId }, query] = await Promise.all([params, searchParams])

  // An id that is not a uuid never reaches the repository: a malformed address is a 404, not a
  // database cast error on the error boundary.
  if (!RunIdParamsSchema.safeParse({ runId }).success) notFound()

  const replay = await loadReplay(runId)
  if (!replay) notFound()

  const tab = readTab(query.tab)
  const basePath = `/review/runs/${runId}` as Route
  const tabHref = (key: Tab): Route => `${basePath}?tab=${key}` as Route

  const { run, capabilities, labels } = replay
  const decided = replay.bands.filter((band) => band.decision !== null).length
  const requestedClaim = typeof query.claim === 'string' ? query.claim : null
  const selectedClaim =
    requestedClaim === null
      ? null
      : (replay.claims.find((claim) => claim.key === requestedClaim) ?? null)

  return (
    <>
      <PageHeader
        title={run.studentName}
        description={t('review.attemptLine', {
          attempt: run.attemptNo,
          variant: VARIANT_LABELS[run.variantKey],
        })}
        eyebrow={
          <Link
            href={`/assignments/${run.assignmentId}` as Route}
            className="text-primary focus-visible:outline-focus rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t('review.backToAssignment')}
          </Link>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RunStateChip state={run.state} />
            {labels.uncalibrated && <LabelChip kind="uncalibrated" />}
            {labels.isWalkthrough && <LabelChip kind="walkthrough" />}
          </div>
        }
      />

      {labels.uncalibrated && (
        <p className="text-ink-muted text-body max-w-measure mb-6">
          {t('review.uncalibratedNote')}
        </p>
      )}

      {run.state === 'voided' && (
        <p className="border-red bg-red-soft text-ink text-body max-w-measure mb-6 rounded-md border p-3">
          {t('review.voidedBanner')}
        </p>
      )}

      {!capabilities.isInstructor && (
        <p className="text-ink-muted text-body max-w-measure mb-6">{t('review.taSeatNote')}</p>
      )}

      <nav aria-label={t('review.viewsLabel')} className="mb-6">
        {/* Five labels do not fit one row at 360 px; below sm the well is a two-up grid and from
            sm it is the row it was. */}
        <ul className="bg-paper-sunken grid grid-cols-2 gap-1 rounded-md p-1 sm:flex sm:w-fit sm:max-w-full sm:flex-wrap">
          {TABS.map((key) => {
            const active = key === tab
            return (
              // Five items in a two-up grid leave a dangling fifth at 360 px; the last one spans
              // both columns so the well reads as a block rather than a mistake.
              <li key={key} className="last:max-sm:col-span-2">
                <Link
                  href={tabHref(key)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'text-meta focus-visible:outline-focus flex h-10 items-center justify-center rounded-md px-3 font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:-outline-offset-2 sm:justify-start',
                    active
                      ? 'border-line bg-paper-raised text-ink border'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {TAB_LABELS[key]}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="flex flex-col gap-6">
        {tab === 'overview' && <Overview replay={replay} basePath={basePath} />}
        {tab === 'bands' && (
          <Bands replay={replay} runId={runId} decided={decided} basePath={basePath} />
        )}
        {tab === 'trace' && (
          <Panel
            id="replay-trace"
            title={t('review.traceTitle')}
            description={t('review.traceDescription')}
            headingLevel={2}
          >
            {replay.events.length === 0 ? (
              <EmptyState
                title={t('review.traceEmptyTitle')}
                body={t('review.traceEmptyBody')}
                headingLevel={3}
              />
            ) : (
              <ReplayTrace
                events={replay.events}
                action={basePath}
                filter={readEventFilter(query.event)}
                total={replay.events.length}
              />
            )}
          </Panel>
        )}
        {tab === 'package' && (
          <PackageTab
            replay={replay}
            basePath={basePath}
            selectedClaimKey={selectedClaim?.key ?? null}
          />
        )}
        {tab === 'actions' && <Actions replay={replay} runId={runId} basePath={basePath} />}
      </div>
    </>
  )
}

/**
 * The address of one claim object.
 *
 * The fragment matters: the Package view draws the version's facts, its confirmation record and its
 * five authoring measures above the claims, so a link with no anchor lands a reader above a full
 * panel and asks them to scroll for the thing they just pressed. The key is encoded because an
 * authored key is a package's to choose.
 */
const claimHref = (basePath: Route, claimKey: string): Route =>
  `${basePath}?tab=package&claim=${encodeURIComponent(claimKey)}#replay-claims` as Route

/**
 * A claim key, as a link to the claim object it names.
 *
 * The keys are printed in three places — the delegation log, the corrections list and the claims
 * table — and in all three the next question is "what *is* C3?". A key a reader has to carry to
 * another tab and retype into a filter is a key that sends them away from what they were doing.
 */
function ClaimLink({ basePath, claimKey }: { basePath: Route; claimKey: string }) {
  return (
    <Link
      href={claimHref(basePath, claimKey)}
      className="text-primary focus-visible:outline-focus rounded-sm font-mono underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {claimKey}
    </Link>
  )
}

// ---------------------------------------------------------------------------------------------
// Overview (UI-033: the observations, four graphs, defense transcript, concept map, declarations,
// the delegation log)
// ---------------------------------------------------------------------------------------------

function Overview({ replay, basePath }: { replay: ReplayBundle; basePath: Route }) {
  const graphs = replay.graphs
  const { capabilities } = replay
  const runId = replay.run.id
  return (
    <>
      {/* First, not seventh. "Is there anything unusual about this run?" is the question a reviewer
          arrives with, and UI-033's tree order is the artifact's order rather than the task's. */}
      <Panel
        id="replay-observations"
        title={t('review.observationsTitle')}
        description={t('review.observationsDescription')}
        headingLevel={2}
      >
        {replay.observations.length === 0 ? (
          <p className="text-ink-muted text-body max-w-measure">{t('review.observationsNone')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {replay.observations.map((observation) => (
              <li key={observation} className="text-ink text-body max-w-measure">
                {OBSERVATION_SENTENCES[observation]}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        id="replay-graphs"
        title={t('review.graphsTitle')}
        description={t('review.graphsDescription')}
        headingLevel={2}
      >
        {graphs === null ? (
          <EmptyState
            title={t('review.graphsEmptyTitle')}
            body={t('review.graphsEmptyBody')}
            headingLevel={3}
          />
        ) : (
          <div className="flex flex-col gap-8 2xl:grid 2xl:grid-cols-2">
            <ConfidenceLine payload={graphs.confidence_line} />
            <ClockTimeline payload={graphs.clock_timeline} />
            <StanceMatrix payload={graphs.stance_matrix} />
            <div className="2xl:col-span-2">
              <GraphFrame
                graphKey="frame_beside_decision"
                title={t('graph.frameBesideDecision.title')}
                description={graphs.frame_beside_decision.description}
                dataTable={graphs.frame_beside_decision.data_table}
                available={graphs.frame_beside_decision.available}
                missingEventTypes={graphs.frame_beside_decision.missing_event_types}
              >
                <FrameBesideDecision
                  frame={
                    graphs.frame_beside_decision.frame === null
                      ? null
                      : {
                          decision: graphs.frame_beside_decision.frame.decision,
                          assumptions: graphs.frame_beside_decision.frame.assumptions,
                          position: graphs.frame_beside_decision.frame.position,
                          confidence: graphs.frame_beside_decision.frame.confidence,
                          lockedAt: graphs.frame_beside_decision.frame.locked_at,
                        }
                  }
                  brief={
                    graphs.frame_beside_decision.brief === null
                      ? null
                      : {
                          recommendation: graphs.frame_beside_decision.brief.recommendation,
                          briefRationale: graphs.frame_beside_decision.brief.rationale,
                          assumptions: graphs.frame_beside_decision.brief.assumptions,
                          changeMyMind: graphs.frame_beside_decision.brief.change_my_mind,
                          confidence: graphs.frame_beside_decision.brief.confidence,
                          namedValues: graphs.frame_beside_decision.brief.named_values,
                          lockedAt: graphs.frame_beside_decision.brief.locked_at,
                        }
                  }
                  namedFields={[]}
                  addendum={graphs.frame_beside_decision.addendum}
                  turn={graphs.frame_beside_decision.turn}
                  disruptedAssumptionIndexes={
                    graphs.frame_beside_decision.disrupted_assumption_indexes
                  }
                  unmatchedDisruptedKeys={graphs.frame_beside_decision.unmatched_disrupted_keys}
                  headingLevel={4}
                />
              </GraphFrame>
            </div>
          </div>
        )}
      </Panel>

      <Panel
        id="replay-defense"
        title={t('review.defenseTitle')}
        description={t('review.defenseDescription')}
        headingLevel={2}
      >
        {replay.defense.length === 0 ? (
          <EmptyState
            title={t('review.defenseEmptyTitle')}
            body={t('review.defenseEmptyBody')}
            headingLevel={3}
          />
        ) : (
          <div className="flex flex-col gap-6">
            <p className="text-ink-muted text-body max-w-measure">{t('review.defenseUnaided')}</p>
            {replay.defense.map((entry) => (
              <section
                key={entry.runQuestionId}
                className="border-line flex flex-col gap-2 border-t pt-5"
              >
                <h3 className="text-h4">
                  {entry.followUpOf === null
                    ? t('review.defenseQuestionLabel', { seq: entry.seq })
                    : t('review.defenseFollowUpLabel', { seq: entry.seq })}
                </h3>
                <p className="text-ink text-reading max-w-measure break-words">{entry.text}</p>
                <h4 className="text-reading mt-2">{t('review.defenseAnswerLabel')}</h4>
                {entry.answer === null || entry.answer.trim().length === 0 ? (
                  <p className="text-ink-muted text-body max-w-measure">
                    {t('review.defenseNoAnswer')}
                  </p>
                ) : (
                  <blockquote className="border-line text-ink text-reading max-w-measure border-l-2 pl-4 break-words whitespace-pre-line">
                    {entry.answer}
                  </blockquote>
                )}
                {entry.durationMs !== null && (
                  <p className="text-ink-muted text-meta font-mono tabular-nums">
                    {t('review.defenseTook', {
                      duration: `${String(Math.round(entry.durationMs / 1000))}s`,
                    })}
                  </p>
                )}
                {/* Reviewer only in every state (12 §8.1): the notes the author wrote about what a
                    good answer covers never travel in a student payload. */}
                <div className="bg-paper-sunken mt-2 flex flex-col gap-1 rounded-md p-3">
                  <h4 className="text-reading">{t('review.defenseNotesLabel')}</h4>
                  <p className="text-ink text-body max-w-measure break-words">
                    {entry.expectedAnswerNotes.trim().length > 0
                      ? entry.expectedAnswerNotes
                      : t('review.defenseNoNotes')}
                  </p>
                </div>
              </section>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        id="replay-concepts"
        title={t('review.conceptsTitle')}
        description={t('review.conceptsDescription')}
        headingLevel={2}
      >
        {replay.readiness.length === 0 ? (
          <EmptyState
            title={t('review.conceptsEmptyTitle')}
            body={t('review.conceptsEmptyBody')}
            headingLevel={3}
          />
        ) : (
          <ConceptMap concepts={replay.readiness} />
        )}
      </Panel>

      <Panel
        id="replay-declarations"
        title={t('review.declarationsTitle')}
        description={t('review.declarationsDescription')}
        headingLevel={2}
      >
        <div className="flex flex-col gap-3">
          {replay.declarations.length === 0 ? (
            <p className="text-ink-muted text-body max-w-measure">{t('review.declarationsNone')}</p>
          ) : (
            <ul className="flex flex-col gap-4">
              {replay.declarations.map((declaration, index) => (
                <li key={`${declaration.at}-${String(index)}`} className="flex flex-col gap-1">
                  <p className="text-ink text-reading max-w-measure">{declaration.purpose}</p>
                  <p className="text-ink-muted text-meta">
                    {t('review.declarationAt', { at: formatDateTime(declaration.at) })}
                  </p>
                  <p className="text-ink-muted text-body max-w-measure">
                    {POLICY_SENTENCES[declaration.coursePolicy]}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p className="text-ink-muted text-body max-w-measure">
            {t('review.declarationNoPenalty')}
          </p>
        </div>
      </Panel>

      <Panel
        id="replay-log"
        title={t('review.logTitle')}
        description={t('review.logDescription')}
        headingLevel={2}
      >
        {replay.delegations.length === 0 ? (
          <EmptyState
            title={t('review.logEmptyTitle')}
            body={t('review.logEmptyBody')}
            headingLevel={3}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {replay.delegations.map((delegation) => (
              <section
                key={delegation.id}
                className="border-line flex flex-col gap-2 border-t pt-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-h4">{t('review.logEntry', { seq: delegation.seq })}</h3>
                  {delegation.inTurnWindow && (
                    <Badge variant="secondary">{t('review.logInWindow')}</Badge>
                  )}
                </div>
                <h4 className="text-reading">{t('review.logRequest')}</h4>
                <blockquote className="border-line text-ink text-reading max-w-measure border-l-2 pl-4 break-words whitespace-pre-line">
                  {delegation.requestText}
                </blockquote>
                <h4 className="text-reading mt-2">{t('review.logResponse')}</h4>
                {delegation.responseText.trim().length === 0 ? (
                  <p className="text-ink-muted text-body max-w-measure">
                    {t('review.logNoResponse')}
                  </p>
                ) : (
                  <p className="text-ink text-reading max-w-measure break-words whitespace-pre-line">
                    {delegation.responseText}
                  </p>
                )}
                <p className="text-ink-muted text-body max-w-measure">
                  {delegation.why === null || delegation.why.trim().length === 0
                    ? t('review.logNoWhy')
                    : t('review.logWhy', { why: delegation.why })}
                </p>
                {/* A label and a list, not a sentence assembled in JSX: a template whose
                    placeholder is filled with an empty string and then followed by React children
                    is a sentence no translator can move or re-punctuate. */}
                {delegation.claims.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-ink-muted text-body">{t('review.logClaimsLabel')}</span>
                    <ul className="flex flex-wrap items-center gap-2">
                      {delegation.claims.map((claim) => (
                        <li key={claim.key}>
                          <ClaimLink basePath={basePath} claimKey={claim.key} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(delegation.flags ?? []).length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {(delegation.flags ?? []).map((flag) => (
                      <li key={flag} className="text-ink-muted text-body max-w-measure">
                        {GUARD_MARKS[flag] ?? t('review.guardMarkUnknown', { flag })}
                      </li>
                    ))}
                  </ul>
                )}
                {/* FR-055, where the exchange is read. It is one act and a note about the material:
                    a marked exchange is left out of the Delegation read (10 §11.3) and the student
                    is never told, in any state. `flagReachesDrafting` says whether a mark set now
                    would reach the drafting, which is where the exclusion is applied (D-481, D-482). */}
                {capabilities.canFlagDelegation && (
                  <DelegationFlag
                    runId={runId}
                    delegationId={delegation.id}
                    alreadyFlagged={(delegation.flags ?? []).includes('out_of_scenario')}
                    reachesDrafting={capabilities.flagReachesDrafting}
                  />
                )}
              </section>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        id="replay-unverified"
        title={t('review.unverifiedTitle')}
        description={t('review.unverifiedDescription')}
        headingLevel={2}
      >
        {replay.unverifiedNumbers.length === 0 ? (
          <p className="text-ink-muted text-body max-w-measure">{t('review.unverifiedNone')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {replay.unverifiedNumbers.map((number, index) => (
              <li
                key={`${number.delegationId}-${String(index)}`}
                className="text-ink text-body max-w-measure"
              >
                {t('review.unverifiedRow', { value: number.value, context: number.context })}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Bands: the seven decisions, the evidence behind each, and the course's arithmetic
// ---------------------------------------------------------------------------------------------

/** The mapping's value for one band, or null for a dimension that is not assessed. */
function termOf(band: BandView['band'], mapping: ReplayBundle['points']['mapping']): number | null {
  return band === null ? null : mapping[band]
}

function Bands({
  replay,
  runId,
  decided,
  basePath,
}: {
  replay: ReplayBundle
  runId: string
  decided: number
  basePath: Route
}) {
  const { points, bands, capabilities, deciders } = replay
  const allDecided = decided === bands.length && bands.length > 0
  const exported = replay.exports.length > 0

  // What the shortcut would decide, so its dialog can name each dimension and the draft it takes.
  const undecided = bands
    .filter((band) => band.decision === null)
    .map((band) => ({
      dimension: band.dimension,
      label: DIMENSION_LABELS[band.dimension],
      band: bandName(band.band),
    }))

  // Which figure the arithmetic is about, and which bands its terms come from. The three cases are
  // the three `priceBands` answers: the drafts until every dimension is decided, the decided bands
  // after that, and the correction's floor when one has been entered (D-422, D-445).
  // `points.basis` names which set of bands the service priced the figure from, and the terms are
  // read from the same set: FR-005's floor can keep the *pre*-correction total, and terms taken
  // from the effective bands beside it would not sum to it (D-462).
  const bandFor = (band: BandView): BandView['band'] => {
    switch (points.basis) {
      case 'draft':
        return band.band
      case 'before_correction':
        return band.bandBeforeCorrection ?? band.effectiveBand
      default:
        return band.effectiveBand
    }
  }
  const total =
    points.basis === 'draft'
      ? points.draft
      : points.basis === 'confirmed'
        ? points.confirmed
        : points.effective
  const label =
    points.basis === 'draft'
      ? t('review.pointsFromDraft')
      : points.basis === 'confirmed'
        ? t('review.pointsFromConfirmed')
        : t('review.pointsAfterCorrection')
  const terms = bands
    .map((band) => termOf(bandFor(band), points.mapping))
    .filter((value): value is number => value !== null)

  return (
    <>
      <Panel
        id="replay-bands"
        title={t('review.bandsTitle')}
        description={t('review.bandsDescription')}
        headingLevel={2}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {bands.length > 0 && (
              <span className="text-ink-muted text-meta font-mono tabular-nums">
                {t('review.bandsProgress', { decided, total: bands.length })}
              </span>
            )}
            {capabilities.canDecide && (
              <ConfirmRemaining
                runId={runId}
                pending={undecided}
                willExportVersion={(replay.exports[0]?.version ?? 0) + 1}
              />
            )}
          </div>
        }
      >
        {!capabilities.canDecide && bands.length > 0 && (
          <p className="border-line bg-paper-sunken text-ink text-body max-w-measure mb-6 rounded-md border p-3">
            {t('review.bandsReadOnly')}
          </p>
        )}
        {bands.length === 0 ? (
          // A held run has no drafts *and* a form to set the seven by hand, one tab away. Saying
          // only the first is a dead end on the tab a reviewer came to the screen for.
          <EmptyState
            title={t('review.bandsEmptyTitle')}
            body={
              capabilities.canBandManually
                ? t('review.bandsEmptyHeldBody')
                : t('review.bandsEmptyBody')
            }
            headingLevel={3}
            {...(capabilities.canBandManually
              ? {
                  action: (
                    <Link
                      href={`${basePath}?tab=actions` as Route}
                      className={buttonVariants({ variant: 'secondary' })}
                    >
                      {t('review.bandsEmptyHeldAction')}
                    </Link>
                  ),
                }
              : {})}
          />
        ) : (
          <div className="flex flex-col gap-8">
            {bands.map((band) => {
              // 08 §4's TA row, per dimension: a teaching assistant may decide the six an
              // instructor has not touched, and the control says so rather than refusing on submit.
              // 08 §4's TA row, exactly: a teaching assistant may re-decide a dimension another
              // TA decided and may not touch one the *instructor* decided. Locking on "somebody
              // decided" told a TA that an instructor had made the decision they had just made
              // themselves, and refused a change the service would have allowed.
              const decider = band.decidedBy === null ? undefined : deciders[band.decidedBy]
              const lockedForThisSeat = !capabilities.isInstructor && decider?.isInstructor === true
              const raised =
                band.bandBeforeCorrection !== null &&
                band.bandAfterCorrection !== null &&
                band.bandAfterCorrection !== band.bandBeforeCorrection

              return (
                <section
                  key={band.dimension}
                  id={`band-${band.dimension}`}
                  aria-labelledby={`band-${band.dimension}-title`}
                  className="border-line flex flex-col gap-3 border-t pt-6 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 id={`band-${band.dimension}-title`} className="text-h4">
                      {DIMENSION_LABELS[band.dimension]}
                    </h3>
                    <LabelChip kind={band.decision === null ? 'draft' : 'confirmed'} />
                    {band.provisional && <LabelChip kind="provisional" />}
                  </div>

                  <p className="text-ink text-body">
                    {band.decision === null
                      ? t('review.bandDraftIs', { band: bandName(band.band) })
                      : t('review.bandOnRecord', { band: bandName(band.effectiveBand) })}
                    {/* The band itself already reads "Unassessed" in that case; the decision
                        word beside it would print it twice. */}
                    {band.decision !== null && band.decision !== 'unassessed' && (
                      <span className="text-ink-muted">
                        {' · '}
                        {DECISION_LABELS[band.decision]}
                      </span>
                    )}
                  </p>

                  {band.decision !== null && band.decidedAt !== null && (
                    <p className="text-ink-muted text-meta">
                      {decider === undefined
                        ? t('review.bandDecidedByUnknown', {
                            when: formatDateTime(band.decidedAt),
                          })
                        : t('review.bandDecidedBy', {
                            who: decider.name,
                            when: formatDateTime(band.decidedAt),
                          })}
                    </p>
                  )}

                  {/* The same two sentences the student's debrief and Judgment Record show, from
                      the same map (D-515): a token printed as prose is the one thing a status line
                      must never be, and three screens reading three copies of that rule is how two
                      of them came to be printing `manual` at the person the band is about. */}
                  <p className="text-ink text-reading max-w-measure break-words">
                    {bandRationaleText(band.rationale)}
                  </p>
                  {band.status === 'unassessed' && band.reason.length > 0 && (
                    <p className="text-ink-muted text-body max-w-measure break-words">
                      {unassessedReasonText(band.reason)}
                    </p>
                  )}
                  <p className="text-ink-muted text-body max-w-measure">
                    {BASIS_SENTENCES[band.basis]}
                    {band.graphKeys.length > 0 && (
                      <>
                        {' '}
                        {t('review.bandGraphsLine', {
                          graphs: band.graphKeys.map((key) => GRAPH_TITLES[key] ?? key).join(', '),
                        })}
                      </>
                    )}
                  </p>

                  {raised && (
                    // The correction's own notice takes the product's confirmation treatment — a
                    // hairline, the green wash, ink text and the icon — rather than a coloured edge
                    // on one side, which DESIGN.md reserves for the 20 px label chip.
                    <p className="border-green bg-green-soft text-ink text-body max-w-measure flex items-start gap-2 rounded-md border p-3">
                      <BadgeCheckIcon
                        aria-hidden="true"
                        className="text-green mt-0.5 size-4 shrink-0"
                      />
                      <span>
                        {t('review.bandRaisedByCorrection', {
                          before: bandName(band.bandBeforeCorrection),
                          after: bandName(band.bandAfterCorrection),
                        })}
                      </span>
                    </p>
                  )}

                  {band.note !== null && band.note.length > 0 && (
                    <p className="text-ink text-body max-w-measure break-words">
                      {t('review.bandNoteLine', { note: band.note })}
                    </p>
                  )}

                  <EvidenceDrawer
                    band={band}
                    events={replay.events}
                    graphTitles={GRAPH_TITLES}
                    tracePath={`${basePath}?tab=trace` as Route}
                  />

                  <BandDecisionControl
                    runId={runId}
                    dimension={band.dimension}
                    dimensionLabel={DIMENSION_LABELS[band.dimension]}
                    draftBand={band.band}
                    decidedBand={band.decidedBand}
                    decision={band.decision}
                    note={band.note}
                    canDecide={capabilities.canDecide && !lockedForThisSeat}
                    willReexport={exported}
                  />
                </section>
              )
            })}
          </div>
        )}
      </Panel>

      {bands.length > 0 && (
        <Panel
          id="replay-points"
          title={t('review.pointsTitle')}
          description={t('review.pointsDescription')}
          headingLevel={2}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-h4">{t('review.pointsMappingLabel')}</h3>
              <ul className="text-ink text-body flex flex-wrap gap-x-6 gap-y-1 font-mono tabular-nums">
                {(['novice', 'developing', 'proficient', 'professional'] as const).map((key) => (
                  <li key={key}>
                    {t('review.pointsMappingLine', {
                      band: BAND_LABELS[key],
                      value: points.mapping[key],
                    })}
                  </li>
                ))}
              </ul>
            </div>

            {total === null || terms.length === 0 ? (
              <p className="text-ink text-body max-w-measure">{t('review.pointsNone')}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <h3 className="text-h4">{label}</h3>
                {/* The arithmetic beside the dimension each term came from. The sentence alone —
                  seven bare integers over seven bands the reader has scrolled past — asked them to
                  recall in order the very thing the panel promises they can check. */}
                <Table className="min-w-lg">
                  <TableCaption>{t('review.pointsTableCaption')}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{t('review.pointsColumnDimension')}</TableHead>
                      <TableHead scope="col">{t('review.pointsColumnBand')}</TableHead>
                      <TableHead scope="col">{t('review.pointsColumnTerm')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bands.map((band) => {
                      const shown = bandFor(band)
                      const term = termOf(shown, points.mapping)
                      return (
                        <TableRow key={band.dimension}>
                          <TableCell className="whitespace-normal">
                            {DIMENSION_LABELS[band.dimension]}
                          </TableCell>
                          <TableCell className="whitespace-normal">{bandName(shown)}</TableCell>
                          <TableCell className="font-mono tabular-nums">
                            {term ?? (
                              <span className="text-ink-muted">{t('review.pointsNotCounted')}</span>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                    <TableRow>
                      <TableCell className="font-medium whitespace-normal" colSpan={2}>
                        {t('review.pointsTotalRow', { assessed: terms.length })}
                      </TableCell>
                      <TableCell className="font-mono font-medium tabular-nums">
                        {total.toFixed(3)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <p className="text-ink text-reading font-mono tabular-nums">
                  {t('review.pointsSentence', {
                    terms: terms.join(' + '),
                    assessed: terms.length,
                    total: total.toFixed(3),
                  })}
                </p>
              </div>
            )}

            {!allDecided && (
              <p className="text-ink-muted text-body max-w-measure">{t('review.pointsPending')}</p>
            )}
            <p className="text-ink-muted text-body max-w-measure">
              {t('review.pointsUnassessedNote')}
            </p>
            <p className="text-ink-muted text-body max-w-measure">
              {t('review.pointsGradebookNote')}
            </p>
          </div>
        </Panel>
      )}

      <Panel
        id="replay-exports"
        title={t('review.exportsTitle')}
        description={t('review.exportsDescription')}
        headingLevel={2}
      >
        <ExportsList runId={runId} exports={replay.exports} />
      </Panel>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Package (UI-033, FR-253): the version, its confirmation record, and every claim object
// ---------------------------------------------------------------------------------------------

function PackageTab({
  replay,
  basePath,
  selectedClaimKey,
}: {
  replay: ReplayBundle
  basePath: Route
  selectedClaimKey: string | null
}) {
  const selected =
    selectedClaimKey === null
      ? null
      : (replay.claims.find((claim) => claim.key === selectedClaimKey) ?? null)

  // The document a Source Trace path names is a row id on this screen (the replay reads the live
  // package, not an export), so the label map is keyed by id; `ClaimObjectView` looks the reference
  // up and falls back to printing it.
  const documentTitles = new Map<string, string>()
  for (const claim of replay.claims) {
    if (claim.source !== null) documentTitles.set(claim.source.documentId, claim.source.title)
  }
  const corrected = new Set(replay.neutralizations.map((row) => row.claimId))

  return (
    <>
      <Panel
        id="replay-package"
        title={t('review.packageTitle')}
        description={t('review.packageDescription')}
        headingLevel={2}
      >
        <PackageView
          version={replay.package}
          variantKey={replay.run.variantKey}
          versionHref={
            `/packages/${replay.package.packageId}/versions/${replay.package.id}` as Route
          }
        />
      </Panel>

      <Panel
        id="replay-claims"
        headingLevel={2}
        title={
          selected === null
            ? t('review.claimsTitle')
            : t('review.claimTitle', { key: selected.key })
        }
        {...(selected === null ? { description: t('review.claimsDescription') } : {})}
      >
        {selected !== null ? (
          <ClaimObjectView
            // The replay reads the live package, where the quoted passage hangs off the source row;
            // an export carries it on the claim. The view draws one passage either way.
            claim={{ ...selected, sourcePassage: selected.source?.passage ?? '' }}
            sourceDocument={
              selected.source === null
                ? null
                : {
                    key: selected.source.key,
                    title: selected.source.title,
                    author: selected.source.author,
                    datedOn: selected.source.datedOn,
                  }
            }
            states={selected.states.map((state) => ({
              variantKey: state.variantKey,
              evidenceStatus: state.evidenceStatus,
              failureFamily: state.failureFamily,
              warrantedStance: state.warrantedStance,
              planted: state.planted,
              verificationPaths: {
                ...(state.verificationPaths.source_trace === undefined
                  ? {}
                  : {
                      source_trace: {
                        document_key: state.verificationPaths.source_trace.document_id,
                        passage: state.verificationPaths.source_trace.passage,
                        dated_on: state.verificationPaths.source_trace.dated_on,
                        author: state.verificationPaths.source_trace.author,
                      },
                    }),
                ...(state.verificationPaths.replication_check === undefined
                  ? {}
                  : { replication_check: state.verificationPaths.replication_check }),
                ...(state.verificationPaths.decomposition_check === undefined
                  ? {}
                  : { decomposition_check: state.verificationPaths.decomposition_check }),
              },
            }))}
            documentTitles={documentTitles}
            backHref={`${basePath}?tab=package` as Route}
            currentVariantKey={replay.run.variantKey}
            confirmation={selected.confirmation}
            claimsAnchor="#replay-claims"
          />
        ) : replay.claims.length === 0 ? (
          <EmptyState
            title={t('review.claimsEmptyTitle')}
            body={t('review.claimsEmptyBody')}
            headingLevel={3}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* A stale or mistyped `?claim=` fell through to the table with no notice, so a link
                that no longer resolves looked exactly like one that does. */}
            {selectedClaimKey !== null && (
              <p className="border-line bg-paper-sunken text-ink text-body max-w-measure rounded-md border p-3">
                {t('review.claimNotFound', { key: selectedClaimKey })}
              </p>
            )}
            <Table className="min-w-3xl">
              <TableCaption>{t('review.claimsCaption')}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t('review.claimsColumnKey')}</TableHead>
                  <TableHead scope="col">{t('review.claimsColumnText')}</TableHead>
                  <TableHead scope="col">{t('review.claimsColumnEvidence')}</TableHead>
                  <TableHead scope="col">{t('review.claimsColumnStance')}</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">{t('review.claimsColumnOpen')}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {replay.claims.map((claim) => {
                  const here = claim.states.find(
                    (state) => state.variantKey === replay.run.variantKey,
                  )
                  return (
                    <TableRow key={claim.id}>
                      <TableCell className="font-mono">{claim.key}</TableCell>
                      <TableCell className="max-w-[48ch] break-words whitespace-normal">
                        <span className="flex flex-col gap-1">
                          <span>{claim.text}</span>
                          {corrected.has(claim.id) && (
                            <span className="text-ink-muted text-meta">
                              {t('review.claimNeutralizedHere')}
                            </span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {here === undefined
                          ? ''
                          : here.evidenceStatus === 'defective'
                            ? t('claimObject.evidence.defective')
                            : t('claimObject.evidence.sound')}
                      </TableCell>
                      <TableCell>
                        {here === undefined ? '' : <StanceChip stance={here.warrantedStance} />}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={claimHref(basePath, claim.key)}
                          className="text-primary text-meta focus-visible:outline-focus inline-flex min-h-10 items-center rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          {t('review.claimOpen', { key: claim.key })}
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>
    </>
  )
}

// ---------------------------------------------------------------------------------------------
// Actions (UI-033: void, corrections, test controls, hand-banding)
// ---------------------------------------------------------------------------------------------

function Actions({
  replay,
  runId,
  basePath,
}: {
  replay: ReplayBundle
  runId: string
  basePath: Route
}) {
  const { capabilities } = replay
  const neutralized = new Set(replay.neutralizations.map((row) => row.claimId))
  const claimKeys = new Map(replay.claims.map((claim) => [claim.id, claim.key]))

  // The family's two variants, read off the claim states: a re-offer runs the other one by default
  // (FR-183) and the select is only an override.
  const variants = new Map<string, { id: string; key: VariantKeyValue }>()
  for (const claim of replay.claims) {
    for (const state of claim.states) {
      variants.set(state.variantId, { id: state.variantId, key: state.variantKey })
    }
  }

  return (
    <>
      {capabilities.canBandManually && (
        <Panel id="replay-manual-bands" title={t('review.manualTitle')} headingLevel={2}>
          <ManualBandsForm runId={runId} />
        </Panel>
      )}

      {!capabilities.isInstructor && (
        <Panel id="replay-actions-seat" title={t('review.actionsSeatTitle')} headingLevel={2}>
          <p className="text-ink text-body max-w-measure">{t('review.actionsInstructorOnly')}</p>
        </Panel>
      )}

      {capabilities.canNeutralize && (
        <Panel
          id="replay-corrections"
          title={t('review.neutralizeTitle')}
          description={t('review.neutralizeDescription')}
          headingLevel={2}
        >
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h3 className="text-h4">{t('review.neutralizationsTitle')}</h3>
              {replay.neutralizations.length === 0 ? (
                <p className="text-ink-muted text-body max-w-measure">
                  {t('review.neutralizationsNone')}
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {replay.neutralizations.map((row) => (
                    <li key={row.id} className="flex flex-col gap-0.5">
                      <p className="text-ink text-body">
                        {/* A claim the version no longer carries has no object to open; its id is
                            printed as the id it is rather than dressed as a key. */}
                        {claimKeys.has(row.claimId) ? (
                          <ClaimLink
                            basePath={basePath}
                            claimKey={claimKeys.get(row.claimId) ?? ''}
                          />
                        ) : (
                          <span className="text-ink-muted font-mono break-all">{row.claimId}</span>
                        )}
                        {' · '}
                        {NEUTRALIZE_REASONS[row.reason]}
                      </p>
                      <p className="text-ink-muted text-meta">
                        {t('review.neutralizationAt', { at: formatDateTime(row.createdAt) })}
                      </p>
                      {row.creditChallenge && (
                        <p className="text-ink-muted text-body">
                          {t('review.neutralizationCredited')}
                        </p>
                      )}
                      {row.note.length > 0 && (
                        <p className="text-ink text-body max-w-measure">
                          {t('review.neutralizationNote', { note: row.note })}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {replay.neutralizations.length > 0 && (
                <p className="text-ink-muted text-body max-w-measure">
                  {t('review.neutralizationsEffect')}
                </p>
              )}
            </section>

            <section className="border-line flex flex-col gap-3 border-t pt-5">
              <h3 className="text-h4">{t('review.claimsTitle')}</h3>
              {replay.claims.length === 0 ? (
                <p className="text-ink-muted text-body max-w-measure">
                  {t('review.neutralizeNoClaims')}
                </p>
              ) : (
                <ul className="flex flex-col gap-4">
                  {replay.claims.map((claim) => (
                    <li key={claim.id} className="flex flex-col gap-2">
                      <p className="text-ink text-body max-w-measure">
                        <span className="mr-2 font-mono">{claim.key}</span>
                        {claim.text}
                      </p>
                      {/* The two facts the decision turns on, where the decision is offered: a
                          reviewer should not have to hold a claim's evidence status in their head
                          across a tab change to know whether it is the one to correct. */}
                      {(() => {
                        const here = claim.states.find(
                          (state) => state.variantKey === replay.run.variantKey,
                        )
                        return here === undefined ? null : (
                          <span className="flex flex-wrap items-center gap-2">
                            <Badge
                              variant={
                                here.evidenceStatus === 'defective' ? 'destructive' : 'secondary'
                              }
                            >
                              {here.evidenceStatus === 'defective'
                                ? t('claimObject.evidence.defective')
                                : t('claimObject.evidence.sound')}
                            </Badge>
                            <StanceChip stance={here.warrantedStance} />
                            {here.planted && <LabelChip kind="planted" />}
                          </span>
                        )
                      })()}
                      {/* Always mounted: the component draws the "already corrected" state
                          itself, because the action that produces it revalidates this page and a
                          swap here would unmount the dialog holding the recompute (D-464). */}
                      <NeutralizeDialog
                        runId={runId}
                        claimId={claim.id}
                        claimKey={claim.key}
                        alreadyCorrected={neutralized.has(claim.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </Panel>
      )}

      {capabilities.canForceFailure && (
        <Panel id="replay-test-controls" title={t('review.testTitle')} headingLevel={2}>
          <TestControls
            runId={runId}
            runState={replay.run.state}
            alreadyArmed={replay.flags.forced_failure_armed === true}
          />
        </Panel>
      )}

      {capabilities.canVoid && (
        <Panel
          id="replay-void"
          title={t('review.voidTitle')}
          description={t('review.voidDescription')}
          headingLevel={2}
        >
          <VoidDialog
            runId={runId}
            variants={[...variants.values()]}
            exported={replay.exports.length > 0}
          />
        </Panel>
      )}
    </>
  )
}
