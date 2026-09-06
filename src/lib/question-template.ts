// The defense question template's placeholder vocabulary (10 §9 step 4; FR-122, D-135, D-342).
//
// It lives in `src/lib` because two modules need the same list and neither may import the other's
// internals: `defense/selection.ts` fills the placeholders when it renders a question for a run, and
// `scenarios/validate.ts` refuses a package whose template names one that will never be filled. A
// second copy of the list is the defect this file exists to make impossible — the renderer and the
// authoring rule would disagree the moment either gained a name.
//
// Pure text, no dependencies. `src/lib` never imports `src/server` (04 §2), and nothing here needs
// to: a placeholder is a spelling, and what a run has to put in it is the caller's business.

/**
 * The five names a template may carry (10 §9 step 4).
 *
 * They are the run's own words in the author's sentence: the claim as the student read it, the
 * figure they typed in their own unit, the stance they ended on, the document a claim came from,
 * and the frame assumption in question. Nothing else is substitutable, because nothing else is a
 * fact the selector holds at the moment it renders.
 */
export const QUESTION_PLACEHOLDERS = [
  'claim_text',
  'figure',
  'stance',
  'document_title',
  'assumption',
] as const

export type QuestionPlaceholder = (typeof QUESTION_PLACEHOLDERS)[number]

/**
 * Every `{name}` a template contains, in the order it contains them, duplicates collapsed.
 *
 * The pattern is deliberately narrower than "anything in braces": a name is lower-case letters and
 * underscores, which is how all five are spelled and how a new one would be. Prose that happens to
 * carry a brace — "{see appendix}", a currency example — is therefore not read as a placeholder and
 * not reported as one, and neither is a template with no braces at all.
 */
export function placeholdersIn(template: string): string[] {
  const found = new Set<string>()
  for (const match of template.matchAll(/\{([a-z_]+)\}/g)) {
    const name = match[1]
    if (name !== undefined) found.add(name)
  }
  return [...found]
}

/**
 * The placeholders in `template` that nothing will ever fill (D-369).
 *
 * `renderTemplate` substitutes the five above and leaves everything else exactly as written, so an
 * unknown name reaches the student as literal braces in the middle of a question — the machinery on
 * the screen, which is the one outcome D-342 ruled out when it chose to render an *empty* value for
 * a known name with nothing behind it. A confirmed package is supposed to be safe to put in front of
 * a student (PRD §7.18), so this is an authoring rule rather than a rendering one: the author is
 * told at validation, where they can fix the sentence, instead of the student meeting it mid-run.
 */
export function unknownPlaceholdersIn(template: string): string[] {
  const known: readonly string[] = QUESTION_PLACEHOLDERS
  return placeholdersIn(template).filter((name) => !known.includes(name))
}
