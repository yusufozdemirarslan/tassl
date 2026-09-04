---
target: the course detail screen (UI-030) and its four sub-views
total_score: 28
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 5
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(app)\\courses\\[courseId]\\page.tsx"
target_fingerprint: "sha256:1e03c467c0d0c6f2e2c3843495e0129073d20e19e9ae19f631543c2a6258ad3f"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(app)\\courses\\[courseId]\\page.tsx"
timestamp: 2026-09-04T14-39-05Z
slug: src-app-app-courses-courseid-page-tsx
---
⚠️ DEGRADED: single-context (no sub-agent/Task tool exposed in this session; Assessment A written first, then the detector and browser evidence folded in)

Mode: **Operate** — the instructor is here to finish a task (set a policy, seat a roster, point an assignment at a package), not to be persuaded. Scanability, native affordances and honest state outrank expression.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Saving states are honest ("Saving…", `aria-busy`), but the four sub-views share one document title, so a tab change announces nothing and browser history shows four identical "Courses" entries. |
| 2 | Match System / Real World | 4 | The policy copy is the best writing in the build: "Tassl displays this policy and never enforces it… a declaration never lowers a band or a point." Product truth, stated where the control is. |
| 3 | User Control and Freedom | 2 | "Remove" deletes a section member on a single click with no confirmation and no undo; "Invite to institution" sends mail immediately with no confirmation step (UI-031 says it "opens the invitation form"). |
| 4 | Consistency and Standards | 3 | The course page guards a malformed id and renders not-found; the roster and assignment pages do not and land on the error boundary. Two 32 px controls sit in a 40 px system. |
| 5 | Error Prevention | 2 | No confirmation on either destructive/irreversible action. Mapping "Apply" exists as an inert control instead of the documented preview-plus-acknowledgement gate. |
| 6 | Recognition Rather Than Recall | 3 | Every hint the instructor needs is inline (package default clock, course default weight, band order). The `uncalibrated` chip vanishes from the package select once a version is chosen. |
| 7 | Flexibility and Efficiency | 2 | No bulk roster paste, no keyboard shortcut, and every form submit drops focus to `<body>`, so a keyboard user re-tabs from the top after each save. |
| 8 | Aesthetic and Minimalist Design | 3 | Calm, one panel level, one teal accent. Undermined by four 270 px inputs holding one digit each on Mapping, and a table caption centred in whitespace under every table. |
| 9 | Error Recovery | 3 | Field errors name the actual problem ("Points must be above zero", "A weight cannot be negative") and focus the first invalid field. Server refusals announce through `role="alert"` but leave focus nowhere. |
| 10 | Help and Documentation | 3 | Panel descriptions carry the domain rule ("an unassessed dimension is excluded, never counted as zero"). No link from "Confirm a scenario package first" to where that happens. |
| **Total** | | **28/40** | **Good — address weak areas, solid foundation** |

## Design Specificity Verdict

**Authored for this product.** Strip the copy out and the shell still reads as Tassl: IBM Plex Serif titles over cool paper, one teal accent per screen, Mono tabular counts in right-aligned columns, hairline panels that never nest. The Policy sub-view could not belong to another product — the legend that a policy control is *not* an enforcement control is a product invariant rendered as UI, and the Mapping panel explains the mean-over-assessed-dimensions rule where the numbers are typed. Nothing here is a generic admin CRUD skin.

Where it slips into category-interchangeable: the Mapping sub-view is four unlabelled-by-scale numeric inputs stretched to a quarter of a 1440 px panel each, which is a settings form anywhere. The instrument-panel promise in DESIGN.md ("dense where data is dense") is not kept — a band scale is dense data and it is rendered as sparse.

**Deterministic scan:** `node .claude/skills/impeccable/scripts/detect.mjs --json src/components/features/courses src/app/(app)/courses src/app/(app)/assignments` → `[]`, exit 0. Clean. axe-core 4.13 (wcag2a/2aa/21aa/22aa + best-practice) over all seven views at 1440 and 360, and again with the New-course dialog open: **0 violations**. Contrast measured on every rendered text/background pair (38 distinct pairs, effective background composited through ancestors): **0 failures**, minimum 5.05:1 (`--primary` on `--primary-soft`). Focus ring present on 100 % of focusable elements: `solid 2px rgb(15,110,116)` at `+2px` offset everywhere, `-2px` inset on the tab strip, which is the DESIGN.md recipe. `prefers-reduced-motion` zeroes transitions. `document.documentElement.scrollWidth === innerWidth` at 1440, 768 and 360.

