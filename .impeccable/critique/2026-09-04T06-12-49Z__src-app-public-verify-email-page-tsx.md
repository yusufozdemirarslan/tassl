---
target: public verify-email screen (UI-003)
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(public)\\verify-email\\page.tsx"
target_fingerprint: "sha256:bbc54b69f2af1e2db0b6e17f5fd50a4cd7d7c61b5e3d187cd841cfa4e1df448f"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(public)\\verify-email\\page.tsx"
timestamp: 2026-09-04T06-12-49Z
slug: src-app-public-verify-email-page-tsx
---
⚠️ DEGRADED: single-context (no sub-agent/Task tool exposed in this review-lane session; Assessment A and Assessment B were run sequentially in one context by the same agent)

Mode: **Operate** (a waiting room with one action: get another link).
Evidence: production build at `http://localhost:3000`, all four documented states exercised (`/verify-email`, `?sent=1&email=…`, `?verified=1`, `?error=INVALID_TOKEN`) at 1440 / 768 / 360 / 320 CSS px. Screenshots and raw measurements in `.impeccable/review/`.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 1 | The resend button spins with `aria-busy="true"` for the entire 60-second cooldown — measured still spinning at 57 s remaining, with no request in flight. |
| 2 | Match System / Real World | 4 | "That link no longer works" / "Confirmation links work once and last 24 hours" is plain, blameless and complete. |
| 3 | User Control and Freedom | 3 | "Back to sign in" is always present; once the cooldown starts there is no way out of it but a page reload, which silently resets it. |
| 4 | Consistency and Standards | 2 | The two resend branches on the same screen behave differently: the button branch never shows a pending state (`isSubmitting` belongs to a form it does not submit), the form branch shows one for 60 s. |
| 5 | Error Prevention | 3 | The 60 s cooldown and the email-shaped Zod schema are right; the cooldown is client-only and resets on reload. |
| 6 | Recognition Rather Than Recall | 3 | `?sent=1` with no `email` claims "We sent a confirmation link to your email address" and then asks the visitor to type that address in — it tells them something it does not know. |
| 7 | Flexibility and Efficiency | 2 | From the `sent` state there is no way to correct a mistyped address; the only affordance is resending to the same wrong one. |
| 8 | Aesthetic and Minimalist Design | 4 | Heading, one sentence, one action. The empty-state grammar DESIGN.md asks for, applied to a waiting state. |
| 9 | Error Recovery | 2 | The `invalid` state recovers well (message plus a resend form). But any failure other than 429 — a 500, an aborted request — is reported as "a new link is on its way". |
| 10 | Help and Documentation | 3 | The link's lifetime (24 hours, single use) is stated in the body copy, which is the right place for it. No support contact. |
| **Total** | | **27/40** | Acceptable — the states are all present and correct in structure; what they *say about themselves* is where this screen loses points. |

## Design Specificity Verdict

**Authored, with one borrowed part.** The three states are shaped like the rest of Tassl: a serif statement of fact, one muted sentence, one action, no illustration, no exclamation mark. "That link no longer works" is precisely the product's voice — descriptive, never accusatory. What is borrowed is the pending vocabulary: a generic spinner pressed into service as a countdown indicator, which is the one moment on this screen where a stock component overrides the product's own commitment to honest state.

**Deterministic scan:** `detect.mjs --json "src/app/(public)" "src/components/features/auth"` → `[]`, exit 0. Nothing found by the detector; every issue below is from browser evidence or from source read against DESIGN.md and 09 §UI-003.

**Visual overlays:** not attempted — no browser-canvas tool is exposed in this lane and the running production build must not be modified, so live-server injection was skipped by design.

## Overall Impression

All four documented states are reachable and structurally correct, and every one of them measured clean on contrast, focus, control height and 360 px reflow. The screen's problem is that it is a waiting room whose instruments are miscalibrated: a spinner that means "working" runs for a minute while nothing works, a success message that appears whether or not anything was sent, and a `<title>` that says "Confirm your email address" on the page whose heading says the confirmation already happened.

## What's Working

1. **The state machine is right.** `error` is read before `verified`, so a spent token never masquerades as a success; the signed-in redirect is skipped for exactly the two states where a session is expected, which is the non-obvious call and the correct one.
2. **The `invalid` state is a genuine recovery screen, not a dead end.** It states what happened, why (once, 24 hours), and puts the resend form directly under it — no bounce to another route to start again.
3. **Resending is indistinguishable for an unknown address.** The enumeration protection of 08 §2.1 survives into the UI: the same sentence, the same cooldown, whatever the API answers.

## Priority Issues

- **[P1] The resend button spins and reports `aria-busy="true"` for the whole 60-second cooldown.**
  **Why it matters:** `SubmitButton pending={isSubmitting || cooling}` (`verify-email-panel.tsx:127`) folds the countdown into the busy state. Measured at 4 s elapsed: label "Resend the link in 57 s", `disabled`, `aria-busy="true"`, `animation-name: spin`. `SubmitButton`'s own contract says "disabled with a spinner **while the call is in flight**". A spinner that runs for a minute after the call finished teaches the student to distrust the one signal that should mean "working" — on a product whose subject is calibrated trust.
  **Fix:** `pending={isSubmitting}`; drive the disabled state from `cooling` separately.
  **Suggested command:** `/impeccable harden`

