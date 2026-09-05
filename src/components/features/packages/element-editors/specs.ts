import { t } from '@/lib/i18n/messages/package-confirm'
import type {
  ClaimImportanceValue,
  ClaimSourceValue,
  ConsequenceLevelValue,
  DocumentRoleValue,
  ElementTypeValue,
  EvidenceStatusValue,
  FailureFamilyValue,
  PositionKindValue,
  QuestionKindValue,
  ReadinessCategoryValue,
  ReskinKindValue,
  StanceValue,
  TurnResponseValue,
  TurnVoiceValue,
  ValueUnitValue,
  VerificationCostValue,
} from '@/server/modules/scenarios/schema'
import type { ElementIndex, ElementOption } from '../element-model'
import { oneLine } from '../element-model'
import type { FieldSpec, SelectOption } from './field-spec'

// The fields of each of the fifteen element types, in the order an author reads them (UI-043).
//
// This is the screen's half of `ELEMENT_INPUT_SCHEMAS`: the same field names, in a shape that can
// be drawn. The schema stays the authority on what is *allowed* — every bound, every enum member,
// every cross-field rule is checked server-side by the one schema the route and the action share —
// and this file says what each field is *called* and which control it takes.
//
// Two things are deliberately absent. The element key is not a field: it is the element's identity
// in the export and in the upsert, `updateElement` refuses a patch that changes one, and it is
// already the heading of the editor. And nothing here restates a package rule — the readiness split
// is 6/4/6 and a claim's concept must be in the concept set, but those are `validatePackage`'s
// sentences and they arrive with the element they name.
//
// The enum lists are written out rather than mapped from the schema's `as const` arrays, because
// those arrays are values in a server module: importing one would pull the module across the
// boundary (D-186). A member added there and not here is a compile error at the `Record<…, string>`
// below, which is the point of writing them as exhaustive records.

// ---------------------------------------------------------------------------------------------
// Enumerated values
// ---------------------------------------------------------------------------------------------

const optionsFrom = <T extends string>(labels: Record<T, string>): SelectOption[] =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }))

const DOCUMENT_ROLES: Record<DocumentRoleValue, string> = {
  supporting: t('confirm.documentRole.supporting'),
  superseded: t('confirm.documentRole.superseded'),
  interpretation_as_fact: t('confirm.documentRole.interpretation_as_fact'),
  irrelevant: t('confirm.documentRole.irrelevant'),
}

const POSITION_KINDS: Record<PositionKindValue, string> = {
  defensible: t('confirm.positionKind.defensible'),
  evidence_inconsistent: t('confirm.positionKind.evidence_inconsistent'),
}

const VALUE_UNITS: Record<ValueUnitValue, string> = {
  percent: t('confirm.unit.percent'),
  ratio: t('confirm.unit.ratio'),
  months: t('confirm.unit.months'),
  usd: t('confirm.unit.usd'),
  count: t('confirm.unit.count'),
  other: t('confirm.unit.other'),
}

const CLAIM_SOURCES: Record<ClaimSourceValue, string> = {
  assistant: t('confirm.claimSource.assistant'),
  document: t('confirm.claimSource.document'),
}

const IMPORTANCES: Record<ClaimImportanceValue, string> = {
  load_bearing: t('confirm.importance.load_bearing'),
  supporting: t('confirm.importance.supporting'),
}

const CONSEQUENCES: Record<ConsequenceLevelValue, string> = {
  low: t('confirm.consequence.low'),
  medium: t('confirm.consequence.medium'),
  high: t('confirm.consequence.high'),
}

const COSTS: Record<VerificationCostValue, string> = {
  cheap: t('confirm.cost.cheap'),
  moderate: t('confirm.cost.moderate'),
  expensive: t('confirm.cost.expensive'),
}

const EVIDENCE_STATUSES: Record<EvidenceStatusValue, string> = {
  sound: t('confirm.evidence.sound'),
  defective: t('confirm.evidence.defective'),
}

