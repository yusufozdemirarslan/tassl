// The Run Debrief (UI-028, FR-150 to FR-155; `src/server/modules/debrief`).
//
// This is the one surface in the product that tells a student how their run went, which makes it the
// one place the product's voice is most likely to slip. Three rules hold every string below, and
// none of them is a matter of taste.
//
//   * **Nothing Tassl observes is treated as misconduct** (PRD §7 standing rules, FR-153). There is
//     no word here for cheating, dishonesty or suspicion, and there is nothing to attach one to: an
//     outside tool declared is a fact about how the work was done, and a defect carried into a
//     decision is a fact about the decision.
//   * **A failure is an action or an omission, never a person** (FR-153: "attributes failures to
//     specific actions and omissions", "never characterizes motives"). So the sentences below say
//     "accepted without running a Source Trace" and never "was careless"; there is no adjective here
//     that describes a student rather than what the trace records. The word "fail" itself is absent,
//     because "you failed to check" is the register the rule exists to keep out.
//   * **No composite, no rank, no percentile** (FR-131). Nothing here compares one run with another
//     or with a cohort, and the word "score" does not appear: what the run holds is seven bands, and
//     what the course does with them is arithmetic the mapping specifies (PRD §7.13, §7.19).
//
// `tests/unit/debrief/assembly.test.ts` scans every value and every key of this namespace against
// the three vocabularies above and fails on any of them, so the rules survive the next person who
// edits a sentence in a hurry. The test re-runs itself over a planted string to prove the scan can
// still fail (D-430's property, one namespace along).
//
// The band descriptors, the unassessed reasons and the graph titles are *not* here: they live in
// `band.ts`, `graph.ts` and `scoring/rubric/v1.ts`, and the debrief shows them through the same
// projections every other reader gets (FR-154: the student and the instructor read one document).
import { scopedT } from '../scoped'

