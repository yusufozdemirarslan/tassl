import { BandCard } from '@/components/features/debrief/band-card'
import {
  ClaimWalkthroughRow,
  type ClaimWalkthroughData,
} from '@/components/features/debrief/claim-walkthrough-row'
import { Counterfactual } from '@/components/features/debrief/counterfactual'
import { DebriefQuestions } from '@/components/features/debrief/debrief-questions'
import { DoneWell } from '@/components/features/debrief/done-well'
import { MissedDefect, type MissedDefectData } from '@/components/features/debrief/missed-defect'
import {
  ProbeTranscript,
  type ProbeTranscriptData,
} from '@/components/features/debrief/probe-transcript'
import { PointsSummary } from '@/components/features/debrief/points-summary'
import { FramePanel } from '@/components/features/run/frame-panel'
import { ClockTimeline, ConfidenceLine, GraphFrame, StanceMatrix } from '@/components/graphs'
import type { ClockTimelinePayload } from '@/components/graphs/clock-timeline'
import type { ConfidenceLinePayload } from '@/components/graphs/confidence-line'
import {
  FrameBesideDecision,
  TurnRecordPanel,
  type FramedRecord,
  type TurnRecord,
} from '@/components/graphs/frame-beside-decision'
import type { StanceMatrixPayload } from '@/components/graphs/stance-matrix'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
// The module's `schema`, not its `index`: a component takes a module's wire types and its actions
// and nothing else (CLAUDE.md §Layering, enforced by `boundaries/dependencies`).
import type {
  DebriefBand,
  DebriefPoints,
  DebriefQuestions as DebriefQuestionsData,
  DebriefSection,
} from '@/server/modules/debrief/schema'

// UI-028 → the twelve sections, in the order FR-151 fixes (10 §13).
//
// **The order is the server's and this file does not hold a copy of it.** The debrief walks the run
// in the order the run happened, which is a product rule rather than a layout: `view.sections`
// arrives in `DEBRIEF_SECTION_ORDER` and this component walks it. A screen that sorted, filtered or
// re-grouped would be telling a different story from the trace.
//
// **A section a run cannot support is named, never dropped** (FR-155, FR-004). `available: false`
// carries the reason as a finished sentence, because the reason names run facts — which events are
// missing, which graph — that no screen holds. A page that quietly omitted the missed-defect
// section would read as a run with nothing to say about its defects, which is a different sentence
// from "your decision rested on no authored defect".
//
// **Every graph goes through `GraphFrame`** (FR-212): the visible title, the always-present
// description, and the data table behind a toggle. `recharts` reaches the two plots that need it
// through `@/components/graphs`'s `next/dynamic` shim and never statically (16 §3.2, D-074).
//
// **Nothing reviewer-only is on this page**, and there is nothing here to drop: the module's
// projection carries no `quotes`, no `evidenceEventSeqs` and no `decidedBy`, and the four graphs
// come from `scoring.readGraphsForOwner`, which withholds FR-106's `speed_outlier` (D-438).

/**
 * The section payload, read at the shape the section's own key implies.
 *
 * `DebriefSection.data` is `unknown` on the wire, and deliberately: the four graph payloads are
 * built and validated by `scoring`, and a module schema may import nothing but `src/lib` (04 §2), so
 * a second declaration of them in `debrief/schema.ts` would be a second thing to keep true. The cast
 * is confined to this one function, one call per section, so the assumption is written down once
 * rather than spread across a dozen render branches.
 */
function dataOf<T>(section: DebriefSection): T {
  return section.data as T
}

type GraphSection<K extends string, P> = { graphKey: K; graph: P }

/**
 * Where each graph is drawn on this page, so a band card can link to the evidence it names.
 *
 * The keys are the section keys, and the values are the ids `DebriefSections` gives the panels
 * below — one derivation, so a section that is renamed takes its anchor with it. The stance matrix
 * and the frame-beside-decision graph share their sections with other content, which is why the
 * anchor is the section rather than the figure.
 */