const FAILURE_FAMILIES: Record<FailureFamilyValue, string> = {
  near_neighbor: t('confirm.family.near_neighbor'),
  unstated_assumption: t('confirm.family.unstated_assumption'),
  stale_evidence: t('confirm.family.stale_evidence'),
  uncomputed_number: t('confirm.family.uncomputed_number'),
  extrapolation: t('confirm.family.extrapolation'),
  reversal_to_agree: t('confirm.family.reversal_to_agree'),
  omitted_alternative: t('confirm.family.omitted_alternative'),
  misapplied_method: t('confirm.family.misapplied_method'),
  misattributed_source: t('confirm.family.misattributed_source'),
  unacceptable_route: t('confirm.family.unacceptable_route'),
}

const TURN_VOICES: Record<TurnVoiceValue, string> = {
  stakeholder_message: t('confirm.voice.stakeholder_message'),
  corrected_number: t('confirm.voice.corrected_number'),
  supplier_notice: t('confirm.voice.supplier_notice'),
  competitor_move: t('confirm.voice.competitor_move'),
  retracted_source: t('confirm.voice.retracted_source'),
  regulatory_note: t('confirm.voice.regulatory_note'),
}

const TURN_RESPONSES: Record<TurnResponseValue, string> = {
  hold: t('confirm.turnResponse.hold'),
  revise: t('confirm.turnResponse.revise'),
  reverse: t('confirm.turnResponse.reverse'),
}

const QUESTION_KINDS: Record<QuestionKindValue, string> = {
  provenance: t('confirm.questionKind.provenance'),
  figure_provenance: t('confirm.questionKind.figure_provenance'),
  verification: t('confirm.questionKind.verification'),
  assumption: t('confirm.questionKind.assumption'),
  confidence: t('confirm.questionKind.confidence'),
  frame_vs_response: t('confirm.questionKind.frame_vs_response'),
  counterfactual: t('confirm.questionKind.counterfactual'),
  default: t('confirm.questionKind.default'),
}

const READINESS_CATEGORIES: Record<ReadinessCategoryValue, string> = {
  foundation: t('confirm.category.foundation'),
  defect_concept: t('confirm.category.defect_concept'),
  ai_behavior: t('confirm.category.ai_behavior'),
}

const RESKIN_KINDS: Record<ReskinKindValue, string> = {
  renamed_entity: t('confirm.reskinKind.renamed_entity'),
  altered_number: t('confirm.reskinKind.altered_number'),
  restructured_document: t('confirm.reskinKind.restructured_document'),
}

/** The five stances, in the order 09 §2.4 names them; the chip supplies the label and the icon. */
export const STANCE_ORDER = [
  'accept',
  'verify',
  'challenge',
  'reject',
  'escalate',
] as const satisfies readonly StanceValue[]

// ---------------------------------------------------------------------------------------------
// References to other elements
// ---------------------------------------------------------------------------------------------

const refOptions = (options: readonly ElementOption[]): SelectOption[] =>
  options.map((option) => ({
    value: option.id,
    label: option.label.length > 0 ? oneLine(option.label, 60) : option.key,
    caption: option.key,
  }))

// ---------------------------------------------------------------------------------------------
// The word limits the schema states (`BRIEF_WORD_LIMIT`, `DOCUMENT_WORD_LIMIT`), restated so the
// counter can count down to the same number the server counts up to (D-075).
// ---------------------------------------------------------------------------------------------

const BRIEF_WORD_LIMIT = 200
const DOCUMENT_WORD_LIMIT = 2000

const WORKING_CLOCK_MIN = 300
const WORKING_CLOCK_MAX = 7200
const TURN_DELAY_MIN = 60
const TURN_DELAY_MAX = 120

const positionField: FieldSpec = {
  kind: 'number',
  name: 'position',
  label: t('confirm.field.position'),
  hint: t('confirm.field.positionHint'),
  min: 0,
  required: true,
}

// ---------------------------------------------------------------------------------------------
// The fifteen
// ---------------------------------------------------------------------------------------------

/**
 * The fields of one element. `values` is passed in because two types change shape with their own
 * content: a superseded document asks which document replaced it, and a defective claim state asks
 * which family it fails under. Both are database checks as well, so a field that appears only when
 * it is required is the editor agreeing with the constraint rather than guessing at one.
 */
