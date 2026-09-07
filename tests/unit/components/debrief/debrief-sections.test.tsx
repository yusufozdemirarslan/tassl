import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DebriefSections } from '@/components/features/debrief/debrief-sections'
import { enUS } from '@/lib/i18n/en-US'
import { DEBRIEF_SECTION_ORDER } from '@/server/modules/debrief/schema'
import type { DebriefSection, DebriefView } from '@/server/modules/debrief'

// UI-028's twelve sections (FR-151, FR-155, FR-153).
//
// Three properties, and all three are product rules rather than layout:
//
//   1. **The order is the run's order.** The debrief walks the run in the order the run happened,
//      and the screen walks `view.sections` rather than holding a copy of the order. The assertion
//      is against `DEBRIEF_SECTION_ORDER` itself, so a reordering of the product rule fails here
//      until the screen is looked at.
//   2. **A section a run cannot support is named, with the reason.** Never dropped: a page that
//      quietly omitted the missed-defect section would read as a run with nothing to say about its
//      defects, which is a different sentence from "your decision rested on no authored defect".
//   3. **At least one thing done well is always present** (FR-153). The service's ladder always
//      returns a sentence, and the section that draws it has no empty state to fall into.
//
// The two recharts plots are stubbed. They are proven in their own suites, they are fetched through
// a `next/dynamic` shim that has nothing to do with the order, and a `ResponsiveContainer` in jsdom
// measures zero and draws nothing — so mocking them keeps this suite about the twelve sections.

vi.mock('@/components/graphs', () => ({
  ConfidenceLine: () => <div data-testid="confidence-line" />,
  ClockTimeline: () => <div data-testid="clock-timeline" />,
  StanceMatrix: () => <div data-testid="stance-matrix" />,
  GraphFrame: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <figure>
      <h3>{title}</h3>
      {children}
    </figure>
  ),
}))

// A Server Action: importing the real module drags the debrief service and `server-only` into jsdom.
vi.mock('@/server/modules/debrief/actions', () => ({ answerDebriefAction: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/runs/r1/debrief',
}))

const emptyTable = { caption: 'A table', columns: ['a'], rows: [['x']] }

const graph = (extra: Record<string, unknown> = {}) => ({
  available: true,
  missing_event_types: [] as string[],
  description: 'A description.',
  data_table: emptyTable,
  ...extra,
})

const FRAME_GRAPH = {
  ...graph(),
  frame: {
    decision: 'Hold the premium share.',
    assumptions: ['One.', 'Two.', 'Three.'],
    position: 'I lean towards holding.',
    confidence: 55,
    locked_at: '2026-09-01T10:00:00.000Z',
  },
  brief: {
    recommendation: 'Hold for a quarter.',
    rationale: 'The payback figure predates the quote.',
    assumptions: ['One.', 'Two.', 'Three.'],
    change_my_mind: 'A recomputed payback.',
    named_values: {},
    confidence: 62,
    locked_at: '2026-09-01T10:40:00.000Z',
  },
  addendum: null,
}

const TURN = {
  text: 'The retention number has been corrected.',
  response: 'revise' as const,
  justification: 'The share was priced on the old figure.',
  confidence: 48,
  implicit: false,
}

const CLAIM = {
  claimId: 'claim-1',
  key: 'C1',
  text: 'Premium payback lands in eleven months.',
  importance: 'load_bearing' as const,
  stanceTaken: 'accept' as const,
  warrantedStance: 'verify' as const,
  match: false,
  evidenceStatus: 'defective' as const,
  failureFamily: 'stale_evidence',
  failureFamilyLabel: enUS['debrief.defect.family.stale_evidence'],
  reliedOn: true,
  neutralized: false,
  rationale: 'The figure predates the fulfillment quote.',
  lines: ['You took the stance Accept.', 'The material warranted Verify.'],
}

const DEFECT = {
  claimId: 'claim-1',
  key: 'C1',
  text: 'Premium payback lands in eleven months.',
  failureFamily: 'stale_evidence',
  failureFamilyLabel: enUS['debrief.defect.family.stale_evidence'],
  document: { title: 'Board deck', author: 'Finance', datedOn: '2026-02-01' },
  passage: 'Payback in eleven months.',
  stanceLine: 'You accepted this claim and your filed decision rested on it.',
  checkLine: 'A Source Trace on this claim reaches the board deck.',
  actionLine: 'No interrogation action was run on this claim.',
}

const BANDS: DebriefView['bands'] = [
  {
    dimension: 'framing',
    band: 'proficient',
    status: 'drafted',
    reason: '',
    decision: null,
    note: null,
    rationale: 'The frame named three load-bearing assumptions.',
    graphKeys: ['frame_beside_decision'],
    raisedByCorrection: false,
  },
]

const SECTION_DATA: Record<string, unknown> = {
  frame_beside_decision: { graphKey: 'frame_beside_decision', graph: FRAME_GRAPH },
  stance_matrix: { graphKey: 'stance_matrix', graph: graph({ summary: [] }), claims: [CLAIM] },
  missed_defects: { items: [DEFECT] },
  probe: {
    claimId: 'claim-2',
    claimKey: 'C2',
    reversal: 'On reflection, the figure may not hold.',
    occurredAt: '2026-09-01T10:20:00.000Z',
    intro: 'You pushed back on claim C2.',
    after: 'The stance this run recorded on that claim is Challenge.',
  },
  confidence_line: { graphKey: 'confidence_line', graph: graph({ points: [] }) },
  turn_beside_frame: {
    graphKey: 'frame_beside_decision',
    turn: TURN,
    frame: FRAME_GRAPH.frame,
    disruptedAssumptionIndexes: [0],
    unmatchedDisruptedKeys: [],
  },
  clock_timeline: {
    graphKey: 'clock_timeline',
    graph: graph({ total_ms: 1, segments: [], marks: [], window: null }),
  },
  counterfactual: { text: 'A run that checked the payback would have filed the same decision.' },
}

