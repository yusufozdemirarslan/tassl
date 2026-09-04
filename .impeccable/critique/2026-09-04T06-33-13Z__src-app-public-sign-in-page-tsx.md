---
target: sign-in screen (UI-001)
total_score: 29
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(public)\\sign-in\\page.tsx"
target_fingerprint: "sha256:85cd31929b483bb93ef53aa8fe34f7dc68d36a31e918fdbc9af95a94933dc450"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(public)\\sign-in\\page.tsx"
timestamp: 2026-09-04T06-33-13Z
slug: src-app-public-sign-in-page-tsx
---
⚠️ DEGRADED: single-context (no sub-agent/Task tool exposed in this session; Assessment A and B were run sequentially by one context)

Target: `src/app/(public)/sign-in/page.tsx` (UI-001) with `src/components/features/auth/sign-in-form.tsx`, `auth-feedback.tsx`, `google-button.tsx`, and the shared `(public)/layout.tsx`.
Mode: **Operate** (DESIGN.md: "The register is Operate on every surface").
Evidence: production build at `http://localhost:3000`, Playwright inspection at 1440 / 768 / 360, plus intercepted 401 / 403 / 429 / 500 / network-abort responses; `detect.mjs --json` over `src/app/(public)` and `src/components/features/auth` returned `[]` (exit 0). Screenshots in `.impeccable/review/`.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | A network failure produces no message at all; the pending spinner is frozen under `prefers-reduced-motion`; the `role="alert"` / `role="status"` slots are `display:none` while empty |
| 2 | Match System / Real World | 4 | "Use the email address your institution knows you by" is exactly right for the audience |
| 3 | User Control and Freedom | 3 | Forgot / create-account escapes are present; the brand mark is a dead `<p>`, so there is no way out of the auth flow |
| 4 | Consistency and Standards | 3 | Tokens, 40 px heights and the focus recipe are uniform; `whitespace-nowrap` on buttons and the conflation of pending with disabled are drift |
| 5 | Error Prevention | 2 | The form error box is injected *above* the submit button, moving the primary action 45–54 px after a failed submit |
| 6 | Recognition Rather Than Recall | 4 | Labels always visible, no placeholder-as-label, `autocomplete` wired on every field |
| 7 | Flexibility and Efficiency | 3 | Autofocus, Enter-to-submit, remember-me, password-manager hints all work; no reveal-password affordance |
| 8 | Aesthetic and Minimalist Design | 4 | Genuinely restrained; hairline card, one teal voice, no decoration |
| 9 | Error Recovery | 2 | Silent failure on a dropped connection leaves the person with no next step |
| 10 | Help and Documentation | 2 | No support route when the institution address is unknown; no privacy/terms anywhere in the flow |
| **Total** | | **29/40** | **Good — the visual contract is met; the status/error dimension is not** |

## Design Specificity Verdict

**LLM assessment.** This reads as Tassl and not as a generic auth template, and that is not a small thing: the serif h1 over a hairline card on cool paper, one deep-teal action, 13/20 sentence-case labels, and no shadow, no gradient, no illustration. Measured against DESIGN.md it is faithful — card 420 px, 24 px padding, 6 px radius, `1px solid #D5DAE2`, `box-shadow: none`, every control 40 px, one focus recipe (`2px solid #0F6E74` at `2px` offset) on every one of the five tab stops. Where it stops being authored is under stress: every failure state is a rectangle that appears in the middle of the form and shoves the button down, and the one moment the interface has to say "I am working" it says it with a spinner that a reduced-motion user sees frozen and a 45 %-opacity label at 1.4:1. The instrument-panel idea — "calm, high-contrast, and honest about state" — is fully delivered at rest and only half delivered in motion.

**Deterministic scan.** `node .claude/skills/impeccable/scripts/detect.mjs --json "src/app/(public)" src/components/features/auth` → `[]`, exit 0. The same run over `button.tsx`, `input.tsx`, `field.tsx`, `page-header.tsx` → `[]`. No hard-coded hex, no banned font, no nested cards, no bounce easing. Everything below came from browser measurement, not from the detector.

**Visual overlays.** Not attempted: no browser-automation tool with script injection was exposed, and the instructions ruled out starting any server. Screenshots stand in as the fallback signal.

## Overall Impression

At rest this is the best-behaved screen in the codebase: correct outline (one `h1`, `main` landmark, `lang="en-US"`), autofocus on email, `autocomplete="email"` / `current-password"`, Enter submits, a 40 px checkbox hit area on a 16 px box, and every text pair passing AA by a wide margin (7.56:1 for the muted description, 6:1 for teal on white, 14.34:1 for ink on the red wash). The single biggest opportunity is that none of that care extends to the failure paths. Three of them — a dropped connection, a frozen spinner, a live region that is `display:none` until the moment it has something to say — are each individually invisible in a happy-path demo and each individually fatal to someone relying on the screen to tell them what happened.

