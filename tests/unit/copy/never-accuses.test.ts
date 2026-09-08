// FR-006's copy review, as a test: the words `cheat`, `misconduct`, `dishonest` and `plagiar`
// appear in the product's whole catalogue only inside a sentence that denies a misconduct finding.
//
// **Is this the same test as `tests/unit/lib/product-voice.test.ts`?** Same corpus, different
// property, and the difference is worth a file.
//
// That one is a *floor*: three vocabularies over every namespace, two tiers, and a pinned inventory
// saying which collisions the product is entitled to and why. It answers "does any string use a
// word the voice rules forbid, unaccounted for?".
//
// This one is a *ceiling on four words in particular*, from the other direction. FR-006 does not
// only say the four words must be accounted for; it says no code path, screen, export field or
// event type expresses a misconduct finding — so the four words have exactly one job in this
// product, which is to deny one. This file enumerates every place they may appear, and each entry
// has to be a denial. A new sentence that added "misconduct" to, say, the debrief could be given an
// inventory row with a straight face by someone in a hurry; it cannot be given a row here, because
// every row here has to be a sentence that says the thing does not happen.
//
// The two cannot disagree about *which words* they are looking for: the vocabulary below is
// filtered out of `MISCONDUCT`'s own entries in `src/lib/product-voice.ts` — the same list the
// run-time band-rationale filter is held to — rather than typed a second time. Extending the shared
// list is what extends this test, and a rename there fails here by name.
import { describe, expect, it } from 'vitest'
import { MISCONDUCT, type Vocabulary } from '@/lib/product-voice'
import { privacyDocument } from '@/lib/legal/privacy'
import { termsDocument } from '@/lib/legal/terms'
import type { LegalDeployment, LegalDocument } from '@/lib/legal/document'
import { everyCatalogue, scan } from '../support/product-voice'

/** The four stems FR-006's copy review names (build-plan phase 13, step 13.5). */
const STEMS = ['cheat', 'dishonest', 'misconduct', 'plagiar'] as const

/** Those four, taken from the shared vocabulary rather than restated. */
const ACCUSATION: Vocabulary = {
  name: 'accusation',
  terms: MISCONDUCT.terms.filter((term) => STEMS.some((stem) => term.startsWith(stem))),
}

/**
 * Every key in the catalogue that may carry one of the four words, and the denial it is making.
 *
 * The step describes this as "the legal pages' explicit sentence". It is three sentences rather
 * than one, and the extra two were already in the product before this step: the course policy
 * display and the outside-tool declaration both have to say, to the student, in the run, that the
 * thing does not count against them (FR-062). Naming the word is how they say it. Each row here is
 * a sentence whose subject is the absence of a misconduct finding; there is no other kind of row.
 */
const DENIALS: readonly { key: string; denial: string }[] = [
  {
    key: 'legal.noMisconductFindings',
    denial: 'The privacy and terms pages state FR-006 outright; both render this one string.',
  },
  {
    key: 'run.policyNoPenalty',
    denial: 'The policy shown before a run starts: declaring a tool costs the student nothing.',
  },
  {
    key: 'workspace.declarationNoPenalty',
    denial: 'The declaration control itself, at the moment of declaring (FR-061, FR-062).',
  },
]

const MODULES = import.meta.glob('../../../src/lib/i18n/messages/*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>
const CATALOGUES = everyCatalogue(MODULES)

/** `path` without the ` (key)` suffix the walker adds when the hit is on the identifier. */
const keyOf = (path: string): string => path.replace(/ \(key\)$/, '')

const findings = (): { path: string; word: string; rule: string }[] =>
  CATALOGUES.flatMap(({ catalogue }) => scan(catalogue, [ACCUSATION]))

/** Every paragraph of a rendered legal document, flattened. */
const paragraphs = (document: LegalDocument): string[] =>
  document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => (block.kind === 'paragraph' ? [block.text] : [])),
  )

const DEPLOYMENT: LegalDeployment = {
  contactEmail: 'privacy@tassl.local',
  managedHosting: true,
  emailDelivery: true,
  googleSignIn: false,
  analytics: false,
  errorMonitoring: false,
  llmProvider: 'mock',
  llmModel: 'mimo-v2.5-pro',
}

