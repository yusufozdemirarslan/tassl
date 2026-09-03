# Surface brief: `/dev/components` (UI-060 Component gallery)

Command: `/impeccable shape /dev/components` · Phase 1, step 1.6 · Written 2026-09-03.
Mode: Operate on every surface. Visual authority: `DESIGN.md` (tokens from `docs/tech/09-frontend-spec.md` §2), fixed; this brief chooses no palette, font, radius, or motion.
Status: unconfirmed. No human answers questions in this build (`docs/tech/00-README.md`, builder rules), so the discovery interview was skipped; the likely reading is asserted and every assumption is tagged `[A-n]` and listed at the end. Shape writes no code.

Sources read: `PRODUCT.md`; `docs/tech/09-frontend-spec-screens.md` §UI-060; `docs/tech/09-frontend-spec.md` §1, §3, §4, §5, §6; `docs/tech/build-plan/phase-01-design-foundation.md` steps 1.5–1.6; `src/app/dev/layout.tsx`; `src/app/dev/components/page.tsx`, `demos.tsx`, `fixtures.ts`; screenshots `.impeccable/review/gallery-1440.png` (1440×4892) and `gallery-360.png`.

## 1. Job and audience

- Who: the builder and the Tassl scenario editor checking built components against `DESIGN.md`; the Impeccable commands (`critique`, `audit`, `harden`, `polish`, `document`); axe (`tests/e2e/a11y/dev-components.spec.ts`) and Lighthouse CI (`lighthouserc.json`, `test` environment). No student, instructor, or author ever reaches it: `src/app/dev/layout.tsx:13` returns 404 unless `APP_ENV` is `local` or `test`.
- Context: a laptop, the local server, one question at a time ("is the disabled button legible?", "does the sample panel carry its label?"). Reading, scrolling, comparing; sometimes opening an overlay.
- Visitor mode: Operate `[A-9]`. A reference instrument, not a showcase.

## 2. Outcome and proof

- Primary task: find one component and verify each of its states against `DESIGN.md` without leaving the page. Success: every component in `09-frontend-spec.md` §3 that exists at this phase appears once per variant and state, on fixture data, below the token vocabulary; axe reports zero serious or critical violations; LHCI passes on this URL.
- Evidence: synthetic fixtures only (`fixtures.ts`: one student name, two universities, three runs, five stances). Nothing may read as a real record; the review-queue table sits inside `IllustrativeSample`, which forces the amber "Illustrative sample data" chip (FR-254).
- Product-specific truth: this page is the Lighthouse target for the run-route script budget (`page.tsx:63-64`), so its client bundle is the ceiling every run screen inherits. It is also the only place the five stance colours, the seven label chips, and the empty / error / sample patterns are visible side by side.

## 3. Selected direction

- Visual authority: `DESIGN.md`, unchanged. Nothing visual is open.
- Structural thesis: one long, single-column reference page grouped by source folder in inventory order: Tokens → Layout components → UI primitives now; Graphs, Run, Debrief, Review, Courses, Packages, Account, Admin as their phases land, each phase adding its own group `[A-1]`. Each group is an `h2` `section` with an id (`#tokens`, `#layout`, `#ui`; `page.tsx:45-46`); each demo is an `h3` caption at meta size (`page.tsx:57`) followed by the live component.
- Sequence: vocabulary first (colour tokens, type scale, spacing / radius / shadow), then containers (Panel, EmptyState, ErrorState, IllustrativeSample), then chrome (Rail, switcher, bell, account menu), then primitives, forms, overlays. The reader learns the words before the sentences.
- Focal moment (Operate): none decorative. What matters is landing on the demo you came for; the section ids are that affordance today, and a jump list is open decision 1 in §7.
- Implementation consequence: the page stays a server component; every interactive demo lives in `demos.tsx` (`'use client'`) so the measured client bundle is the primitives' own runtime and nothing else. Fixture text is literal by design: `jsx-no-literals` is off for `src/app/dev/**` (phase-01 step 1.5 implementation notes), so `t()` is not required on this route.

## 4. Scope and boundaries

- Fidelity: a production page for `local` and `test`; it ships, gated.
- Breadth at this step: `src/components/ui/*` (shadcn, themed) and `src/components/layout/*`. The four graphs from `tests/fixtures/scoring/marco-8-of-11.json` arrive in Phase 10 (`fixtures.ts:1`); feature components arrive with their phases `[A-1]`. UI-060 is fully met only after Phase 10.
- Interactivity: demos are live (dialog, alert dialog, sheet, popover, tooltip, dropdown menu, toast, tabs, every form control). Nothing persists; nothing calls a server action.
- Named targets: `src/app/dev/components/page.tsx`, `demos.tsx`, `fixtures.ts`; `src/app/dev/layout.tsx`; `lighthouserc.json`.
- Untouched: the `APP_ENV` gate; token values, fonts, radii, motion; the `jsx-no-literals` waiver; LHCI budgets. Components under review are edited only to fix findings from the loop, never restyled from this page.
- Anti-goals: no marketing framing, no showcase composition, no illustrations, no dark theme (deferred), no theme switcher, no prop tables or code snippets (a state catalogue, not Storybook) `[A-2]`, no gallery-only components beyond the local `Group` and `Demo` wrappers.

## 5. States and ranges

