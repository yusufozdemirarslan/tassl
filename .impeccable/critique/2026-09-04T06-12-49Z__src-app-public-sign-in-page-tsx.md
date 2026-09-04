---
target: public sign-in screen (UI-001)
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(public)\\sign-in\\page.tsx"
target_fingerprint: "sha256:85cd31929b483bb93ef53aa8fe34f7dc68d36a31e918fdbc9af95a94933dc450"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(public)\\sign-in\\page.tsx"
timestamp: 2026-09-04T06-12-49Z
slug: src-app-public-sign-in-page-tsx
---
⚠️ DEGRADED: single-context (no sub-agent/Task tool exposed in this review-lane session; Assessment A and Assessment B were run sequentially in one context by the same agent)

Mode: **Operate** (public authentication; the visitor's success is "I am signed in", not "I am persuaded").
Evidence: production build at `http://localhost:3000`, inspected with a throwaway Playwright script at 1440 / 768 / 360 / 320 CSS px and at 200 % text-only zoom. Screenshots and raw measurements in `.impeccable/review/` (`report.json`, `report2.json`, `report3.json`).

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | A network failure during submit produces **nothing** — no alert, no status, no console-visible message; the button re-enables and the screen looks untouched. |
| 2 | Match System / Real World | 4 | "Use the email address your institution knows you by." is exactly the sentence this audience needs; no jargon anywhere. |
| 3 | User Control and Freedom | 3 | Forgot / create-account exits are present, but activating Submit `disabled`s the focused button and drops keyboard focus to `<body>`. |
| 4 | Consistency and Standards | 3 | Focus recipe, 40 px controls and token colours are exact; `gap-5` (20 px) is off the documented 4/8/12/16/24 scale in six places, and `FormStatus` uses `--primary-soft` where DESIGN.md reserves `--green-soft` for confirmation surfaces. |
| 5 | Error Prevention | 3 | Zod + `noValidate` + correct `autocomplete` tokens; but "Resend verification" can be fired repeatedly with no pending guard. |
| 6 | Recognition Rather Than Recall | 4 | Labels are always visible, never placeholders; `autocomplete="email" / "current-password"` let the password manager do the remembering. |
| 7 | Flexibility and Efficiency | 3 | `autoFocus` on email, Enter submits, "Keep me signed in" defaults on. No password-reveal toggle. |
| 8 | Aesthetic and Minimalist Design | 4 | One card, one accent, one action. Nothing decorates. This is the instrument-panel register done properly. |
| 9 | Error Recovery | 1 | Two of the four failure paths mislead: an offline submit says nothing at all, and a rate-limited "Resend verification" reports success ("a new link is on its way") for an email that was never sent. |
| 10 | Help and Documentation | 3 | Forgot-password and resend are the right two escape hatches; there is no "still stuck?" contact route, and `/privacy` and `/terms` do not exist yet (phase scope, not a defect). |
| **Total** | | **29/40** | Good — but the two 1s are on the same axis: the screen does not tell the truth when the call fails. |

## Design Specificity Verdict

**Authored for this product.** The card is not a generic auth template: the type is IBM Plex Serif over Plex Sans, the single accent is the deep teal that means "action" everywhere else in Tassl, depth is a hairline rather than a shadow, and the copy speaks to a student whose institution owns the roster. Swap it into an unrelated SaaS and it would read as borrowed. The one place it becomes interchangeable is the failure surface: a generic red box with a generic sentence, which is where an assessment product that is *about* honest state reporting should be at its most precise.

**Deterministic scan:** `node .claude/skills/impeccable/scripts/detect.mjs --json "src/app/(public)" "src/components/features/auth"` → `[]`, exit 0. No detector findings; every issue below came from the browser evidence or from reading the source against DESIGN.md and 09 §UI-001.

**Visual overlays:** not attempted. No browser-canvas tool is exposed in this lane and the running server is a production build that must not be touched, so the live-server injection flow was skipped deliberately; static screenshots at four widths stand in.

## Overall Impression

The static screen is close to finished. Contrast, focus rings, control heights, tab order, reflow at 320 px and 200 % text zoom are all clean — I could not find a single WCAG AA failure in the resting state. Everything wrong here is in the *transitions*: what the screen says while a request is in flight, and what it says when the request fails. A sign-in form that silently swallows a network error is a worse defect than any amount of visual drift, because the student's only recourse is to press the button again and watch nothing happen.

## What's Working

1. **The focus recipe is honoured exactly, everywhere.** Every focusable element measured `outline: solid 2px rgb(15,110,116)` at `outline-offset: 2px`, and every text input additionally turns its border `--primary`. No `outline-none` traps (D-158), no half-alpha glows. That is rarer than it sounds.
2. **The Base UI checkbox naming trap is handled correctly.** The server HTML already carries `role="checkbox" aria-labelledby="sign-in-remember-label"`, the native input is `aria-hidden`, clipped and `tabindex="-1"`, the visible label toggles it, and the `::after` pad measures a real 40 × 40 hit area (verified with `elementFromPoint`). The accessibility tree reads `checkbox "Keep me signed in" [checked]` before hydration.
3. **The refusal copy never leaks who has an account.** `INVALID_EMAIL_OR_PASSWORD`, `INVALID_EMAIL`, `INVALID_PASSWORD` and `USER_NOT_FOUND` all collapse to one sentence that names no field — the enumeration-protection requirement of 08 §2.3 met at the copy layer, not just the API layer.

## Priority Issues

- **[P0] A network failure produces no feedback of any kind.**
  **Why it matters:** with the request aborted, all five auth forms leave the alert region empty, re-enable the submit button and log `TypeError: Failed to fetch` as an unhandled `pageerror`. The student presses Sign in, the spinner blinks, and the screen returns to exactly where it was. There is no message to read and nothing to act on. The comment at `auth-feedback.tsx:9-18` asserts Better Auth "never throws" — true for HTTP refusals, false for fetch-level failures, and the whole error path is built on that assumption.
  **Fix:** wrap each `authClient.*` call in `try/catch` (or add one shared `callAuth()` helper in `auth-feedback.tsx`) and map a thrown error to `t('auth.error.generic')`.
  **Suggested command:** `/impeccable harden`

- **[P1] A rate-limited "Resend verification" is announced as a success.**
  **Why it matters:** `resendVerification()` (`sign-in-form.tsx:81-89`) ignores the result entirely — it clears the error and sets "If that address still needs confirming, a new link is on its way" even when the API answered 429 with `X-Retry-After: 42`. Verified in the browser. The student then waits for an email that was never sent, on the one screen where waiting for an email is the whole point. UI-001 documents a rate-limited state with retry seconds for this screen; this action bypasses it.
  **Fix:** give the resend the same `retryAfterProbe()` + `mapAuthError` treatment as the submit, and a `pending` guard so it cannot be double-fired.
  **Suggested command:** `/impeccable harden`

- **[P2] Submitting drops keyboard focus to `<body>`.**
  **Why it matters:** the submit button is `disabled` while the request is in flight, and in Chromium clicking or Entering it has focused it — so disabling it evicts focus to the document body. After a refused sign-in the keyboard user is back at the top of the document and must Tab through everything again. Verified: activating the button by keyboard leaves `document.activeElement === body`; submitting with Enter from the password field keeps focus (only that one path is safe).
  **Fix:** DESIGN.md already sanctions the alternative — keep the control focusable with `aria-disabled="true"` plus an early return in the handler, instead of `disabled`.
  **Suggested command:** `/impeccable adapt`

- **[P2] The live regions are `display:none` while empty, which defeats their stated purpose.**
  **Why it matters:** `FormAlert` and `FormStatus` carry `empty:hidden`, so an empty `role="alert"` computes `display:none` and is absent from the accessibility tree (measured). The comment at `auth-feedback.tsx:95-97` says the region is always mounted so announcements fire on *content change* rather than on *region insertion* — but a `display:none` region is, to assistive technology, not mounted. The pattern degrades to exactly the case it was written to avoid.
  **Fix:** keep the region rendered and take it out of the gapped flex flow another way — move it outside the `flex flex-col gap-5` stack, or give it `sr-only`-style clipping when empty rather than `display:none`.
  **Suggested command:** `/impeccable harden`

- **[P2] Off-scale spacing is now the default rhythm of every auth form.**
  **Why it matters:** `gap-5` = 20 px, and DESIGN.md §Layout fixes the scale at 4/8/12/16/24/32/48/64 with the note that the Tailwind numeric scale "is never remapped". It appears in `sign-in-form.tsx:94`, `sign-up-form.tsx:80`, `forgot-password-form.tsx:65`, `reset-password-form.tsx:82`, `verify-email-panel.tsx:93,113` (and `ui/field.tsx:47`), so the field rhythm on all five public screens is off-token. `gap-x-1.5` (6 px) adds a second off-scale value.
  **Fix:** `gap-5` → `gap-4` (16 px) or `gap-6` (24 px); `gap-x-1.5` → `gap-x-2`.
  **Suggested command:** `/impeccable layout`

## Persona Red Flags

**Jordan (First-Timer — a third-year student on campus wifi):** signs in from a lecture hall, the wifi drops mid-request, and the screen says nothing. Jordan presses Sign in three more times, concludes the account is broken, and emails the instructor. Nothing on the screen would have told them the request never left the laptop.

**Sam (Screen-reader user, NVDA + Firefox):** submits, focus is thrown to the top of the document, and the refusal arrives from a region that was `display:none` a frame earlier. Sam hears the error but has lost their place in the form and must re-Tab to the email field to correct it. The "Resend verification" button they then activate vanishes from the DOM as the alert clears, throwing focus to `<body>` a second time.

**Alex (Power User — instructor signing in between classes):** everything Alex wants is here (Enter submits, remember-me is on by default, the password manager fills both fields from the correct `autocomplete` tokens). No red flags; this persona is well served.

## Minor Observations

- Document title is correct here (`Sign in to Tassl · Tassl`) but is stale on the sibling states — see the verify-email snapshot.
- The "Resend verification" button inside the alert is 32 px (`size="sm"`); DESIGN.md permits sm buttons at 32 px but also sets a 40 px minimum touch target, and this is the only control on the screen below 40. It clears WCAG 2.5.8 (≥ 24 px) comfortably.
- `FormStatus` renders a confirmation on `--primary-soft` with no icon, while `FormAlert` renders a refusal on `--red-soft` with one. DESIGN.md assigns `--green-soft` (with the green as the icon) to confirmation surfaces and `--primary-soft` to selected rows.
- Client validation fires three simultaneous `role="alert"` regions on an empty sign-up submit; one assertive summary plus `aria-describedby` descriptions would interrupt once instead of three times.
- The Google path (`googleEnabled`, the `or` divider, `GoogleButton`) could not be exercised: `GOOGLE_CLIENT_ID` is empty in this build, so that documented UI-001 state is unverified.
- Under `prefers-reduced-motion` the spinner's `animation-duration` is 0 s, so the pending state's only moving cue freezes. `disabled` + `aria-busy` still carry the state, but a text change ("Signing in…") would carry it visibly.

## Questions to Consider

- What does this screen owe a student whose request never left the browser? Right now the answer is "nothing", and this is the product that teaches people to notice when a system is quietly unreliable.
- If the resend action can lie about having sent an email, what else on this surface reports success it has not verified?
- The refusal box is the least Tassl-specific thing on the screen. What would a refusal designed by the same hand that designed the stance chips look like?