describe('the catalogue never accuses anybody', () => {
  it('looks for the four words the shared vocabulary already forbids', () => {
    // Derived, not restated: if `MISCONDUCT` renamed an entry, this fails here rather than
    // quietly scanning for three words.
    for (const stem of STEMS) {
      expect(
        ACCUSATION.terms.filter((term) => term.startsWith(stem)),
        `no entry of MISCONDUCT begins "${stem}"`,
      ).not.toEqual([])
    }
    expect(ACCUSATION.terms).toEqual([
      'cheat(?:s|ed|ing|er|ers)?',
      'dishonest(?:y|ly)?',
      'misconduct',
      'plagiaris(?:m|e|ed|ing)',
      'plagiariz(?:m|e|ed|ing)',
    ])
  })

  it('scans every namespace there is', () => {
    expect(CATALOGUES.length).toBeGreaterThanOrEqual(35)
    expect(CATALOGUES.some(({ file }) => file === 'legal.ts')).toBe(true)
  })

  it('finds the four words only in a sentence that denies a misconduct finding', () => {
    const permitted = new Set(DENIALS.map((row) => row.key))
    const outstanding = findings().filter((finding) => !permitted.has(keyOf(finding.path)))
    expect(outstanding).toEqual([])
  })

  it('has no denial row whose sentence has gone', () => {
    // The table cannot rot into a list of keys nobody checks: a string rewritten to drop the word,
    // or a key renamed, takes its row with it.
    const found = new Set(findings().map((finding) => keyOf(finding.path)))
    expect(DENIALS.filter((row) => !found.has(row.key)).map((row) => row.key)).toEqual([])
  })

  it('renders that sentence on both legal pages', () => {
    // The exemption is not a key nobody uses: FR-006's sentence is on the two pages a person can
    // read without an account, and it is one string, so the two cannot drift apart.
    const sentence = paragraphs(privacyDocument(DEPLOYMENT)).find((text) =>
      text.includes('misconduct'),
    )
    expect(sentence).toBeDefined()
    expect(sentence).toContain('Tassl makes no misconduct findings')
    expect(paragraphs(termsDocument(DEPLOYMENT))).toContain(sentence)
  })

  it('says no more than that on either page', () => {
    // Every other sentence on both documents is clean, including the tables: the pages describe
    // what is stored and what is not done, and only the one sentence names the thing.
    const everyString = (document: LegalDocument): string[] =>
      document.sections.flatMap((section) => [
        section.heading,
        ...section.blocks.flatMap((block) => {
          if (block.kind === 'paragraph') return [block.text]
          if (block.kind === 'list') return [...block.items]
          return [block.caption, ...block.columns, ...block.rows.flat()]
        }),
      ])

    for (const document of [privacyDocument(DEPLOYMENT), termsDocument(DEPLOYMENT)]) {
      const hits = everyString(document)
        .filter((text) => !text.startsWith('Tassl makes no misconduct findings'))
        .flatMap((text, index) => scan({ [`line-${index}`]: text }, [ACCUSATION]))
      expect(hits).toEqual([])
    }
  })
})

describe('the scan can still fail', () => {
  it.each([
    ['debrief.planted', 'The run shows signs of cheating.'],
    ['review.planted', 'This looks like plagiarism.'],
    ['record.planted', 'The student was dishonest about the tool.'],
    ['home.planted', 'A misconduct finding is attached to this run.'],
  ])('catches a planted sentence at %s', (path, planted) => {
    const permitted = new Set(DENIALS.map((row) => row.key))
    const hits = scan({ [path]: planted }, [ACCUSATION])
    expect(hits).not.toEqual([])
    expect(hits.filter((finding) => permitted.has(keyOf(finding.path)))).toEqual([])
  })

  it('catches the word added to a legal page that is not the denial', () => {
    const hits = scan(
      { 'legal.privacy.scope.body': 'Tassl reports misconduct to your institution.' },
      [ACCUSATION],
    )
    expect(hits.map((finding) => finding.word)).toEqual(['misconduct'])
  })
})
