// Every user-facing string lives here (docs/tech/04-repo-structure.md, NFR-017, SYS-021).
// Keys are dot-separated by screen or module; values may carry {param} placeholders.
export const enUS = {
  'landing.title': 'Tassl',
  'landing.tagline': 'Make the call.',

  // Shared UI primitives
  'ui.close': 'Close',
} as const

export type MessageKey = keyof typeof enUS