/** The twelve sections, every one available, in the order the module fixes. */
function sections(overrides: Partial<Record<string, Partial<DebriefSection>>> = {}) {
  return DEBRIEF_SECTION_ORDER.map((key): DebriefSection => {
    const base: DebriefSection = {
      key,
      available: true,
      reason: null,
      title: `Section ${key}`,
      body: `About ${key}.`,
      data: SECTION_DATA[key] ?? null,
    }
    return { ...base, ...overrides[key] }
  })
}

function view(overrides: Partial<DebriefView> = {}): DebriefView {
  return {
    run: { id: 'run-1' } as DebriefView['run'],
    sections: sections(),
    bands: BANDS,
    points: {
      mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
      weight: 2.5,
      assessed: 1,
      draft: 3,
      confirmed: null,
      effective: null,
    },
    questions: {
      answered: false,
      canAnswer: true,
      stanceToChange: null,
      doDifferently: null,
      answeredAt: null,
    },
    doneWell: 'You completed the frame before the assistant unlocked.',
    labels: {
      version: 'draft',
      uncalibrated: true,
      isWalkthrough: true,
      viewer: 'owner',
      mode: 'standard',
      variant: 'defective',
    },
    ...overrides,
  }
}

/** The section panels, in the order they appear in the document. */
function renderedKeys(): string[] {
  return Array.from(document.querySelectorAll('section[id^="debrief-"]')).map((node) =>
    node.id.replace('debrief-', '').replaceAll('-', '_'),
  )
}

describe('DebriefSections (UI-028)', () => {
  it('draws the twelve sections in the fixed order the module declares', () => {
    render(<DebriefSections view={view()} />)
    expect(renderedKeys()).toEqual([...DEBRIEF_SECTION_ORDER])
  })

  it('names a section it cannot draw, with the reason, rather than dropping it', () => {
    const reason = enUS['debrief.unavailable.probeNotFired']
    render(
      <DebriefSections
        view={view({
          sections: sections({
            probe: { available: false, reason, data: null },
          }),
        })}
      />,
    )

    // Still in the document, still in its place in the order.
    expect(renderedKeys()).toEqual([...DEBRIEF_SECTION_ORDER])
    expect(screen.getByText(reason)).toBeInTheDocument()
    expect(screen.getAllByText(enUS['debrief.sectionUnavailableLabel'])).toHaveLength(1)
    // And the section it would have drawn is gone with it.
    expect(screen.queryByText('You pushed back on claim C2.')).toBeNull()
  })

  it('always names at least one thing this run did (FR-153)', () => {
    render(<DebriefSections view={view()} />)
    expect(
      screen.getByText('You completed the frame before the assistant unlocked.'),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['debrief.doneWell.label'])).toBeInTheDocument()
  })

  it('draws the claim walk, the missed defect with its document and action, and the Turn', () => {
    render(<DebriefSections view={view()} />)

    // The same claim is in two sections — the walk and the missed defect — which is the point:
    // the walk is about every claim and the defect section is about what the decision carried.
    expect(screen.getAllByText(CLAIM.text)).toHaveLength(2)
    expect(screen.getByText(CLAIM.rationale)).toBeInTheDocument()
    expect(screen.getByText(DEFECT.stanceLine)).toBeInTheDocument()
    expect(screen.getByText(DEFECT.checkLine)).toBeInTheDocument()
    expect(screen.getByText(DEFECT.actionLine)).toBeInTheDocument()
    expect(screen.getByText(TURN.text)).toBeInTheDocument()
  })

  it('marks a draft band as draft and its provisional points as draft', () => {
    render(<DebriefSections view={view()} />)
    expect(screen.getByText(enUS['debrief.band.draftLabel'])).toBeInTheDocument()
    expect(screen.getByText(enUS['debrief.points.draftLabel'])).toBeInTheDocument()
    expect(screen.getByText(enUS['debrief.points.draftNote'])).toBeInTheDocument()
    expect(screen.getByText('3.000')).toBeInTheDocument()
  })

  it('replaces the draft with the confirmed band in place, with the instructor’s note', () => {
    render(
      <DebriefSections
        view={view({
          bands: [
            {
              ...BANDS[0]!,
              decision: 'overridden',
              band: 'developing',
              note: 'The second assumption is not load-bearing.',
            },
          ],
          points: {
            mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
            weight: 2.5,
            assessed: 1,
            draft: 3,
            confirmed: 2,
            effective: null,
          },
        })}
      />,
    )

    expect(screen.getByText(enUS['debrief.band.confirmedLabel'])).toBeInTheDocument()
    expect(screen.queryByText(enUS['debrief.band.draftLabel'])).toBeNull()
    expect(screen.getByText(enUS['debrief.band.decision.overridden'])).toBeInTheDocument()
    expect(screen.getByText('The second assumption is not load-bearing.')).toBeInTheDocument()
    expect(screen.getByText(enUS['debrief.points.confirmedLabel'])).toBeInTheDocument()
    expect(screen.getByText('2.000')).toBeInTheDocument()
  })

  it('gives a reviewer the two questions with no form to answer them (FR-154)', () => {
    render(
      <DebriefSections
        view={view({
          questions: {
            answered: false,
            canAnswer: false,
            stanceToChange: null,
            doDifferently: null,
            answeredAt: null,
          },
        })}
      />,
    )

    expect(screen.getByText(enUS['debrief.questions.readOnly'])).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: enUS['debrief.questions.submit'] })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
