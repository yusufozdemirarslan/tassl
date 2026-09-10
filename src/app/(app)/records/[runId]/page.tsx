import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import type { Route } from 'next'
import { BandCard } from '@/components/features/debrief/band-card'
import { ClockTimeline, ConfidenceLine, GraphFrame, StanceMatrix } from '@/components/graphs'
import type { ClockTimelinePayload } from '@/components/graphs/clock-timeline'
import type { ConfidenceLinePayload } from '@/components/graphs/confidence-line'
import { FrameBesideDecision } from '@/components/graphs/frame-beside-decision'
import type { StanceMatrixPayload } from '@/components/graphs/stance-matrix'
import type { GraphDataTable } from '@/components/graphs/graph-frame'
import { TrajectorySample } from '@/components/graphs/trajectory-sample'
import { LabelChip } from '@/components/layout/label-chip'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { buttonVariants } from '@/components/ui/button'
import { isAppError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import { getRecord, sample, type RecordView } from '@/server/modules/records'
import { RunIdParamsSchema } from '@/server/modules/records/schema'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('record.title') }

// UI-029, the Judgment Record (FR-170 to FR-172, FR-254).
//
// **The student's own artifact, and the one that leaves Tassl.** It carries the four graphs, the
// bands the instructor decided with their notes and the reason each sits where it does, the mode and
// the variant, and a download of the record-form trace. It carries **no weight, no mapping and no
// points** at any depth — `records.getRecord` enforces that by name containment before it answers
// (FR-172, D-421, D-439), and the download is the same document. The debrief is where a student
// reads their course's arithmetic (12 §8.3).
//
// **Owner only, from `confirmed`.** A reviewer reads the run through the replay, which carries
// everything this page does not; what makes this page the student's is that it is theirs to keep. A
// run that has not been confirmed is not an error boundary — the screen that says what the reader is
// waiting for is UI-027, so the page sends them there (D-465).
//
// **The illustrative trajectory is never mixed with the record** (FR-171, D-035). It is the last
// panel, inside the mandatory label, behind `FEATURE_SAMPLE_DATA`; when the flag is off there is no
// panel rather than an empty one.
//
// `recharts` reaches the two plots that need it through `@/components/graphs`'s `next/dynamic` shim
// and never statically (16 §3.2, D-074, D-282).

type RecordPageProps = { params: Promise<{ runId: string }> }

/** The four graph payloads, at the shape their components read them (see `debrief-sections.tsx`). */
type RecordGraphs = {
  confidence_line: ConfidenceLinePayload
  clock_timeline: ClockTimelinePayload
  stance_matrix: StanceMatrixPayload
  frame_beside_decision: {
    available: boolean
    missing_event_types: readonly string[]
    description: string
    data_table: GraphDataTable
    frame: {
      decision: string
      assumptions: string[]
      position: string
      confidence: number
      locked_at: string
    } | null
    brief: {
      recommendation: string
      rationale: string
      assumptions: string[]
      change_my_mind: string
      named_values: Record<string, number>
      confidence: number | null
      locked_at: string
    } | null
    addendum: string | null
    turn: {
      text: string
      response: 'hold' | 'revise' | 'reverse' | null
      justification: string | null
      confidence: number | null
      implicit: boolean
    } | null
    disrupted_assumption_indexes: number[]
    unmatched_disrupted_keys: string[]
  }
}

/**
 * Where each graph is drawn on this page (UI-028's graph link, applied to UI-029).
 *
 * All four share the one panel here, so all four anchors are the same id — which is the honest
 * answer: the record draws them together and a reader who follows any of the four lands where the
 * four are.
 */
const GRAPH_ANCHORS: Readonly<Record<string, string>> = {
  confidence_line: '#record-graphs',
  clock_timeline: '#record-graphs',
  stance_matrix: '#record-graphs',
  frame_beside_decision: '#record-graphs',
}

const MODE_LABELS: Record<RecordView['mode'], string> = {
  guided: t('record.mode.guided'),
  standard: t('record.mode.standard'),
  open: t('record.mode.open'),
}