**Browser overlay:** not attempted — the live-server/injection flow is not appropriate against a shared production build another agent is using. Screenshots and instrumented probes under `.impeccable/review/` are the evidence instead.

## Overall Impression

This is careful work. The token discipline is total, the a11y baseline is genuinely clean rather than clean-because-nothing-was-checked, and the copy does real teaching. The single biggest opportunity is **state honesty at the edges**: three of the documented states (the invitations list, the mapping preview/apply gate, the assignment runs table and the way to create an assignment at all) are represented by a control that does nothing, a panel that forgets, or nothing at all — and the two irreversible actions that *do* work fire on one click.

## What's Working

1. **The policy sub-view is product truth as interface.** The legend states what the control does not do before the instructor picks. The three choice cards give the full sentence, not a label, and the checked card takes the primary wash with a primary border. This is the screen a competitor cannot copy without adopting the product's ethics.
2. **The focus system is uniform and provable.** Every one of the 60+ focusable elements measured across seven views carries the same 2 px `--focus` outline; the table scroll container is a named focusable `region`; the skip link is first and grows to 40 px on focus; the account menu opens on Enter, traps correctly, and returns focus to its trigger on Escape.
3. **Deferred dialog loading is invisible and correct.** `CourseForm`/`NewSectionDialog` keep the trigger, frame, title and description in the entry bundle and pull react-hook-form only on open; the dialog names itself immediately, Escape restores focus to the trigger, and the import failure has its own sentence.

## Priority Issues

### [P1] Every form submit drops keyboard focus to `<body>`
**Why it matters:** `SubmitButton` sets `disabled={pending}`, the browser blurs a disabled element, and nothing takes focus back. Measured on the roster add form at 120 ms, 400 ms, 1.2 s and 2.5 s after Enter: `activeElement` is `BODY` throughout, including after the `role="alert"` refusal renders. The refusal is announced but a keyboard or screen-reader user is standing at the top of the document and must tab past the skip link, brand, bell, account menu and rail to get back. This is every form on these four screens.
**Fix:** in `src/components/features/account/form-feedback.tsx` `SubmitButton`, swap `disabled={pending}` for `aria-disabled={pending}` plus an early return in the submit handler, so the button keeps focus; or, if it must stay `disabled`, move focus to the `FormAlert` (give it `tabIndex={-1}` and focus it when `message` becomes non-null).
**Suggested command:** `/impeccable harden`

### [P1] "Remove" deletes a roster member on one click, with no confirmation and no undo
**Why it matters:** `section-roster.tsx:176` calls `removeSectionMemberAction` straight from `onClick`. The control is a ghost button that reads as plain text in a table row, the pointer target is 74×32 px, and the only guard is server-side (`MEMBER_HAS_RUNS`). A mis-click on the wrong row silently unseats a student; recovery is re-adding them by address. DESIGN.md's own rule is "Confirmation before destructive actions".
**Fix:** wrap the action in the existing `Dialog` with a destructive confirm naming the member ("Remove Student One from section A?"), or convert to a two-step in-row confirm. Same treatment for "Invite to institution", which currently sends mail on one click.
**Suggested command:** `/impeccable harden`

### [P1] The roster table is unreadable at 360 px
**Why it matters:** `section-roster.tsx:163` puts `[overflow-wrap:anywhere] whitespace-normal` on the email cell, which lets that column collapse instead of letting the scroll region do its job. Measured at 360: region 294 px, table 329 px, email column **49 px** — `student2@tassl.local` renders as five stacked fragments — while Name keeps 111 px and only 47 px of the 90 px Remove button is inside the viewport. The table technically scrolls 35 px, so nothing is lost, but the primary identifying column is destroyed to buy nothing.
**Fix:** drop the `whitespace-normal` / `overflow-wrap` override so `TableCell`'s default `whitespace-nowrap` holds, and give the table a `min-w-[34rem]`. The region then scrolls at its natural width, which is what `overflow-x-auto` and the named `region` were built for.
**Suggested command:** `/impeccable adapt`

