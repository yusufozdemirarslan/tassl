// The Judgment Record and its export (UI-029, FR-170 to FR-172, FR-243, FR-254;
// `src/server/modules/records`).
//
// The record is the artifact that leaves Tassl: the four graphs, the confirmed bands with the
// instructor's notes, the mode and the variant, and the run's trace in the record form. It carries
// **no weight, no mapping and no points** — that arithmetic is the course's and the debrief is where
// a student reads it (12 §8.3) — so no string here names one either.
//
// **This namespace is held to the same three vocabularies as `debrief.` and `review.`** (D-468).
// `tests/unit/lib/record-voice.test.ts` scans every key and every value against the misconduct, the
// character-and-motive and the ranking word lists with no allowlist. It is the student's own
// permanent record of a run, which makes it the last place a word about the person rather than the
// work should appear.
import { scopedT } from '../scoped'

export const record = {
  'record.exportFileName': 'tassl-record-{runId}.json',
  // The course file is versioned (D-087), so its name is too: two versions of one run are two
  // different files, and a downloads folder is exactly where that difference gets lost.
  'record.courseExportFileName': 'tassl-course-export-{runId}-v{version}.json',

  // ---------------------------------------------------------------------------------------------
  // The screen (UI-029)
  // ---------------------------------------------------------------------------------------------
  'record.title': 'Judgment Record',
  'record.description':
    'What this run stands on: the four graphs plotted from its trace, the band your instructor decided on each dimension, and the scenario it was taken under.',
  'record.download': 'Download record',
  'record.downloadNote':
    'A JSON file of this run: the events, the graphs and the confirmed bands. It carries no course arithmetic, so nothing in it is a grade.',
  'record.confirmedAt': 'Bands confirmed {when}',
  'record.adjustedAt': 'Adjusted after a correction {when}',
  'record.graphsTitle': 'The four graphs',
  'record.graphsDescription': 'Plotted from this run’s own trace, and identical to your debrief.',
  'record.bandsTitle': 'The seven dimensions',
  'record.bandsDescription':
    'Each band is your instructor’s decision, with the recorded reason it sits there and any note they wrote.',
  'record.contextTitle': 'How this run was set up',
  'record.contextDescription': 'The mode it ran in and the variant of the scenario it drew.',
  'record.modeLabel': 'Mode',
  'record.mode.guided': 'Guided',
  'record.mode.standard': 'Standard',
  'record.mode.open': 'Open',
  'record.variantLabel': 'Variant',
  'record.variant.defective': 'Defective',
  'record.variant.sound': 'Sound',
  'record.uncalibratedNote':
    'Every band in this build is a descriptive draft: the rubric has not been calibrated against a pilot yet.',
  'record.debriefLink': 'Open the debrief',
  'record.backToRun': 'Back to the run',

  // ---------------------------------------------------------------------------------------------
  // The illustrative four-run trajectory (FR-171, FR-254, D-035)
  //
  // Never mixed with the record above it, always inside the labelled wrapper, and always described
  // as what it is: a picture of a shape, drawn from numbers that describe nobody.
  // ---------------------------------------------------------------------------------------------
  'record.trajectoryTitle': 'Four-run trajectory',
  'record.trajectoryNote':
    'These four runs are invented and describe no student, including you. They show the shape a term of runs takes; Tassl plots one run at a time, and everything above this panel is yours.',
  'record.trajectoryBandsCaption': 'Where each dimension sits across four invented runs.',
  'record.trajectoryReadingsCaption': 'The per-run readings behind those four invented runs.',
  'record.trajectoryDimensionColumn': 'Dimension',
  'record.trajectoryRunColumn': 'Run',
  'record.trajectoryChallengeColumn': 'False challenge rate',
  'record.trajectoryConfidenceColumn': 'Confidence at lock',
  'record.trajectoryAccuracyColumn': 'Claims held correctly at lock',
  'record.trajectoryEscalationColumn': 'Escalations used',
  'record.trajectoryOutsideColumn': 'Escalations outside competence',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(record)
