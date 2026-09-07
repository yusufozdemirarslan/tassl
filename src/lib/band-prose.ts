// The two identifiers a band row carries where a drafted one carries prose, and their sentences
// (FR-004, FR-140, FR-153; D-463, D-515).
//
// `run_bands` stores two things that are names rather than sentences:
//
//   * `rationale = 'manual'` on all seven dimensions of a held run a faculty seat banded by hand
//     (10 §12), where a drafted band carries a paragraph;
//   * `draft_reason` = one of four `UnassessedReason` values on a dimension that holds no band,
//     where a drafted one carries an empty string.
//
// Three screens render those rows — the reviewer's replay, the student's debrief and the Judgment
// Record — and D-463 gave the first one a sentence for each while the two student surfaces kept
// printing `manual` and `no_evidence` at a person. A snake_case identifier is the one thing a
// status line must never be, and the record is the artifact that leaves Tassl.
//
// So the map is here, in `src/lib`, imported by the shared `BandCard` and by the replay page and by
// nothing else. It is a `lib` module and not a component, because `scoring.MANUAL_BAND_RATIONALE`
// is re-exported from the constant below: the string the pipeline *writes* and the string the
// screen *compares against* are one literal, which is what stops the branch from silently going
// dead the day the constant changes.
import { t } from '@/lib/i18n/t'

/** `run_bands.rationale` for a band a faculty seat placed rather than the pipeline (10 §12). */
export const MANUAL_BAND_RATIONALE = 'manual'

/** `run_bands.draft_reason` (FR-004): why a dimension holds no band. */
const UNASSESSED_REASONS: Record<string, string> = {
  graph_unavailable: t('band.unassessedReason.graph_unavailable'),
  no_evidence: t('band.unassessedReason.no_evidence'),
  stance_records_lost: t('band.unassessedReason.stance_records_lost'),
  read_failed: t('band.unassessedReason.read_failed'),
}

/**
 * The rationale as a person reads it: the pipeline's paragraph, or the sentence for a hand-placed
 * band.
 *
 * Anything else is passed through, because the alternative is a screen that swallows a rationale it
 * did not recognise — and a band with no reason beside it is the state FR-004 exists to prevent.
 */
export const bandRationaleText = (rationale: string): string =>
  rationale === MANUAL_BAND_RATIONALE ? t('band.rationaleManual') : rationale

/**
 * FR-004's sentence for a dimension that holds no band, from its stored reason.
 *
 * An unrecognised reason falls back to itself for the reason above: showing the identifier is bad,
 * and showing nothing at all is worse.
 */
export const unassessedReasonText = (reason: string): string => UNASSESSED_REASONS[reason] ?? reason
