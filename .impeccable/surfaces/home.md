# Surface brief: `/home` (UI-009 Home, inside the UI-008 app shell)

Command: `/impeccable shape /home` · Phase 1, step 1.6 · Written 2026-09-03.
Mode: Operate on every surface. Visual authority: `DESIGN.md` (tokens from `docs/tech/09-frontend-spec.md` §2), fixed; this brief chooses no palette, font, radius, or motion.
Status: unconfirmed. No human answers questions in this build (`docs/tech/00-README.md`, builder rules), so the discovery interview was skipped; the likely reading is asserted and every assumption is tagged `[A-n]` and listed at the end. Shape writes no code.

Sources read: `PRODUCT.md`; `docs/tech/09-frontend-spec-screens.md` §UI-008, §UI-009; `docs/tech/09-frontend-spec.md` §1 (route map, navigation model), §2, §5, §6; `docs/tech/build-plan/phase-01-design-foundation.md` step 1.6, `phase-03-auth.md` step 3.5, `phase-11-review-debrief-record.md` (UI-009 panels); `src/app/(app)/home/page.tsx`, `src/app/(app)/layout.tsx`, `src/components/layout/*`; `src/lib/i18n/en-US.ts:35-43`; screenshots `.impeccable/review/home-1440.png`, `home-360.png`.

## 1. Job and audience

- Who: every signed-in person, arriving after sign-in (`/` redirects here) or from the rail. Primary: a student between sessions of a course. Also instructors and teaching assistants with runs to review, authors and editors with packages to confirm, admins.
- Context: laptop or phone (360 px up), a few seconds, one question: "what is next for me?" A switchboard, not a workspace. A student may arrive under time pressure just before an assigned run opens.
- Visitor mode: Operate `[A-14]`.
- Phase 1 reality (observed): the shell is unwired, `user={null}`, no institutions, rail Home only (`(app)/layout.tsx:10,15`); the page is PageHeader + one Panel + EmptyState with no action (`home/page.tsx:15-18`).

## 2. Outcome and proof

- Primary action: the one next step for the role. Student: Start, Continue, or Read debrief on a run. Reviewer: open a scored run awaiting a band decision, or a held run. Author or editor: open a draft awaiting confirmation or a generation in progress. Success: one click from Home to that step; when nothing is pending, an honest empty state that says so.
- Evidence: the person's own assignments, runs, review queue, packages, courses, and unread count, all tenant-scoped; real data from Phase 3 onward, never synthetic on this page.
- Product-specific truth: Home carries no score, band, rank, percentile, streak, or progress metric (`PRODUCT.md` invariants: no composite score, rank, or percentile anywhere) `[A-1]`. A run row states its state and its next action; bands live only in the debrief and the Judgment Record. Nothing on Home is a verdict on the person.

## 3. Selected direction

