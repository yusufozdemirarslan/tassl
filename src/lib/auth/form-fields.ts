import { z } from 'zod'

import { t } from '@/lib/i18n/t'

/**
 * The field shapes the five public authentication forms share (UI-001 to UI-004). The bounds live
 * here so 12–128 has one source: sign-up, reset, and the password hint on both screens cannot
 * drift apart, and a change to the rule is a change to this file only.
 */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128
export const NAME_MAX_LENGTH = 120

/** Every address field on the public screens; Better Auth lowercases it server-side. */
export const emailField = z.email({ error: t('auth.validation.email') })

/** A password being *chosen*: 12–128, no composition rules (UI-002, UI-004). */
export const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: t('auth.validation.passwordLength') })
  .max(PASSWORD_MAX_LENGTH, { error: t('auth.validation.passwordLength') })

/**
 * A password being *presented* (sign-in): only its presence is checked here. The length rule
 * belongs to the account that was created, not to this attempt, and applying it would tell a
 * stranger that some passwords cannot exist.
 */
export const currentPasswordField = z.string().min(1, { error: t('auth.validation.password') })

/** The person's name on sign-up: 1–120 after trimming (UI-002). */
export const nameField = z
  .string()
  .trim()
  .min(1, { error: t('auth.validation.name') })
  .max(NAME_MAX_LENGTH, { error: t('auth.validation.nameTooLong') })
