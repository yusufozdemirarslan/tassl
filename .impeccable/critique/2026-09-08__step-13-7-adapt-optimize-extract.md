# Step 13.7 — `adapt`, `optimize`, `extract`, `document`

Phase 13, `feat/13-cross-cutting-hardening`. The app-wide passes, run over every screen rather than
one route at a time. Every **high** and **medium** finding below was fixed; every **low** was waived
with its reason (D-130), and the four waivers are also `D-631` in `docs/tech/DECISIONS.md` so they
are reversible from the register rather than only from here.

The instrument for the `adapt` pass is `tests/e2e/responsive/viewports.spec.ts`: the workspace, the
debrief, the replay (its graphs, its bands and its trace) and the confirmation workspace at 360,
768, 1024 and 1440 px, asserting no horizontal page scroll, that every primary action is inside the
viewport with nothing on top of it, and that the stance matrix is never drawn below 1:1.

## `adapt`

| # | Severity | Finding | What was done | Decision |
|---|---|---|---|---|
| 1 | high | Toasts sit on the fixed bottom rail. sonner is `bottom-right`, and under 600 px full width at 16 px from the bottom edge with `z-index: 999999`; the rail is 57 px tall at `z-20`. Every toast covered the whole of primary navigation, and a toast is pointer-interactive, so taps aimed at the rail dismissed the message. | `mobileOffset={{ bottom: '5rem', … }}` — the same 80 px `main`'s `pb-20` and `scroll-padding-bottom` already use for that bar. | D-625 |
| 2 | high | Nineteen of twenty-four dialogs had no height bound. A `fixed` box centred with `-translate-y-1/2` overflows the *viewport* off both ends with nothing to scroll: the Decision Lock read-back's "Lock it" button was below the bottom edge at 360 × 780. | `max-h-[calc(100dvh-2rem)] overflow-y-auto` into `DialogContent` and `AlertDialogContent`; `overflow-y-auto` into `SheetContent`. Five hand-written guards and one local patch deleted. | D-622 |
| 3 | high | Two links inside prose (`/sign-in`, `/sign-up`) were distinguished from the surrounding muted text by colour alone, at 1.26:1 — WCAG 1.4.1, Level A. | Underlined at rest, and the rule written down as the Underlined-In-Prose Rule. | D-624 |
| 4 | medium | `main` had no maximum width; dense screens ran 2288 px edge to edge on a 2560 px monitor. *(Carried over: found by an earlier pass and recorded as out of scope then.)* | `--container-page: 96rem`, applied as `max-w-page mx-auto`. | D-620 |
| 5 | medium | The stance matrix drew at ~0.61 at 360 px — labels at 7 px, counts at 9 — because `preserveAspectRatio` fitted a 484-unit grid into a 296 px box. *(Carried over, as above.)* | A 1× floor and a 1.25× ceiling with its own `overflow-x-auto` region; `GraphFrame.height` gains `'auto'` for a chart that is server-rendered and needs no reservation. | D-621 |
| 6 | medium | The confirmation workspace lost 46 % of its editor at the `lg` boundary: 751 px at 1023, 407 at 1024 — about 42 characters a line. The shape D-310 already ruled a bug. | Split moved to `xl` with an 18 rem tree (editor 696 px); `ElementList`'s tree/select swap moved with it; `element-editor`'s own field grid moved `xl` → `2xl`. | D-628 |
| 7 | medium | The header's institution name was *narrower* at 768 px (16 ch) than at 767 (~24 ch), and did not recover until 1024. | One cap at every width; recorded as the Monotonic-Width Rule. | D-627 |
| 8 | medium | `SheetContent`'s close button was a 32 px target — the identical control in `dialog.tsx` had been fixed with a comment naming the 40 px minimum — and both sheet and dialog titles ran under it by 24–28 px at 360 px. | `after:absolute after:-inset-1` on the sheet's close; `pr-8` on `DialogTitle` and `SheetTitle`. | D-626 |
| 9 | medium | The unverified-figure mark explained itself only in a tooltip, and Base UI gates a tooltip's focus opener on `matchesFocusVisible`, which a tap never produces. A sighted touch reader got a warning triangle and no sentence — and the sentence says the mark is about provenance, not correctness. | The sentence rendered in text, once, under a reply that carries a mark. Tooltip and tab stop unchanged; two assertions added to the unit test. | D-629 |
| 10 | medium | Three density caps guessed rather than measured: the claims table's sticky column left 56 px of a 296 px scroll region at 360 px; `Popover` was the one floating surface with no `100vw` clamp; three tables were wrapped in a second, keyboard-unreachable `overflow-x-auto` around `Table`'s own region. | Cap measured to `max-w-40`; the clamp its four siblings already carry; the three wrappers deleted. | D-630 |
| — | low, waived | The bottom rail truncates its labels at 360 px when a seat holds all six destinations. | Icons are distinct, every accessible name is complete, and six destinations needs a platform admin who is also an instructor and a student. | D-631 (c) |
| — | low, waived | Truncated values are recoverable only through `title`, which never fires on touch (account email, institution name). | Both are identity rather than content, and the person already knows them. | D-631 (d) |
| — | low, waived | No `viewport-fit=cover`, so the paper ground does not run into a notch. | Next 16 emits `width=device-width, initial-scale=1` by default, which letterboxes the page and therefore keeps the fixed bottom rail clear of a home indicator with no `env()` padding at all. Opting in would need safe-area padding on the header, the rail and the sticky band to buy a ground colour. | — |

