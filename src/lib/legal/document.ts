// The shape a legal page is written in (UI-006, SYS-007, D-017).
//
// `privacy.ts` and `terms.ts` build one of these from the message catalogue and from what the
// deployment is actually configured with; `src/app/(public)/{privacy,terms}/page.tsx` renders it.
// The split is what makes the pages testable without a browser: a claim on either page is a value
// in a structure a unit test can read, rather than JSX somebody has to look at.
//
// `src/lib` never imports `src/server` (04 §2), so the deployment facts arrive as an argument.

/** One block of a section. A section is a heading and the blocks under it, in order. */
export type LegalBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: readonly string[] }
  | {
      kind: 'table'
      /** One short line naming the table; it is the table's accessible name (DESIGN.md §Tables). */
      caption: string
      columns: readonly string[]
      rows: readonly (readonly string[])[]
    }

export type LegalSection = {
  /** Stable anchor, used by the contents list at the top of the page. */
  id: string
  heading: string
  blocks: readonly LegalBlock[]
}

export type LegalDocument = {
  title: string
  summary: string
  /** ISO date (YYYY-MM-DD) of the last human review; the page formats it. */
  lastReviewed: string
  sections: readonly LegalSection[]
}

/**
 * What the pages need to know about the installation they are being read on.
 *
 * Every field is a fact the server can answer from its own configuration, and each one decides a
 * row of the processor table or a sentence beside it. The point is that the page describes *this*
 * deployment: a service that is switched off is not named as one that handles your data.
 */
export type LegalDeployment = {
  /** The address a person writes to; the address part of `EMAIL_FROM`. */
  contactEmail: string
  /** True when the deployment runs on the managed platform rather than on a developer's machine. */
  managedHosting: boolean
  /** True when email actually leaves the process (`EMAIL_TRANSPORT=resend`). */
  emailDelivery: boolean
  /** True when the Google button is offered (`GOOGLE_CLIENT_ID` is set). */
  googleSignIn: boolean
  /** True when product analytics is switched on (`NEXT_PUBLIC_POSTHOG_KEY` is set). */
  analytics: boolean
  /** True when error monitoring is switched on (`NEXT_PUBLIC_SENTRY_DSN` is set). */
  errorMonitoring: boolean
  /** `effectiveLlmProvider()`; `mock` means no run text can reach a model provider. */
  llmProvider: string
  /** The model name behind that provider; only shown when the provider is not the mock. */
  llmModel: string
}

/** Drops the blocks a deployment does not have, so a section never renders an empty list. */
export const blocks = (...maybe: readonly (LegalBlock | null)[]): LegalBlock[] =>
  maybe.filter((block): block is LegalBlock => block !== null)

/** Drops the rows a deployment does not have (a processor that is switched off). */
export const rows = (
  ...maybe: readonly (readonly string[] | null)[]
): readonly (readonly string[])[] => maybe.filter((row): row is readonly string[] => row !== null)
