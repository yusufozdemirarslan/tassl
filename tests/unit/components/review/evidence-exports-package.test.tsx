import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Route } from 'next'
import { EvidenceDrawer } from '@/components/features/review/evidence-drawer'
import { ExportsList } from '@/components/features/review/exports-list'
import { PackageView } from '@/components/features/review/package-view'
import { formatDateTime } from '@/lib/format/date-time'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { ExportSummary } from '@/server/modules/records/schema'
import type { ElementConfirmationView, PackageVersionView } from '@/server/modules/scenarios/schema'
import type { BandView } from '@/server/modules/scoring/schema'
import type { TraceEventView } from '@/server/modules/trace/schema'

// The three read-only panels of UI-033 (FR-180, FR-181, FR-184, FR-195, FR-198, FR-204). None of
// them takes an action or holds state — they are Server Components rendering facts about a run that
// is already scored — so what is worth protecting is the judgement each of them makes about what a
// reviewer is shown: which evidence is one click away, which file a link actually hands over, and
// which half of a package version a seat is admitted to.
//
// They share a file because they share that shape and their fixtures overlap; each has its own
// describe, and no test in one reaches into another.

const RUN_ID = '3f2b7c10-8a2e-4d5b-9c31-0f1a2b3c4d5e'
const ASSIGNMENT_ID = '5c8d1e44-7b31-4a9e-8f02-6d3c9a1b2e77'

// ---------------------------------------------------------------------------------------------
// EvidenceDrawer
// ---------------------------------------------------------------------------------------------

const TRACE_PATH = `/review/runs/${RUN_ID}?tab=trace` as Route

// Only two of the four keys, deliberately: a graph key can reach the view before the title map
// catches up with it, and the drawer has to name it rather than render a hole.
const GRAPH_TITLES: Readonly<Record<string, string>> = {
  stance_matrix: enUS['graph.stanceMatrix.title'],
  confidence_line: enUS['graph.confidenceLine.title'],
}

const CLAIM_USED: TraceEventView = {
  seq: 42,
  type: 'claim_used',
  occurredAt: '2026-09-07T10:14:00.000Z',
  clockRemainingMs: 900_000,
  actorId: 'user_student',
  payload: {},
}

const STANCE_SET: TraceEventView = {
  seq: 57,
  type: 'stance_set',
  occurredAt: '2026-09-07T10:19:00.000Z',
  clockRemainingMs: 600_000,
  actorId: 'user_student',
  payload: {},
}

const QUOTE_TEXT = 'I checked the payback figure against the appendix before I relied on it.'

function band(over: Partial<BandView> = {}): BandView {
  return {
    dimension: 'verification',
    band: 'proficient',
    status: 'drafted',
    reason: 'The claim was checked before it was relied on.',
    basis: 'trace',
    provisional: false,
    graphKeys: ['stance_matrix'],
    evidenceEventSeqs: [42],
    quotes: [{ event_seq: 42, text: QUOTE_TEXT }],
    rationale: 'The Source Trace was run on the load-bearing claim.',
    decision: null,
    decidedBand: null,
    decidedBy: null,
    decidedAt: null,
    note: null,
    bandBeforeCorrection: null,
    bandAfterCorrection: null,
    effectiveBand: 'proficient',
    ...over,
  }
}

function renderDrawer(over: Partial<BandView> = {}): ReturnType<typeof userEvent.setup> {
  render(
    <EvidenceDrawer
      band={band(over)}
      events={[CLAIM_USED, STANCE_SET]}
      graphTitles={GRAPH_TITLES}
      tracePath={TRACE_PATH}
    />,
  )
  return userEvent.setup()
}

const disclosure = () => screen.getByText(enUS['review.evidenceSummary'])

/**
 * The link into the Trace for one sequence, found by both halves of its name.
 *
 * A pattern rather than a literal: the gap between the number and the event's kind is a flex gap
 * rather than a text node, so the accessible name runs the two together, and a test spelling that
 * out would have to be rewritten the day the markup puts a space there.
 */
