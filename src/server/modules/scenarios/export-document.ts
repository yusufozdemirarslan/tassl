// Module `scenarios` — `buildExport` (docs/tech/10-backend-spec-modules.md §4; SYS-026).
//
// The version as the portable document: every reference between elements travels as an element key
// rather than a database id, which is what lets one institution's package be read by another and
// what makes `export ∘ import` the identity on it. `exportPackage` returns it, `confirmVersion`
// stores it as the version's snapshot, and the generation pipeline reads a version through it in
// order to hand it to `completePackage` (D-750).
//
// It lives beside `validate.ts` rather than inside `service.ts` for that last reason: `authoring`
// may reach this module's validator, units and schema but not its service, which reads
// `authoring`'s own index for the generation record (D-530). A pure projection of a row set is the
// right shape to share across that edge; the service is not.
//
// Pure and structural, like `validate.ts` and `units.ts`: it takes `ExportableVersion`, which
// `repo.VersionFull` satisfies and so does a literal in a test. An internal module file may not
// reach a repository (04 §2), and nothing here is a query.
import {
  PACKAGE_EXPORT_SCHEMA_VERSION,
  type AnswerSpacePositionExport,
  type ClaimExport,
  type DefenseQuestionExport,
  type DocumentExport,
  type NamedFieldExport,
  type PackageExport,
  type ReadinessItemExport,
  type SeedRecordExport,
  type StakeholderExport,
  type SycophancyProbeExport,
  type TurnExport,
  type VariantExport,
  type VariantClaimStateExport,
  type VerificationPaths,
  type VerificationPathsExport,
} from './schema'

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------
//
// Every field the projection reads and nothing else. The element shapes are the *export* shapes
// with the key references swapped back for ids, because that is exactly what a row is: an export
// row addressed by the database rather than by name. `tests/unit/scenarios/export-document.test.ts`
// pins that `VersionFull` still assigns here.

type ById<T, K extends string> = Omit<T, K> & { id: string }

export type ExportableVersion = {
  package: { title: string; familyKey: string; discipline: string }
  conceptSet: readonly string[]
  brief: string
  workingClockSeconds: number
  turnDelaySeconds: number
  difficultyProfile: PackageExport['version']['difficultyProfile']
  generalEscalationReply: string
  debriefCounterfactual: string
  seedRecord: (SeedRecordExport & { id?: string }) | null | undefined
  documents: readonly (ById<DocumentExport, 'supersededByKey' | 'stakeholderKey'> & {
    supersededByDocumentId: string | null
    stakeholderId: string | null
  })[]
  stakeholders: readonly (ById<StakeholderExport, 'contradictsStakeholderKey'> & {
    contradictsStakeholderId: string | null
  })[]
  answerSpacePositions: readonly (ById<AnswerSpacePositionExport, 'supportingDocumentKeys'> & {
    supportingDocumentIds: readonly string[]
  })[]
  namedFields: readonly NamedFieldExport[]
  claims: readonly (ById<ClaimExport, 'sourceDocumentKey'> & {
    sourceDocumentId: string | null
  })[]
  variants: readonly {
    key: VariantExport['key']
    label: string
    claimStates: readonly (Omit<VariantClaimStateExport, 'claimKey' | 'verificationPaths'> & {
      claimId: string
      verificationPaths: VerificationPaths
    })[]
  }[]
  probe: (Omit<SycophancyProbeExport, 'claimKey'> & { claimId: string }) | null | undefined
  turn:
    | (Omit<TurnExport, 'stakeholderKey' | 'windowClaimKeys'> & {
        stakeholderId: string | null
        windowClaimIds: readonly string[]
      })
    | null
    | undefined
  defenseQuestions: readonly (ById<DefenseQuestionExport, 'claimKey'> & {
    claimId: string | null
  })[]
  readinessItems: readonly (ReadinessItemExport & { id: string })[]
}

const keyOf = (index: ReadonlyMap<string, string>, id: string | null): string | null =>
  id === null ? null : (index.get(id) ?? null)

function toVerificationPathsExport(
  paths: VerificationPaths,
  documentKeyById: ReadonlyMap<string, string>,
): VerificationPathsExport {
  const trace = paths.source_trace
  const documentKey = trace ? documentKeyById.get(trace.document_id) : undefined
  return {
    ...(trace && documentKey
      ? {
          source_trace: {
            document_key: documentKey,
            passage: trace.passage,
            dated_on: trace.dated_on,
            author: trace.author,
          },
        }
      : {}),
    ...(paths.replication_check ? { replication_check: paths.replication_check } : {}),
    ...(paths.decomposition_check ? { decomposition_check: paths.decomposition_check } : {}),
  }
}

