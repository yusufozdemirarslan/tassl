// The analytics allowlist, as two constants: docs/tech/17-analytics-events.md §6.
//
// Rule 3 of 17 §1 is enforced twice. At compile time every catalogue event is a `z.strictObject`
// whose leaves are ids, enums, counts, durations, shares, booleans, and regex-constrained strings,
// so an unknown or free-text property does not type-check and does not validate. At run time the
// `ops_*` counters (13 §3.7) assemble their properties from whatever the emitting site had at hand,
// so they are filtered against the same two rules before anything leaves the process.
//
// These live in `src/lib` because both halves need them: the catalogue test walks every schema's
// keys with the pattern, and the server transport filters with it.

/**
 * A property name that would name a person, a place, or a piece of authored text. Matched on the
 * key's last underscore-separated word, so `email`, `user_email`, `answer_text`, and
 * `justification` are all refused while `documents_opened_count` is not.
 *
 * The one exception is a `has_` prefix. `has_why` and `has_note` (17 §3.3, §3.4) are booleans that
 * say *whether* the student wrote a "why" line or the instructor left a note — the presence of the
 * thing, never the thing — and a rule that refused them would refuse the safe answer to the exact
 * question the catalogue is careful to ask (D-564).
 */
export const FORBIDDEN_PROPERTY_PATTERN =
  /^(?!has_)(?:[a-z0-9]+_)*(name|email|text|body|ip|address|answer|statement|purpose|justification|why|note|title|url|password|token|phone)$/

/**
 * The longest string an event property may carry. Every legitimate value is an id, an enum, a
 * prompt name, or a model name; 200 characters is far above all of them and far below any sentence
 * a student or an author wrote.
 */
export const MAX_PROPERTY_STRING_LENGTH = 200
