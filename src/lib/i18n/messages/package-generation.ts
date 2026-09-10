// UI-042, the generation progress screen (FR-191, FR-198, AI-001).
//
// One namespace because one Client Component reads all of it: the seven step rows, the report of
// what the package still does not satisfy, and the two controls that start the pipeline. A screen
// nobody but an author of the institution ever opens (16 §3.4).
//
// Three rules govern the wording.
//
// **Nothing here is a verdict on a person.** A step that stopped is a job that did not finish, and
// that is what it is called — `src/lib/product-voice.ts` forbids the other word and is right to:
// the vocabulary a student is never shown should not be the vocabulary an author is trained in.
//
// **No rule is restated.** `validatePackage` writes the sentence a broken rule deserves, with the
// element keys in it; this file names the panel and stops. The one place a code has no sentence is
// a rule the package no longer breaks, and `ruleSettled` says exactly that rather than inventing
// one.
//
// **A control says what it does.** The retry resumes at the first step that has not finished — it
// does not start again at step 1, which would rewrite rows the later steps depend on (D-683) — and
// it does not touch an element an author has already confirmed. Both halves are on the screen
// beside the button, because the second half is the one that decides whether the press is safe.
import { scopedT } from '../scoped'

export const packageGeneration = {
  // ---------------------------------------------------------------------------------------
  // The screen
  // ---------------------------------------------------------------------------------------
  'generation.metaTitle': 'Generating {title}, version {version}',
  'generation.backToVersion': 'Back to version {version}',
  'generation.descriptionNotStarted':
    'Nothing has been drafted into version {version} yet. Generation reads the seed case and writes the version in seven steps; every element it writes is a draft until an author reads it and decides on it.',
  'generation.descriptionRunning':
    'Seven steps are writing version {version} from the seed case. This screen asks the server where they have got to every five seconds.',
  'generation.descriptionComplete':
    'All seven steps finished. Every element is a draft: read each one in the confirmation workspace and record a decision before version {version} can be confirmed.',
  'generation.descriptionStopped':
    'A step did not finish, so the steps after it did not run. What it could not satisfy is below, with the element it was writing.',
  'generation.descriptionFrozen':
    'Version {version} is confirmed. Nothing can be generated into it; a change is a new version.',

  // ---------------------------------------------------------------------------------------
  // The seven steps
  // ---------------------------------------------------------------------------------------
  'generation.stepsTitle': 'The seven steps',
  'generation.stepsDescription':
    'Each step asks the model once, writes the elements it owns, and checks them against the package rules for those elements. A step that does not satisfy them runs a second time with the unmet rules restated; a second refusal stops the pipeline there.',
  'generation.stepPosition': 'Step {number} of 7',
  'generation.step.reskin_brief_stakeholders': 'Re-skin, brief and stakeholders',
  'generation.step.documents': 'Evidence Room documents',
  'generation.step.answer_space_fields': 'Answer space and named fields',
  'generation.step.claims_and_states': 'Claims and their variant states',
  'generation.step.turn_and_probe': 'The Turn and the probe',
  'generation.step.question_bank_and_counterfactual': 'Question bank and counterfactual',
  'generation.step.readiness_items': 'Readiness Check items',
  'generation.status.queued': 'Waiting',
  'generation.status.running': 'Running',
  'generation.status.succeeded': 'Done',
  'generation.status.failed': 'Did not finish',
  'generation.passSecond': 'Second pass, with the unmet rules restated',
  'generation.passLabel': 'Pass',
  'generation.tokensLabel': 'Tokens',
  'generation.tokensValue': '{input} in, {output} out',
  'generation.costLabel': 'Cost estimate',
  'generation.costValue': 'US${amount}',
  'generation.costFree': 'US$0.00, on the mock provider',
  'generation.notAsked': 'Not asked yet',
  'generation.durationLabel': 'Took',
  'generation.durationSeconds': '{seconds} s',
  'generation.durationMinutes': '{minutes} min {seconds} s',
  'generation.elapsed': 'running for {duration}',
  'generation.totalTokens': 'Tokens so far',
  'generation.totalCost': 'Cost estimate so far',
  'generation.totalPasses': 'Passes run',

  // ---------------------------------------------------------------------------------------
  // A step that stopped
  // ---------------------------------------------------------------------------------------
  'generation.stoppedTitle': 'Generation stopped',
  'generation.stepRulesTitle': 'What this step could not satisfy',
  'generation.ruleSettled':
    'The package no longer breaks this rule. It was unmet when the step ran, and something has changed it since.',
  'generation.stepErrorTitle': 'What the step answered',
  'generation.retry': 'Run generation again',
  'generation.retryPending': 'Starting…',
  'generation.retryNote':
    'Generation resumes at the first step that has not finished; the steps already done are not run again. Every element you have confirmed is kept exactly as it is, and every other element a step reaches is replaced.',

  // ---------------------------------------------------------------------------------------
  // Starting it
  // ---------------------------------------------------------------------------------------
  'generation.startTitle': 'Generation has not run on this version',
  'generation.start': 'Start generation',
  'generation.startPending': 'Starting…',
  'generation.startNote':
    'Seven steps, one model call each, from the seed case recorded with this version. Nothing they write is part of a package until an author reads every element and decides on it.',
  'generation.startedToast': 'Generation started.',
  'generation.readOnlyTitle': 'This version is not yours to generate',
  'generation.readOnlyBody':
    'Only an instructor or a scenario author of this institution runs generation on a package. You can read this version and its record.',

  // ---------------------------------------------------------------------------------------
  // The package rules, once the seven steps are through
  // ---------------------------------------------------------------------------------------
  'generation.rulesTitle': 'Rules this package does not meet yet',
  'generation.rulesBody':
    'The seven steps finished and these rules are still unmet. Open the element each one names and put it right by hand; a rule the pipeline could not satisfy is one an author settles.',
  'generation.rulesOkTitle': 'Every package rule is met',
  'generation.rulesOkBody':
    'Version {version} is a complete draft. Read every element, record a decision on each, and the version can be confirmed and frozen.',
  'generation.ruleElements': 'elements {keys}',
  'generation.openElement': 'Open {key}',
  'generation.openWorkspace': 'Open confirmation workspace',
  'generation.openWorkspaceNote':
    'The pipeline stopped, so some elements are missing and others were never checked. The workspace is where you write what is missing and decide on what is there.',

  // ---------------------------------------------------------------------------------------
  // The poll, and what it announces
  // ---------------------------------------------------------------------------------------
  'generation.liveRunning': 'Step {number} of 7, {step}, is running.',
  'generation.liveComplete': 'All seven generation steps finished.',
  'generation.liveStopped': 'Generation stopped at step {number}, {step}.',
} as const

export const t = scopedT(packageGeneration)
