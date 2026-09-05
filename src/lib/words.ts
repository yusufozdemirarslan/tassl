// Word counting, markup stripping, and the word-limit bound every free-text field is built from
// (docs/tech/10-backend-spec.md §5, 12-security.md §4 row A03, 10-backend-spec-modules.md §17,
// D-075, FR-103).
//
// This file lives in `src/lib` on purpose: the form counts words while the student types and the
// server counts them again when the field arrives, and D-075 requires those two counts to agree
// exactly. One implementation, imported by both, is the only way to guarantee that — so nothing
// here may reach for `src/server`, and nothing here may depend on a parser or a sanitizer package
// whose version could drift between the browser bundle and the Node runtime.
import { z } from 'zod'

/**
 * D-075: a word is any maximal run of non-whitespace, counted after trimming.
 *
 * `\s` is JavaScript's own whitespace class, so the same engine that runs the form runs the
 * validator and the two never disagree. Non-breaking spaces, the Unicode space separators, and the
 * line separators all split, which is what a reader would count.
 */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

// Markup stripping (10 §5): HTML tags, markdown link syntax, control characters except newlines.
//
// The point is not output safety — React escapes everything it renders and `react/no-danger` is an
// error — it is that FR-103 promises plain text with hard word limits, and pasted markup would
// otherwise be stored, counted as words, and read back as noise.

/** `<!-- … -->`, including one that is never closed, which would otherwise be left as prose. */
const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g

/** `<!DOCTYPE …>`, `<![CDATA[…]]>`, and `<?xml …?>`. */
const HTML_DECLARATION = /<[!?][\s\S]*?>/g

/**
 * A tag: `<`, an optional `/`, then a letter. Requiring the letter is what keeps prose intact —
 * "churn < 6 percent > baseline" contains no tag, and `/<[^>]*>/` would eat the middle of it.
 */
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g

/**
 * `[label](target)` and `![alt](src)` collapse to the words a reader sees; the target is dropped.
 * Brackets nested inside a label are beyond a regex, and are left as the literal text they are.
 */
const MARKDOWN_INLINE_LINK = /!?\[([^\]]*)\]\([^)]*\)/g

/** `[label][ref]`, and the reference definition line it points at. */
const MARKDOWN_REFERENCE_LINK = /!?\[([^\]]*)\]\[[^\]]*\]/g
const MARKDOWN_LINK_DEFINITION = /^[ \t]*\[[^\]]*\]:[ \t]*\S+.*$/gm

/**
 * Control characters that survive `stripMarkup`'s `\r` normalization, plus the invisible formatting
 * characters a paste can carry: zero-width spaces and joiners, the byte-order mark, the word
 * joiner, and the bidirectional overrides that can make stored text read in an order it was not
 * written in. Tab and newline are deliberately kept — they are whitespace, so `countWords` splits
 * on them, and deleting a tab would silently glue two words into one.
 */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/**
 * Strips markup from free text and trims it (10 §5: "all text is trimmed"), so the value that
 * `countWords` sees, the value `.min(1)` sees, and the value stored are the same value.
 *
 * Emphasis markers (`**bold**`, `_italic_`) are left alone: they change no word count, they are
 * rendered verbatim as the characters the student typed, and removing them would corrupt prose that
 * uses an underscore or an asterisk for its own reasons.
 */
export function stripMarkup(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(HTML_COMMENT, '')
    .replace(HTML_DECLARATION, '')
    .replace(HTML_TAG, '')
    .replace(MARKDOWN_LINK_DEFINITION, '')
    .replace(MARKDOWN_INLINE_LINK, '$1')
    .replace(MARKDOWN_REFERENCE_LINK, '$1')
    .replace(INVISIBLE, '')
    .trim()
}

/**
 * The bound for a free-text field (10 §17): `wordLimit(50)`, `wordLimit(120).min(1)`.
 *
 * It stays a `ZodString` — `overwrite` and `refine` are checks in Zod 4, not wrappers — so the
 * caller can keep chaining and every later check reads the stripped, trimmed text. That is what
 * makes `wordLimit(n).min(1)` mean "not empty once the markup is gone" rather than "the paste was
 * not empty", which is the reading 10 §17 gives it.
 *
 * The message is the code `WORD_LIMIT`, not a sentence: a validator message is a wire value that
 * `z.flattenError` hands to the screen under `details.fieldErrors`, and the words the reader sees
 * come from `t()` there. `params` carries the limit for anything that reads the issue directly,
 * but the envelope does not: `flattenError` keeps messages and drops everything else, so a screen
 * naming the number takes it from the same constant it passed to `wordLimit` — the form and the
 * server build the field from one schema, so there is only ever one number to name.
 */
export function wordLimit(n: number): z.ZodString {
  return z
    .string()
    .overwrite(stripMarkup)
    .refine((value) => countWords(value) <= n, { error: 'WORD_LIMIT', params: { limit: n } })
}
