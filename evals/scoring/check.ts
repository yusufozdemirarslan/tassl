// The scoring eval suite (docs/tech/11-llm-integration.md §5, AI-003, FR-139, D-064).
//
// The PRD fixes eleven placements by hand — "accepting everything on a variant that plants a defect
// is the bottom of Calibration", "both consequential defects escalated is the top of it", "a full
// reversal on a marginal Turn is over-adaptation", "holding with a stated reason scores exactly as
// highly as warranted revision" — and `tests/unit/scoring/bands.test.ts` asserts every one of them
// against the band rules directly. This suite asserts them again through the **whole pipeline**:
// the run's trace, four graphs, the categorical facts, five real prompts rendered and answered by
// the configured provider, the draft bands, and the points.
//
// That is a different question from the unit test's, and it is the question §5 asks. The unit test
// says the rules are right given a read; this says the placements survive a model — that no prompt
// wording, no mapping of what comes back, and no degradation path moves a placement the PRD fixed.
// On the mock the answer is deterministic and the threshold is 100 percent (D-064); with a key and
// `FEATURE_AI=true` the same cases run against the real provider at 90.
//
// Each case names a fixture from `tests/fixtures/scoring/` — the thirteen runs of 14 §5 — and the
// authored answer space the brief is read against. The expectations are properties of the run, never
// the model's words: a band per dimension, a rate, a confidence shape, a flag.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { LlmProvider } from '@/server/llm/provider'
// The pure half of the pipeline, reached file by file rather than through the module's public
// `index.ts`: that door re-exports `scoreRun`, which reaches the permission helpers and so
// `server-only`, and `tsx` has no `react-server` condition to resolve it with. `evals/assistant`
// reaches `assistant/triggers` for the same reason.
import { draftBands } from '@/server/modules/scoring/bands'
import { categoricalFacts } from '@/server/modules/scoring/facts'
import { buildGraphs, type GraphInput } from '@/server/modules/scoring/graphs'
import { DEFAULT_MAPPING, computePoints } from '@/server/modules/scoring/points'
import {
  runBandReads,
  type ReadContext,
  type ReadDefenseEntry,
  type ReadDocument,
  type ReadPosition,
} from '@/server/modules/scoring/reads'
import { DIMENSIONS, currentRubric, type Dimension } from '@/server/modules/scoring/rubric'
import { outputHash, type EvalCaseResult, type EvalCheck, type EvalSuite } from '../config'

const ROOT = process.cwd()
const CASES_DIR = join(ROOT, 'evals', 'scoring', 'cases')
const FIXTURES_DIR = join(ROOT, 'tests', 'fixtures', 'scoring')

// ---------------------------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------------------------

const BandSchema = z.enum(['novice', 'developing', 'proficient', 'professional'])

const PositionSchema = z.object({
  key: z.string().min(1),
  kind: z.enum(['defensible', 'evidence_inconsistent']).default('defensible'),
  summary: z.string().min(1),
  ignoredEvidence: z.string().nullable().default(null),
  isMinimumCommitment: z.boolean().default(false),
})

const EvalCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** The requirement or PRD section this placement is fixed by; printed in the report. */
  fixes: z.string().min(1),
  /** A file name under `tests/fixtures/scoring/`, without the extension. */
  fixture: z.string().min(1),
  answerSpace: z.array(PositionSchema).default([]),
  /** What a sound answer to every defense question of this fixture covers. */
  expectedAnswerNotes: z.string().default('A sound answer says where the figure came from.'),
  /** FR-125: the run never reached its defense, which caps Ownership and nothing else. */
  defenseMissed: z.boolean().default(false),
  /**
   * PRD §7.11, FR-139: run the fixture twice — once as a hold on a Turn that warranted none, once
   * as a revision on one that warranted one — and assert the two Adaptation bands are equal.
   */
  holdEqualsRevision: z.boolean().default(false),
  /**
   * The justification the second run files (D-674).
   *
   * The two runs used to differ in the direction *alone*: the same sentence, filed as a hold and
   * then as a revision. That is not the comparison FR-139 makes, and on a real provider it could
   * not pass — the hold's justification argues that what arrived does not move the framed payback,
   * and read as the reason for a revision it argues against the move it is attached to. Six runs of
   * `band-read-adaptation` placed the hold `professional` and that pairing `developing`, six times
   * out of six, which is a model reading a contradiction correctly rather than a model preferring a
   * direction. `bands.ts` already guarantees the structural half — a response that matched its
   * warrant is Proficient before anyone reads a word, and the read can only lift it — and
   * `tests/unit/scoring/bands.test.ts` asserts that directly.
   *
   * So the second run files its own reason, of the same quality: it takes up the same sentence of
   * the Turn and names the same framed assumption, and differs only in the move it justifies. What
   * the check then proves is FR-139 as written — *holding with a stated reason scores exactly as
   * highly as warranted revision* — rather than the stronger, unpromised claim that one sentence
   * scores the same whatever it is attached to.
   */
  warrantedRevisionJustification: z.string().default(''),
  expect: z.object({
    bands: z.record(z.string(), BandSchema).default({}),
    unassessed: z.array(z.string()).default([]),
    falseChallengeRate: z.number().nullable().optional(),
    matchedShare: z.number().nullable().optional(),
    confidenceShape: z.enum(['flat_50', 'flat_100', 'rising_unchecked', 'other']).optional(),
    confidence: z.object({ frame: z.number(), lock: z.number() }).optional(),
    flags: z.array(z.string()).default([]),
    /** True when the run should produce no points at all (every dimension unassessed). */
    pointsNull: z.boolean().default(false),
  }),
})
export type ScoringEvalCase = z.infer<typeof EvalCaseSchema>