const GRAPH_ANCHORS: Readonly<Record<string, string>> = {
  confidence_line: '#debrief-confidence-line',
  clock_timeline: '#debrief-clock-timeline',
  stance_matrix: '#debrief-stance-matrix',
  frame_beside_decision: '#debrief-frame-beside-decision',
}

/**
 * What the page hands this component.
 *
 * `DebriefView` itself lives on the module's service — `run` is a whole `RunSummary` there and a
 * `foreignDocument` in the schema — and a component may not reach a module's public index. What is
 * needed of the run here is its id, for the one form on the page, so the shape is stated with that
 * and the four wire types the schema does publish; the service's view satisfies it.
 */
export type DebriefSectionsView = {
  run: { id: string }
  sections: readonly DebriefSection[]
  bands: readonly DebriefBand[]
  points: DebriefPoints
  questions: DebriefQuestionsData
  doneWell: string
}

export function DebriefSections({ view }: { view: DebriefSectionsView }) {
  return (
    <div className="flex flex-col gap-6">
      {view.sections.map((section) => (
        <Panel
          key={section.key}
          id={`debrief-${section.key.replaceAll('_', '-')}`}
          title={section.title}
          description={section.body}
          headingLevel={2}
          // The two questions are the one thing on this page the student writes, and DESIGN.md
          // gives a writing surface the wider gutter — the same `reading` padding the brief editor
          // and the scenario brief take.
          padding={section.key === 'questions' ? 'reading' : 'default'}
        >
          {section.available ? (
            <SectionBody section={section} view={view} />
          ) : (
            <Unavailable reason={section.reason} />
          )}
        </Panel>
      ))}
    </div>
  )
}

/** The named absence (FR-155): a label, and the server's own sentence for why. */
function Unavailable({ reason }: { reason: string | null }) {
  return (
    <div className="bg-paper-sunken flex flex-col gap-1 rounded-md p-3">
      <p className="text-ink-muted text-meta font-medium">{t('debrief.sectionUnavailableLabel')}</p>
      {/* FR-155's promise is that the absence is *named*: the label is a chip, not the sentence, and
          a section that arrived with a null reason still says something rather than nothing. */}
      <p className="text-ink text-body max-w-measure">
        {reason ?? t('debrief.sectionUnavailableUnknown')}
      </p>
    </div>
  )
}

