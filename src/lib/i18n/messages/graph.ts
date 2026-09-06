// The four graphs (PRD §7.13, FR-132 to FR-136, FR-212): the frame every graph is drawn in, the
// titles, axis and column labels, and the templates every graph *description* is composed from.
//
// It is its own namespace because two very different readers share it. The builders in
// `src/server/modules/scoring/graphs/*` compose `description` and `data_table` here on the server,
// at scoring time, and store the result in `run_scores.graphs` (DATA-042) — so a description is a
// record, written once, read back identically by the debrief, the Judgment Record and the faculty
// replay (FR-154). The chart components in `src/components/graphs/*` read the same namespace in the
// browser for the axis labels and the frame's own controls, and a Client Component ships the
// namespace it reads and no others (16 §3.4).
//
// Three rules govern every sentence here.
//
//   * **A description is built from templates with numbers, never from model output** (10 §11.1).
//     Everything below is a sentence with `{placeholders}` a builder fills from the trace. Nothing
//     a model wrote reaches a graph.
//   * **Nothing here evaluates.** A graph shows what happened against the authored standard; the
//     bands are read off it elsewhere and the instructor confirms them (PRD §7.13). So the
//     vocabulary is descriptive — "matched", "not surfaced", "sound or verified" — and there is no
//     word for good or bad, no composite, no rank, and no percentile (FR-131).
//   * **A graph nobody can read is a failed graph.** Every string that exists so a screen-reader
//     user gets the same reading as a sighted one — the table caption, the column names, the
//     "not available" cell, the unavailable state that names its missing events — is as load-
//     bearing as the chart itself (WCAG 2.2 AA, FR-212).
import { scopedT } from '../scoped'

