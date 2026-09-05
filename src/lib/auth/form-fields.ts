import { email, maxLength, minLength, string, trim } from 'zod/mini'

import { t } from '@/lib/i18n/messages/auth'

/**
 * The field shapes the five public authentication forms share (UI-001 to UI-004). The bounds live
 * here so 12–128 has one source: sign-up, reset, and the password hint on both screens cannot
 * drift apart, and a change to the rule is a change to this file only.
 *
 * Zod is imported from `zod/mini`, one named function at a time (B5, D-184). The classic `z`
 * namespace is a single object that reaches every schema class, the whole error machinery,
 * `toJSONSchema` and the locale table, so no bundler can drop any of it: it costs 94 KB gzip on
 * every screen that renders a form. The mini builders validate identically — same checks, same
 * issue codes, same messages, same resolver output — and only what these fields name is bundled.
 * The trade is the fluent methods: a rule is a `check()` argument rather than a chained call.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128
export const NAME_MAX_LENGTH = 120

/** Every address field on the public screens; Better Auth lowercases it server-side. */
export const emailField = email({ error: t('auth.validation.email') })

/** A password being *chosen*: 12–128, no composition rules (UI-002, UI-004). */
export const newPasswordField = string().check(
  minLength(PASSWORD_MIN_LENGTH, { error: t('auth.validation.passwordLength') }),
  maxLength(PASSWORD_MAX_LENGTH, { error: t('auth.validation.passwordLength') }),
)

/**
 * A password being *presented* (sign-in): only its presence is checked here. The length rule
 * belongs to the account that was created, not to this attempt, and applying it would tell a
 * stranger that some passwords cannot exist.
 */
export const currentPasswordField = string().check(
  minLength(1, { error: t('auth.validation.password') }),
)

/**
 * The person's name on sign-up: 1–120 after trimming (UI-002). `trim()` is an overwriting check,
 * so it runs first and the two length checks — and the submitted value — see the trimmed string,
 * exactly as the chained `.trim().min().max()` did.
 */
export const nameField = string().check(
  trim(),
  minLength(1, { error: t('auth.validation.name') }),
  maxLength(NAME_MAX_LENGTH, { error: t('auth.validation.nameTooLong') }),
)
