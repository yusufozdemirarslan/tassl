// `completePackage` (docs/tech/10-backend-spec-modules.md §4, §5; D-750).
//
// One contract, asserted from as many directions as there are ways to break it:
//
//     validateExport(completePackage(document)).ok === true
//
// for every document `PackageExportSchema` parses. The generation pipeline runs this function
// against the validator in a loop and only reports a package finished when the loop comes back
// clean, so a case this file does not cover is a case an author meets as a rule code on a screen —
// which is the thing D-750 exists to make impossible.
//
// The tests are therefore adversarial rather than illustrative: the empty document, a document
// whose every element is present but wrong, and a document that is already valid (which must come
// back untouched, because the author reviews the model's work and not a rewrite of it).
import { describe, expect, it } from 'vitest'
import { completePackage } from '@/server/modules/scenarios/complete'
import { PackageExportSchema, type PackageExport } from '@/server/modules/scenarios/schema'
import { validateExport } from '@/server/modules/scenarios/validate-export'

const BASE_DATE = '2026-03-02'

/**
 * The least a document can be and still parse: the schema's own defaults, plus what it requires.
 *
 * Zod spells an optional key `k?: T | undefined` and the export type spells it `k?: T`, which under
 * `exactOptionalPropertyTypes` are different types; `scenarios/service.ts` crosses the same gap
 * with the same one-line cast, at the one place a parsed document becomes a `PackageExport`.
 */
function emptyDocument(): PackageExport {
  return PackageExportSchema.parse({
    schemaVersion: 1,
    package: { title: 'Kavena Loop revenue model', familyKey: 'kavena-loop' },
    version: { conceptSet: ['evidence quality', 'provenance', 'denominators', 'recency'] },
  }) as PackageExport
}

const complete = (document: PackageExport): PackageExport =>
  completePackage(document, { baseDate: BASE_DATE })

/** The rule codes a completed document still breaks; empty is the contract. */
const brokenBy = (document: PackageExport): string[] =>
  validateExport(document).failures.map((failure) => failure.code)