## `optimize`

No high or medium findings: every budget passes and nothing measured is slow. What was measured:

- **Framework floor 132,164 / 175,000 — unchanged by all three passes.** React + the Next client
  runtime and nothing else: `posthog-js` (88,364 gzip) and `@sentry/nextjs` (4,695) are in their own
  lazily-imported chunks and are *not* in `rootMainFiles`, so neither is charged to a route that may
  have no key for it (D-579).
- **Every route inside its ceiling**, before and after (full tables in the step report). Tightest:
  `/(app)/assignments/[assignmentId]` 170,438 / 175,000, the roster 169,426, the confirmation
  workspace 167,028, `/review/runs/[runId]` 124,205 / 130,000, `/sign-in` 103,724 / 110,000. The
  three heaviest chunks on the tightest route are `zod/mini`'s core (32,122) and Base UI's
  positioning and scroll internals — the price of one schema shared by form, action and route
  (D-184) and of the primitives the page actually renders. Nothing there is waste.
- **CSS 16,100 gzip** across two sheets.
- The 5 s run poll already sends `If-None-Match`, skips a hidden tab and re-asks on
  `visibilitychange`; the graphs are already behind `next/dynamic` except the two that draw no
  chart; no list in the product is long enough for virtualisation to pay for itself.
- **Waived low: the fonts.** Seven complete IBM Plex woff2 faces, 443 KB, where the split Latin-1
  subsets would be about a quarter of that. LHCI measures 947,699 of 1,060,000 total with them, they
  are cached immutably for a year, `font-display: swap` paints in the fallback immediately and
  `adjustFontFallback` holds the metrics — so the saving is on a cold first *swap*, not on LCP, CLS
  or INP, and the change would rewrite `16-performance-a11y-budgets.md` §6.2's named inventory.
  D-631 (b).

## `extract`

- **`RecordDisclosure`** (`src/components/layout/record-disclosure.tsx`). The replay's trace and the
  admin audit log had the same eight lines byte-for-byte — the summary's class list, the
  `[&::-webkit-details-marker]:hidden`, the `<pre>`, the `JSON.stringify(…, null, 2)`. The new
  component has **no `'use client'`** and imports **no message catalogue** (both strings are props),
  so the trace keeps shipping no JavaScript for it and neither route gains a module it did not have.
  Measured against the baseline: `/admin/audit` +36 bytes gzip, which is the module boundary
  itself, and `/review/runs/[runId]` unchanged by it — the trace renders it on the server. D-623.
