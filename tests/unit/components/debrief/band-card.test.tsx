import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BandCard, type BandCardData } from '@/components/features/debrief/band-card'
import { enUS } from '@/lib/i18n/en-US'

// D-515: neither of the two identifiers a band row can carry is ever printed at a person.
//
// `BandCard` is the one component the student's debrief (UI-028) and the Judgment Record (UI-029)
// both draw their seven dimensions with. Two of the values it renders are names rather than
// sentences: a held run a faculty seat banded by hand stores the literal `manual` in
// `run_bands.rationale` on all seven dimensions (10 §12, FR-140), and an unassessed dimension
// stores an `UnassessedReason` — `no_evidence` — in `run_bands.draft_reason`.
//
// The reviewer's replay had a branch for each from D-463. This card had neither, so both surfaces
// D-468 calls "the ones a person may still be reading a year later" printed the raw token. Nothing
// caught it because `tests/unit/debrief/assembly.test.ts` wrote `'no evidence'` with a space —
// a string production never produces.

const base: BandCardData = {
  dimension: 'verification',
  band: 'proficient',
  status: 'drafted',
  decision: 'confirmed',
  note: null,
  rationale: 'The run ran a Source Trace on the payback figure before the brief was locked.',
  graphKeys: ['stance_matrix'],
}

describe('a band card prints sentences, never the identifiers the row stores', () => {
  it('renders the pipeline’s own rationale exactly as it was written', () => {
    render(<BandCard band={base} />)
    expect(screen.getByText(base.rationale)).toBeInTheDocument()
  })

  it('renders the sentence for a band a faculty seat placed by hand, not “manual”', () => {
    // FR-140: every dimension of a hand-banded held run carries this one literal.
    render(<BandCard band={{ ...base, rationale: 'manual' }} />)
    expect(screen.getByText(enUS['band.rationaleManual'])).toBeInTheDocument()
    expect(screen.queryByText('manual')).not.toBeInTheDocument()
  })

  it.each([
    ['no_evidence', enUS['band.unassessedReason.no_evidence']],
    ['graph_unavailable', enUS['band.unassessedReason.graph_unavailable']],
    ['stance_records_lost', enUS['band.unassessedReason.stance_records_lost']],
    ['read_failed', enUS['band.unassessedReason.read_failed']],
  ])('renders FR-004’s sentence for %s, not the identifier', (reason, sentence) => {
    render(
      <BandCard
        band={{ ...base, band: null, status: 'unassessed', reason, rationale: 'manual' }}
      />,
    )
    expect(screen.getByText(sentence)).toBeInTheDocument()
    expect(screen.queryByText(reason)).not.toBeInTheDocument()
  })

  it('shows an unrecognised reason rather than swallowing it', () => {
    // A band with no reason beside it is the state FR-004 exists to prevent, so an unknown value
    // falls back to itself: bad, and better than a blank line.
    render(
      <BandCard
        band={{ ...base, band: null, status: 'unassessed', reason: 'something_new_entirely' }}
      />,
    )
    expect(screen.getByText('something_new_entirely')).toBeInTheDocument()
  })

  it('leaves the record’s projection, which carries no reason at all, unchanged', () => {
    // `records.toRecordBand` builds this shape without `reason` or `raisedByCorrection` (D-469).
    render(<BandCard band={{ ...base, rationale: 'manual' }} />)
    expect(screen.getByText(enUS['band.rationaleManual'])).toBeInTheDocument()
  })
})