describe('completePackage', () => {
  it('completes the empty document into one that breaks no rule', () => {
    expect(brokenBy(complete(emptyDocument()))).toEqual([])
  })

  it('returns a document the export schema still parses', () => {
    const completed = complete(emptyDocument())
    const reparsed = PackageExportSchema.safeParse(completed)
    expect(reparsed.success ? [] : reparsed.error.issues).toEqual([])
  })

  it('is idempotent: completing a completed document changes nothing', () => {
    const once = complete(emptyDocument())
    expect(complete(once)).toEqual(once)
  })

  it('is pure: the same input always yields the same output', () => {
    expect(complete(emptyDocument())).toEqual(complete(emptyDocument()))
  })

  it('leaves a document that already breaks no rule alone', () => {
    const already = complete(emptyDocument())
    expect(complete(already)).toEqual(already)
  })

  // -------------------------------------------------------------------------------------------
  // The shapes a real model produces: everything present, one thing short
  // -------------------------------------------------------------------------------------------

  it('fills a question bank that is missing its figure-provenance question', () => {
    const base = complete(emptyDocument())
    const stripped: PackageExport = {
      ...base,
      defenseQuestions: base.defenseQuestions.filter(
        (question) => question.kind !== 'figure_provenance',
      ),
    }
    expect(brokenBy(stripped)).toContain('QUESTION_BANK_INCOMPLETE')

    const fixed = complete(stripped)
    expect(brokenBy(fixed)).toEqual([])
    expect(
      fixed.defenseQuestions.some(
        (question) =>
          question.kind === 'figure_provenance' &&
          question.claimKey === null &&
          question.template.includes('{figure}'),
      ),
    ).toBe(true)
  })

  it('fills a Readiness Check that is four items short of the split', () => {
    const base = complete(emptyDocument())
    const stripped: PackageExport = { ...base, readinessItems: base.readinessItems.slice(0, 12) }
    expect(brokenBy(stripped)).toContain('READINESS_SPLIT')

    const fixed = complete(stripped)
    expect(brokenBy(fixed)).toEqual([])
    expect(fixed.readinessItems).toHaveLength(16)
    const counts = { foundation: 0, defect_concept: 0, ai_behavior: 0 }
    for (const item of fixed.readinessItems) counts[item.category] += 1
    expect(counts).toEqual({ foundation: 6, defect_concept: 4, ai_behavior: 6 })
  })

  it('rewrites a template that names a placeholder nothing fills', () => {
    const base = complete(emptyDocument())
    const first = base.defenseQuestions[0]
    expect(first).toBeDefined()
    const broken: PackageExport = {
      ...base,
      defenseQuestions: base.defenseQuestions.map((question, index) =>
        index === 0
          ? { ...question, template: 'What made you take {stance_text} here?' }
          : question,
      ),
    }
    expect(brokenBy(broken)).toContain('QUESTION_TEMPLATE_PLACEHOLDER')
    expect(brokenBy(complete(broken))).toEqual([])
  })

  it('cuts a counterfactual of five sentences down to three', () => {
    const base = complete(emptyDocument())
    const long =
      'One thing happened. A second thing happened. A third thing happened. ' +
      'A fourth thing happened. A fifth thing happened.'
    const broken: PackageExport = {
      ...base,
      version: { ...base.version, debriefCounterfactual: long },
    }
    expect(brokenBy(broken)).toContain('COUNTERFACTUAL_SENTENCES')
    expect(brokenBy(complete(broken))).toEqual([])
  })

  it('plants exactly one defect when the model planted none', () => {
    const base = complete(emptyDocument())
    const unplanted: PackageExport = {
      ...base,
      variants: base.variants.map((variant) => ({
        ...variant,
        claimStates: variant.claimStates.map((state) => ({
          ...state,
          planted: false,
          evidenceStatus: 'sound' as const,
          failureFamily: null,
        })),
      })),
    }
    expect(brokenBy(unplanted)).toContain('DEFECTIVE_VARIANT_PLANT')

    const fixed = complete(unplanted)
    expect(brokenBy(fixed)).toEqual([])
    const defective = fixed.variants.find((variant) => variant.key === 'defective')
    const planted = defective?.claimStates.filter((state) => state.planted) ?? []
    expect(planted).toHaveLength(1)
    expect(planted[0]?.evidenceStatus).toBe('defective')
  })

  it('plants exactly one defect when the model planted three', () => {
    const base = complete(emptyDocument())
    const overPlanted: PackageExport = {
      ...base,
      variants: base.variants.map((variant) => ({
        ...variant,
        claimStates: variant.claimStates.map((state, index) =>
          variant.key === 'defective' && index < 3
            ? {
                ...state,
                planted: true,
                evidenceStatus: 'defective' as const,
                failureFamily: 'stale_evidence' as const,
              }
            : state,
        ),
      })),
    }
    expect(brokenBy(overPlanted)).toContain('DEFECTIVE_VARIANT_PLANT')

    const fixed = complete(overPlanted)
    expect(brokenBy(fixed)).toEqual([])
    const defective = fixed.variants.find((variant) => variant.key === 'defective')
    expect(defective?.claimStates.filter((state) => state.planted)).toHaveLength(1)
  })

  it('repoints a Source Trace at a document that is in the room', () => {
    const base = complete(emptyDocument())
    const dangling: PackageExport = {
      ...base,
      variants: base.variants.map((variant) => ({
        ...variant,
        claimStates: variant.claimStates.map((state) =>
          state.verificationPaths.source_trace
            ? {
                ...state,
                verificationPaths: {
                  ...state.verificationPaths,
                  source_trace: {
                    ...state.verificationPaths.source_trace,
                    document_key: 'NOWHERE',
                  },
                },
              }
            : state,
        ),
      })),
    }
    expect(brokenBy(dangling)).toContain('TRACE_DOCUMENT_MISSING')
    expect(brokenBy(complete(dangling))).toEqual([])
  })

  it('completes an Evidence Room of one document and one of twenty', () => {
    const base = complete(emptyDocument())
    const one: PackageExport = { ...base, documents: base.documents.slice(0, 1) }
    // Claims and traces still name documents the cut removed; the completion repoints them.
    expect(brokenBy(complete(one))).toEqual([])
    expect(complete(one).documents.length).toBeGreaterThanOrEqual(6)

    const many: PackageExport = {
      ...base,
      documents: Array.from({ length: 20 }, (_, index) => ({
        key: `X${index}`,
        title: `Note ${index}`,
        author: 'Someone',
        datedOn: '2026-02-01',
        role: 'supporting' as const,
        position: index,
        body: 'A short note.',
        supersededByKey: null,
        stakeholderKey: null,
      })),
    }
    const fixed = complete(many)
    expect(brokenBy(fixed)).toEqual([])
    expect(fixed.documents.length).toBeLessThanOrEqual(12)
  })

  it('cuts a document body that runs past the word limit', () => {
    const base = complete(emptyDocument())
    const first = base.documents[0]
    expect(first).toBeDefined()
    const long: PackageExport = {
      ...base,
      documents: base.documents.map((document, index) =>
        index === 0 ? { ...document, body: 'word '.repeat(2500) } : document,
      ),
    }
    expect(brokenBy(long)).toContain('DOCUMENT_TOO_LONG')
    expect(brokenBy(complete(long))).toEqual([])
  })

  it('cuts a brief that runs past two hundred words', () => {
    const base = complete(emptyDocument())
    const long: PackageExport = {
      ...base,
      version: { ...base.version, brief: 'word '.repeat(400) },
    }
    expect(brokenBy(long)).toContain('BRIEF_TOO_LONG')
    expect(brokenBy(complete(long))).toEqual([])
  })

  it('completes a claim set of one claim into six with the mix the rules ask for', () => {
    const base = complete(emptyDocument())
    const firstClaim = base.claims[0]
    expect(firstClaim).toBeDefined()
    const thin: PackageExport = {
      ...base,
      claims: base.claims.slice(0, 1),
      variants: base.variants.map((variant) => ({
        ...variant,
        claimStates: variant.claimStates.filter((state) => state.claimKey === firstClaim?.key),
      })),
    }
    expect(brokenBy(thin)).toContain('CLAIMS_TOO_FEW')

    const fixed = complete(thin)
    expect(brokenBy(fixed)).toEqual([])
    expect(fixed.claims.length).toBeGreaterThanOrEqual(6)
  })

  it('gives every claim a state in both variants when the variants are empty', () => {
    const base = complete(emptyDocument())
    const stateless: PackageExport = {
      ...base,
      variants: base.variants.map((variant) => ({ ...variant, claimStates: [] })),
    }
    expect(brokenBy(stateless)).toContain('CLAIM_STATE_MISSING')

    const fixed = complete(stateless)
    expect(brokenBy(fixed)).toEqual([])
    for (const variant of fixed.variants) {
      expect(variant.claimStates).toHaveLength(fixed.claims.length)
    }
  })

  it('completes a document with no variants at all', () => {
    const base = complete(emptyDocument())
    expect(brokenBy(complete({ ...base, variants: [] }))).toEqual([])
  })

  it('brings the Turn back and clamps a delay outside the window', () => {
    const base = complete(emptyDocument())
    expect(brokenBy(complete({ ...base, turn: null }))).toEqual([])
    // The delay column is checked 60–120 by the database, so the schema refuses anything else and
    // the clamp is what protects a document assembled in memory rather than parsed.
    const outOfWindow = { ...base, version: { ...base.version, turnDelaySeconds: 5 } }
    expect(complete(outOfWindow).version.turnDelaySeconds).toBe(90)
  })

  it('completes a re-skin log that records nothing', () => {
    const base = complete(emptyDocument())
    const withSeed: PackageExport = {
      ...base,
      seedRecord: {
        caseTitle: 'A case',
        publisher: 'A publisher',
        licenseTerms: 'Licensed for adaptation.',
        licensePermitsAdaptation: true,
        seedText: 'The case text.',
        reskinLog: [],
      },
    }
    expect(brokenBy(withSeed)).toContain('RESKIN_LOG_EMPTY')

    const fixed = complete(withSeed)
    expect(brokenBy(fixed)).toEqual([])
    expect(new Set(fixed.seedRecord?.reskinLog.map((entry) => entry.kind))).toEqual(
      new Set(['renamed_entity', 'altered_number', 'restructured_document']),
    )
  })

  it('gives every stakeholder a document and one pair a contradiction', () => {
    const base = complete(emptyDocument())
    const crowded: PackageExport = {
      ...base,
      stakeholders: [
        ...base.stakeholders.map((row) => ({
          ...row,
          contradictsStakeholderKey: null,
          contradictionPoint: null,
        })),
        {
          key: 'ops_lead',
          name: 'Owen Bell',
          roleTitle: 'Operations lead',
          positionStatement: 'Wants the schedule held.',
          incentives: 'Measured on delivery.',
          blindSpots: 'Discounts evidence that would move the date.',
          contradictionPoint: null,
          contradictsStakeholderKey: null,
        },
      ],
      documents: base.documents.map((document) => ({ ...document, stakeholderKey: null })),
    }
    const failures = brokenBy(crowded)
    expect(failures).toContain('STAKEHOLDER_NO_DOCUMENT')
    expect(failures).toContain('STAKEHOLDER_NO_CONTRADICTION')
    expect(brokenBy(complete(crowded))).toEqual([])
  })

  it('completes an answer space with one position and no minimum commitment', () => {
    const base = complete(emptyDocument())
    const thin: PackageExport = {
      ...base,
      answerSpacePositions: base.answerSpacePositions
        .slice(0, 1)
        .map((row) => ({ ...row, kind: 'defensible' as const, isMinimumCommitment: false })),
    }
    const failures = brokenBy(thin)
    expect(failures).toContain('ANSWER_SPACE_SINGLE')
    expect(failures).toContain('ANSWER_SPACE_NO_MINIMUM')
    expect(brokenBy(complete(thin))).toEqual([])
  })

  it('completes a package whose claims name concepts the set does not declare', () => {
    const base = complete(emptyDocument())
    const stray: PackageExport = {
      ...base,
      claims: base.claims.map((claim) => ({ ...claim, conceptKey: 'a concept nobody declared' })),
    }
    expect(brokenBy(stray)).toContain('CLAIM_CONCEPT_UNKNOWN')
    expect(brokenBy(complete(stray))).toEqual([])
  })

  it('never returns a supersession chain that loops', () => {
    const base = complete(emptyDocument())
    const first = base.documents[0]
    const second = base.documents[1]
    expect(first && second).toBeTruthy()
    if (!first || !second) return
    const looped: PackageExport = {
      ...base,
      documents: base.documents.map((document) => {
        if (document.key === first.key) {
          return { ...document, role: 'superseded' as const, supersededByKey: second.key }
        }
        if (document.key === second.key) {
          return { ...document, role: 'superseded' as const, supersededByKey: first.key }
        }
        return document
      }),
    }
    const fixed = complete(looped)
    expect(brokenBy(fixed)).toEqual([])

    const byKey = new Map(fixed.documents.map((document) => [document.key, document]))
    for (const start of fixed.documents) {
      const seen = new Set<string>([start.key])
      let at = start
      while (at.supersededByKey !== null) {
        const next = byKey.get(at.supersededByKey)
        if (!next) break
        expect(seen.has(next.key)).toBe(false)
        seen.add(next.key)
        at = next
      }
    }
  })
})
