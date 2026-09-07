// Step 12.2 — the step table (docs/tech/10-backend-spec-modules.md §5; 11-llm-integration.md §2.1).
//
// The table is the pipeline's contract with `validatePackage`, and the two ways it can be wrong are
// both silent:
//
//   * **A rule nobody owns.** A rule added to the validator that no step is held to would be
//     checked only at confirmation, so the author would meet it after sixty decisions rather than
//     inside the step that produced the fault — and the retry that exists to fix it would never
//     fire. The partition below is asserted against `VALIDATION_RULE_CODES` itself.
//   * **An element type nobody owns, or two steps owning one.** `regenerateElement` re-runs "the
//     step that owns this element" (10 §5); an element type claimed by two steps would make that
//     ambiguous, and one claimed by none would make the regenerate control on UI-043 dead.
import { describe, expect, it } from 'vitest'
import { GENERATION_STEPS } from '@/server/modules/authoring/schema'
import {
  GENERATION_STEP_DEFINITIONS,
  GENERATION_STEP_ORDER,
  nextStep,
  stepOwningElement,
} from '@/server/modules/authoring/steps'
import { ELEMENT_TYPES } from '@/server/modules/scenarios/schema'
import { VALIDATION_RULE_CODES } from '@/server/modules/scenarios/validate'

describe('the seven generation steps', () => {
  it('are the seven of 11 §2.1, in order, each ending at the next', () => {
    expect(GENERATION_STEP_ORDER).toEqual(GENERATION_STEPS)
    for (const [index, step] of GENERATION_STEP_ORDER.entries()) {
      expect(nextStep(step)).toBe(GENERATION_STEP_ORDER[index + 1] ?? null)
    }
  })

  it('name a prompt of 11 §2.1 apiece, and no two the same', () => {
    const names = GENERATION_STEP_ORDER.map((step) => GENERATION_STEP_DEFINITIONS[step].prompt.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^gen-[a-z0-9-]+$/)
  })
})

describe('the validation subsets', () => {
  it('partition `validatePackage`: every rule owned once, and none invented', () => {
    const owned = GENERATION_STEP_ORDER.flatMap((step) => GENERATION_STEP_DEFINITIONS[step].rules)
    expect(new Set(owned).size, 'a rule is claimed by two steps').toBe(owned.length)
    expect([...owned].sort()).toEqual([...VALIDATION_RULE_CODES].sort())
  })

  it('holds each step to rules its own output can satisfy', () => {
    // Spot-checks that a mis-filed rule would break: the documents step owns the room's rules and
    // the claims step owns the plant's, not the other way round.
    expect(GENERATION_STEP_DEFINITIONS.documents.rules).toContain('DOCUMENT_ROLES_MISSING')
    expect(GENERATION_STEP_DEFINITIONS.documents.rules).toContain('STAKEHOLDER_NO_DOCUMENT')
    expect(GENERATION_STEP_DEFINITIONS.claims_and_states.rules).toContain('DEFECTIVE_VARIANT_PLANT')
    expect(GENERATION_STEP_DEFINITIONS.readiness_items.rules).toEqual(['READINESS_SPLIT'])
  })
})

describe('element ownership', () => {
  it('gives every element type exactly one step', () => {
    const owned = GENERATION_STEP_ORDER.flatMap(
      (step) => GENERATION_STEP_DEFINITIONS[step].elementTypes,
    )
    expect(new Set(owned).size, 'an element type is written by two steps').toBe(owned.length)
    expect([...owned].sort()).toEqual([...ELEMENT_TYPES].sort())
    for (const elementType of ELEMENT_TYPES) {
      expect(stepOwningElement(elementType), elementType).not.toBeNull()
    }
  })

  it('sends a document to the documents step and a readiness item to step 7', () => {
    expect(stepOwningElement('document')).toBe('documents')
    expect(stepOwningElement('readiness_item')).toBe('readiness_items')
    expect(stepOwningElement('brief')).toBe('reskin_brief_stakeholders')
    // The Turn's delay is a version column, and `TURN_DELAY` reads it there (06 §3.3).
    expect(stepOwningElement('clock_and_difficulty')).toBe('turn_and_probe')
  })
})

describe('what a step is given', () => {
  it('hands the seed text to step 1 and to no other step', () => {
    const source = {
      conceptSet: ['payback_period'],
      brief: 'A brief.',
      seed: { seedText: 'THE LICENSED CASE', licenseTerms: 'Adaptation permitted.' },
      reskinLog: [{ kind: 'renamed_entity', from: 'a', to: 'b' }],
      stakeholders: [{ key: 'founder', name: 'I H', roleTitle: 'CEO', positionStatement: 'Go.' }],
      documents: [
        {
          key: 'D1',
          title: 'T',
          author: 'A',
          datedOn: '2026-01-01',
          role: 'supporting',
          body: 'B',
        },
      ],
      positions: [{ key: 'hold', kind: 'defensible', summary: 'S' }],
      namedFields: [{ key: 'premium_payback_months', label: 'Payback', unit: 'months' }],
      claims: [
        {
          key: 'C1',
          text: 'The payback is eleven months.',
          importance: 'load_bearing',
          consequenceLevel: 'high',
          conceptKey: 'payback_period',
          failureFamilies: ['stale_evidence'],
        },
      ],
    }

    for (const step of GENERATION_STEP_ORDER) {
      const input = GENERATION_STEP_DEFINITIONS[step].buildInput(source, [])
      const rendered = JSON.stringify(input)
      if (step === 'reskin_brief_stakeholders') {
        expect(rendered).toContain('THE LICENSED CASE')
      } else {
        // 11 §2.1: step 1 is the only step given the seed case. A later step that carried it would
        // be handing 200,000 characters of somebody else's document to a prompt that never renders
        // it, which is a channel no rendered prompt would explain (D-525).
        expect(rendered, step).not.toContain('THE LICENSED CASE')
      }
      // Every step carries the retry channel, empty on a first pass (10 §5, `gen.ts`).
      expect(input['restatedRules'], step).toEqual([])
    }
  })

  it('carries the restated rules into every step that can be retried', () => {
    const source = {
      conceptSet: [],
      brief: '',
      seed: { seedText: 'x', licenseTerms: '' },
      reskinLog: [],
      stakeholders: [],
      documents: [],
      positions: [],
      namedFields: [],
      claims: [],
    }
    for (const step of GENERATION_STEP_ORDER) {
      const input = GENERATION_STEP_DEFINITIONS[step].buildInput(source, ['A RULE THAT BROKE'])
      expect(input['restatedRules'], step).toEqual(['A RULE THAT BROKE'])
    }
  })
})