## What's Working

- **The focus recipe is applied without exception.** Tab-walking all five stops on this screen (and 27 across the five routes) returns `outline: solid 2px rgb(15,110,116)` at `outline-offset: 2px` with `:focus-visible` matching every time. No `outline-none` sabotage, no glow, no element that quietly loses the ring. DESIGN.md's D-158 warning was heeded.
- **The security copy is disciplined.** One message for a wrong address and a wrong password ("That email address and password do not match an account"), the same "check your email" screen whether or not the address already exists, and the rate limiter given its own message because it is about the browser rather than about who has an account. That is a product decision expressed in UI copy, and it is right.
- **Contrast has margin, not just a pass.** Muted ink on white is 7.56:1, ink on the red wash 14.34:1, control borders 3.9:1 against paper. Nothing sits at 4.51:1 hoping no one measures.

## Priority Issues

### [P0] A failed request produces no message at all
**Why it matters.** With the sign-in POST aborted at the network layer, the console shows `pageerror: Failed to fetch`, the submit button re-enables, the fields keep their values, and **nothing** appears: `role="alert"` stays empty and `display:none`. The person pressed Sign in and the screen did not react. There is no retry affordance, no explanation, and the unhandled rejection escapes to `window.onerror` (so Sentry will collect it as a crash rather than as a handled failure). Reproduced identically on sign-up, forgot-password and reset-password — every form in the flow.
**Fix.** `authClient.*` resolves `{ data, error }` for HTTP errors but still *rejects* on a transport failure. Wrap the call once in `auth-feedback.tsx` — e.g. `export async function callAuth<T>(run: () => Promise<T>)` returning the client's result or a synthesized `{ error: { status: 0, statusText: 'Network Error' } }` — and have all five forms go through it, so `mapAuthError`'s `default` branch renders `t('auth.error.generic')`.
**Suggested command.** `/impeccable harden`

### [P0] Buttons clip their own labels at 200 % text size
**Why it matters.** `buttonVariants` carries `whitespace-nowrap` (`src/components/ui/button.tsx:9`). At a 32 px root font on a 360 px viewport the sign-in flow's longer labels overflow their own box in both directions — `/reset-password?token=abc` renders the primary button as "…e the new passw…", with the left half unreachable because it overflows to the left of the scroll origin. `document.documentElement.scrollWidth` reaches 419 against a 360 px viewport on `/forgot-password`, `/reset-password` and `/verify-email`, and 443 on `?verified=1`. Loss of content and of the label that names the action: **WCAG 2.2 AA 1.4.4 Resize Text**.
**Fix.** In `src/components/ui/button.tsx:9` drop `whitespace-nowrap` for `text-center`, and change the size heights in the same file (`h-8` / `h-10` / `h-12`, lines 26–29) to `min-h-8` / `min-h-10` / `min-h-12` with `py-1`, so 40 px still holds at every normal size and a wrapped label grows the button instead of escaping it. Add `max-w-full` to the `buttonVariants` base so the `inline-flex` link-buttons ("Continue to Tassl", "Ask for a new link") cannot exceed the card.
**Suggested command.** `/impeccable adapt`

### [P1] The live regions are `display:none` for the whole time they are empty
**Why it matters.** `FormAlert` and `FormStatus` (`auth-feedback.tsx:100` and `:132`) carry `className="empty:hidden"`, which compiles to `:empty { display: none }`. Measured on every route: the `role="alert"` and `role="status"` containers report `display: "none"` at rest. The comment two lines above says the region "is always in the tree so the assistive announcement fires on the content change rather than on the insertion of the region itself" — `empty:hidden` is exactly what defeats that, because a `display:none` element is not in the accessibility tree, so the change reads to assistive tech as an insertion, which polite (`role="status"`) regions are not reliably announced for. **WCAG 2.2 AA 4.1.3 Status Messages.**
**Fix.** Change `empty:hidden` to `empty:sr-only` in both components. `sr-only` sets `position:absolute`, so the empty region leaves the flex flow (no stray 20 px gap) while staying rendered and in the accessibility tree.
**Suggested command.** `/impeccable harden`

