import { enUS, type MessageKey } from './en-US'
import { interpolate, type MessageParams } from './scoped'

export type { MessageParams }

/**
 * Resolves a message key to its en-US string and interpolates `{name}` placeholders.
 *
 * This `t` is bound to the whole catalogue, so importing it pulls all 28 namespaces in. Server
 * code and Server Components use it; a Client Component imports the `t` of its own namespace
 * module instead (`@/lib/i18n/messages/<namespace>`) so the browser is not sent 786 strings to
 * render a dialog (docs/tech/16 §3.4).
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return interpolate(enUS[key], params)
}
