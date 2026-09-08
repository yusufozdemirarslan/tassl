// PII minimization before a third party sees a word of it (docs/tech/11-llm-integration.md §3,
// D-066, SYS-025).
//
// Everything a student writes inside a run — the frame, the delegation requests, the brief, the Turn
// justification, the defense answers — is read by a model, and everything a package carries came out
// of a document a human pasted in. Neither is ours to hand to a vendor in full. What leaves is the
// text with three things taken out of it:
//
//   * **E-mail addresses.** The one identifier a student is most likely to type into their own
//     writing, and the one 06's tables treat as identity everywhere else.
//   * **Credentialed URLs** — `https://user:secret@host/path`. A seed case pasted from an internal
//     wiki is exactly where one of these turns up, and it is a live credential rather than a name.
//   * **Telephone numbers**, in the three shapes that cannot be anything else.
//
// **Ordinary numbers are never touched, and that is the hard half of this file.** Tassl is a product
// about figures: `61 percent`, `$4,200`, `2.1`, `2026-09-02`, `1,200 to 2,000`. The numeric guard
// (D-068) decides what the assistant may say about them and it works by comparing the reply's
// figures with the room's; a redactor that ate a payback figure on the way out would make the room's
// own numbers unverifiable and the guard would flag the model for quoting them. So the phone rule
// asks for a shape a quantity does not have — a `+` country prefix, a parenthesised area code, or
// three groups joined by `-` or `.` in the 3-3-4 arrangement — and nothing else. A bare run of digits
// is a number, and a number stays.
//
// The replacement is a marker rather than a deletion: a model that reads "e-mail [redacted] about
// the schedule" knows a name was there and can write around it, where a model that reads "e-mail
// about the schedule" has been handed a sentence that says something else.
//
// Where it runs: `untrusted()` (`prompts/untrusted.ts`) applies it to every field it wraps, which is
// every untrusted field of every prompt in the library (D-650). One place, and it is the renderer, so
// a prompt cannot be written that forgets it.

/** What replaces a match. Deliberately lower case and bracketed: it reads as a redaction, not text. */
export const REDACTED = '[redacted]'

/**
 * `local@domain.tld`. The local part is the permissive one because a student writes their own
 * address, not a validator's; the domain must end in a letters-only TLD so that `2.1@4` is not one.
 */
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g

/**
 * `scheme://user:password@host…`, the whole URL.
 *
 * The credential is the reason to redact and the host is the reason to redact the rest of it: a
 * secret is only a secret alongside what it opens. A URL with no `user:pass@` is left alone — the
 * Evidence Room's documents cite sources, and a redacted citation is a document that cannot be
 * traced, which is the one thing the Source Trace exists for.
 */
const CREDENTIALED_URL = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@\S+/g

/**
 * The three telephone shapes, and no fourth.
 *
 * 1. `+44 20 7946 0958`, `+1 (555) 010-4477`: a `+`, then at least eight more digits among
 *    separators. The `+` prefix is what makes this unambiguous — no quantity in a business document
 *    is written with a leading plus and eight digits.
 * 2. `(555) 010-4477`: a parenthesised three-digit group. Parentheses around exactly three digits
 *    followed by more digits is a phone number or nothing.
 * 3. `555-010-4477`, `555.010.4477`: 3-3-4 joined by hyphens or dots. Three groups, fixed lengths.
 *    `2026-09-02` has a four-two-two shape and does not match; `1,200-2,000` uses commas inside its
 *    groups and a four-digit first group, and does not match either.
 *
 * A space-separated run is deliberately not a shape: `600 120 240` is three numbers in a table far
 * more often than it is a number somebody can ring.
 */
const PHONE_PATTERNS: readonly RegExp[] = [
  /\+\d(?:[\d\s().-]{6,}\d)/g,
  /\(\d{3}\)[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
  /\b\d{3}([-.])\d{3}\1\d{4}\b/g,
]

/**
 * The text with e-mails, credentialed URLs and telephone numbers replaced by `[redacted]`.
 *
 * Order matters: the URL rule runs before the e-mail rule, because `https://a:b@c.example/d` holds
 * something an e-mail pattern would match and redacting the address alone would leave the password
 * in the prompt. Phones run last, over text the first two have already taken their matches out of.
 */
export function redactPii(text: string): string {
  if (text === '') return text
  let out = text.replace(CREDENTIALED_URL, REDACTED).replace(EMAIL, REDACTED)
  for (const pattern of PHONE_PATTERNS) out = out.replace(pattern, REDACTED)
  return out
}

/** True when `redactPii` would change the text; for tests and for the outbound-body assertions. */
export const hasPii = (text: string): boolean => redactPii(text) !== text