### [P1] Three documented states are represented by a control that does nothing or a panel that forgets
**Why it matters:** UI-030 specifies Mapping as "four numeric inputs; **Preview changes** shows affected runs with points now and after; **Apply** requires ticking 'I understand every confirmed run will be re-exported'", with states "preview loading" and "applied (toast with the recompute count)". What ships is Save plus an `aria-disabled` Apply that is dimmed to 45 % and does nothing on press. UI-031 specifies an "invitations list (pending, expired)"; the panel is React state seeded empty, so an invitation sent thirty seconds ago is gone on reload and "expired" can never render — there is no `listInvitations` read in the tenancy module to render from. UI-032's runs table and the "New assignment" entry point (`createAssignmentAction` "from the course page") do not exist, so the assignment configuration screen has no way in.
**Fix:** either build them or say so on the screen. The Mapping panel already does this well — "Recomputation of confirmed runs arrives with review" — so remove the inert Apply button and keep the sentence; give the invitations panel a server read (`listInvitations(actor, orgId)` in `tenancy`) rather than client state; put the deferral note on the assignments empty state next to the existing "Confirm a scenario package first".
**Suggested command:** `/impeccable clarify`

### [P1] A malformed id lands on the error boundary instead of not-found
**Why it matters:** `/assignments/not-a-uuid` and `/courses/not-a-uuid/sections/<id>/roster` both render "Something went wrong — The problem has been recorded… Reference: 3783969976". A typo in an address is reported to the instructor as a system fault and to Sentry as an incident. The course detail page already does this right (`CourseIdParamsSchema.safeParse({ courseId })` → `notFound()`, with a comment saying exactly why); the other two pages skipped it.
**Fix:** add the same `safeParse` guard before the read in `src/app/(app)/assignments/[assignmentId]/page.tsx:45` and `src/app/(app)/courses/[courseId]/sections/[sectionId]/roster/page.tsx:62`.
**Suggested command:** `/impeccable harden`

## Persona Red Flags

**Sam (accessibility-dependent):** Tabs into "Add to section", presses Enter, and focus vanishes to `<body>`; the refusal is announced but the cursor is gone. Switches from Sections to Policy and hears nothing — the route announcer is empty and `document.title` is "Courses · Tassl" for all four sub-views. Reaches the Remove buttons at 74×32 px, under the 40 px this product promises in PRODUCT.md. Everything else — focus rings, contrast, landmarks, the named table region, the skip link — is genuinely solid.

**Riley (stress tester):** Types `0` into Novice and gets "Points must be above zero" with focus on the field. Good. Edits the URL to a non-uuid course and gets an incident reference. Sends an invitation, reloads, and it is gone. Presses "Apply to confirmed runs" and nothing happens at all — no message, no toast, no focus change; only a sentence underneath, which is easy to miss when the control looks pressable enough to press.

**Alex (power user):** One roster address at a time, no paste-a-column, no keyboard shortcut, and focus reset to the top of the document after every add. Seating a 40-person section is 40 round trips through the whole tab order.

## Minor Observations

- **Table captions are centred** (`<caption>` default) under full-width tables, so "Courses in this institution" and "People in A" float in whitespace with nothing aligned to them. `TableCaption` should carry `text-left` (`src/components/ui/table.tsx:117`).
- **Mapping fields are four 270 px inputs holding one digit.** `grid gap-4 sm:grid-cols-2 lg:grid-cols-4` with no cap (`mapping-editor.tsx:126`). Cap the grid or the inputs (`max-w-[10ch]`) so the scale reads as a scale.
- **Gray text on a colored background.** The checked policy card takes `bg-primary-soft` and its `FieldDescription` stays `text-ink-muted` (#4B5563 on #DDEFF0, 6.36:1 — passes AA, breaks DESIGN.md's "Don't put gray text on a colored background").
- **The `uncalibrated` chip is only in the open select popup**, never on the closed trigger, because `SelectPrimitive.Value` renders the `items` label string. UI-032 asks for the chip on the select.
- **"Default run weight" hint wraps to three lines** because `max-w-[32ch]` is on the whole `Field` rather than the `Input` (`policy-form.tsx:204`).
- **Four sub-views, one title.** `export const metadata = { title: t('courses.title') }` for all of them; `generateMetadata` returning `${course.name} · ${TAB_LABELS[tab]}` fixes the history, the tab strip and the route announcer at once.
- **The app-shell account button overflows the document at 200 % text on a 360 px viewport** (`scrollWidth` 416 vs 360). Not these screens' code, but it is the only horizontal overflow left in the build.
- The tab strip wraps "Mapping" onto a lone second row at 360 inside the sunken well. Acceptable; a `grid-cols-2` at that width would read better.

## Questions to Consider

- If the Mapping "Apply" control cannot act until Phase 11, what does keeping it buy that the sentence underneath does not?
- The Policy sub-view teaches the instructor a product invariant while they choose. Should Mapping do the same — showing what one confirmed run would be worth under the numbers as typed?
- An instructor seating a class has a spreadsheet column of addresses. What would the roster look like if that were the primary input and one-at-a-time were the fallback?
