---
target: verify-email screen (UI-003)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(public)\\verify-email\\page.tsx"
target_fingerprint: "sha256:bbc54b69f2af1e2db0b6e17f5fd50a4cd7d7c61b5e3d187cd841cfa4e1df448f"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(public)\\verify-email\\page.tsx"
timestamp: 2026-09-04T06-33-14Z
slug: src-app-public-verify-email-page-tsx
---
⚠️ DEGRADED: single-context (no sub-agent/Task tool exposed in this session; Assessment A and B were run sequentially by one context)

Target: `src/app/(public)/verify-email/page.tsx` (UI-003) with `src/components/features/auth/verify-email-panel.tsx` and the shared `auth-feedback.tsx`.
Mode: **Operate**.
Evidence: production build at `http://localhost:3000`, all four documented states (`plain`, `?sent=1&email=…`, `?verified=1`, `?error=INVALID_TOKEN`) inspected at 1440 / 768 / 360, plus intercepted 200 and 500 resend responses and a 60-second cooldown observed to completion; `detect.mjs --json` returned `[]` (exit 0). Screenshots in `.impeccable/review/`.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | The resend button spins with `aria-busy="true"` for the entire 60 s cooldown; a 500 from the resend endpoint is reported as "a new link is on its way" |
| 2 | Match System / Real World | 4 | "That link no longer works", "Confirmation links work once and last 24 hours" — plain, accurate, no jargon |
| 3 | User Control and Freedom | 3 | "Back to sign in" on every state; the verified state offers only "Continue", with no way back if the person did not expect to be signed in |
| 4 | Consistency and Standards | 2 | The two resend affordances behave differently: the button branch sets `aria-busy={isSubmitting}` correctly, the form branch passes cooldown into `pending` |
| 5 | Error Prevention | 3 | The invalid-token state correctly offers a fresh resend rather than a dead end |
| 6 | Recognition Rather Than Recall | 2 | `?sent=1` without `email` makes the person retype the address they typed thirty seconds earlier |
| 7 | Flexibility and Efficiency | 3 | One tab stop to the action in the common state; no way to correct a mistyped address other than starting sign-up again |
| 8 | Aesthetic and Minimalist Design | 4 | Three states, one card, one action each; nothing decorative |
| 9 | Error Recovery | 2 | A failed resend looks exactly like a successful one, and then locks the button for 60 s |
| 10 | Help and Documentation | 2 | No "check your spam folder", no support address, no "wrong address?" path |
| **Total** | **26/40** | | **Acceptable — the three states are right; what the screen says about them is not always true** |

## Design Specificity Verdict

**LLM assessment.** The three-state split is genuinely well modelled, and the page comment explains why the signed-in redirect is skipped for two of them ("bouncing them to /home would delete the only confirmation they ever get") — that is product thinking, not template thinking. The visual world is the same disciplined instrument panel as the rest of the flow: serif h1, hairline card, one secondary action, `Back to sign in` as a plain teal link. Where it goes category-generic is in what it *asserts*. This screen's whole job is to be truthful about an asynchronous event happening in someone's inbox, and in three separate places it says something that is not necessarily true: a bare `/verify-email` claims a link was sent; a 500 from the resend endpoint says a new link is on its way; and a button that is merely cooling down claims to be busy. The instrument panel's promise is "honest about state" — this is the screen where that promise costs the most and is kept the least.

**Deterministic scan.** `detect.mjs --json "src/app/(public)" src/components/features/auth` → `[]`, exit 0. No token drift, no banned font, no nested cards. Everything below is browser-measured.

**Visual overlays.** Not attempted: no browser tool with script injection was exposed and no server could be started. Screenshots are the fallback signal.

## Overall Impression

Four URLs, four correct-looking screens, correct `h1` per state, no horizontal overflow at any default width, focus ring on every stop, all text at 7.56:1 or better. Then you press the one button on the page and it lies to you for a minute: the spinner keeps turning, `aria-busy` stays true, and the label counts down inside a control at 45 % opacity where the countdown is the least legible text on the page (2.03:1). Fix the truthfulness of the states and this screen is finished.