export function loadCases(): ScoringEvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => EvalCaseSchema.parse(JSON.parse(readFileSync(join(CASES_DIR, name), 'utf8'))))
}

type Fixture = GraphInput & { name: string; purpose: string }

const loadFixture = (name: string): Fixture =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf8')) as Fixture

// ---------------------------------------------------------------------------------------------
// The pipeline, as `scoring.scoreRun` runs it minus the database
// ---------------------------------------------------------------------------------------------

/** The interview as the fixture recorded it, paired question to answer by its run question id. */
function defenseOf(input: GraphInput, notes: string): ReadDefenseEntry[] {
  const answers = new Map<string, { text: string; seq: number }>()
  for (const event of input.events) {
    if (event.type !== 'defense_answer') continue
    const payload = event.payload as { run_question_id: string; text: string }
    answers.set(payload.run_question_id, { text: payload.text, seq: event.seq })
  }
  return input.events
    .filter((event) => event.type === 'defense_question')
    .map((event) => {
      const payload = event.payload as { run_question_id: string; rendered_text: string }
      const answer = answers.get(payload.run_question_id)
      return {
        question: payload.rendered_text,
        expectedAnswerNotes: notes,
        answer: answer?.text ?? '',
        followUp: null,
        followUpAnswer: null,
        answerEventSeq: answer?.seq ?? null,
      }
    })
}

const documentsOf = (input: GraphInput): ReadDocument[] =>
  input.packageVersion.documents.map((document) => ({
    id: document.id,
    title: document.title,
    role: 'supporting',
    supersededByDocumentId: null,
  }))

type PipelineResult = {
  bands: ReturnType<typeof draftBands>
  facts: ReturnType<typeof categoricalFacts>
  points: number | null
}

async function runPipeline(
  input: GraphInput,
  testCase: ScoringEvalCase,
  provider: LlmProvider,
): Promise<PipelineResult> {
  const graphs = buildGraphs(input)
  const facts = categoricalFacts(input, graphs)
  const context: ReadContext = {
    events: input.events,
    graphs,
    // A fixture is a run nobody reviewed, so it carries no FR-055 mark (D-481).
    flaggedDelegationIds: input.flaggedDelegationIds,
    turn: input.packageVersion.turn,
    positions: testCase.answerSpace as ReadPosition[],
    documents: documentsOf(input),
    claims: input.packageVersion.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceDocumentId: claim.sourceDocumentId,
    })),
    defense: defenseOf(input, testCase.expectedAnswerNotes),
    rubric: currentRubric(),
  }
  // No `runId`: `llm_calls.run_id` is a uuid pointing at a real run, and a fixture is not one. The
  // request id is the case, which is what a support case would look this call up by (§4).
  const { reads } = await runBandReads(context, provider, {
    requestId: `eval-scoring-${testCase.id}`,
  })
  const bands = draftBands({
    facts,
    graphs,
    reads,
    ...(testCase.defenseMissed ? { defenseMissed: true } : {}),
  })
  const points = computePoints(
    Object.fromEntries(
      DIMENSIONS.map((dimension) => [dimension, bands[dimension].band ?? 'unassessed']),
    ),
    DEFAULT_MAPPING,
  )
  return { bands, facts, points }
}

/**
 * The same run as a warranted revision (PRD §7.11): the Turn's warrant, the response, and the
 * reason the student wrote for it, which is the one thing A.6 reads (D-674).
 */
function asWarrantedRevision(input: GraphInput, justification: string): GraphInput {
  return {
    ...input,
    packageVersion: {
      ...input.packageVersion,
      turn:
        input.packageVersion.turn === null
          ? null
          : { ...input.packageVersion.turn, warrantsChange: true, proportionateResponse: 'revise' },
    },
    events: input.events.map((event) =>
      event.type === 'turn_response_locked'
        ? {
            ...event,
            payload: {
              ...event.payload,
              response: 'revise',
              ...(justification === '' ? {} : { justification }),
            },
          }
        : event,
    ),
  }
}

// ---------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------

const check = (name: string, ok: boolean, detail?: string): EvalCheck =>
  detail === undefined ? { name, ok } : { name, ok, detail }

const near = (value: number | null, expected: number): boolean =>
  value !== null && Math.abs(value - expected) < 0.0005