export const graph = {
  // ---------------------------------------------------------------------------------------------
  // The frame (16 §9)
  // ---------------------------------------------------------------------------------------------
  'graph.showTable': 'Show data table',
  'graph.showGraph': 'Show graph',
  /** Rendered in place of a `null` cell, so a blank never has to be interpreted. */
  'graph.notAvailable': 'not available',
  'graph.unavailable': 'This graph is not available for this run.',
  'graph.unavailableMissing': 'Missing events: {types}.',
  /** The description of a graph that could not be built; it still says what was looked for. */
  'graph.unavailableDescription':
    'This graph could not be plotted from this run’s trace. The events it is drawn from are missing: {types}.',
  'graph.emptyTable': 'This graph has no rows.',

  // ---------------------------------------------------------------------------------------------
  // Confidence line (FR-132, FR-083)
  // ---------------------------------------------------------------------------------------------
  'graph.confidenceLine.title': 'Confidence line',
  'graph.confidenceLine.caption':
    'Confidence at each of the run’s three confidence points, against the share of the claims relied on at that point that were sound or verified',
  'graph.confidenceLine.columnPoint': 'Point',
  'graph.confidenceLine.columnConfidence': 'Confidence',
  'graph.confidenceLine.columnAccuracy': 'Accuracy',
  'graph.confidenceLine.columnReliedOn': 'Claims relied on',
  'graph.confidenceLine.columnAccurate': 'Sound or verified',
  'graph.confidenceLine.pointFrame': 'Frame',
  'graph.confidenceLine.pointLock': 'Decision lock',
  'graph.confidenceLine.pointTurn': 'After the Turn',
  'graph.confidenceLine.seriesConfidence': 'Confidence',
  'graph.confidenceLine.seriesAccuracy': 'Accuracy of claims relied on',
  'graph.confidenceLine.description':
    'Confidence stated by the student, against the authored accuracy of the claims they were relying on at the time. {points}',
  'graph.confidenceLine.point': '{point} — confidence {confidence}, {accuracy}.',
  'graph.confidenceLine.confidenceValue': '{value} out of 100',
  'graph.confidenceLine.confidenceMissing': 'was not recorded',
  'graph.confidenceLine.accuracyValue':
    'accuracy {percent} percent — {accurate} of {reliedOn} claims relied on were sound or verified',
  'graph.confidenceLine.accuracyNone': 'no claims were being relied on yet',

  // ---------------------------------------------------------------------------------------------
  // Clock timeline (FR-133, FR-063)
  // ---------------------------------------------------------------------------------------------
  'graph.clockTimeline.title': 'Clock timeline',
  'graph.clockTimeline.caption':
    'The working period and the Turn window, segmented by activity, with each claim-touching event and each clock-stop credit marked',
  'graph.clockTimeline.columnClock': 'Clock',
  'graph.clockTimeline.columnActivity': 'Activity',
  'graph.clockTimeline.columnStart': 'From',
  'graph.clockTimeline.columnEnd': 'To',
  'graph.clockTimeline.columnLength': 'Length',
  'graph.clockTimeline.columnDetail': 'Detail',
  'graph.clockTimeline.clockWorking': 'Working clock',
  'graph.clockTimeline.clockWindow': 'Turn window',
  'graph.clockTimeline.segmentReading': 'Reading',
  'graph.clockTimeline.segmentDelegation': 'Delegation',
  'graph.clockTimeline.segmentAction': 'Interrogation action',
  'graph.clockTimeline.segmentEscalation': 'Escalation',
  'graph.clockTimeline.segmentBrief': 'Brief',
  'graph.clockTimeline.segmentUnattributed': 'Unattributed',
  'graph.clockTimeline.segmentTurnResponse': 'Turn response',
  'graph.clockTimeline.segmentPaused': 'Paused',
  'graph.clockTimeline.markClaimTouch': 'Claim touched',
  'graph.clockTimeline.markClockCredit': 'Clock credit',
  'graph.clockTimeline.markLock': 'Decision lock',
  'graph.clockTimeline.markTurnDelivered': 'Turn delivered',
  'graph.clockTimeline.detailDocument': 'Document: {title}',
  'graph.clockTimeline.detailClaims': 'Claims: {keys}',
  'graph.clockTimeline.description':
    'The working period ran {total}, spent as follows: {breakdown}. {marks} {window}',
  'graph.clockTimeline.breakdownEntry': '{label} {duration}',
  'graph.clockTimeline.marks':
    '{claimTouch} claim-touching events and {clockCredit} clock-stop credits are marked.',
  'graph.clockTimeline.windowSentence':
    'The Turn window ran {total}, spent as follows: {breakdown}.',
  'graph.clockTimeline.windowNone': 'No Turn window opened on this run.',

  // ---------------------------------------------------------------------------------------------
  // Stance matrix (FR-134, FR-082, D-107)
  // ---------------------------------------------------------------------------------------------
  'graph.stanceMatrix.title': 'Stance matrix',
  'graph.stanceMatrix.caption':
    'One row per consequential claim: the stance taken against the stance warranted under the authored conditions, with the five-by-five summary beneath',
  'graph.stanceMatrix.columnClaim': 'Claim',
  'graph.stanceMatrix.columnText': 'Statement',
  'graph.stanceMatrix.columnSurfaced': 'Surfaced',
  'graph.stanceMatrix.columnTaken': 'Stance taken',
  'graph.stanceMatrix.columnTakenAt': 'Set at',
  'graph.stanceMatrix.columnPreviousStance': 'Previous stance',
  'graph.stanceMatrix.columnPrecedingAction': 'Preceding action',
  'graph.stanceMatrix.columnWarranted': 'Stance warranted',
  'graph.stanceMatrix.columnEvidence': 'Evidence status',
  'graph.stanceMatrix.columnImportance': 'Importance',
  'graph.stanceMatrix.columnReadiness': 'Readiness context',
  'graph.stanceMatrix.columnReliedOn': 'Relied on',
  'graph.stanceMatrix.columnNeutralized': 'Neutralized',
  'graph.stanceMatrix.columnMatch': 'Match',
  'graph.stanceMatrix.notSurfaced': 'Not surfaced',
  'graph.stanceMatrix.noStance': 'No stance',
  'graph.stanceMatrix.evidenceSound': 'Sound',
  'graph.stanceMatrix.evidenceDefective': 'Defective',
  'graph.stanceMatrix.importanceLoadBearing': 'Load-bearing',
  'graph.stanceMatrix.importanceSupporting': 'Supporting',
  'graph.stanceMatrix.yes': 'Yes',
  'graph.stanceMatrix.no': 'No',
  'graph.stanceMatrix.readinessCorrect': '{concept}: answered correctly',
  'graph.stanceMatrix.readinessIncorrect': '{concept}: answered incorrectly',
  'graph.stanceMatrix.readinessUnanswered': '{concept}: not answered',
  'graph.stanceMatrix.readinessNone': 'No readiness item on this concept',
  'graph.stanceMatrix.creditedMatch': 'Matched (challenge credited)',
  'graph.stanceMatrix.summaryRowHeader': 'Taken',
  'graph.stanceMatrix.summaryColumnHeader': 'Warranted',
  'graph.stanceMatrix.summaryCell': '{taken} taken where {warranted} was warranted: {count}',
  'graph.stanceMatrix.description':
    '{claims} consequential claims in this run’s variant. {surfaced} were surfaced and {stanced} carried a stance; {matched} matched the stance warranted. False Challenge Rate {fcr} percent: {falseChallenges} sound claims warranting accept or verify were challenged or rejected, over all {denominator} consequential claims. {neutralized}',
  'graph.stanceMatrix.descriptionNeutralized':
    '{count} claims were neutralized and are excluded from the summary and the rate.',
  'graph.stanceMatrix.descriptionNoNeutralized': 'No claim was neutralized.',
  'graph.stanceMatrix.fcrLabel': 'False Challenge Rate',
  'graph.stanceMatrix.fcrValue': '{percent} percent ({falseChallenges} of {denominator})',
  'graph.stanceMatrix.matchedLabel': 'Stances matching what was warranted',
  'graph.stanceMatrix.percentValue': '{percent} percent',
  'graph.stanceMatrix.descriptionMatched':
    'Stances matching what was warranted: {percent} percent.',

  // ---------------------------------------------------------------------------------------------
  // Frame beside decision (FR-135, D-079)
  // ---------------------------------------------------------------------------------------------
  'graph.frameBesideDecision.title': 'Frame beside decision',
  'graph.frameBesideDecision.caption':
    'The frame locked before the assistant was in the room, the brief filed at the Decision Lock, and the response to the Turn',
  'graph.frameBesideDecision.columnField': 'Field',
  'graph.frameBesideDecision.columnFrame': 'Frame',
  'graph.frameBesideDecision.columnDecision': 'Decision',
  'graph.frameBesideDecision.rowStatement': 'Decision or recommendation',
  'graph.frameBesideDecision.rowPosition': 'Position or rationale',
  'graph.frameBesideDecision.rowAssumption': 'Assumption {number}',
  'graph.frameBesideDecision.rowChangeMyMind': 'What would change my mind',
  'graph.frameBesideDecision.rowConfidence': 'Confidence',
  'graph.frameBesideDecision.rowAddendum': 'Addendum',
  'graph.frameBesideDecision.rowTurn': 'The Turn',
  'graph.frameBesideDecision.rowTurnResponse': 'Response to the Turn',
  'graph.frameBesideDecision.disruptedMark': 'Disrupted by the Turn',
  'graph.frameBesideDecision.turnTitle': 'The Turn and the response filed',
  'graph.frameBesideDecision.turnJustification': 'Justification',
  'graph.frameBesideDecision.turnConfidence': 'Confidence after the Turn',
  'graph.frameBesideDecision.turnResponseLabel': 'Response filed',
  'graph.frameBesideDecision.disruptedList': 'Disrupted by the Turn: assumption {list}.',
  'graph.frameBesideDecision.unmatchedList':
    'Disrupted by the Turn but not named in the frame: {list}.',
  'graph.frameBesideDecision.addendumTitle': 'Addendum',
  'graph.frameBesideDecision.confidenceValue': '{value} out of 100',
  'graph.frameBesideDecision.responseHold': 'Hold',
  'graph.frameBesideDecision.responseRevise': 'Revise',
  'graph.frameBesideDecision.responseReverse': 'Reverse',
  'graph.frameBesideDecision.responseImplicit': 'Hold, filed by the window closing',
  'graph.frameBesideDecision.responseNone': 'No response was filed',
  'graph.frameBesideDecision.description':
    'The frame locked before the assistant was in the room, beside the decision filed after it. {turn} {disrupted}',
  'graph.frameBesideDecision.descriptionTurn':
    'The Turn was answered {response}, with confidence {confidence}.',
  'graph.frameBesideDecision.descriptionTurnImplicit':
    'The Turn window closed without a response, which files a hold.',
  'graph.frameBesideDecision.descriptionTurnNone': 'No Turn was delivered on this run.',
  'graph.frameBesideDecision.descriptionDisrupted':
    'Assumptions the Turn disrupted: {count} of the three the frame named ({list}).',
  'graph.frameBesideDecision.descriptionDisruptedNone':
    'The Turn disrupted none of the framed assumptions.',
  'graph.frameBesideDecision.descriptionUnmatched':
    'Disruptions the frame never named ({count}): {list}.',
  'graph.frameBesideDecision.empty': 'Empty',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(graph)
