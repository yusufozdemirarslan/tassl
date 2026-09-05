// A `t` bound to part of the catalogue (docs/tech/04-repo-structure.md, NFR-017, SYS-021).
//
// `src/lib/i18n/t.ts` binds one to the whole of `enUS`, which is what server code and Server
// Components use. A Client Component instead imports the `t` its own namespace module exports, so
// the bundle carries that namespace's strings and not the other 27 (docs/tech/16 §3.4): the
// catalogue is one object literal per namespace under `messages/`, and nothing pulls in a
// namespace it never reads.

export type MessageParams = Record<string, string | number>

/** One namespace's slice of the catalogue: dotted keys to their en-US strings. */
export type Messages = Readonly<Record<string, string>>

/** Distributes over the union, so two slices give the union of their keys and not the shared ones. */
type KeyOf<M> = M extends unknown ? keyof M : never

/** A `t` that still takes the full dotted key, typed to the slices it was bound to. */
export type Translate<Maps extends readonly Messages[]> = (
  key: KeyOf<Maps[number]> & string,
  params?: MessageParams,
) => string

/** Interpolates `{name}` placeholders; a name the caller did not pass is left as it was written. */
export function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}

function merge(maps: readonly Messages[]): Messages {
  if (maps.length === 1) return maps[0]!
  const out: Record<string, string> = {}
  for (const map of maps) for (const [key, value] of Object.entries(map)) out[key] = value
  return out
}

/**
 * Binds `t` to one or more namespace slices. Call sites keep the full dotted key —
 * `t('packages.title')` — and the key type is exactly what those slices hold, so a key from a
 * namespace the component did not import is a compile error rather than a missing string.
 */
export function scopedT<const Maps extends readonly Messages[]>(...maps: Maps): Translate<Maps> {
  const messages = merge(maps)
  return (key, params) => interpolate(messages[key]!, params)
}