- **The dialog height guard** was written by hand at five call sites and became the primitive's;
  the one local `overflow-y-auto` on a `SheetContent` went the same way. D-622.
- **Waived low: the focus recipe**, hand-written on 70 elements across 53 files. It already has one
  implementation — the `:focus-visible` rule in `globals.css`'s base layer — and the repetitions are
  defensive cover for the eleven places that set `outline-none` (D-158). They are interleaved into
  53 different class lists rather than being one repeated string, so consolidating them is 53 hand
  edits whose only failure mode is a silently lost focus ring: a WCAG 2.4.7 regression for no bytes
  and nothing a user sees. D-631 (a).

**Nothing was extracted into a barrel.** The one new module is imported by path from both call
sites, and it is a Server Component: this build has twice had a barrel pull a heavy module into a
light route (a constant imported as a *value* from a module schema dragging Zod's namespace in, and
a `'use client'` barrel that cannot re-export a Server Component), and the bundle was re-measured
after every pass to prove it did not happen a third time.

## `document`

`DESIGN.md` gained the page cap, the Monotonic-Width Rule, the Underlined-In-Prose Rule, the
confirmation workspace's own split, the drawing-scale floor, the viewport bound on every floating
surface, the title/close clearance, the toast offset, and the record disclosure as a component of
the system. `.impeccable/design.json` was reconciled with it: the three named rules it was missing
were added and the Reading Measure Rule's body was corrected to the `max-w-measure` (60 ch) form
D-317 settled. **The §2 tokens are untouched** — no colour, type step, radius, spacing value or
duration changed in this step.

## What the verification found beyond this step

`pnpm test:e2e` was run in full (249 tests across chromium, firefox and webkit): **242 passed, 7
failed**, and every failure was traced. None is a regression from this step.

- **`tests/e2e/system/health.spec.ts` fails on all three browsers, deterministically** — reproduced
  in isolation, single-worker. The spec has asserted `x-request-id` on `/api/health` since Phase 3;
  step 13.3 narrowed `src/proxy.ts`'s matcher to skip that path (D-569, D-602), so nothing sets the
  header any more. Reported and left: the fix is either the probe rejoining the matcher, which
  reverses a decision taken so the liveness endpoint answers identically with and without a session,
  or the route generating its own id — a call for the step that owns `12-security.md` §4, not for a
  design pass, and weakening the assertion is not an option (D-632).
- **`tests/e2e/coverage.test.ts` failed because `flows.json` still marked the `admin` flow
  `"pending": "13.5"`** although step 13.5 had landed `tests/e2e/admin/admin.spec.ts`. Fixed — the
  coverage test's own comment prescribes exactly that, and removing the marker strengthens the gate
  rather than weakening it: the flow's spec is now checked to exist and to declare a test (D-632).
- **`tests/e2e/a11y/instructor.spec.ts` fails on firefox** with axe's `document-title` on the
  mapping-preview scan — the one screen in the run this step touched, so it was tested directly:
  `src/components/features/courses/mapping-editor.tsx` was restored to its pre-13.7 state, rebuilt,
  and the spec run again on firefox alone. **It fails identically**, so the cause is not this step's
  change. It passes on chromium and webkit in isolation and failed on chromium only under the load
  of the three-worker run.
- **`tests/e2e/a11y/student-run.spec.ts` failed once on firefox (`ECONNRESET` on sign-out) and once
  on webkit (`document-title`)**; both pass in isolation, single-worker.
- **`tests/e2e/responsive/viewports.spec.ts` passes 3/3 on every browser.** Its one earlier failure
  was a 300 s navigation timeout on firefox caused by a three-browser probe this session was running
  concurrently; re-run alone it takes 7.2 s.

## Gate

`npx impeccable@3.6.1 detect --json .` through `scripts/impeccable-gate.mjs`:
`0 open findings (ignores active: 0 rules, 0 files, 2 values)`.