### [P1] The submit button moves out from under the pointer when the error appears
**Why it matters.** `FormAlert` sits between the "Keep me signed in" row and the submit button (`sign-in-form.tsx:138`). Measured: the button's top goes from y=587 to y=632 on `INVALID_EMAIL_OR_PASSWORD` (45 px) and to y=641 on `EMAIL_NOT_VERIFIED` (54 px, because the box also carries a "Resend verification" button). The place the person just clicked is now occupied by the error box. A second, reflexive click lands on the alert, and on a screen where the most common event is "I typed my password wrong and want to try again" that is the wrong 54 px to move.
**Fix.** Move `<FormAlert>` and `<FormStatus>` above the fields, directly under `PageHeader`, in all five forms. The message then sits where the eye already is after a failed submit, the fields and the button never move, and the announcement order matches the reading order.
**Suggested command.** `/impeccable harden`

### [P1] The pending state is a spinner that does not spin
**Why it matters.** `globals.css:279-286` zeroes `animation-duration` for everything under `prefers-reduced-motion: reduce`. Measured while a sign-in request is in flight in a reduced-motion context: `animationName: "spin"`, `animationDuration: "0s"` — a static crescent that reads as a decorative glyph. What is left of the pending state is a disabled button whose label sits at **1.4:1** against its own fill (45 % opacity per DESIGN.md's disabled rule) and an `aria-busy="true"` no sighted user can hear. For a reduced-motion user the screen simply stops responding for the length of the request.
**Fix.** Two parts. (a) In `globals.css`'s reduced-motion block, exempt the loading indicator: `.animate-spin { animation-duration: 1.2s !important; }` — a slow, small, bounded rotation is the standard carve-out for essential progress feedback. (b) In `SubmitButton` (`auth-feedback.tsx:147`) swap the label while pending (a new `auth.signIn.submitting` key, "Signing in…"), so the state is carried by text as well as by motion and survives both reduced motion and the 45 % opacity.
**Suggested command.** `/impeccable animate`

## Persona Red Flags

**Jordan (First-Timer).** Arrives from an institutional email, mistypes the address, presses Sign in on a hotel wifi that drops the request — and the screen does nothing at all. No message, no spinner, no retry. Jordan presses it three more times, concludes Tassl is broken, and emails the instructor. There is also no help link, no support address, and no privacy or terms link anywhere in the flow, so there is nowhere to go.

**Sam (Screen-reader user, NVDA + Firefox).** Autofocus on the email field and the `autocomplete` attributes are handled well, and the field-level errors are announced. But the form-level message — the one that says the credentials were wrong — lives in a region that was `display:none` a frame earlier, so the announcement is unreliable; and the pending state exists only as `aria-busy` on a button Sam has already tabbed away from. On success Sam gets `router.push` with no announcement of the destination.

**Priya (Low-vision, 200 % browser text size).** The primary button's label is clipped on both sides, the page scrolls sideways, and on `/reset-password` the h1's last word runs off the card because `PageHeader`'s `<h1>` has no `break-words` while its description does (`page-header.tsx:22` vs `:29`).

## Minor Observations

- The brand mark is a `<p>` at 24 px serif 600 (`(public)/layout.tsx:15`), inside `<main>`. DESIGN.md §Navigation puts the brand at the h4 size (20 px), and putting it inside `main` means `main` wraps the whole page rather than the page's main content. A `<header>` sibling above `<main>` would give the flow a `banner` landmark it currently lacks.
- "Tassl" appears twice in the first 90 px: the brand mark and then "Sign in **to Tassl**". On `/sign-up` it is "Tassl" + "Create your **Tassl** account".
- The `Field` primitive puts `role="group"` on every field with no accessible name (`ui/field.tsx:77`), so the aria snapshot reads `group → text "Email address" → textbox "Email address"`. Every field is announced as an unnamed group.
- `main` uses `px-4` at all widths; DESIGN.md specifies a 24 px page gutter at `md` and above.
- The sign-in Zod schema is declared inline in the client component (`sign-in-form.tsx:28`), and the 12–128 password rule is duplicated verbatim in `sign-up-form.tsx:30` and `reset-password-form.tsx:23`. CLAUDE.md asks for one schema per input.
- `GOOGLE_CLIENT_ID` is empty in this build, so the divider + Google button branch (`sign-in-form.tsx:157-166`) rendered nothing and could not be inspected.
- The "Resend verification" action inside the red error box is a secondary button with teal text — a teal action sitting inside a red surface.

## Questions to Consider

- If the error message moved above the fields, would the "Resend verification" action still need to live inside the alert box, or does it belong beside the submit button as a second, equal choice?
- The screen is honest about *what* went wrong and silent about *whether anything is happening*. What would this look like if pending were as designed as the error states are?
- Two of the five states this screen can be in (network failure, provider outage) have no visual design at all. Is "That did not work. Try again." the right sentence for both, or does a transport failure deserve to say so?
