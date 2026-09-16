// `buildExport` (docs/tech/10-backend-spec-modules.md §4; SYS-026).
//
// The projection takes `ExportableVersion` rather than the repository's `VersionFull`, because an
// internal module file may not reach a repository (04 §2) — the same reason `validate.ts` and
// `units.ts` take structural types. That freedom is only safe while the structural type is still
// *wider* than the row set it stands for, so this file is where the two are held together: a
// `VersionFull` has to keep assigning to `ExportableVersion`, and the day a column is added or
// renamed underneath it, this is the test that says so.
import { describe, expect, it } from 'vitest'
import { buildExport, type ExportableVersion } from '@/server/modules/scenarios/export-document'
import type { VersionFull } from '@/server/modules/scenarios/repository'
import { PackageExportSchema } from '@/server/modules/scenarios/schema'

describe('buildExport', () => {
  it('takes a version the repository returns', () => {
    // A type-level assertion with no value behind it: `VersionFull` is derived from a query, so
    // there is nothing to construct here and nothing to run. `tsc` is the assertion.
    const assignable = (version: VersionFull): ExportableVersion => version
    expect(typeof assignable).toBe('function')
  })

  it('projects an empty version into a document the export schema parses', () => {
    const version: ExportableVersion = {
      package: { title: 'Kavena Loop', familyKey: 'kavena-loop', discipline: 'marketing_strategy' },
      conceptSet: ['evidence quality', 'provenance', 'denominators', 'recency'],
      brief: 'A brief.',
      workingClockSeconds: 1500,
      turnDelaySeconds: 90,
      difficultyProfile: { estimate: 'unknown', note: '', uncalibrated: true },
      generalEscalationReply: '',
      debriefCounterfactual: '',
      seedRecord: null,
      documents: [],
      stakeholders: [],
      answerSpacePositions: [],
      namedFields: [],
      claims: [],
      variants: [],
      probe: null,
      turn: null,
      defenseQuestions: [],
      readinessItems: [],
    }

    const document = buildExport(version)
    const parsed = PackageExportSchema.safeParse(document)
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
    expect(document.package.familyKey).toBe('kavena-loop')
  })

  it('names a Source Trace by the key of the document it leads to', () => {
    const version: ExportableVersion = {
      package: { title: 'Kavena Loop', familyKey: 'kavena-loop', discipline: 'marketing_strategy' },
      conceptSet: ['evidence quality', 'provenance', 'denominators', 'recency'],
      brief: 'A brief.',
      workingClockSeconds: 1500,
      turnDelaySeconds: 90,
      difficultyProfile: { estimate: 'unknown', note: '', uncalibrated: true },
      generalEscalationReply: 'A reply.',
      debriefCounterfactual: 'One. Two. Three.',
      seedRecord: null,
      documents: [
        {
          id: 'doc-id',
          key: 'D1',
          title: 'A note',
          author: 'Someone',
          datedOn: '2026-02-01',
          role: 'supporting',
          position: 0,
          body: 'A short note.',
          supersededByDocumentId: null,
          stakeholderId: null,
        },
      ],
      stakeholders: [],
      answerSpacePositions: [],
      namedFields: [],
      claims: [
        {
          id: 'claim-id',
          key: 'C1',
          text: 'A claim.',
          sourceKind: 'assistant',
          sourcePassage: '',
          importance: 'load_bearing',
          consequenceLevel: 'high',
          verificationCost: 'cheap',
          weaklySourced: false,
          volatile: false,
          conceptKey: 'evidence quality',
          carriedValues: [],
          triggerPhrases: [],
          triggerDescription: '',
          escalatable: false,
          escalationReply: null,
          rationale: '',
          position: 0,
          sourceDocumentId: 'doc-id',
        },
      ],
      variants: [
        {
          key: 'defective',
          label: 'Defective',
          claimStates: [
            {
              claimId: 'claim-id',
              evidenceStatus: 'defective',
              failureFamily: 'stale_evidence',
              warrantedStance: 'challenge',
              planted: true,
              verificationPaths: {
                source_trace: {
                  document_id: 'doc-id',
                  passage: 'The passage.',
                  dated_on: '2026-02-01',
                  author: 'Someone',
                },
              },
            },
          ],
        },
      ],
      probe: null,
      turn: null,
      defenseQuestions: [],
      readinessItems: [],
    }

    const document = buildExport(version)
    expect(document.claims[0]?.sourceDocumentKey).toBe('D1')
    expect(document.variants[0]?.claimStates[0]?.verificationPaths.source_trace?.document_key).toBe(
      'D1',
    )
  })
})