function SectionBody({ section, view }: { section: DebriefSection; view: DebriefSectionsView }) {
  switch (section.key) {
    case 'frame_beside_decision': {
      const data = dataOf<GraphSection<'frame_beside_decision', FrameGraph>>(section)
      return (
        <GraphFrame
          graphKey="frame_beside_decision"
          title={t('graph.frameBesideDecision.title')}
          description={data.graph.description}
          dataTable={data.graph.data_table}
          available={data.graph.available}
          missingEventTypes={data.graph.missing_event_types}
          headingLevel={3}
        >
          <FrameBesideDecision
            frame={toFramedRecord(data.graph.frame)}
            brief={
              data.graph.brief === null
                ? null
                : {
                    recommendation: data.graph.brief.recommendation,
                    briefRationale: data.graph.brief.rationale,
                    assumptions: data.graph.brief.assumptions,
                    changeMyMind: data.graph.brief.change_my_mind,
                    confidence: data.graph.brief.confidence,
                    namedValues: data.graph.brief.named_values,
                    lockedAt: data.graph.brief.locked_at,
                  }
            }
            namedFields={[]}
            addendum={data.graph.addendum}
            headingLevel={4}
          />
        </GraphFrame>
      )
    }

    case 'stance_matrix': {
      const data = dataOf<
        GraphSection<'stance_matrix', StanceMatrixPayload> & {
          claims: readonly ClaimWalkthroughData[]
        }
      >(section)
      return (
        <div className="flex flex-col gap-8">
          <StanceMatrix payload={data.graph} headingLevel={3} />
          <section className="flex flex-col gap-5">
            <h3 className="text-h4">{t('debrief.claimsHeading')}</h3>
            <div className="flex flex-col gap-5">
              {data.claims.map((claim) => (
                <ClaimWalkthroughRow key={claim.claimId} claim={claim} />
              ))}
            </div>
          </section>
        </div>
      )
    }

    case 'missed_defects': {
      const data = dataOf<{ items: readonly MissedDefectData[] }>(section)
      return (
        <div className="flex flex-col gap-6">
          {data.items.map((defect) => (
            <MissedDefect key={defect.claimId} defect={defect} />
          ))}
        </div>
      )
    }

    case 'probe':
      return <ProbeTranscript probe={dataOf<ProbeTranscriptData>(section)} />

    case 'confidence_line': {
      const data = dataOf<GraphSection<'confidence_line', ConfidenceLinePayload>>(section)
      return <ConfidenceLine payload={data.graph} headingLevel={3} />
    }

    case 'turn_beside_frame': {
      const data = dataOf<{
        turn: TurnRecord
        frame: FrameGraph['frame']
        disruptedAssumptionIndexes: readonly number[]
        unmatchedDisruptedKeys: readonly string[]
      }>(section)
      const frame = toFramedRecord(data.frame)
      return (
        <div className="flex flex-col gap-6 2xl:grid 2xl:grid-cols-2 2xl:gap-8">
          <section className="flex min-w-0 flex-col gap-3">
            <h3 className="text-h4">{t('decision.frameTitle')}</h3>
            {frame === null ? (
              <p className="text-ink-muted text-reading max-w-measure">
                {t('decision.frameMissing')}
              </p>
            ) : (
              <FramePanel frame={frame} />
            )}
            {data.disruptedAssumptionIndexes.length > 0 && (
              <p className="border-amber text-ink text-body max-w-measure border-l-2 pl-3">
                {t('graph.frameBesideDecision.disruptedList', {
                  list: data.disruptedAssumptionIndexes.map((index) => index + 1).join(', '),
                })}
              </p>
            )}
            {data.unmatchedDisruptedKeys.length > 0 && (
              <p className="border-amber text-ink text-body max-w-measure border-l-2 pl-3">
                {t('graph.frameBesideDecision.unmatchedList', {
                  list: data.unmatchedDisruptedKeys.join(', '),
                })}
              </p>
            )}
          </section>
          <TurnRecordPanel turn={data.turn} headingLevel={3} className="min-w-0" />
        </div>
      )
    }

    case 'clock_timeline': {
      const data = dataOf<GraphSection<'clock_timeline', ClockTimelinePayload>>(section)
      return <ClockTimeline payload={data.graph} headingLevel={3} />
    }

    case 'counterfactual':
      return <Counterfactual text={dataOf<{ text: string }>(section).text} />

    case 'bands':
      return (
        <div className="flex flex-col gap-6">
          {view.bands.map((band) => (
            <BandCard key={band.dimension} band={band} graphAnchors={GRAPH_ANCHORS} />
          ))}
        </div>
      )

    case 'points':
      return <PointsSummary points={view.points} />

    case 'done_well':
      return <DoneWell sentence={view.doneWell} />

    case 'questions':
      return (
        <DebriefQuestions
          runId={view.run.id}
          answered={view.questions.answered}
          canAnswer={view.questions.canAnswer}
          stanceToChange={view.questions.stanceToChange}
          doDifferently={view.questions.doDifferently}
          answeredAt={view.questions.answeredAt}
        />
      )
  }
}

/** The frame-beside-decision payload, at the depth these two sections read it. */
type FrameGraph = {
  available: boolean
  missing_event_types: readonly string[]
  description: string
  data_table: {
    caption: string
    columns: readonly string[]
    rows: readonly (readonly (string | number | null)[])[]
  }
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
}

/** The stored payload's snake_case frame, in the shape the two frame readers take. */
function toFramedRecord(frame: FrameGraph['frame']): FramedRecord | null {
  return frame === null
    ? null
    : {
        decision: frame.decision,
        assumptions: frame.assumptions,
        position: frame.position,
        confidence: frame.confidence,
        lockedAt: frame.locked_at,
      }
}