- Visual authority: `DESIGN.md`, unchanged.
- Structural thesis: PageHeader (greeting, institution) followed by role panels stacked in one column in priority order: "Your runs", "Review", "Packages", "Courses". A panel renders only when the role can ever populate it; an applicable panel with nothing in it renders its EmptyState `[A-2]`. Each panel is a list: rows of label, state chip, Mono time (clock or due date), one action at the right.
- Sequence: header → runs (first for anyone who has runs) → review → packages → courses. Priority order, not alphabetical `[A-3]`.
- Focal moment (Operate): the action on the top row of "Your runs", the one teal button on the page. Everything else is ink on paper.
- Implementation consequence: Phase 1 ships the container (this brief's target). Phase 3 wires session, greeting, institution, and the zero-membership state (`home.noMemberships`, `en-US.ts:42`). Phase 6 adds "Your runs" with the data-driven action. Phase 11 adds Review, Packages, Courses. The empty state's action is deliberately absent until its destination exists (`home/page.tsx:9-11`) `[A-4]`.

## 4. Scope and boundaries

- Fidelity: production; live behind the session guard once Phase 3 lands (`src/proxy.ts`).
- Breadth: the Home page and the (app) shell around it (skip link → header → rail → main), reviewed together because the shell is visible only here at this phase.
- Interactivity: links, one action per row, panel-level retry.
- Named targets: `src/app/(app)/home/page.tsx`; `src/app/(app)/layout.tsx`; `src/components/layout/app-shell.tsx`, `rail.tsx`, `page-header.tsx`, `panel.tsx`, `empty-state.tsx`, `error-state.tsx`, `institution-switcher.tsx`, `notifications-bell.tsx`, `account-menu.tsx`; `src/lib/i18n/en-US.ts` (`home.*`, `shell.*`, `nav.*`).
- Untouched: shell tree order and landmarks; rail behaviour (`aria-current`, bottom bar under `md`); `FocusOnRouteChange`; tokens; the empty-state pattern (heading, sentence, action; no illustration).
- Anti-goals: no dashboard of metrics or charts; no leaderboard; no announcements feed or banner; no onboarding tour; no bands or points on rows; no "recent activity" timeline `[A-1]`; no marketing copy (Home is not a landing page; `/` only redirects).

## 5. States and ranges

- Shell: signed in with one institution (name only, no menu) / several (radio menu) / zero memberships (rail Home only; the Home panel shows `home.noMemberships` with no action) `[A-5]`; bell 0 … 99+; account menu with settings and sign out.
- Page: loading (shell skeleton, `(app)/loading.tsx`); per-panel empty; per-panel error (ErrorState with request id and "Try again", `error-state.tsx`); populated.
- Ranges `[A-6]`: runs per student 0–3 typical, about 10 max per term; reviewer queue 0–60 (section sizes 20–60); packages 0–10; courses 0–6; scenario label ≤ 60 characters; person name ≤ 40; institution name ≤ 60 (the switcher trigger truncates at 16ch, `institution-switcher.tsx:55`).
- Run row states: assigned (Start, with start or due date); readiness, framing, working, paused (Continue, with clock); decision_locked, turn_open, defense_pending (Continue); pending scoring, under review (state only, no action); scored, confirmed (Read debrief). The clock is Mono with tabular figures.
- Observed now (`home-1440.png`, `home-360.png`): "Not signed in", "No institution yet", bell 0, "Nothing to do yet" with the generic body and no action.

## 6. Interaction and layout

- Hierarchy: `h1` "Home" (focus target on route change, `page-header.tsx:19`) → panel `h3` titles → rows. A titled, empty panel must not produce two `h3`s: `empty-state.tsx:16` hardcodes `h3` and `panel.tsx:40` renders `h3` for the title. Open decision 2.
- Topology: `main` beside a 224 px rail from `md`; full width under `md` with the bottom bar and `pb-24` reserved for it (`app-shell.tsx:52`). Panels stack in one column at every width `[A-7]`; description text at 72ch.
- Responsiveness: at 360 the two header placeholder labels wrap to two lines inside the fixed 56 px header (observed; `app-shell.tsx:36`). Under `sm` a row folds to two lines: label and chip on the first, time and action on the second `[A-8]`.
- Affordances: the row action is a `Button` (primary on the top row of "Your runs", secondary elsewhere, one accent per screen `[A-9]`); the scenario label is not a second link when the action exists (one target per row).
- Feedback: route change moves focus to the `h1`; no toasts on Home; retry re-fetches one panel.
- Transitions: rail hover 150 ms; nothing else animates.

## 7. Constraints and open decisions

- Platform and delivery: RSC page; `proxy.ts` redirect plus `getSession()` in the page (Phase 3); role-gated panels through the permission helper (`docs/tech/08-auth-authz.md`); tenant-scoped repository calls; page-view analytics event only.
- Accessibility: landmarks; one `h1`; 40 px targets; no colour-only state (state chips carry text and icon); reduced motion respected; nothing timed on this page.
- Localization: every string through `t()`; the `home.*` keys exist at `en-US.ts:35-43`.
- Reusable components: PageHeader, Panel, EmptyState, ErrorState, Skeleton, Button, Badge; the run state chip is defined with RunFrame in Phase 6 and reused on Home rows `[A-10]`.
- Open decisions a builder must not invent:
  1. Greeting copy. The spec says "greeting, institution". Likely reading: the person's name and institution as the PageHeader description, no time-of-day logic; settle in Phase 3 with a `D-` row `[A-11]`.
  2. Empty-state heading level inside a titled panel (`h3` sibling vs `h4`). Settle in Phase 6 when the first titled panel lands; touches `empty-state.tsx`.
  3. Empty action per panel. Likely reading: the panel's destination route (Runs, Review, Packages, Courses); `home.emptyAction` "Check again" (`en-US.ts:41`) only where no destination exists; Phase 1 has none `[A-4]`.
  4. Held runs for reviewers: rows in the Review panel with the same row shape, not a count `[A-12]`.
  5. Row order in "Your runs": clock running first, then assigned by due date, then awaiting debrief `[A-13]`.

## Observed at shape time (inputs for critique and audit; not direction)

- `src/components/layout/app-shell.tsx:36` — `h-14 items-center` header; at 360 "No institution yet" and "Not signed in" wrap to two lines (`home-360.png`). Why: brand plus three text labels exceed 360 px. Fix for `audit` / `adapt`: hide the two placeholder texts under `sm` behind `sr-only` (icons stay), or let the header grow with `min-h-14`.
- `src/app/(app)/home/page.tsx:16-18` — empty state without an action while `DESIGN.md` states heading, sentence, action. Accepted for Phase 1 per the file comment (`page.tsx:9-11`); closes in Phase 6.
- `src/app/(app)/layout.tsx:15` — `user={null}` renders "Not signed in" inside the authenticated shell. Phase 3 replaces it; nothing to do now.
- `src/app/(app)/home/page.tsx:16` — `Panel` without `title` gets no `aria-labelledby` (`panel.tsx:34`); the EmptyState `h3` is the panel's visible heading. Fine now; see open decision 2.

## Assumptions

- [A-1] Home shows no score, band, rank, percentile, streak, or progress metric on any row or panel; the invariant forbids composite scores and ranks, and the "no band on a row" extension is this brief's reading.
- [A-2] A panel renders only when the role can ever populate it; an applicable but empty panel renders its EmptyState.
- [A-3] The spec's panel order (runs, review, packages, courses) is priority order.
- [A-4] Each panel's empty action is its destination route; "Check again" is a fallback only where no destination exists; Phase 1 shows no action.
- [A-5] With zero memberships the Home panel shows `home.noMemberships` and no action.
- [A-6] Content ranges: runs 0–10 per term, review queue 0–60, packages 0–10, courses 0–6; scenario label ≤ 60, name ≤ 40, institution ≤ 60 characters.
- [A-7] Panels stack in one column at every width; no two-up layout at `xl`.
- [A-8] Under `sm` a row folds to two lines (label and chip; time and action).
- [A-9] Only the top row of "Your runs" carries a primary button; the rest are secondary.
- [A-10] The run state chip is defined with RunFrame in Phase 6 and reused here.
- [A-11] The greeting is name plus institution with no time-of-day logic.
- [A-12] Held runs appear as rows, not a count.
- [A-13] "Your runs" orders clock-running first, then assigned by due date, then awaiting debrief.
- [A-14] Visitor mode is Operate (given by the build's standing answer to every Impeccable direction question).