## What's Working

- **The state model matches the spec exactly.** `resolveState` reads `error` before `verified` because Better Auth appends the error to the same callback, and the signed-in redirect is deliberately skipped for `verified` and `invalid`. Each state gets its own `h1` — "Confirm your email address", "Email address confirmed", "That link no longer works" — so the page never reuses a title that has stopped being true.
- **Enumeration protection is consistent.** A resend for an unknown address produces the same "If that address still needs confirming, a new link is on its way" as a known one, matching sign-up's identical treatment of an already-used address.
- **The 360 px rendering of the sent state is genuinely good.** The long address wraps cleanly because `PageHeader` gives its description `break-words`; an 80-character unbreakable address at 360 px still yields `scrollWidth === 360`.

## Priority Issues

### [P1] The resend button reports "busy" for the whole 60-second cooldown
**Why it matters.** `SubmitButton pending={isSubmitting || cooling}` (`verify-email-panel.tsx:127`) drives the spinner, `disabled`, and `aria-busy` from one flag. Measured on `?error=INVALID_TOKEN` after a resend: label "Resend the link in 59 s", `disabled: true`, `aria-busy: "true"`, `.animate-spin` present — for sixty seconds, with no request in flight. A screen reader is told the control is busy for a minute; a sighted user watches a spinner that means nothing. The button branch of this very component (lines 98–107) already does it correctly with `disabled={cooling || isSubmitting}` and `aria-busy={isSubmitting}`, so the two halves of one screen disagree.
**Fix.** Give `SubmitButton` (`auth-feedback.tsx:147`) separate `pending` and `disabled` props — `<Button disabled={disabled ?? pending} aria-busy={pending}>` — and call it as `pending={isSubmitting} disabled={isSubmitting || cooling}` at `verify-email-panel.tsx:127`.
**Suggested command.** `/impeccable harden`

### [P1] A failed resend is reported as a successful one
**Why it matters.** `verify-email-panel.tsx:71-76` only branches on `status === 429`; every other error falls through to `setStatus(t('auth.verify.resendSent'))` and starts the cooldown. Verified by intercepting the resend endpoint with a 500: the screen says "If that address still needs confirming, a new link is on its way" and locks the button for 60 s. The person now waits for an email that was never queued, and cannot retry for a minute. Enumeration protection requires that a *known* and an *unknown* address look identical; it does not require that a server failure look like success. `forgot-password-form.tsx:53-57` has the same shape and the same defect.
**Fix.** In both files, surface `mapAuthError(result.error, probe.seconds)` for `result.error.status >= 500` **and** for the transport rejection (see the network finding), and only fall through to the reassuring message for 2xx and for the 4xx codes that would otherwise enumerate accounts. Do not start the cooldown on a failed send.
**Suggested command.** `/impeccable harden`

### [P1] A bare `/verify-email` claims an email was sent
**Why it matters.** `resolveState` (`verify-email/page.tsx:30-34`) returns `'sent'` whenever neither `error` nor `verified` is present, so `/verify-email` with no query at all renders the h1 "Confirm your email address" and the body "We sent a confirmation link to your email address. Open it to finish setting up your account; the link works for 24 hours." Nothing was sent. Anyone who reaches this URL from a bookmark, a shared link, or a back-button is told an email is on its way and will wait for it. The same state also shows an empty email field beneath that sentence, which contradicts the claim.
**Fix.** Make the bare case its own state in `resolveState` — when `sent`, `verified` and `error` are all absent, render a neutral title and body ("Confirm your email address" / "Enter the address you signed up with and we'll send a new link") above the existing resend form. Reserve `auth.verify.sentBodyNoEmail` for the genuine `?sent=1` case.
**Suggested command.** `/impeccable clarify`