- Page states: renders, or 404 outside `local` / `test`. The page fetches nothing, so it has no loading, empty, or error state of its own `[A-3]`; Skeleton and ErrorState appear only as demos.
- Catalogue ranges (fixed by fixtures): 23 colour tokens; 10 type steps; 8 spacing steps, 3 radii, 1 shadow; 9 button states; 4 badge variants; 6 label chips plus `sample` inside the sample panel; institutions 0 / 1 / 2 (the switcher truncates a name at 16ch, `institution-switcher.tsx:55`); bell 0 / 3 / 120 (overflow renders "99+"); account menu signed out / signed in; sample table 3 rows; trace scroll area 12 rows; fields valid, invalid (140 of 100), disabled; checkbox, radio, switch checked; 3 tabs.
- Overlay open states exist only on interaction; screenshots capture the closed state, so `critique` and `audit` open each overlay by hand or by script `[A-4]`.
- Reduced motion: every transition at 0; the toast still appears.

## 6. Interaction and layout

- Hierarchy: `h1` "Component gallery" (PageHeader, `page.tsx:68-73`) → `h2` per group → `h3` per demo → the component's own heading (`Panel` renders an `h3`, `IllustrativeSample` an `h4`). Heading levels stay real headings so the document outline and axe are honest; the meta-size `h3` caption is deliberate.
- Topology: root → `dev/layout.tsx`, no AppShell, no rail; `max-w-6xl` centred with 24 px page padding (`dev/layout.tsx:16`); 48 px between groups, 32 px between demos.
- Responsiveness: single column at every width; type-scale rows and the form grid collapse under `md`; tables scroll inside their own container below their natural width; the Rail demo is forced into its desktop layout inside a bordered box (`page.tsx:212-215`), so the bottom-bar layout is reviewed on `/home` under `md`, not here `[A-5]`. Checked at 1440 and 360: no horizontal page scroll.
- Affordances: section ids for deep links; every demo keyboard-reachable with the 2 px focus ring; 40 px targets on every control.
- Feedback: toast "Draft saved"; dialogs trap and restore focus; tabs move with arrow keys.
- Transitions: 150 ms state, 200 ms overlays, ease-out; none under reduced motion.

## 7. Constraints and open decisions

- Platform: Next.js 16 App Router; server page plus one client module; `force-dynamic` because the gate reads env at request time (`dev/layout.tsx:8`).
- Delivery: axe zero serious / critical; LHCI on this URL in `test`; `impeccable detect` gate in CI (`scripts/impeccable-gate.mjs`).
- Accessibility: WCAG 2.2 AA; one `h1`; landmarks; 40 px targets; every icon with visible text or `aria-label`; toggles carry `aria-label` because Base UI renders their role on a `span` (`DESIGN.md` §Inputs).
- Localization: en-US; literal fixture text allowed on this route only.
- Reusable components: consumes `src/components/ui` and `src/components/layout`; defines none.
- Open decisions a builder must not invent:
  1. Jump list. The page is 4,892 px tall at 1440 with three groups and will roughly triple by Phase 11. Likely reading: add a compact in-page `nav` (links to the group ids) under the PageHeader when the fourth group lands, not before `[A-6]`.
  2. Landmark. `dev/layout.tsx:16` wraps the page in a `div`, so the route has no `main` and no skip link, and §6 requires landmarks. Likely reading: `audit` decides between a `main` in the dev layout and leaving it, given the route is dev-only `[A-7]`.
  3. Bottom-bar rail. Either add a second, forced bottom-bar rendering or reword the caption at `page.tsx:212` so it stops promising both layouts `[A-5]`.
  4. "DESIGN.md v1" badge (`page.tsx:72`): informational and hand-maintained; it tracks no version field `[A-8]`.

## Observed at shape time (inputs for critique and audit; not direction)

- `src/app/dev/layout.tsx:16` — no `main` landmark and no skip link on this route. Why: §6 landmarks. Fix: open decision 2.
- `src/app/dev/components/page.tsx:127-136` — the three radius squares and the shadow square are named only by `title` attributes (hover-only, invisible to keyboard and touch), while the spacing steps beside them carry visible mono captions. Why: `DESIGN.md` "nothing requires hover"; every mark carries information. Fix: give each a visible mono caption like the spacing steps.
- `src/app/dev/components/page.tsx:212-215` — caption says desktop and bottom-bar layouts share one component, but only the desktop layout is rendered. Fix: open decision 3.
- `src/app/dev/components/page.tsx:57` — demo captions are `h3` at 13 px muted; semantically right, visually label-like. Keep; note for `critique`.
- `src/app/dev/components/fixtures.ts:1` — graph fixtures absent until Phase 10; UI-060 is partial until then.

## Assumptions

- [A-1] Future groups follow the §3 inventory order and each feature phase adds its own group to this page; the spec says only "grouped by folder".
- [A-2] The gallery is a state catalogue: no prop tables, no code snippets, no usage docs.
- [A-3] The page has no loading, empty, or error state of its own because it fetches nothing.
- [A-4] Overlay open states are exercised interactively during `critique` / `audit` rather than rendered statically for screenshots.
- [A-5] The bottom-bar rail is reviewed on `/home` under `md`; the gallery either adds a forced bottom-bar demo or rewords its caption (open decision 3).
- [A-6] An in-page jump list is deferred until a fourth group exists.
- [A-7] Whether the dev layout gains a `main` landmark is left to `audit`.
- [A-8] The "DESIGN.md v1" badge is informational and hand-maintained.
- [A-9] Visitor mode is Operate (given by the build's standing answer to every Impeccable direction question).