async function runCase(testCase: ScoringEvalCase, provider: LlmProvider): Promise<EvalCaseResult> {
  const input = loadFixture(testCase.fixture)
  const { bands, facts, points } = await runPipeline(input, testCase, provider)
  const checks: EvalCheck[] = []

  for (const [dimension, expected] of Object.entries(testCase.expect.bands)) {
    const band = bands[dimension as Dimension]
    checks.push(
      check(
        `${dimension} is ${expected}`,
        band.band === expected,
        `got ${band.band ?? `unassessed (${band.reason})`}`,
      ),
    )
  }

  for (const dimension of testCase.expect.unassessed) {
    const band = bands[dimension as Dimension]
    checks.push(
      check(
        `${dimension} is unassessed`,
        band.status === 'unassessed' && band.band === null,
        `got ${band.band ?? band.status}`,
      ),
    )
  }

  if (testCase.expect.falseChallengeRate !== undefined) {
    const expected = testCase.expect.falseChallengeRate
    checks.push(
      check(
        `false challenge rate is ${String(expected)}`,
        expected === null ? facts.fcr === null : near(facts.fcr, expected),
        `got ${String(facts.fcr)}`,
      ),
    )
  }

  if (testCase.expect.matchedShare !== undefined) {
    const expected = testCase.expect.matchedShare
    checks.push(
      check(
        `matched share is ${String(expected)}`,
        expected === null ? facts.matchedShare === null : near(facts.matchedShare, expected),
        `got ${String(facts.matchedShare)}`,
      ),
    )
  }

  if (testCase.expect.confidenceShape !== undefined) {
    checks.push(
      check(
        `confidence line is ${testCase.expect.confidenceShape}`,
        facts.confidenceShape === testCase.expect.confidenceShape,
        `got ${facts.confidenceShape}`,
      ),
    )
  }

  if (testCase.expect.confidence !== undefined) {
    const { frame, lock } = testCase.expect.confidence
    checks.push(
      check(
        `confidence runs ${String(frame)} to ${String(lock)}`,
        facts.confidence.frame === frame && facts.confidence.lock === lock,
        `got ${String(facts.confidence.frame)} to ${String(facts.confidence.lock)}`,
      ),
    )
  }

  for (const flag of testCase.expect.flags) {
    const raised =
      flag === 'nothing_answered'
        ? facts.nothingAnswered
        : flag === 'all_novice'
          ? DIMENSIONS.every((dimension) => bands[dimension].band === 'novice')
          : DIMENSIONS.every((dimension) => bands[dimension].band === 'professional')
    checks.push(check(`flag ${flag} is raised`, raised))
  }

  if (testCase.expect.pointsNull) {
    checks.push(check('the run produces no points', points === null, `got ${String(points)}`))
  }

  if (testCase.holdEqualsRevision) {
    const revised = await runPipeline(
      asWarrantedRevision(input, testCase.warrantedRevisionJustification),
      testCase,
      provider,
    )
    checks.push(
      check(
        'holding with a reason bands exactly as warranted revision does',
        bands.adaptation.band === revised.bands.adaptation.band,
        `hold ${String(bands.adaptation.band)} vs revision ${String(revised.bands.adaptation.band)}`,
      ),
    )
  }

  // Two properties every case keeps, whatever it is about. A band read from a model is provisional
  // and cites the events behind it (FR-137, FR-138); a rationale never names the answer key (D-396).
  const drafted = DIMENSIONS.map((dimension) => bands[dimension]).filter(
    (band) => band.status === 'drafted',
  )
  checks.push(
    check(
      'every drafted band cites the events it was read from',
      drafted.every((band) => band.evidenceEventSeqs.length > 0),
    ),
  )
  // D-396's exact list, and no wider. `warrants_change` and `proportionate_response` are the two
  // fields 12 §8.1 forbids in a student payload in any state, and "planted" is the word for the one
  // thing the debrief never names. A warranted *stance* is not on the list: it is revealed to the
  // student once the run is scored (D-117), and `band.verification.defectFree` says so in prose.
  checks.push(
    check(
      'no rationale names the Turn’s warrant or a planted claim (D-396)',
      DIMENSIONS.every((dimension) => {
        const text = bands[dimension].rationale.toLowerCase()
        return !['warrants_change', 'proportionate_response', 'planted', 'defective'].some((word) =>
          text.includes(word),
        )
      }),
    ),
  )

  // What the model actually wrote for this case, as a digest (§5, D-661): the five rationales are
  // the only prose a band read produces, so hashing them fingerprints the answer without printing a
  // word of it. Everything above reports a band, a rate or a flag, which the model did not write.
  return {
    id: testCase.id,
    title: `${testCase.title} (${testCase.fixes})`,
    outputHash: outputHash(...DIMENSIONS.map((dimension) => bands[dimension].rationale)),
    checks,
  }
}

export const scoringSuite: EvalSuite = {
  name: 'scoring',
  async run(provider: LlmProvider): Promise<EvalCaseResult[]> {
    const results: EvalCaseResult[] = []
    for (const testCase of loadCases()) results.push(await runCase(testCase, provider))
    return results
  },
}
