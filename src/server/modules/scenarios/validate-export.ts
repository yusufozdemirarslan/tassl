// Validating a package document before it is a package (10 §4, SYS-026).
//
// `validatePackage` reads a version the way the database holds it: elements carry ids and reference
// each other by id. An export references by key instead, so that a document written by hand — the
// Meridian Roast fixture — or exported from one institution can be imported into another. The two
// shapes describe the same package, and this file is the one place that says how.
//
// It exists so nothing has to choose between two bad options: writing a second copy of the
// key-to-id resolution inside a test, or reaching for a database to answer a question that is
// purely about the document. `importPackage` resolves keys while it writes rows, which is the right
// shape there; here the ids are synthetic and never leave the function.
import type { PackageExport } from './schema'
import {
  validatePackage,
  type PackageValidationResult,
  type ValidatedVersion,
  type ValidatedVerificationPaths,
} from './validate'

/**
 * The document as a version, with each element's key standing in for its id.
 *
 * Using the key as the id is deliberate: every rule that reports `elementIds` then reports
 * something a reader of the document can find, so a failure on a hand-written fixture names `C3`
 * rather than a uuid that exists nowhere. Keys are unique per element type inside a version
 * (06 §3.3), which is what makes them safe to use this way.
 */
export function toValidatedVersion(document: PackageExport): ValidatedVersion {
  return {
    conceptSet: document.version.conceptSet,
    brief: document.version.brief,
    turnDelaySeconds: document.version.turnDelaySeconds,
    generalEscalationReply: document.version.generalEscalationReply,
    debriefCounterfactual: document.version.debriefCounterfactual,
    seedRecord: document.seedRecord
      ? { reskinLog: document.seedRecord.reskinLog.map((entry) => ({ kind: entry.kind })) }
      : null,
    documents: document.documents.map((row) => ({
      id: row.key,
      key: row.key,
      body: row.body,
      role: row.role,
      datedOn: row.datedOn,
      supersededByDocumentId: row.supersededByKey,
      stakeholderId: row.stakeholderKey,
    })),
    stakeholders: document.stakeholders.map((row) => ({
      id: row.key,
      key: row.key,
      contradictsStakeholderId: row.contradictsStakeholderKey,
      contradictionPoint: row.contradictionPoint,
    })),
    answerSpacePositions: document.answerSpacePositions.map((row) => ({
      id: row.key,
      key: row.key,
      kind: row.kind,
      ignoredEvidence: row.ignoredEvidence,
      isMinimumCommitment: row.isMinimumCommitment,
    })),
    namedFields: document.namedFields.map((row) => ({ key: row.key })),
    claims: document.claims.map((row) => ({
      id: row.key,
      key: row.key,
      text: row.text,
      importance: row.importance,
      consequenceLevel: row.consequenceLevel,
      conceptKey: row.conceptKey,
      weaklySourced: row.weaklySourced,
      volatile: row.volatile,
      escalatable: row.escalatable,
      escalationReply: row.escalationReply,
    })),
    variants: document.variants.map((variant) => ({
      key: variant.key,
      claimStates: variant.claimStates.map((state) => ({
        // A state has no key of its own, so it is named by the pair that identifies it.
        id: `${variant.key}:${state.claimKey}`,
        claimId: state.claimKey,
        evidenceStatus: state.evidenceStatus,
        failureFamily: state.failureFamily,
        warrantedStance: state.warrantedStance,
        verificationPaths: toValidatedPaths(state.verificationPaths),
        planted: state.planted,
      })),
    })),
    turn: document.turn ? { id: 'turn' } : null,
    defenseQuestions: document.defenseQuestions.map((row) => ({
      kind: row.kind,
      claimId: row.claimKey,
      assumptionIndex: row.assumptionIndex,
      template: row.template,
    })),
    readinessItems: document.readinessItems.map((row) => ({
      id: row.key,
      key: row.key,
      category: row.category,
      stem: row.stem,
      options: row.options,
      answerKey: row.answerKey,
    })),
  }
}

/**
 * The export names a Source Trace's document by key; a version names it by id, and here the key is
 * the id. Everything else in the paths object is the same on both sides.
 */
function toValidatedPaths(
  paths: PackageExport['variants'][number]['claimStates'][number]['verificationPaths'],
): ValidatedVerificationPaths {
  const { source_trace: trace, ...rest } = paths
  return trace
    ? {
        ...rest,
        source_trace: {
          document_id: trace.document_key,
          passage: trace.passage,
          dated_on: trace.dated_on,
          author: trace.author,
        },
      }
    : rest
}

/** Every rule of 10 §4, run over a document that has no rows yet. */
export function validateExport(document: PackageExport): PackageValidationResult {
  return validatePackage(toValidatedVersion(document))
}