export function fieldsFor(
  elementType: ElementTypeValue,
  values: Record<string, unknown>,
  index: ElementIndex,
): FieldSpec[] {
  switch (elementType) {
    case 'brief':
      return [
        {
          kind: 'textarea',
          name: 'brief',
          label: t('confirm.field.brief'),
          hint: t('confirm.field.briefHint'),
          rows: 10,
          reading: true,
          wordLimit: BRIEF_WORD_LIMIT,
          required: true,
        },
      ]

    case 'document':
      return [
        { kind: 'text', name: 'title', label: t('confirm.field.title'), required: true },
        { kind: 'text', name: 'author', label: t('confirm.field.author'), required: true },
        { kind: 'date', name: 'datedOn', label: t('confirm.field.datedOn'), required: true },
        {
          kind: 'select',
          name: 'role',
          label: t('confirm.field.role'),
          options: optionsFrom(DOCUMENT_ROLES),
          required: true,
        },
        positionField,
        ...(values['role'] === 'superseded'
          ? [
              {
                kind: 'select' as const,
                name: 'supersededByDocumentId',
                label: t('confirm.field.supersededBy'),
                hint: t('confirm.field.supersededByHint'),
                options: refOptions(index.documents),
                nullable: true,
              },
            ]
          : []),
        {
          kind: 'select',
          name: 'stakeholderId',
          label: t('confirm.field.documentStakeholder'),
          hint: t('confirm.field.documentStakeholderHint'),
          options: refOptions(index.stakeholders),
          nullable: true,
        },
        {
          kind: 'textarea',
          name: 'body',
          label: t('confirm.field.body'),
          rows: 16,
          reading: true,
          wordLimit: DOCUMENT_WORD_LIMIT,
          required: true,
        },
      ]

    case 'stakeholder':
      return [
        { kind: 'text', name: 'name', label: t('confirm.field.name'), required: true },
        { kind: 'text', name: 'roleTitle', label: t('confirm.field.roleTitle'), required: true },
        {
          kind: 'textarea',
          name: 'positionStatement',
          label: t('confirm.field.positionStatement'),
          rows: 4,
          required: true,
        },
        {
          kind: 'textarea',
          name: 'incentives',
          label: t('confirm.field.incentives'),
          rows: 3,
          required: true,
        },
        {
          kind: 'textarea',
          name: 'blindSpots',
          label: t('confirm.field.blindSpots'),
          rows: 3,
          required: true,
        },
        {
          kind: 'select',
          name: 'contradictsStakeholderId',
          label: t('confirm.field.contradictsStakeholder'),
          options: refOptions(index.stakeholders),
          nullable: true,
        },
        {
          kind: 'textarea',
          name: 'contradictionPoint',
          label: t('confirm.field.contradictionPoint'),
          hint: t('confirm.field.contradictionPointHint'),
          rows: 3,
        },
      ]

    case 'answer_space_position':
      return [
        {
          kind: 'select',
          name: 'kind',
          label: t('confirm.field.positionKind'),
          options: optionsFrom(POSITION_KINDS),
          required: true,
        },
        {
          kind: 'textarea',
          name: 'summary',
          label: t('confirm.field.summary'),
          rows: 4,
          required: true,
        },
        {
          kind: 'textarea',
          name: 'ignoredEvidence',
          label: t('confirm.field.ignoredEvidence'),
          hint: t('confirm.field.ignoredEvidenceHint'),
          rows: 3,
        },
        {
          kind: 'checkbox',
          name: 'isMinimumCommitment',
          label: t('confirm.field.isMinimumCommitment'),
        },
        {
          kind: 'multi',
          name: 'supportingDocumentIds',
          label: t('confirm.field.supportingDocuments'),
          options: refOptions(index.documents),
        },
        positionField,
      ]

    case 'named_field':
      return [
        { kind: 'text', name: 'label', label: t('confirm.field.label'), required: true },
        {
          kind: 'select',
          name: 'unit',
          label: t('confirm.field.unit'),
          options: optionsFrom(VALUE_UNITS),
          required: true,
        },
        positionField,
      ]

    case 'claim':
      return [
        {
          kind: 'textarea',
          name: 'text',
          label: t('confirm.field.text'),
          rows: 3,
          reading: true,
          required: true,
        },
        {
          kind: 'select',
          name: 'sourceKind',
          label: t('confirm.field.sourceKind'),
          options: optionsFrom(CLAIM_SOURCES),
          required: true,
        },
        {
          kind: 'select',
          name: 'sourceDocumentId',
          label: t('confirm.field.sourceDocument'),
          options: refOptions(index.documents),
          nullable: true,
        },
        {
          kind: 'textarea',
          name: 'sourcePassage',
          label: t('confirm.field.sourcePassage'),
          rows: 3,
        },
        {
          kind: 'select',
          name: 'importance',
          label: t('confirm.field.importance'),
          options: optionsFrom(IMPORTANCES),
          required: true,
        },
        {
          kind: 'select',
          name: 'consequenceLevel',
          label: t('confirm.field.consequenceLevel'),
          options: optionsFrom(CONSEQUENCES),
          required: true,
        },
        {
          kind: 'select',
          name: 'verificationCost',
          label: t('confirm.field.verificationCost'),
          options: optionsFrom(COSTS),
          required: true,
        },
        {
          kind: 'text',
          name: 'conceptKey',
          label: t('confirm.field.conceptKey'),
          ...(index.conceptSet.length > 0
            ? { hint: t('confirm.field.conceptKeyHint', { concepts: index.conceptSet.join(', ') }) }
            : {}),
          mono: true,
          required: true,
        },
        { kind: 'checkbox', name: 'weaklySourced', label: t('confirm.field.weaklySourced') },
        { kind: 'checkbox', name: 'volatile', label: t('confirm.field.volatile') },
        {
          kind: 'rows',
          name: 'carriedValues',
          label: t('confirm.field.carriedValues'),
          itemName: t('confirm.field.carriedValue'),
          // `CarriedValueSchema.field_key` is optional, not nullable: a figure that names no
          // declared field carries no key at all. A new row starts that way, and so does a row
          // whose key is set back to None — a package with no named fields declared has no other
          // valid shape to offer.
          newRow: () => ({ value: 0, unit: 'percent' }),
          columns: [
            {
              kind: 'select',
              name: 'field_key',
              label: t('confirm.field.carriedFieldKey'),
              optional: true,
              options: index.namedFields.map((field) => ({
                value: field.key,
                label: field.label.length > 0 ? field.label : field.key,
                caption: field.key,
              })),
            },
            { kind: 'number', name: 'value', label: t('confirm.field.carriedValueNumber') },
            {
              kind: 'select',
              name: 'unit',
              label: t('confirm.field.unit'),
              options: optionsFrom(VALUE_UNITS),
            },
          ],
        },
        {
          kind: 'strings',
          name: 'triggerPhrases',
          label: t('confirm.field.triggerPhrases'),
          hint: t('confirm.field.triggerPhrasesHint'),
          itemName: t('confirm.field.triggerPhrase'),
        },
        {
          kind: 'textarea',
          name: 'triggerDescription',
          label: t('confirm.field.triggerDescription'),
          rows: 2,
        },
        { kind: 'checkbox', name: 'escalatable', label: t('confirm.field.escalatable') },
        ...(values['escalatable'] === true
          ? [
              {
                kind: 'textarea' as const,
                name: 'escalationReply',
                label: t('confirm.field.escalationReply'),
                hint: t('confirm.field.escalationReplyHint'),
                rows: 4,
              },
            ]
          : []),
        {
          kind: 'textarea',
          name: 'rationale',
          label: t('confirm.field.rationale'),
          hint: t('confirm.field.rationaleHint'),
          rows: 4,
        },
        positionField,
      ]

    case 'variant_claim_state':
      return [
        {
          kind: 'select',
          name: 'evidenceStatus',
          label: t('confirm.field.evidenceStatus'),
          options: optionsFrom(EVIDENCE_STATUSES),
          required: true,
        },
        ...(values['evidenceStatus'] === 'defective'
          ? [
              {
                kind: 'select' as const,
                name: 'failureFamily',
                label: t('confirm.field.failureFamily'),
                hint: t('confirm.field.failureFamilyHint'),
                options: optionsFrom(FAILURE_FAMILIES),
                nullable: true,
              },
            ]
          : []),
        {
          kind: 'stance',
          name: 'warrantedStance',
          label: t('confirm.field.warrantedStance'),
          options: STANCE_ORDER,
          required: true,
        },
        {
          kind: 'checkbox',
          name: 'planted',
          label: t('confirm.field.planted'),
          hint: t('confirm.field.plantedHint'),
        },
        {
          kind: 'verificationPaths',
          name: 'verificationPaths',
          label: t('confirm.field.verificationPaths'),
          hint: t('confirm.field.verificationPathsHint'),
          documents: refOptions(index.documents),
        },
      ]

    case 'probe':
      return [
        {
          kind: 'select',
          name: 'claimId',
          label: t('confirm.field.probeClaim'),
          options: refOptions(index.claims),
          required: true,
        },
        {
          kind: 'textarea',
          name: 'originalPosition',
          label: t('confirm.field.originalPosition'),
          rows: 4,
          reading: true,
          required: true,
        },
        {
          kind: 'textarea',
          name: 'scriptedReversal',
          label: t('confirm.field.scriptedReversal'),
          rows: 4,
          reading: true,
          required: true,
        },
      ]

    case 'turn':
      return [
        {
          kind: 'textarea',
          name: 'text',
          label: t('confirm.field.turnText'),
          rows: 6,
          reading: true,
          required: true,
        },
        {
          kind: 'select',
          name: 'voice',
          label: t('confirm.field.voice'),
          options: optionsFrom(TURN_VOICES),
          required: true,
        },
        {
          kind: 'select',
          name: 'stakeholderId',
          label: t('confirm.field.turnStakeholder'),
          options: refOptions(index.stakeholders),
          nullable: true,
        },
        { kind: 'checkbox', name: 'warrantsChange', label: t('confirm.field.warrantsChange') },
        {
          kind: 'select',
          name: 'proportionateResponse',
          label: t('confirm.field.proportionateResponse'),
          options: optionsFrom(TURN_RESPONSES),
          required: true,
        },
        {
          kind: 'textarea',
          name: 'evidence',
          label: t('confirm.field.evidence'),
          rows: 4,
          required: true,
        },
        {
          kind: 'strings',
          name: 'disruptedAssumptionKeys',
          label: t('confirm.field.disruptedAssumptionKeys'),
          itemName: t('confirm.field.disruptedAssumption'),
        },
        {
          kind: 'multi',
          name: 'windowClaimIds',
          label: t('confirm.field.windowClaims'),
          options: refOptions(index.claims),
        },
      ]

    case 'defense_question':
      return [
        {
          kind: 'select',
          name: 'kind',
          label: t('confirm.field.questionKind'),
          options: optionsFrom(QUESTION_KINDS),
          required: true,
        },
        {
          kind: 'textarea',
          name: 'template',
          label: t('confirm.field.template'),
          hint: t('confirm.field.templateHint'),
          rows: 3,
          reading: true,
          required: true,
        },
        {
          kind: 'select',
          name: 'claimId',
          label: t('confirm.field.questionClaim'),
          options: refOptions(index.claims),
          nullable: true,
        },
        {
          kind: 'number',
          name: 'assumptionIndex',
          label: t('confirm.field.assumptionIndex'),
          hint: t('confirm.field.assumptionIndexHint'),
          min: 0,
          max: 2,
          nullable: true,
        },
        { kind: 'checkbox', name: 'isDefault', label: t('confirm.field.isDefault') },
        {
          kind: 'json',
          name: 'condition',
          label: t('confirm.field.condition'),
          hint: t('confirm.field.conditionHint'),
        },
        { kind: 'textarea', name: 'followUp', label: t('confirm.field.followUp'), rows: 3 },
        {
          kind: 'textarea',
          name: 'expectedAnswerNotes',
          label: t('confirm.field.expectedAnswerNotes'),
          hint: t('confirm.field.expectedAnswerNotesHint'),
          rows: 4,
        },
        positionField,
      ]

    case 'readiness_item':
      return [
        {
          kind: 'select',
          name: 'category',
          label: t('confirm.field.category'),
          options: optionsFrom(READINESS_CATEGORIES),
          required: true,
        },
        {
          kind: 'text',
          name: 'conceptKey',
          label: t('confirm.field.conceptKey'),
          mono: true,
          required: true,
        },
        {
          kind: 'textarea',
          name: 'stem',
          label: t('confirm.field.stem'),
          rows: 3,
          reading: true,
          required: true,
        },
        {
          kind: 'rows',
          name: 'options',
          label: t('confirm.field.options'),
          itemName: t('confirm.field.option'),
          newRow: () => ({ key: '', text: '' }),
          columns: [
            {
              kind: 'text',
              name: 'key',
              label: t('confirm.field.optionKey'),
              mono: true,
              width: 'narrow',
            },
            { kind: 'textarea', name: 'text', label: t('confirm.field.optionText') },
          ],
        },
        {
          kind: 'select',
          name: 'answerKey',
          label: t('confirm.field.answerKey'),
          options: readOptionKeys(values),
          required: true,
        },
        positionField,
      ]

    case 'counterfactual':
      return [
        {
          kind: 'textarea',
          name: 'debriefCounterfactual',
          label: t('confirm.field.counterfactual'),
          hint: t('confirm.field.counterfactualHint'),
          rows: 5,
          reading: true,
          required: true,
        },
      ]

    case 'general_escalation_reply':
      return [
        {
          kind: 'textarea',
          name: 'generalEscalationReply',
          label: t('confirm.field.generalEscalationReply'),
          hint: t('confirm.field.generalEscalationReplyHint'),
          rows: 5,
          reading: true,
          required: true,
        },
      ]

    case 'clock_and_difficulty':
      return [
        {
          kind: 'number',
          name: 'workingClockSeconds',
          label: t('confirm.field.workingClockSeconds'),
          hint: t('confirm.field.workingClockSecondsHint', {
            readable: readableMinutes(values['workingClockSeconds']),
          }),
          min: WORKING_CLOCK_MIN,
          max: WORKING_CLOCK_MAX,
          required: true,
        },
        {
          kind: 'number',
          name: 'turnDelaySeconds',
          label: t('confirm.field.turnDelaySeconds'),
          hint: t('confirm.field.turnDelaySecondsHint'),
          min: TURN_DELAY_MIN,
          max: TURN_DELAY_MAX,
          required: true,
        },
        {
          kind: 'difficulty',
          name: 'difficultyProfile',
          label: t('confirm.field.difficultyEstimate'),
        },
      ]

    case 'seed_reskin':
      return [
        { kind: 'text', name: 'caseTitle', label: t('confirm.field.caseTitle'), required: true },
        { kind: 'text', name: 'publisher', label: t('confirm.field.publisher'), required: true },
        {
          kind: 'textarea',
          name: 'licenseTerms',
          label: t('confirm.field.licenseTerms'),
          rows: 4,
          required: true,
        },
        {
          kind: 'checkbox',
          name: 'licensePermitsAdaptation',
          label: t('confirm.field.licensePermitsAdaptation'),
        },
        {
          kind: 'rows',
          name: 'reskinLog',
          label: t('confirm.field.reskinLog'),
          itemName: t('confirm.field.reskinEntry'),
          newRow: () => ({ kind: 'renamed_entity', from: '', to: '', note: '' }),
          columns: [
            {
              kind: 'select',
              name: 'kind',
              label: t('confirm.field.reskinKind'),
              options: optionsFrom(RESKIN_KINDS),
            },
            { kind: 'text', name: 'from', label: t('confirm.field.reskinFrom') },
            { kind: 'text', name: 'to', label: t('confirm.field.reskinTo') },
            { kind: 'text', name: 'note', label: t('confirm.field.reskinNote'), width: 'wide' },
          ],
        },
        {
          kind: 'textarea',
          name: 'seedText',
          label: t('confirm.field.seedText'),
          rows: 14,
          reading: true,
          required: true,
        },
      ]
  }
}

/** The answer key can only be one of the option keys this item actually carries. */
function readOptionKeys(values: Record<string, unknown>): SelectOption[] {
  const options = values['options']
  if (!Array.isArray(options)) return []
  return options.flatMap((entry): SelectOption[] => {
    if (typeof entry !== 'object' || entry === null) return []
    const { key, text } = entry as { key?: unknown; text?: unknown }
    if (typeof key !== 'string' || key.length === 0) return []
    return [{ value: key, label: typeof text === 'string' ? oneLine(text, 60) : key, caption: key }]
  })
}

/** 1500 seconds is twenty-five minutes; an author sets a clock in minutes and types seconds. */
function readableMinutes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return ''
  const minutes = Math.round(value / 60)
  return minutes > 0 ? `${String(minutes)} min` : ''
}