/** The whole version as the export format, built from the rows (10 §4 `exportPackage`). */
export function buildExport(version: ExportableVersion): PackageExport {
  const documentKeyById = new Map(version.documents.map((row) => [row.id, row.key]))
  const stakeholderKeyById = new Map(version.stakeholders.map((row) => [row.id, row.key]))
  const claimKeyById = new Map(version.claims.map((row) => [row.id, row.key]))

  const documents: DocumentExport[] = version.documents.map((row) => ({
    key: row.key,
    title: row.title,
    author: row.author,
    datedOn: row.datedOn,
    role: row.role,
    position: row.position,
    body: row.body,
    supersededByKey: keyOf(documentKeyById, row.supersededByDocumentId),
    stakeholderKey: keyOf(stakeholderKeyById, row.stakeholderId),
  }))

  const stakeholders: StakeholderExport[] = version.stakeholders.map((row) => ({
    key: row.key,
    name: row.name,
    roleTitle: row.roleTitle,
    positionStatement: row.positionStatement,
    incentives: row.incentives,
    blindSpots: row.blindSpots,
    contradictionPoint: row.contradictionPoint,
    contradictsStakeholderKey: keyOf(stakeholderKeyById, row.contradictsStakeholderId),
  }))

  const answerSpacePositions: AnswerSpacePositionExport[] = version.answerSpacePositions.map(
    (row) => ({
      key: row.key,
      kind: row.kind,
      summary: row.summary,
      ignoredEvidence: row.ignoredEvidence,
      isMinimumCommitment: row.isMinimumCommitment,
      position: row.position,
      supportingDocumentKeys: row.supportingDocumentIds.flatMap((id) => {
        const key = documentKeyById.get(id)
        return key ? [key] : []
      }),
    }),
  )

  const namedFields: NamedFieldExport[] = version.namedFields.map((row) => ({
    key: row.key,
    label: row.label,
    unit: row.unit,
    position: row.position,
  }))

  const claims: ClaimExport[] = version.claims.map((row) => ({
    key: row.key,
    text: row.text,
    sourceKind: row.sourceKind,
    sourcePassage: row.sourcePassage,
    importance: row.importance,
    consequenceLevel: row.consequenceLevel,
    verificationCost: row.verificationCost,
    weaklySourced: row.weaklySourced,
    volatile: row.volatile,
    conceptKey: row.conceptKey,
    carriedValues: row.carriedValues,
    triggerPhrases: row.triggerPhrases,
    triggerDescription: row.triggerDescription,
    escalatable: row.escalatable,
    escalationReply: row.escalationReply,
    rationale: row.rationale,
    position: row.position,
    sourceDocumentKey: keyOf(documentKeyById, row.sourceDocumentId),
  }))

  const variants: VariantExport[] = version.variants.map((variant) => ({
    key: variant.key,
    label: variant.label,
    claimStates: variant.claimStates.flatMap((state): VariantClaimStateExport[] => {
      const claimKey = claimKeyById.get(state.claimId)
      if (!claimKey) return []
      return [
        {
          claimKey,
          evidenceStatus: state.evidenceStatus,
          failureFamily: state.failureFamily,
          warrantedStance: state.warrantedStance,
          planted: state.planted,
          verificationPaths: toVerificationPathsExport(state.verificationPaths, documentKeyById),
        },
      ]
    }),
  }))

  const probeClaimKey = version.probe ? claimKeyById.get(version.probe.claimId) : undefined
  const probe: SycophancyProbeExport | null =
    version.probe && probeClaimKey
      ? {
          claimKey: probeClaimKey,
          originalPosition: version.probe.originalPosition,
          scriptedReversal: version.probe.scriptedReversal,
        }
      : null

  const turn: TurnExport | null = version.turn
    ? {
        text: version.turn.text,
        voice: version.turn.voice,
        warrantsChange: version.turn.warrantsChange,
        proportionateResponse: version.turn.proportionateResponse,
        evidence: version.turn.evidence,
        disruptedAssumptionKeys: version.turn.disruptedAssumptionKeys,
        stakeholderKey: keyOf(stakeholderKeyById, version.turn.stakeholderId),
        windowClaimKeys: version.turn.windowClaimIds.flatMap((id) => {
          const key = claimKeyById.get(id)
          return key ? [key] : []
        }),
      }
    : null

  const defenseQuestions: DefenseQuestionExport[] = version.defenseQuestions.map((row) => ({
    key: row.key,
    kind: row.kind,
    assumptionIndex: row.assumptionIndex,
    template: row.template,
    condition: row.condition,
    followUp: row.followUp,
    expectedAnswerNotes: row.expectedAnswerNotes,
    isDefault: row.isDefault,
    position: row.position,
    claimKey: keyOf(claimKeyById, row.claimId),
  }))

  const readinessItems: ReadinessItemExport[] = version.readinessItems.map((row) => ({
    key: row.key,
    category: row.category,
    conceptKey: row.conceptKey,
    stem: row.stem,
    options: row.options,
    answerKey: row.answerKey,
    position: row.position,
  }))

  const seedRecord: SeedRecordExport | null = version.seedRecord
    ? {
        caseTitle: version.seedRecord.caseTitle,
        publisher: version.seedRecord.publisher,
        licenseTerms: version.seedRecord.licenseTerms,
        licensePermitsAdaptation: version.seedRecord.licensePermitsAdaptation,
        seedText: version.seedRecord.seedText,
        reskinLog: version.seedRecord.reskinLog,
      }
    : null

  return {
    schemaVersion: PACKAGE_EXPORT_SCHEMA_VERSION,
    package: {
      title: version.package.title,
      familyKey: version.package.familyKey,
      discipline: version.package.discipline,
    },
    version: {
      conceptSet: [...version.conceptSet],
      brief: version.brief,
      workingClockSeconds: version.workingClockSeconds,
      turnDelaySeconds: version.turnDelaySeconds,
      difficultyProfile: version.difficultyProfile,
      generalEscalationReply: version.generalEscalationReply,
      debriefCounterfactual: version.debriefCounterfactual,
    },
    seedRecord,
    documents,
    stakeholders,
    answerSpacePositions,
    namedFields,
    claims,
    variants,
    probe,
    turn,
    defenseQuestions,
    readinessItems,
  }
}