- **[P1] The countdown — the only information the state carries — is rendered at 45 % opacity.**
  **Why it matters:** the whole button is `disabled` at `opacity: 0.45`, so "Resend the link in 57 s" composites to roughly 1.9:1 against its own fill. Disabled controls are exempt from WCAG 1.4.3, which is exactly why the countdown must not live inside one: the seconds remaining are the only thing on screen telling the student the wait is finite, and they are the least legible text on the page.
  **Fix:** keep the button label stable ("Resend the link") and move the countdown to an `--ink-muted` 13/20 line beneath it.
  **Suggested command:** `/impeccable clarify`

- **[P1] The document title contradicts the page on two of the four states.**
  **Why it matters:** `metadata` is a static `t('auth.verify.sentTitle')`, so `?verified=1` (h1 "Email address confirmed") and `?error=INVALID_TOKEN` (h1 "That link no longer works") both carry the tab title "Confirm your email address · Tassl". A screen-reader user tabbing between windows, and anyone scanning a tab strip after clicking an emailed link, is told the opposite of what happened. WCAG 2.4.2 asks the title to describe the page's purpose. The sibling `/reset-password` has the same defect (title "Choose a new password" over the h1 "That reset link no longer works").
  **Fix:** replace `export const metadata` with `generateMetadata({ searchParams })` returning `TITLES[state]`.
  **Suggested command:** `/impeccable harden`

- **[P2] Any resend failure that is not a 429 is announced as a success.**
  **Why it matters:** `resend()` only maps `status === 429`; every other error — a 500, an aborted request — falls through to "If that address still needs confirming, a new link is on its way" and starts the cooldown. The identical-response rule exists for 4xx enumeration protection and is right; a server or network failure is not enumeration-sensitive and should be surfaced.
  **Fix:** keep the identical answer for 4xx, but map `status >= 500` and thrown/network errors to `t('auth.error.generic')`.
  **Suggested command:** `/impeccable harden`

- **[P2] The `email` query parameter is rendered into the page verbatim.**
  **Why it matters:** `/verify-email?sent=1&email=<anything>` prints that text inside "We sent a confirmation link to **…**." on a public, unauthenticated URL. React escapes it, so there is no XSS — but a crafted link renders attacker-chosen prose inside Tassl's own chrome ("…to your account is suspended, call +1-555-0100"), verified in the browser. The same raw value is then used as the resend address.
  **Fix:** parse the parameter with the module's `z.email()` schema in the page and fall back to `sentBodyNoEmail` when it fails.
  **Suggested command:** `/impeccable harden`

## Persona Red Flags

**Jordan (First-Timer):** mistypes their address at sign-up, lands here, reads "We sent a confirmation link to jordn@uni.edu", and has no way to fix it — the only control resends to the same wrong address, then locks itself for 60 seconds behind a spinner that suggests something is still happening. Jordan's only real exit is the browser back button.

**Sam (Screen-reader user):** activates "Resend the link", the button disables and focus falls to `<body>`; the confirmation arrives politely from a region that was `display:none` an instant earlier, and the 60-second countdown is announced nowhere at all. Sam has no way to know how long the control will stay unavailable.

**Alex (Power User):** clicks the emailed link, lands on `?verified=1`, sees one clean confirmation and one primary action. Reads the tab title, which says "Confirm your email address", and briefly wonders whether it worked.

## Minor Observations

- The two resend branches disagree about pending state: the `sent`-with-email branch passes `isSubmitting` from a form it never submits, so `aria-busy` is permanently `false` and a double-click fires two requests.
- `?sent=1` with no `email` asserts a link was sent and then asks for the address; the copy should not claim what the URL does not carry.
- The cooldown is client-only and resets on reload — the server rate limiter is the real guard, so this is presentation, not protection, and the copy should not imply otherwise.
- `FormStatus` puts a confirmation on `--primary-soft` with no icon; DESIGN.md assigns `--green-soft` with the green as the icon to confirmation surfaces.
- `gap-5` (20 px) at lines 93 and 113 is off the documented 4/8/12/16/24 spacing scale, matching the same drift on the other four public screens.
- Verified clean and worth keeping: no horizontal overflow at 360 or 320 px even with a 180-character address (`break-words` on the description earns its comment), the focus ring is the exact DESIGN.md recipe on every control, and every text pair measured ≥ 6:1.

## Questions to Consider

- This is a screen about waiting. What is the honest visual vocabulary for "nothing is happening yet, and that is fine" — and why is it currently the same spinner used for "a request is in flight"?
- If a student cannot correct a mistyped address from here, is `sent` really a state, or an unrecoverable dead end wearing a state's clothes?
- The product's thesis is that a helpful system can be unreliable in ways you must learn to notice. What does it cost when Tassl's own confirmation message is one of those?