export const debrief = {
  // ---------------------------------------------------------------------------------------------
  // The page and its two versions (FR-150)
  // ---------------------------------------------------------------------------------------------
  'debrief.title': 'Run Debrief',
  'debrief.version.draft': 'Draft',
  'debrief.version.confirmed': 'Confirmed',
  'debrief.version.draftNote':
    'Every band below is a draft. Your instructor reads the run and confirms or changes each one; when they do, this page shows what they decided in place of the draft.',
  'debrief.version.confirmedNote':
    'Your instructor has read this run. Each band below is what they decided, with any note they wrote.',
  'debrief.viewer.reviewer': 'Viewing as reviewer',
  'debrief.viewer.reviewerNote':
    'This is the student’s own debrief, exactly as they read it. The two questions at the end are theirs to answer.',

  // ---------------------------------------------------------------------------------------------
  // The twelve sections, in the fixed order of FR-151 and 10 §13
  // ---------------------------------------------------------------------------------------------
  'debrief.section.frameBesideDecision.title': 'Your frame beside your decision',
  'debrief.section.frameBesideDecision.body':
    'What you wrote before the assistant unlocked, set beside the recommendation you filed at the lock.',
  'debrief.section.stanceMatrix.title': 'Claim by claim',
  'debrief.section.stanceMatrix.body':
    'Every consequential claim in this run: the stance you took, the stance the material warranted, and the reason the author wrote for it.',
  'debrief.section.missedDefects.title': 'Defects the decision rested on',
  'debrief.section.missedDefects.body':
    'Claims this variant authored as defective that your filed decision still rested on, each with the document behind it and the check that would have shown it.',
  'debrief.section.probe.title': 'Where the assistant changed its position',
  'debrief.section.probe.body':
    'The assistant reversed itself after you pushed back on a claim. Here is what it said, word for word.',
  'debrief.section.confidenceLine.title': 'Your confidence through the run',
  'debrief.section.confidenceLine.body':
    'The readings you gave: at the frame, at the lock, and after the Turn.',
  'debrief.section.turnBesideFrame.title': 'The Turn beside your frozen frame',
  'debrief.section.turnBesideFrame.body':
    'What arrived after the lock, which of your framed assumptions it disturbed, and the response you filed.',
  'debrief.section.clockTimeline.title': 'Where the clock went',
  'debrief.section.clockTimeline.body':
    'Reading, delegating and checking across the working clock, with every paused span credited back.',
  'debrief.section.counterfactual.title': 'How this run could have gone',
  'debrief.section.counterfactual.body':
    'Three sentences the author wrote about this scenario. They are the same for everyone who takes it and describe no particular run.',
  'debrief.section.bands.title': 'The seven dimensions',
  'debrief.section.bands.body':
    'Each dimension holds a band and the recorded reason it sits there, or says why it holds none.',
  'debrief.section.points.title': 'What your course does with the bands',
  'debrief.section.points.body':
    'Tassl places bands. Converting them into gradebook points is your course’s arithmetic, under the mapping your instructor set.',
  'debrief.section.doneWell.title': 'One thing this run did',
  'debrief.section.doneWell.body': 'Taken from the trace, like everything else on this page.',
  'debrief.section.questions.title': 'Two questions',
  'debrief.section.questions.body':
    'Answering them closes the run. Nobody marks these answers; they are yours, and your instructor can read them.',

  // ---------------------------------------------------------------------------------------------
  // Why a section is not drawn (FR-155, FR-004)
  //
  // A section a run cannot support is named with the reason rather than left out, so a partial
  // debrief reads as a run that recorded less and never as a page that is missing something.
  // ---------------------------------------------------------------------------------------------
  'debrief.unavailable.graph':
    'This section is drawn from the {graph}, and this run’s trace does not carry the events it needs ({missing}). It is named here rather than drawn from something else.',
  'debrief.unavailable.noGraphs':
    'This run has no plotted graphs, so this section has nothing to draw from.',
  'debrief.unavailable.noDefects':
    'Your filed decision rested on no claim this variant authored as defective.',
  'debrief.unavailable.probeNotFired':
    'The assistant held its position throughout this run, so there is nothing to replay here.',
  'debrief.unavailable.noTurn':
    'No Turn was delivered in this run, so there is nothing to set beside the frame.',
  'debrief.unavailable.noCounterfactual':
    'This scenario version carries no counterfactual, so there is nothing authored to show.',
  'debrief.unavailable.noBands': 'This run holds no bands yet.',
  'debrief.unavailable.noMapping':
    'This run holds no bands yet, so there is no arithmetic for your course to do.',

  // ---------------------------------------------------------------------------------------------
  // Claim by claim (FR-151)
  // ---------------------------------------------------------------------------------------------
  'debrief.claim.heading': 'Claim {key}',
  'debrief.claim.youTook': 'You took the stance {stance}.',
  'debrief.claim.youTookAfter': 'You took the stance {stance}, having first taken {previous}.',
  'debrief.claim.noStance': 'No stance was recorded on this claim.',
  'debrief.claim.notSurfaced': 'This claim never came up in your run.',
  'debrief.claim.warranted': 'The material warranted {stance}.',
  'debrief.claim.same': 'The two are the same.',
  'debrief.claim.different': 'The two differ.',
  'debrief.claim.reliedOn': 'Your filed decision rested on this claim.',
  'debrief.claim.notReliedOn': 'Your filed decision did not rest on this claim.',
  'debrief.claim.checksRun': 'You ran {actions} on this claim.',
  'debrief.claim.noChecksRun': 'No interrogation action was run on this claim.',
  'debrief.claim.rationaleLabel': 'What the author wrote',
  'debrief.claim.noRationale': 'The author wrote no reason for this claim.',
  'debrief.claim.neutralized':
    'Your instructor took this claim out of this run’s arithmetic, so nothing about it counts either way.',
  'debrief.claim.credited':
    'Your instructor recorded that your challenge on this claim was right, and this run reads it as a match.',
  'debrief.claim.recordLost':
    'The stance record for this claim did not survive, so this run is not read either way on it.',

  // ---------------------------------------------------------------------------------------------
  // Defects the decision rested on (FR-151, FR-153)
  //
  // Every sentence names an act or an omission and stops there. What the check would have returned
  // is authored material, and its clock cost is the number that was on the control at the time.
  // ---------------------------------------------------------------------------------------------
  'debrief.defect.acceptedRelied':
    'You accepted this claim and your filed decision rested on it. The material warranted {warranted}.',
  'debrief.defect.stanceRelied':
    'You took the stance {stance} on this claim and your filed decision rested on it. The material warranted {warranted}.',
  'debrief.defect.noStanceRelied':
    'No stance was recorded on this claim and your filed decision rested on it. The material warranted {warranted}.',
  'debrief.defect.familyLabel': 'What was wrong with it',
  'debrief.defect.documentLabel': 'Where it came from',
  'debrief.defect.document': '{title}, written by {author}, dated {dated}',
  'debrief.defect.noDocument': 'This claim names no document in the Evidence Room.',
  'debrief.defect.passageLabel': 'The passage behind it',
  'debrief.defect.checkLabel': 'The check that would have shown it',
  'debrief.defect.sourceTrace':
    'A Source Trace on this claim reaches {document}, written by {author} and dated {dated}. It costs {minutes} minutes of the working clock.',
  'debrief.defect.replicationCheck':
    'A Replication Check on this claim returns: {result} It costs {minutes} minutes of the working clock.',
  'debrief.defect.decompositionCheck':
    'A Decomposition Check on this claim breaks it into {steps} steps and shows the result of each. It costs {minutes} minutes of the working clock.',
  'debrief.defect.noPath':
    'No interrogation action returns anything for this claim in this variant, so the reading was in the documents.',
  'debrief.defect.checkedFirst': 'You ran {actions} on this claim before taking that stance.',
  'debrief.defect.notChecked': 'No interrogation action was run on this claim.',

  // The ten authored defect kinds, in the words a student reads them in. The instrument's own name
  // for each is in the package, where the author works; this is what it looks like from the run.
  'debrief.defect.family.near_neighbor':
    'A figure close to the right one, taken from the wrong row',
  'debrief.defect.family.unstated_assumption':
    'An assumption the claim rests on that it never states',
  'debrief.defect.family.stale_evidence': 'Evidence that later material had already overtaken',
  'debrief.defect.family.uncomputed_number':
    'A number presented as read off when nothing computed it',
  'debrief.defect.family.extrapolation': 'A result stretched past what the material supports',
  'debrief.defect.family.reversal_to_agree': 'A position changed to agree with what it was told',
  'debrief.defect.family.omitted_alternative':
    'A reading that leaves out an alternative the room holds',
  'debrief.defect.family.misapplied_method': 'A method applied where its conditions do not hold',
  'debrief.defect.family.misattributed_source':
    'A statement attributed to a source that does not carry it',
  'debrief.defect.family.unacceptable_route': 'A route to the answer the material rules out',

  // ---------------------------------------------------------------------------------------------
  // The Sycophancy Probe, verbatim (FR-053, FR-151)
  // ---------------------------------------------------------------------------------------------
  'debrief.probe.intro':
    'You pushed back on claim {key}, and the assistant reversed its position. The reversal was written into the scenario before your run started: it happens to everyone who pushes back there, and it says nothing about the claim.',
  'debrief.probe.reversalLabel': 'What the assistant said',
  'debrief.probe.stanceAfter': 'The stance this run recorded on that claim is {stance}.',
  'debrief.probe.noStanceAfter': 'This run recorded no stance on that claim.',

  // ---------------------------------------------------------------------------------------------
  // The seven dimensions (FR-151, FR-004, FR-182)
  // ---------------------------------------------------------------------------------------------
  'debrief.band.draftLabel': 'Draft band',
  'debrief.band.confirmedLabel': 'Confirmed band',
  'debrief.band.decision.confirmed': 'Your instructor confirmed the draft.',
  'debrief.band.decision.overridden': 'Your instructor decided this dimension differently.',
  'debrief.band.decision.unassessed':
    'Your instructor recorded this dimension as unassessed, so it is left out of the arithmetic.',
  'debrief.band.noteLabel': 'Your instructor wrote',
  'debrief.band.noNote': 'Your instructor wrote no note on this dimension.',
  'debrief.band.evidenceLabel': 'Read from',
  'debrief.band.raisedByCorrection':
    'A correction your instructor entered moved this dimension up. A correction can raise a band and never lowers one.',
  'debrief.band.uncalibrated':
    'Every band in this build is a descriptive draft: the rubric has not been calibrated against a pilot yet.',

  // ---------------------------------------------------------------------------------------------
  // What the course does with the bands (FR-202, FR-203, D-091)
  // ---------------------------------------------------------------------------------------------
  'debrief.points.mappingLabel': 'Your course’s mapping',
  'debrief.points.mappingRow': '{band} is worth {value}',
  'debrief.points.weightLabel': 'What this run is worth in the course',
  'debrief.points.weight': '{weight} percent of the course grade',
  'debrief.points.arithmetic':
    'Each assessed dimension is worth what the mapping gives its band. Those values are added and divided by {assessed}, the number of dimensions this run was assessed on. A dimension recorded as unassessed is left out entirely and is never counted as nothing.',
  'debrief.points.draftLabel': 'Provisional points, draft',
  'debrief.points.draftNote':
    'Provisional and drawn from draft bands. No draft band reaches a gradebook, and this number is in no export.',
  'debrief.points.confirmedLabel': 'Confirmed points',
  'debrief.points.confirmedNote':
    'Drawn from the bands your instructor confirmed, under your course’s mapping. This is the number your course’s export carries.',
  'debrief.points.correctedLabel': 'Points after your instructor’s correction',
  'debrief.points.correctedNote':
    'A correction can only move this number up: the run keeps the higher of the two.',
  'debrief.points.none':
    'No dimension of this run was assessed, so there is no arithmetic for your course to do.',

  // ---------------------------------------------------------------------------------------------
  // One thing this run did (FR-153, 10 §13.1)
  //
  // The order of these templates is the order 10 §13.1 fixes; the first one the run supports is the
  // one shown, and the last is a fallback that is true of every run that reached this page.
  // ---------------------------------------------------------------------------------------------
  'debrief.doneWell.matchedStance':
    'On claim {key}, one the scenario marks as load-bearing, you took {stance} — the stance the material warranted.',
  'debrief.doneWell.sourceTrace':
    'You ran {action} on claim {key} and then took the stance {stance} rather than accepting what the claim said.',
  'debrief.doneWell.turnResponse':
    'The Turn warranted {warranted}, and that is the response you filed.',
  'debrief.doneWell.escalation':
    'You escalated on claim {key} and said in your own words what you could not settle from the material in front of you.',
  'debrief.doneWell.frame':
    'Your frame named three assumptions the decision rests on, the first of them: “{assumption}”.',
  'debrief.doneWell.fallback': 'You completed the frame before the assistant unlocked.',

  // ---------------------------------------------------------------------------------------------
  // The two questions (FR-152)
  // ---------------------------------------------------------------------------------------------
  'debrief.questions.stanceToChange.label': 'Which single stance would you change, and to what?',
  'debrief.questions.stanceToChange.help': 'Up to 100 words.',
  'debrief.questions.doDifferently.label':
    'What will you do differently in the next run like this?',
  'debrief.questions.doDifferently.help': 'Up to 100 words.',
  'debrief.questions.submit': 'File both answers',
  'debrief.questions.answeredAt': 'Answered {when}',
  'debrief.questions.answeredNote':
    'Both answers are filed and this run is closed. In this build there is no next run to unlock.',
  'debrief.questions.readOnly':
    'Only the student who took this run can answer these two questions.',

  // ---------------------------------------------------------------------------------------------
  // The three interrogation actions, named where a sentence above interpolates one
  // ---------------------------------------------------------------------------------------------
  'debrief.action.source_trace': 'a Source Trace',
  'debrief.action.replication_check': 'a Replication Check',
  'debrief.action.decomposition_check': 'a Decomposition Check',
  'debrief.action.stakeholder_interview': 'a Stakeholder Interview',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(debrief)
