import { enUS, type MessageKey } from './en-US'

export type MessageParams = Record<string, string | number>

/** Resolves a message key to its en-US string and interpolates `{name}` placeholders. */
export function t(key: MessageKey, params?: MessageParams): string {
  const template: string = enUS[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}