### [P1] Activating the resend button destroys keyboard focus
**Why it matters.** In the `?sent=1&email=…` state the resend control is a real `disabled` button. Measured: focus the button, press Enter, and `document.activeElement` is `body` — the browser drops focus when the focused element becomes `disabled`. The next Tab restarts from the top of the document. DESIGN.md's own button rule anticipates this: "using `aria-disabled` where the control must stay discoverable". The polite status message that explains what happened is also not focused, so a keyboard user is left at the document root with no indication that anything occurred.
**Fix.** In `verify-email-panel.tsx:98-107` use `aria-disabled={cooling || isSubmitting}` with a guard in `onClick` instead of `disabled`, so focus survives and the countdown label stays reachable. The same applies to `ResetPasswordForm`'s success branch (`reset-password-form.tsx:66-78`), which replaces the whole form and leaves `activeElement` on `body`; give it the `takeFocus` treatment `ForgotPasswordForm` already uses.
**Suggested command.** `/impeccable harden`

### [P2] The countdown is the least readable text on the page
**Why it matters.** "Resend the link in 60 s" is the only place the remaining wait is shown, and it lives inside the disabled control at 45 % opacity — measured at **2.03:1** on the secondary variant and **1.4:1** on the primary. Disabled controls are exempt from WCAG 1.4.3, but the exemption assumes the label is not carrying information the person needs; here it is the only information on the screen.
**Fix.** Keep the 45 % disabled treatment (it is the contract) and move the countdown out of the control: the button reverts to "Resend the link" and a `--ink-muted` line beneath it — or the existing `FormStatus` — carries "You can ask for another link in 60 s", in Mono per DESIGN.md's Tabular Clock Rule so the digits do not shift.
**Suggested command.** `/impeccable clarify`

## Persona Red Flags

**Jordan (First-Timer).** Signs up, lands here, does not find the email (it is in spam — the screen never suggests looking), presses "Resend the link", and gets a spinner that spins for a full minute with the countdown greyed out to near-illegibility. There is no "wrong address?" path, so if Jordan mistyped the address at sign-up the only route out is to sign up again with no indication that this is what to do.

**Sam (Screen-reader user).** Presses Enter on "Resend the link", focus vanishes to `body`, and the control they were on is announced as busy for the next sixty seconds. The status message that explains what happened is a `role="status"` region that was `display:none` a frame earlier (`auth-feedback.tsx:132`), so the announcement is unreliable.

**Alex (Power User).** Opens `/verify-email` from a bookmark to check whether the account is confirmed, and is told an email was just sent. It was not.

## Minor Observations

- `export const metadata` is a constant (`verify-email/page.tsx:12`), so all four states share the browser-tab title "Confirm your email address · Tassl" — including `?verified=1` (h1 "Email address confirmed") and `?error=` (h1 "That link no longer works"). `reset-password/page.tsx:11` has the same problem. Both need `generateMetadata({ searchParams })` reusing the existing `TITLES` map.
- The `?verified=1` state has no "Back to sign in" link — the only control is "Continue to Tassl". A person who verified on a shared device has no visible way out.
- At a 32 px root font the "Continue to Tassl" link-button measures 270 px wide starting at x=81 in a 360 px viewport: it escapes the card because `buttonVariants` carries `whitespace-nowrap` and no `max-w-full`.
- `PageHeader`'s description has `break-words` but its `<h1>` does not (`page-header.tsx:22` vs `:29`), so "That link no longer works" overflows the card at 200 % text.
- The email address in the sent body is set in `--ink-muted` at the same weight as the surrounding sentence. It is the one fact on the screen the person needs to check; DESIGN.md's Mono-with-tabular-figures voice exists for exactly this.

## Questions to Consider

- The screen never says "check your spam folder", which is the actual reason most people are still on it after two minutes. What is the cost of one more sentence?
- If the address in the sent state were editable rather than merely displayed, would the invalid-token branch's separate resend form still need to exist?
- Three of this screen's four states are reached by a link someone clicked in an email client that may have prefetched it. Does "That link no longer works" say the right thing to someone whose scanner burned the token before they saw it?