const VARIANT_LABELS: Record<RecordView['variant']['key'], string> = {
  defective: t('record.variant.defective'),
  sound: t('record.variant.sound'),
}

/** `generateMetadata` and the render both need the record; `cache` makes that one read (D-178). */
const loadRecord = cache(async (runId: string): Promise<RecordView | 'missing' | 'not-yet'> => {
  const { actor } = await getViewer()
  try {
    return await getRecord(actor, runId)
  } catch (error) {
    if (!isAppError(error)) throw error
    if (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN') return 'missing'
    if (error.code === 'RECORD_NOT_AVAILABLE') return 'not-yet'
    throw error
  }
})

export default async function JudgmentRecordPage({ params }: RecordPageProps) {
  const { runId } = await params
  if (!RunIdParamsSchema.safeParse({ runId }).success) notFound()

  const view = await loadRecord(runId)
  if (view === 'missing') notFound()
  if (view === 'not-yet') redirect(`/runs/${runId}` as Route)

  const graphs = view.graphs as unknown as RecordGraphs
  const trajectory = sample.trajectory()

  return (
    <>
      <PageHeader
        title={t('record.title')}
        description={t('record.description')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {view.uncalibrated && <LabelChip kind="uncalibrated" />}
            {view.isWalkthrough && <LabelChip kind="walkthrough" />}
          </div>
        }
      />

      <div className="mb-6 flex flex-col gap-3">
        {view.confirmedAt !== null && (
          <p className="text-ink-muted text-meta font-mono tabular-nums">
            {t('record.confirmedAt', { when: formatDateTime(view.confirmedAt) })}
          </p>
        )}
        {view.adjustedAt !== null && (
          <p className="text-ink-muted text-meta font-mono tabular-nums">
            {t('record.adjustedAt', { when: formatDateTime(view.adjustedAt) })}
          </p>
        )}
        {view.uncalibrated && (
          <p className="text-ink-muted text-body max-w-measure">{t('record.uncalibratedNote')}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {/* A document at an address, not a button: the browser's own save, open-in-new-tab and
              copy-link all work, and the route ships no JavaScript for it. `download` carries the
              name rather than leaving it to `content-disposition` (D-719). */}
          <a
            href={`/api/v1/runs/${view.runId}/record/export`}
            className={buttonVariants({})}
            download={t('record.exportFileName', { runId: view.runId })}
          >
            {t('record.download')}
          </a>
          <Link
            href={`/runs/${view.runId}/debrief` as Route}
            className={buttonVariants({ variant: 'secondary' })}
          >
            {t('record.debriefLink')}
          </Link>
          <Link
            href={`/runs/${view.runId}` as Route}
            className={buttonVariants({ variant: 'ghost' })}
          >
            {t('record.backToRun')}
          </Link>
        </div>
        <p className="text-ink-muted text-body max-w-measure">{t('record.downloadNote')}</p>
      </div>

      <div className="flex flex-col gap-6">
        <Panel
          id="record-graphs"
          title={t('record.graphsTitle')}
          description={t('record.graphsDescription')}
          headingLevel={2}
        >
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
        </Panel>

        <Panel
          id="record-bands"
          title={t('record.bandsTitle')}
          description={t('record.bandsDescription')}
          headingLevel={2}
        >
          <div className="flex flex-col gap-6">
            {view.bands.map((band) => (
              <BandCard key={band.dimension} band={band} graphAnchors={GRAPH_ANCHORS} />
            ))}
          </div>
        </Panel>

        <Panel
          id="record-context"
          title={t('record.contextTitle')}
          description={t('record.contextDescription')}
          headingLevel={2}
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-ink-muted text-meta font-medium">{t('record.modeLabel')}</dt>
              <dd className="text-ink text-reading">{MODE_LABELS[view.mode]}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-ink-muted text-meta font-medium">{t('record.variantLabel')}</dt>
              <dd className="text-ink text-reading">{VARIANT_LABELS[view.variant.key]}</dd>
            </div>
          </dl>
        </Panel>

        {trajectory !== null && <TrajectorySample data={trajectory} />}
      </div>
    </>
  )
}
