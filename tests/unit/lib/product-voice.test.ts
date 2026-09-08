import { describe, expect, it } from 'vitest'
import { VOCABULARIES } from '@/lib/product-voice'
import { scan } from '../support/product-voice'

// D-514: the forbidden-word scan covers **every** namespace, and says out loud where the product's
// own vocabulary collides with it.
//
// D-450, D-457 and D-468 held `debrief.`, `review.` and `record.` to three vocabularies with no
// allowlist, and D-457 argued the two words the reviewer's screen needs — the `Scored` state chip
// and a claim's failure family — were safely elsewhere. "Elsewhere" was 39 unscanned namespaces,
// and `RunStateChip` renders `run.stateScored` on the student's own home and run list. So the
// exemption was not structural; it was a place the scan did not look.
//
// **The property this file has to keep** is that a *new* forbidden word cannot be added to a
// student-facing string without something failing. A blanket scan with a per-term allowlist would
// destroy it — allowing "careless" anywhere allows it everywhere. So the coverage is two tiers, and
// neither tier turns a term off:
//
//   **Tier one — the judgment surfaces, no exemption of any kind.** `debrief.`, `review.`, `record.`
//   and `band.` are the namespaces whose strings are composed into what a person is told about a
//   run. `band.` is here because `bands.ts` splices these sentences into `run_bands.rationale`,
//   which the student's debrief and the Judgment Record render verbatim — and it was not clean:
//   `band.adaptation.over` and `.under` read "scored exactly as failing to adapt is" and were
//   printed on both surfaces. They now read "placed exactly as a response that went less far is".
//
//   **Tier two — every other namespace, scanned in full**, with one structural exemption and a
//   pinned inventory of what remains:
//
//     * *the exemption* is a hit on a **key name** whose word is in the `fail…` family. This
//       codebase names every error toast `…Failed` (`run.startFailed`, `ui.formLoadFailed`) and
//       every authored defect attribute `failure…` (`confirm.field.failureFamily`). An identifier
//       names an operation that did not complete or a property of a *claim*, never a person, and it
//       is never rendered. The **value** under every one of those keys is scanned with no
//       exemption, which is where the sentence a person reads actually lives.
//     * *the inventory* below pins `path + word` pairs, one row per collision, each with the reason
//       the product is entitled to that word. It is not an allowlist: "scored" is pinned at
//       `run.stateScored` and nowhere else, so the same word in a new string fails, and a new word
//       in a pinned string fails. A row whose hit has gone is a failure too, so the table cannot
//       rot into a list of words nobody checks.
//
// The reasons are a closed set. Inventing an eighth is a deliberate act with a name on it, rather
// than a sentence someone talked themselves into.

/** Why the product is entitled to a word its own voice rules forbid. */
type Reason =
  /** The sentence denies the forbidden thing exists: "There is no total score, no rank". */
  | 'negation'
  /** The run's own lifecycle state, or the job and notification type named after it. */
  | 'state_name'
  /** An operation, a job, a document or the assistant that did not complete. Never a person. */
  | 'system_failure'
  /** A scenario author's vocabulary for a claim or a package element, on an authoring surface. */
  | 'authored_attribute'
  /** The mean over the assessed dimensions, which PRD §7.19 requires be named as such. */
  | 'arithmetic'
  /** The word is not comparing this student with anyone: two answers, a cohort that does not exist. */
  | 'not_a_comparison'
  /** The word is not being used in the forbidden sense at all: "frozen for good", "on top of". */
  | 'ordinary_english'

type Row = { path: string; word: string; why: Reason }

/**
 * The namespaces held to the scan with nothing exempted, by key prefix.
 *
 * `packageConfirm`'s keys begin `confirm.`, so the tier is decided by the key a string actually
 * carries rather than by the module it is written in — which is what the reader of a stack trace
 * has in front of them too.
 */
const STRICT_PREFIXES = ['debrief.', 'review.', 'record.', 'band.'] as const