const traceLink = (seq: number, kind: string) =>
  screen.getByRole('link', {
    name: new RegExp(`^${t('review.evidenceEventSeq', { seq })}\\s*${kind}$`),
  })

describe('EvidenceDrawer (UI-033)', () => {
  // The whole point of the component: seven bands are decided one after another, so the evidence
  // for each sits closed beside its band and opens where the reviewer is standing. A panel that
  // opened by default would put seven lists of events between a reviewer and the next decision.
  it('keeps the evidence closed until it is asked for, and one press away', async () => {
    const user = renderDrawer()

    expect(disclosure()).toBeInTheDocument()
    expect(screen.getByText(QUOTE_TEXT)).not.toBeVisible()

    await user.click(disclosure())

    expect(screen.getByText(QUOTE_TEXT)).toBeVisible()
  })

  it('names the graphs the read used in the reader’s language', async () => {
    const user = renderDrawer({ graphKeys: ['stance_matrix', 'confidence_line'] })
    await user.click(disclosure())

    expect(screen.getByText(enUS['review.evidenceGraphs'])).toBeVisible()
    expect(screen.getByText(enUS['graph.stanceMatrix.title'])).toBeVisible()
    expect(screen.getByText(enUS['graph.confidenceLine.title'])).toBeVisible()
  })

  // A key with no title yet is still a fact about how the band was read, so it is printed as it
  // stands rather than dropped: a silently missing line of evidence is the one a reviewer cannot
  // know to ask about.
  it('prints a graph key the title map does not carry rather than dropping it', async () => {
    const user = renderDrawer({ graphKeys: ['clock_timeline'] })
    await user.click(disclosure())

    expect(screen.getByText('clock_timeline')).toBeVisible()
  })

  // The reason the sequence is a link at all: a reviewer deciding a band who wants to see event 42
  // was otherwise memorising "42", changing tab and scrolling two hundred rows. The address filters
  // the Trace to that event's own kind and anchors on the row, so it lands on the event itself.
  it('turns each sequence into a link that lands on that event in the Trace', async () => {
    const user = renderDrawer({ evidenceEventSeqs: [42, 57] })
    await user.click(disclosure())

    expect(screen.getByText(enUS['review.evidenceEvents'])).toBeVisible()

    expect(traceLink(42, enUS['review.eventType.claim_used'])).toHaveAttribute(
      'href',
      `${TRACE_PATH}&event=claim_used#event-42`,
    )
    expect(traceLink(57, enUS['review.eventType.stance_set'])).toHaveAttribute(
      'href',
      `${TRACE_PATH}&event=stance_set#event-57`,
    )
  })

  // An owner's view withholds fields from some events (12 §8), so a band can name a sequence the
  // replay this reader was given does not carry. The number is still evidence and still says so;
  // what it must not be is a link to a filter that would come back empty.
  it('leaves a sequence the replay does not carry as a number, not a broken link', async () => {
    const user = renderDrawer({ evidenceEventSeqs: [99] })
    await user.click(disclosure())

    const line = screen.getByText(t('review.evidenceEventSeq', { seq: 99 }))
    expect(line).toBeVisible()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows each quote the read took from the run’s own words', async () => {
    const second = 'The appendix supersedes the figure in the summary.'
    const user = renderDrawer({
      quotes: [
        { event_seq: 42, text: QUOTE_TEXT },
        { event_seq: 57, text: second },
      ],
    })
    await user.click(disclosure())

    expect(screen.getByText(enUS['review.evidenceQuotes'])).toBeVisible()
    expect(screen.getByText(QUOTE_TEXT)).toBeVisible()
    expect(screen.getByText(second)).toBeVisible()
  })

  // The empty state belongs to a band with nothing behind any of the three lists. A band that
  // quoted the student but pointed at no graph and no event still has evidence to show, and saying
  // "this band names no evidence" over the top of it would be false.
  it('shows the lists it has, and claims no evidence only when all three are empty', async () => {
    const user = renderDrawer({ graphKeys: [], evidenceEventSeqs: [] })
    await user.click(disclosure())

    expect(screen.getByText(QUOTE_TEXT)).toBeVisible()
    expect(screen.queryByText(enUS['review.evidenceNone'])).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['review.evidenceGraphs'])).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['review.evidenceEvents'])).not.toBeInTheDocument()
  })

  it('says the band rests on its rationale alone when it names nothing else', async () => {
    const user = renderDrawer({ graphKeys: [], evidenceEventSeqs: [], quotes: [] })
    await user.click(disclosure())

    expect(screen.getByText(enUS['review.evidenceNone'])).toBeVisible()
    expect(screen.queryByText(enUS['review.evidenceQuotes'])).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
// ExportsList
// ---------------------------------------------------------------------------------------------

function exportRow(over: Partial<ExportSummary> & { id: string }): ExportSummary {
  return {
    runId: RUN_ID,
    assignmentId: ASSIGNMENT_ID,
    version: 1,
    reason: 'initial',
    createdAt: '2026-09-07T14:15:00.000Z',
    ...over,
  }
}

const V1 = exportRow({ id: '7a1c2b93-4e5f-4a6b-8c7d-9e0f1a2b3c01' })
const V2 = exportRow({
  id: '7a1c2b93-4e5f-4a6b-8c7d-9e0f1a2b3c02',
  version: 2,
  reason: 'override',
  createdAt: '2026-09-08T09:30:00.000Z',
})

const downloadOf = (version: number) =>
  screen.getByRole('link', { name: t('review.exportDownload', { version }) })

const fileNameOf = (version: number) =>
  t('record.courseExportFileName', { runId: RUN_ID, version: String(version) })

describe('ExportsList (UI-033)', () => {
  it('lists every version written, with the reason and when it was written', () => {
    render(<ExportsList runId={RUN_ID} exports={[V2, V1]} />)

    expect(screen.getByText(enUS['review.exportsCaption'])).toBeInTheDocument()
    expect(screen.getByText(enUS['review.exportReason.override'])).toBeInTheDocument()
    expect(screen.getByText(enUS['review.exportReason.initial'])).toBeInTheDocument()
    // The product's one fixed UTC timestamp (D-177), not a locale-dependent rendering.
    expect(screen.getByText(formatDateTime(V2.createdAt))).toBeInTheDocument()
    expect(screen.getByText(formatDateTime(V1.createdAt))).toBeInTheDocument()
  })

  // The ledger is append-only: version 1 is what the instructor entered points from, and it stays
  // readable after an override has written version 2. A list that replaced the row, or offered one
  // download for "the export", would lose the provenance the versions exist to carry (D-087).
  it('keeps the earlier version downloadable after a later one is written', () => {
    render(<ExportsList runId={RUN_ID} exports={[V2, V1]} />)

    expect(downloadOf(1)).toHaveAttribute('href', `/api/v1/runs/${RUN_ID}/exports/1`)
    expect(downloadOf(2)).toHaveAttribute('href', `/api/v1/runs/${RUN_ID}/exports/2`)
  })

  // D-719: the file name is named on the link as well as in `content-disposition`, because an
  // engine that disregards the header disregards its filename too — and two versions of one run
  // landing in a downloads folder as the same name is exactly the provenance the ledger protects.
  it('names the file each link hands over, version and all', () => {
    render(<ExportsList runId={RUN_ID} exports={[V2, V1]} />)

    expect(downloadOf(1)).toHaveAttribute('download', fileNameOf(1))
    expect(downloadOf(2)).toHaveAttribute('download', fileNameOf(2))
    expect(fileNameOf(2)).not.toEqual(fileNameOf(1))
  })

  // Five reasons, and one of them does not share its key's name — `mapping_change` reads from
  // `review.exportReason.mapping` — so the table is walked rather than spot-checked.
  it.each([
    ['initial', enUS['review.exportReason.initial']],
    ['override', enUS['review.exportReason.override']],
    ['neutralization', enUS['review.exportReason.neutralization']],
    ['mapping_change', enUS['review.exportReason.mapping']],
    ['unassessed', enUS['review.exportReason.unassessed']],
  ] as const)('gives the %s export its own sentence', (reason, sentence) => {
    render(
      <ExportsList
        runId={RUN_ID}
        exports={[exportRow({ id: '7a1c2b93-4e5f-4a6b-8c7d-9e0f1a2b3c03', reason })]}
      />,
    )

    const row = screen.getAllByRole('row')[1]
    expect(row).toBeDefined()
    expect(within(row as HTMLElement).getByText(sentence)).toBeInTheDocument()
  })

  it('says no export has been written rather than drawing an empty table', () => {
    render(<ExportsList runId={RUN_ID} exports={[]} />)

    expect(
      screen.getByRole('heading', { name: enUS['review.exportsEmptyTitle'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['review.exportsEmptyBody'])).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  // Tassl holds no grade, and the sentence that says so belongs beside the number it is about — one
  // panel up, in the points summary. Twice in one scroll is a sentence a reader stops seeing.
  it('does not repeat the gradebook sentence beside the files', () => {
    render(<ExportsList runId={RUN_ID} exports={[V2, V1]} />)

    expect(screen.queryByText(enUS['review.pointsGradebookNote'])).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------------------------
// PackageView
// ---------------------------------------------------------------------------------------------

const VERSION_HREF = '/packages/pkg-1/versions/ver-1' as Route

const CONFIRMATION: ElementConfirmationView = {
  id: '8b2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e05',
  elementType: 'claim',
  elementId: '8b2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e06',
  elementKey: 'C3',
  revision: 1,
  decision: 'confirmed',
  note: '',
  openedAt: '2026-08-20T08:55:00.000Z',
  decidedAt: '2026-08-20T09:00:00.000Z',
  decidedBy: 'user_author',
  decidedByName: 'Ada Author',
}

const VERSION: PackageVersionView = {
  id: '9c3e4f50-6b7c-4d8e-9f0a-1b2c3d4e5f07',
  packageId: '9c3e4f50-6b7c-4d8e-9f0a-1b2c3d4e5f08',
  packageTitle: 'Warehouse consolidation',
  familyKey: 'operations_consolidation',
  version: 3,
  status: 'confirmed',
  calibrationStatus: 'uncalibrated',
  conceptSet: ['payback', 'throughput'],
  brief: 'Decide whether to consolidate the two warehouses.',
  workingClockSeconds: 2700,
  turnDelaySeconds: 300,
  difficultyProfile: { estimate: 'unknown', note: '', uncalibrated: true },
  generalEscalationReply: 'The operations lead answers escalations.',
  debriefCounterfactual: 'A Source Trace on the payback figure would have found the appendix.',
  teachingNoteChecked: true,
  confirmedAt: '2026-08-20T09:00:00.000Z',
  confirmedBy: 'user_author',
  counts: {
    documents: 6,
    stakeholders: 3,
    answerSpacePositions: 4,
    namedFields: 5,
    claims: 8,
    variants: 2,
    defenseQuestions: 6,
    readinessItems: 4,
  },
  confirmationRecord: [],
  authoringRecord: { generationModel: null, generatedAt: null, runs: [], editors: [] },
  measures: {
    seedToConfirmedMs: 5_400_000,
    editRate: 0.25,
    rejectedShare: 0.05,
    generationPasses: 2,
    reviewMsPerElement: 120_000,
  },
  validation: { ok: true, failures: [] },
  warnings: [],
  seedRecord: null,
  restricted: false,
  capabilities: { canEdit: false, canConfirm: false, canRegenerate: false },
}

function renderPackage(
  over: Partial<PackageVersionView> = {},
  variantKey: 'defective' | 'sound' = 'defective',
) {
  render(
    <PackageView
      version={{ ...VERSION, ...over }}
      variantKey={variantKey}
      versionHref={VERSION_HREF}
    />,
  )
}

/** The value the fact grid shows under a label: `<dt>` and then its own `<dd>`, as a reader pairs them. */
function factUnder(label: string): HTMLElement {
  const term = screen.getByText(label)
  const value = term.nextElementSibling
  if (!(value instanceof HTMLElement)) throw new Error(`No value is shown under “${label}”.`)
  return value
}

describe('PackageView (UI-033)', () => {
  it('names the package, its version and the variant this run drew', () => {
    renderPackage()

    expect(factUnder(enUS['review.packageIdLabel'])).toHaveTextContent(VERSION.packageTitle)
    expect(factUnder(enUS['review.packageIdLabel'])).toHaveTextContent(VERSION.packageId)
    expect(factUnder(enUS['review.packageVersionLabel'])).toHaveTextContent('3')
    expect(factUnder(enUS['review.packageStatusLabel'])).toHaveTextContent(
      enUS['review.packageStatusConfirmed'],
    )
  })

  it.each([
    ['draft', enUS['review.packageStatusDraft']],
    ['confirmed', enUS['review.packageStatusConfirmed']],
    ['retired', enUS['review.packageStatusRetired']],
  ] as const)('reads a %s version by its word, not its enum value', (status, label) => {
    renderPackage({ status })

    expect(factUnder(enUS['review.packageStatusLabel'])).toHaveTextContent(label)
  })

  // The claim vocabulary owns the short pair. `review.variantDefective` is "Defective variant",
  // which reads correctly in the page header and stammers under a label already saying "Variant on
  // this run".
  it.each([
    ['defective', enUS['claimObject.variant.defective'], enUS['review.variantDefective']],
    ['sound', enUS['claimObject.variant.sound'], enUS['review.variantSound']],
  ] as const)('gives the %s variant one word under its label', (variantKey, word, phrase) => {
    renderPackage({}, variantKey)

    expect(factUnder(enUS['review.packageVariantLabel'])).toHaveTextContent(word)
    expect(screen.queryByText(phrase)).not.toBeInTheDocument()
  })

  it('links out to the version’s own screen, where the seed record and the export live', () => {
    renderPackage()

    expect(screen.getByRole('link', { name: enUS['review.packageOpen'] })).toHaveAttribute(
      'href',
      VERSION_HREF,
    )
  })

  // 08 §4's program-lead row reads "✓ org (measures only)": the seat is admitted to the accounting
  // of what authoring cost and to nothing else. The withheld fields arrive empty rather than
  // absent, so the flag is what lets the screen say which fact it is looking at — and the measures
  // must still be there, because they are the whole reason that seat opened the screen.
  it('tells a restricted seat the record is not theirs to read, and still shows the measures', () => {
    renderPackage({ restricted: true, confirmationRecord: [CONFIRMATION] })

    expect(
      screen.getByRole('heading', { name: enUS['review.packageRestrictedTitle'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['review.packageRestrictedBody'])).toBeInTheDocument()
    expect(screen.queryByText(enUS['packageVersion.recordByTypeCaption'])).not.toBeInTheDocument()
    expect(screen.queryByText(CONFIRMATION.decidedByName)).not.toBeInTheDocument()

    expect(
      screen.getByRole('heading', { name: enUS['review.packageMeasuresTitle'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['packageVersion.generationPasses'])).toBeInTheDocument()
  })

  // "There is a record and it is not yours to read" and "there is no record" are different facts,
  // so each says which one it is (DESIGN.md §Empty states).
  it('says there is no record when there is none, in different words from the restricted seat', () => {
    renderPackage()

    expect(
      screen.getByRole('heading', { name: enUS['review.packageRecordEmptyTitle'] }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['review.packageRecordEmptyBody'])).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: enUS['review.packageRestrictedTitle'] }),
    ).not.toBeInTheDocument()
  })

  it('draws the confirmation record when the seat may read it', () => {
    renderPackage({ confirmationRecord: [CONFIRMATION] })

    expect(screen.getByText(enUS['packageVersion.recordByTypeCaption'])).toBeInTheDocument()
    expect(screen.getAllByText(CONFIRMATION.decidedByName).length).toBeGreaterThan(0)
    expect(
      screen.queryByRole('heading', { name: enUS['review.packageRecordEmptyTitle'] }),
    ).not.toBeInTheDocument()
  })

  // A confirmed package version is immutable, and a run is drawn from the version as it was: this
  // tab reports and never edits. The only thing to press is the link out of it.
  it('offers nothing to press: the tab reports a confirmed version and changes none of it', () => {
    renderPackage()

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