/** Every message module, so a namespace added later is scanned without anyone remembering to. */
const MODULES = import.meta.glob('../../../src/lib/i18n/messages/*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>

const CATALOGUES: { file: string; catalogue: Record<string, string> }[] = Object.entries(MODULES)
  .flatMap(([file, module]) =>
    Object.values(module)
      .filter(
        (value): value is Record<string, string> =>
          typeof value === 'object' &&
          value !== null &&
          Object.values(value).every((entry) => typeof entry === 'string'),
      )
      .map((catalogue) => ({ file: file.slice(file.lastIndexOf('/') + 1), catalogue })),
  )
  .sort((a, b) => a.file.localeCompare(b.file))

const isStrict = (path: string): boolean =>
  STRICT_PREFIXES.some((prefix) => path.startsWith(prefix))

/** The one structural exemption, stated as a predicate rather than as a list of words. */
const isFailureIdentifier = (finding: { path: string; word: string }): boolean =>
  finding.path.endsWith(' (key)') && /^fail/i.test(finding.word)

/**
 * Every place the product's own vocabulary collides with a forbidden word, and why it may.
 *
 * Read it as a list of sentences a reviewer signed off on, not as a list of words that are allowed.
 */
const INVENTORY: readonly Row[] = [
  // The claim object a reviewer reads: an authored property of a *claim*, never of a person.
  { path: 'claimObject.weaklySourcedLabel (key)', word: 'weakly', why: 'authored_attribute' },
  { path: 'claimObject.weaklySourcedLabel', word: 'Weakly', why: 'authored_attribute' },
  { path: 'claimObject.familyLabel', word: 'Failure', why: 'authored_attribute' },

  // The course settings screen: two policy descriptions that deny an effect, and the mean itself.
  { path: 'courses.policyDeclaredDescription', word: 'score', why: 'negation' },
  { path: 'courses.policyInEnvironmentDescription', word: 'scoring', why: 'negation' },
  { path: 'courses.mappingDescription', word: 'mean', why: 'arithmetic' },

  // "Your run goes to scoring from here" — the pipeline, by its name.
  { path: 'defense.finishConfirmBody', word: 'scoring', why: 'state_name' },

  // Notifications name the state that caused them. `run_scored` is a column value (SYS-010).
  { path: 'notifications.emptyBody', word: 'scored', why: 'state_name' },
  { path: 'notifications.type.generation_failed', word: 'failed', why: 'system_failure' },
  { path: 'notifications.type.run_scored', word: 'scored', why: 'state_name' },
  { path: 'notifications.runScored.title (key)', word: 'Scored', why: 'state_name' },
  { path: 'notifications.runScored.title', word: 'scored', why: 'state_name' },
  { path: 'notifications.runScored.body (key)', word: 'Scored', why: 'state_name' },
  { path: 'notifications.runScoredReviewer.title (key)', word: 'Scored', why: 'state_name' },
  { path: 'notifications.runScoredReviewer.body (key)', word: 'Scored', why: 'state_name' },

  // The authoring surfaces. "Frozen for good", "a decision on top of this one", and the authored
  // attributes of a claim; no student reads any of it.
  { path: 'confirm.draftDescription', word: 'good', why: 'ordinary_english' },
  { path: 'confirm.confirmDialogBody', word: 'good', why: 'ordinary_english' },
  { path: 'confirm.lockedBody', word: 'top of', why: 'ordinary_english' },
  { path: 'confirm.field.weaklySourced (key)', word: 'weakly', why: 'authored_attribute' },
  { path: 'confirm.field.weaklySourced', word: 'Weakly', why: 'authored_attribute' },
  { path: 'confirm.field.conceptKeyHint', word: 'fails', why: 'authored_attribute' },
  { path: 'confirm.field.rationaleHint', word: 'scored', why: 'state_name' },
  { path: 'confirm.field.failureFamily', word: 'Failure', why: 'authored_attribute' },
  { path: 'confirm.field.difficultyUncalibratedHint', word: 'cohort', why: 'not_a_comparison' },
  { path: 'packageImport.doneWithFailures', word: 'fail', why: 'authored_attribute' },
  { path: 'packageImport.importedWithFailures', word: 'fail', why: 'authored_attribute' },
  { path: 'packageVersion.rulesFailing', word: 'fail', why: 'authored_attribute' },
  { path: 'packageVersion.reviewPerElementHelp', word: 'average', why: 'arithmetic' },
  { path: 'packages.warningReadinessConceptHelp', word: 'scored', why: 'state_name' },

  // The Readiness Check exists to be told it does not count, so it says so four times.
  { path: 'readiness.description', word: 'scored', why: 'negation' },
  { path: 'readiness.skipBody', word: 'failure', why: 'system_failure' },
  { path: 'readiness.skipBody', word: 'fails', why: 'system_failure' },
  { path: 'readiness.skipBody', word: 'scored', why: 'negation' },
  { path: 'readiness.resultDescription', word: 'score', why: 'negation' },
  { path: 'readiness.resultDescription', word: 'comparison', why: 'negation' },

  // The run's own screens: its state, the arithmetic it is priced by, and FR-131 denied in full.
  { path: 'run.forcedFailureNotArmable', word: 'fail', why: 'system_failure' },
  { path: 'run.stateScored (key)', word: 'Scored', why: 'state_name' },
  { path: 'run.stateScored', word: 'Scored', why: 'state_name' },
  { path: 'run.policyNoPenalty', word: 'misconduct', why: 'negation' },
  { path: 'run.mappingNote', word: 'mean', why: 'arithmetic' },
  { path: 'run.mappingNote', word: 'score', why: 'negation' },
  { path: 'run.mappingNote', word: 'rank', why: 'negation' },
  { path: 'run.mappingNote', word: 'percentile', why: 'negation' },
  { path: 'run.clockUncalibratedNote', word: 'cohort', why: 'not_a_comparison' },
  { path: 'run.readinessBody', word: 'scored', why: 'negation' },
  { path: 'run.statusScoringTitle (key)', word: 'Scoring', why: 'state_name' },
  { path: 'run.statusScoringTitle', word: 'scored', why: 'state_name' },
  { path: 'run.statusScoringBody (key)', word: 'Scoring', why: 'state_name' },
  { path: 'run.statusScoredTitle (key)', word: 'Scored', why: 'state_name' },
  { path: 'run.statusScoredBody (key)', word: 'Scored', why: 'state_name' },
  { path: 'run.statusDefenseCompleteBody', word: 'Scoring', why: 'state_name' },
  { path: 'run.statusVoidedBody', word: 'scored', why: 'negation' },
  { path: 'run.reviewDeleteBody', word: 'good', why: 'ordinary_english' },
  { path: 'run.reviewReplayNote', word: 'scored', why: 'state_name' },

  // The legal pages (UI-006). The only namespace whose job includes naming the things the product
  // does not do, so every collision here is a denial: FR-006's sentence, FR-131's "no total, no
  // rank and no percentile", and the one place a run's own lifecycle is named to a reader who has
  // not signed in. `tests/unit/copy/never-accuses.test.ts` pins the misconduct row a second time,
  // from the other direction: it is the *only* place in the catalogue that word may be written.
  { path: 'legal.noMisconductFindings (key)', word: 'Misconduct', why: 'negation' },
  { path: 'legal.noMisconductFindings', word: 'misconduct', why: 'negation' },
  { path: 'legal.privacy.limits.noTotals', word: 'rank', why: 'negation' },
  { path: 'legal.privacy.limits.noTotals', word: 'percentile', why: 'negation' },
  { path: 'legal.privacy.limits.hidden', word: 'scored', why: 'state_name' },

  // "The name your instructors and classmates see beside your work" — who sees it, not a ranking.
  { path: 'settings.profileDescription', word: 'classmates', why: 'not_a_comparison' },

  // "A low number with a reason behind it reads better than a confident guess" — two answers.
  { path: 'workspace.confidenceHint', word: 'better than', why: 'not_a_comparison' },
  { path: 'workspace.declarationNoPenalty', word: 'misconduct', why: 'negation' },
  { path: 'workspace.briefConfidenceHint', word: 'better than', why: 'not_a_comparison' },
]

const keyOf = (row: { path: string; word: string }): string => `${row.path} :: ${row.word}`

/** Every finding in the whole catalogue, tier one and tier two together. */
function allFindings(): { path: string; word: string; rule: string }[] {
  return CATALOGUES.flatMap(({ catalogue }) => scan(catalogue))
}

describe('the whole message catalogue is scanned for the product’s voice', () => {
  it('scans every namespace module there is', () => {
    // Enough modules that a glob that silently matched nothing would be caught, and the count is
    // the file count so a namespace added later is scanned rather than skipped.
    expect(CATALOGUES.length).toBeGreaterThanOrEqual(35)
    const keys = CATALOGUES.flatMap(({ catalogue }) => Object.keys(catalogue))
    expect(keys.length).toBeGreaterThan(1500)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is scanned against all three vocabularies, not a subset of them', () => {
    expect(VOCABULARIES.map((vocabulary) => vocabulary.name)).toEqual([
      'misconduct',
      'character and motive',
      'ranking and comparison',
    ])
  })

  it('finds no forbidden word at all on the four judgment surfaces', () => {
    // No exemption and no inventory: `debrief.`, `review.`, `record.` and `band.` are the sentences
    // a person is told about a run, and `band.` reaches both student surfaces through
    // `run_bands.rationale`.
    expect(allFindings().filter((finding) => isStrict(finding.path))).toEqual([])
  })

  it('leaves nothing outside the exemption and the inventory', () => {
    const outstanding = allFindings()
      .filter((finding) => !isStrict(finding.path))
      .filter((finding) => !isFailureIdentifier(finding))
      .filter((finding) => !INVENTORY.some((row) => keyOf(row) === keyOf(finding)))
    expect(outstanding).toEqual([])
  })

  it('has no inventory row whose collision has gone', () => {
    // The table cannot rot into a list of words nobody checks: a string rewritten to drop its
    // forbidden word takes its row with it.
    const found = new Set(allFindings().map(keyOf))
    expect(INVENTORY.filter((row) => !found.has(keyOf(row)))).toEqual([])
  })

  it('exempts an identifier and never the sentence under it', () => {
    expect(isFailureIdentifier({ path: 'run.startFailed (key)', word: 'Failed' })).toBe(true)
    // The value under that same key is scanned like every other value.
    expect(isFailureIdentifier({ path: 'run.startFailed', word: 'failed' })).toBe(false)
    // And the exemption is the `fail…` family alone: no other word is ever excused by being a key.
    expect(isFailureIdentifier({ path: 'run.carelessThing (key)', word: 'careless' })).toBe(false)
  })
})

describe('the coverage can still fail', () => {
  it.each([
    ['misconduct', 'workspace.planted', 'The student was caught using an outside tool.'],
    ['character and motive', 'run.planted', 'This run was careless about the Source Trace.'],
    ['ranking and comparison', 'settings.planted', 'You are above the cohort average.'],
    ['character and motive', 'band.planted', 'The answers were poor.'],
  ])('finds a planted %s sentence at %s', (rule, path, planted) => {
    const findings = scan({ [path]: planted })
    expect(findings.map((finding) => finding.rule)).toContain(rule)
    // And it is outside both escapes: not an identifier, and not in the inventory.
    const escaped = findings
      .filter((finding) => !isStrict(finding.path))
      .filter(
        (finding) =>
          isFailureIdentifier(finding) || INVENTORY.some((row) => keyOf(row) === keyOf(finding)),
      )
    expect(escaped).toEqual([])
  })

  it('fails on a forbidden word added to a string the inventory already pins', () => {
    // The inventory pins `path + word`, not the path — so a *second* word in a pinned string is a
    // new finding, and the table does not shelter it.
    const findings = scan({
      'run.stateScored': 'Scored, and the student was careless.',
    })
    const outstanding = findings.filter(
      (finding) => !INVENTORY.some((row) => keyOf(row) === keyOf(finding)),
    )
    expect(outstanding.map((finding) => finding.word)).toEqual(['careless'])
  })

  it('fails on a pinned word moved to a string the inventory does not pin', () => {
    const findings = scan({ 'run.someNewNote': 'There is a rank in Tassl after all.' })
    expect(
      findings.filter((finding) => INVENTORY.some((row) => keyOf(row) === keyOf(finding))),
    ).toEqual([])
  })
})
