# 09 — Frontend Specification

**Purpose / Read this when:** you build or change any page, layout, or component. This file holds the route map, the design system (the authority Impeccable's `DESIGN.md` records), the component inventory, the Impeccable workflow every screen goes through, and the accessibility and performance targets. Per-screen specifications are in `09-frontend-spec-screens.md`.

**Requirements covered:** UI-001 to UI-060, FR-210 to FR-214, NFR-006, NFR-010, NFR-013, NFR-017, SYS-018, SYS-021, INT-011; decisions D-005, D-025, D-052, D-074.

## 1. Route map (App Router)

| Route | Layout chain | Guard | Loading / error | Serves |
|---|---|---|---|---|
| `/` | root | none | — | redirects to `/home` when signed in, else `/sign-in` |
| `/sign-in`, `/sign-up`, `/verify-email`, `/forgot-password`, `/reset-password` | root → `(public)` | redirect to `/home` if signed in | `loading.tsx` skeleton card; `error.tsx` | UI-001 to UI-004 |
| `/privacy`, `/terms` | root → `(public)` | none | static | UI-006 |
| `/home` | root → `(app)` | session | shell skeleton; boundary | UI-009 |
| `/settings`, `/settings/security`, `/settings/data` | `(app)` | session | | UI-010 |
| `/notifications` | `(app)` | session | | UI-011 |
| `/invitations/[invitationId]` | `(app)` | session | | UI-005 |
| `/runs` | `(app)` | session (student or reviewer) | | UI-020 |
| `/runs/[runId]` | `(app)` → `runs/[runId]/layout.tsx` (RunFrame) | run owner or reviewer | run skeleton; boundary with request id | UI-027 |
| `/runs/[runId]/start` | RunFrame | owner; state `assigned` | | UI-021 |
| `/runs/[runId]/readiness`, `/runs/[runId]/readiness/result` | RunFrame | owner; state `readiness` / any later | | UI-022 |
| `/runs/[runId]/work` | RunFrame | owner; state `framing`, `working`, `paused` | | UI-023, UI-024 |
| `/runs/[runId]/locked` | RunFrame | owner; state `decision_locked` | | UI-024 |
| `/runs/[runId]/turn` | RunFrame | owner; state `turn_open` | | UI-025 |
| `/runs/[runId]/defense` | RunFrame | owner; state `defense_pending` | | UI-026 |
| `/runs/[runId]/debrief` | RunFrame | owner or reviewer; state ≥ `scored` | | UI-028 |
| `/records/[runId]` | `(app)` | owner; state ≥ `confirmed` | | UI-029 |
| `/courses`, `/courses/[courseId]` | `(app)` | member | | UI-030 |
| `/courses/[courseId]/sections/[sectionId]/roster` | `(app)` | section instructor, program lead | | UI-031 |
| `/assignments/[assignmentId]`, `/assignments/[assignmentId]/exports` | `(app)` | reviewer | | UI-032, UI-035 |
| `/review`, `/review/runs/[runId]` | `(app)` | reviewer | | UI-034, UI-033 |
| `/packages`, `/packages/new`, `/packages/[packageId]/versions/[versionId]`, `.../generation`, `.../confirm` | `(app)` | author, editor, (reviewer read-only for the version view) | | UI-040 to UI-044 |
| `/admin/users`, `/admin/flags`, `/admin/audit` | `(app)` → `admin/layout.tsx` | platform admin | | UI-050 |
| `/dev/components` | root → `dev/layout.tsx` | `APP_ENV` in {local, test}; else `notFound()` | | UI-060 |
| `not-found.tsx`, `error.tsx`, `global-error.tsx` | root | — | — | UI-007 |

Guards: `src/proxy.ts` redirects requests to `(app)` routes without a session cookie to `/sign-in?next=`; every page calls `getSession()` and the permission helper in its RSC and redirects or renders 404 (`notFound()`) for cross-tenant ids. The RunFrame layout redirects to the state's route when the URL does not match (`RunSummary.links.next`), so a student who opens `/runs/[id]/work` after locking lands on `/locked` or `/turn`.

Navigation model: the `(app)` shell has a left rail (Home, Runs, Courses, Review, Packages, Admin as permitted), the institution switcher, the notifications bell, and the account menu. Run pages hide the rail and show the RunFrame header (run label, state chip, clock, frame panel toggle, declaration control) to keep the working period focused.

## 2. Design system (recorded in `DESIGN.md`; D-025)

Register: an instrument panel for a simulator-style assessor. Calm, high-contrast, dense where data is dense (matrix, timeline), generous where the student writes (frame, brief, defense). No decoration that does not carry information. Visitor mode for every surface: Operate.

### 2.1 Typography

| Role | Face | Weights | Size scale (px / line-height) |
|---|---|---|---|
| UI and body | IBM Plex Sans | 400, 500, 600 | 13/20 (meta), 14/22 (body), 16/26 (reading), 18/28 (lead) |
| Trace data, numbers, keys, clock | IBM Plex Mono | 400, 500 | 12/18, 14/20; `font-feature-settings: "tnum"` |
| Headings | IBM Plex Serif | 500, 600 | 20/28 (h4), 24/32 (h3), 30/38 (h2), 36/44 (h1) |

Self-hosted woff2 in `public/fonts`, loaded with `next/font/local` in `src/app/fonts.ts` (`16-performance-a11y-budgets.md` §fonts). Never Inter, Arial, or system defaults.

### 2.2 Color tokens (light theme; dark theme is deferred and the tokens are structured for it)

| Token | Value | Use |
|---|---|---|
| `--paper` | `#F6F7F9` | page ground |
| `--paper-raised` | `#FFFFFF` | panels, cards (never nested) |
| `--paper-sunken` | `#ECEFF3` | inputs, timeline track |
| `--ink` | `#141A26` | primary text (tinted, never pure black) |
| `--ink-muted` | `#4B5563` | secondary text (contrast on paper 7.5:1) |
| `--ink-faint` | `#8A93A3` | decorative only: gridlines, disabled outlines, hairline icons; never text (3.1:1 on paper-raised, D-153); placeholders use ink at 70 % alpha and disabled text ink at 45 % (`16 §8.7`) |
| `--line-control` | `rgb(20 26 38 / 0.4)` | input and control boundaries (3.9:1 on paper, D-153) |
| `--line` | `#D5DAE2` | borders |
| `--line-strong` | `#AEB6C2` | focused borders, table rules |
| `--primary` | `#0F6E74` | actions, links, selected stance (deep teal) |
| `--primary-ink` | `#FFFFFF` | text on primary (7.1:1) |
| `--primary-soft` | `#DDEFF0` | selected row background |
| `--amber` | `#B7791F` | draft, uncalibrated, provisional labels and warnings as borders, icons, and chip fills only; never a text color (3.40:1 on paper, D-122); text on an amber-filled chip is `--ink` (4.78:1) |
| `--amber-soft` | `#FBF1DC` | label background with `--ink` text |
| `--red` | `#A23B2A` | refusals, errors, defect rows in the replay |
| `--red-soft` | `#F8E5E1` | |
| `--green` | `#2E7D4F` | confirmed, matched stances |
| `--green-soft` | `#E1F1E7` | |
| `--focus` | `#0F6E74` | 2 px outline with 2 px offset |
| Stance colors | accept `#2E7D4F`, verify `#0F6E74`, challenge `#B7791F`, reject `#A23B2A`, escalate `#5B4B9A` | matrix cells and stance chips, always paired with a text label and an icon |

No gray text on colored backgrounds; on `--primary-soft`, `--amber-soft`, `--green-soft`, `--red-soft` the text is the matching strong color or `--ink`. No gradients.

### 2.3 Spacing, radius, elevation, motion

- Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64 px (`--space-1` … `--space-8`). Page gutter 24 px; panel padding 16 px; dense tables 8 px cells.
- Radius: 2 px (chips, table cells), 6 px (inputs, buttons, panels), 10 px (dialogs). No pill buttons except stance chips (radius 999 px).
- Elevation: panels sit on `--paper` with a 1 px `--line` border and no shadow; dialogs and popovers use `0 8px 24px rgb(20 26 38 / 0.12)`. Cards are never nested inside cards; sections are separated by whitespace and hairlines.
- Motion: 150 ms for state changes, 200 ms for panel open/close, `cubic-bezier(0.2, 0, 0, 1)` (ease-out); no bounce or elastic easing; `prefers-reduced-motion` removes all transitions; the clock updates once per second without animation.
- Density: the stance matrix and clock timeline use 12/18 mono; everything the student writes uses 16/26 sans.

### 2.4 Iconography

`lucide-react` (tree-shaken), 16 px in chips and 20 px in navigation, always with a text label or `aria-label`. Stance icons: accept `check`, verify `search-check`, challenge `message-square-warning`, reject `x-octagon`, escalate `arrow-up-right`. State icons: locked `lock`, paused `pause-circle`, turn `radio`, draft `pencil-line`, confirmed `badge-check`, uncalibrated `flask-conical`.

### 2.5 Empty states and error illustration

No illustrations. Empty states are a single serif heading, one sentence of body text, and one action, inside the panel where content will appear. Errors show the plain message, the request id in mono, and a retry action. "Illustrative sample data" panels carry the amber label chip in their header and a dashed `--line-strong` border.

### 2.6 Tailwind and shadcn wiring

- Tailwind 4 with `@import "tailwindcss";` and `@theme inline { --color-paper: var(--paper); … --font-sans: var(--font-plex-sans); --font-mono: var(--font-plex-mono); --font-serif: var(--font-plex-serif); --radius-sm: 2px; --radius-md: 6px; --radius-lg: 10px; }` in `src/app/globals.css`; the CSS variables above are declared on `:root`.
- shadcn components are generated with `pnpm dlx shadcn@4.20.1 init -d --no-monorepo` (preset `base-nova` on Base UI, D-154) then `add`, and their default zinc tokens are replaced by the variables above in `globals.css` (`--background: var(--paper)`, `--foreground: var(--ink)`, `--primary: var(--primary)`, `--primary-foreground: var(--primary-ink)`, `--muted: var(--paper-sunken)`, `--muted-foreground: var(--ink-muted)`, `--border: var(--line)`, `--ring: var(--focus)`, `--destructive: var(--red)`, `--radius: 6px`). `components.json`: `style: "base-nova"`, `tailwind.css: "src/app/globals.css"`, `cssVariables: true`, `baseColor: "neutral"`, `iconLibrary: "lucide"`, aliases `@/components`, `@/lib`, `@/components/ui`, and `utils: "@/lib/cn"` (D-154).

## 3. Component inventory

`src/components/ui` (shadcn, themed): `button` (variants primary, secondary, ghost, destructive; sizes sm, md, lg), `input`, `textarea`, `label`, `select`, `checkbox`, `radio-group`, `switch`, `dialog`, `alert-dialog`, `sheet`, `popover`, `tooltip`, `tabs`, `table`, `badge`, `separator`, `scroll-area`, `progress`, `dropdown-menu`, `sonner` (toasts), `skeleton`, `field` (react-hook-form bindings; shadcn 4 replaced `form`, D-154).

`src/components/layout`: `AppShell`, `Rail`, `InstitutionSwitcher`, `NotificationsBell`, `AccountMenu`, `PageHeader` (serif title, description, actions), `Panel` (bordered section; never nested), `EmptyState`, `ErrorState` (message + request id + retry), `IllustrativeSample` (mandatory label wrapper, FR-254), `Label` chips (`draft`, `confirmed`, `uncalibrated`, `walkthrough`, `provisional`, `unreviewed`).

`src/components/features/run`: `RunFrame` (header: label, state chip, `Clock`, frame toggle, `DeclarationControl`), `Clock` (mono countdown; live region announcements at 5:00 and 1:00; paused state), `PolicyDisplay`, `ReadinessItem`, `ReadinessTimer`, `ConceptMap`, `BriefPanel` (scenario brief), `EvidenceRoom` (document list + `DocumentReader` with open/close signals), `FrameForm` (four fields with live word counts and the confidence slider with a numeric input), `FramePanel` (locked frame, collapsible), `AssistantPanel` (request box, streaming reply with `ClaimCard`s inline, "AI assistant" label, no-commentary state), `ClaimCard` (text, `StanceControl`, actions menu, escalate, escalation reply, used mark), `StanceControl` (five radio-style chips), `ActionResultSheet`, `EscalationDialog`, `DelegationLog` (rows with why line editor and used marks), `DeclarationControl` (text field with the no-penalty sentence), `BriefEditor` (five text fields with word counts, named numeric fields with units, confidence; autosave), `LockDialog` (summary, unstanced-claim refusal with the claim named), `AddendumDialog`, `PausedOverlay` (cause, resume button, credit note), `TurnPanel` (message in the world's voice, window countdown, window claims, response form with the frozen record beside), `DefenseQuestion` (question, answer editor, duration capture, follow-up), `DefenseArtifacts` (frame, brief, Turn response read-only), `RunStatus` (pending scoring, under review, scored).

`src/components/graphs`: `GraphFrame` (title, `role="img"` SVG slot, visually hidden description, "Data table" toggle rendering `<table>`), `ConfidenceLine`, `ClockTimeline`, `StanceMatrix` (rows + 5×5 summary + FCR), `FrameBesideDecision`, `TrajectorySample` (illustrative only).

`src/components/features/debrief`: `DebriefSections` (ordered), `ClaimWalkthroughRow`, `MissedDefect`, `ProbeTranscript`, `Counterfactual`, `BandCard` (draft/confirmed, evidence drawer trigger, quotes, note), `PointsSummary` (mapping, weight, draft/confirmed points), `DoneWell`, `DebriefQuestions`.

`src/components/features/review`: `ReplayTrace` (event list with clock column, filters by type), `BandDecisionControl` (four bands + unassessed + note), `EvidenceDrawer` (events behind a band), `PackageView`, `ClaimObjectView`, `ConfirmationRecord`, `VoidDialog`, `NeutralizeDialog` (reason, credit checkbox, note), `TestControls` (force failure), `ExportsList`, `ReviewQueue` (illustrative + real).

`src/components/features/courses`: `CourseForm`, `PolicyForm`, `MappingEditor` (with change preview table), `SectionRoster`, `AssignmentForm`, `AssignmentRunsTable`.

`src/components/features/packages`: `SeedForm`, `GenerationProgress`, `ElementList`, `ElementEditor` (per element type), `ConfirmBar` (confirm / edit / reject / regenerate), `VersionHeader`, `AuthoringMeasures`.

`src/components/features/account`: `ProfileForm`, `PasswordForm`, `SessionsList`, `DataExportButton`, `DeleteAccountDialog`.

`src/components/features/admin`: `UsersTable`, `RoleSelect`, `FlagsTable`, `AuditTable`.

Every component with text takes strings from `t()`; every interactive component is keyboard operable and has visible focus.

## 4. Impeccable workflow (mandatory, D-005)

Command names verified against Impeccable 3.6.1 (`npx impeccable@3.6.1`, skill `/impeccable <command>`): `init`, `shape`, `critique`, `audit`, `harden`, `polish`, `onboard`, `clarify`, `adapt`, `optimize`, `extract`, `document`, `detect`, `hooks`, `doctor`.

**Phase 1, once:**

1. `npx impeccable@3.6.1 install --providers=claude --scope=project` (keep the design hook), then reload Claude Code.
2. `/impeccable init`. When it asks: primary user = students in professional degree programs (3rd/4th year undergraduates and MBA, marketing and strategy) taking a Decision Run, and course instructors reviewing runs; the job = make a consequential decision with an AI assistant in the room and remain accountable for it; mechanism = controlled-reliability claims with an irreversible Decision Lock and a simulator-style trace readout; constraints = text-only runs, no artifact polish rewarded, WCAG 2.2 AA, en-US, Next.js 16 + Tailwind 4 + shadcn; voice = plain, declarative, never accusatory, never "cheating"; platform = web; stack = "delegated: Next.js 16 App Router, already scaffolded". Answer every question from `01-prd-analysis.md` §1–3 and this file; do not describe visual style during init (Impeccable forbids it).
3. Write `DESIGN.md` from §2 of this file in the installed skill's format (D-152): YAML frontmatter with `colors`, `typography`, `rounded`, `spacing`, and `components`, then the sections Overview, Colors (with the normative token table), Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts, plus Motion; the sidecar `.impeccable/design.json` carries shadows, motion, breakpoints, and narrative.
4. Build the app shell and the component gallery, then run `/impeccable document` to reconcile `DESIGN.md` with the built shell. When it proposes a change to a token, keep the value in §2 unless the change is required for contrast (log a `D-` row).
5. Add the ignore block to `.gitignore`:

```
# impeccable-ignore-start
.impeccable/config.local.json
.impeccable/hook.cache.json
.impeccable/hook.pending.json
.impeccable/*.png
.impeccable/review/
.impeccable/questions/
.impeccable/live/server.json
.impeccable/live/sessions/
.impeccable/live/previews/
.impeccable/live/annotations/
.impeccable/live/cache/
.impeccable/live/manual-edit-apply-transaction.json
.impeccable/live/manual-edit-events.jsonl
.impeccable/live/manual-edit-evidence/
.impeccable/live/pending-manual-edits.json
.impeccable/live/deferred-svelte-component-accepts.json
.impeccable/live/*.png
# impeccable-ignore-end
```

Keep `.impeccable/config.json`, `.impeccable/design.json`, `.impeccable/surfaces/*.md`, and `.impeccable/critique/*.md` tracked.

**Every new screen, inside its feature phase** (the per-screen loop; each phase step names the target route):

1. `/impeccable shape <route>` with the screen's section of `09-frontend-spec-screens.md` as the brief; when it asks about direction or visitor mode, answer "Operate; follow DESIGN.md".
2. Build against `DESIGN.md` and the component inventory.
3. `/impeccable critique <route>` → fix every finding rated high or medium.
4. `/impeccable audit <route>` (a11y, performance, responsive) → fix.
5. `/impeccable harden <route>` (errors, overflow, edge cases) → fix.
6. `/impeccable polish <route>` before the phase closes.

**After the core run screens exist (Phase 11):** `/impeccable onboard` for first-run flows and empty states (home, runs list, packages list); `/impeccable clarify <route>` for UX copy on the run workspace, debrief, replay, and confirmation workspace.

**Hardening phase (Phase 13):** `/impeccable adapt` across the app (all devices, 360 px to 1440 px), `/impeccable optimize` (performance), `/impeccable extract` to pull repeated patterns into `src/components/ui` and `DESIGN.md`.

**CI gate:** `npx impeccable@3.6.1 detect --json .` in the PR workflow; findings fail the build unless waived in `.impeccable/config.json` under `detector.ignoreRules`/`ignoreFiles`/`ignoreValues` with a `reason` string.

**Design rules the spec states explicitly (Impeccable anti-patterns):** no Inter, Arial, or system-default fonts; no gray text on colored backgrounds; no pure black or pure gray (always tinted); no cards nested in cards; no bounce or elastic easing; no generic purple-to-blue gradients (no gradients at all).

## 5. Responsive behavior

Breakpoints: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. The run workspace is a three-column layout at `lg`+ (Evidence Room | assistant and claims | brief and log), two columns at `md` (tabs for brief/log), and a single column with a bottom tab bar under `md`. The stance matrix scrolls horizontally inside its container under `lg` with sticky first column; the clock timeline stacks its window below the working clock under `md`. Nothing requires hover; every action is reachable by tap and keyboard. Minimum touch target 40 px.

## 6. Accessibility target (WCAG 2.2 AA, NFR-006)

- Semantic landmarks (`header`, `nav`, `main`, `aside`), one `h1` per page, heading order preserved.
- Focus: visible 2 px outline; focus moves to the page title on route change (`useFocusOnRouteChange`); dialogs trap and restore focus; the paused overlay is a modal dialog.
- Live regions: clock warnings (5:00, 1:00, expired), Turn arrival, assistant reply completion, lock refusal message.
- Forms: labels, descriptions, inline errors tied with `aria-describedby`, word counts announced politely.
- Graphs: `GraphFrame` contract (FR-212); color never the only carrier (stance chips carry icon and label; matrix cells carry text).
- Reading: documents rendered as `article` with headings and paragraphs; no text in images; no timed element without the pause path (FR-213).
- Keyboard-only completion of the whole run is an E2E test (FR-210).
- Contrast ratios are listed in `16-performance-a11y-budgets.md` and every pairing meets 4.5:1 (text) or 3:1 (UI).

## 7. Performance budgets

Per `16-performance-a11y-budgets.md`: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1; ≤ 250 KB gzip JS per run route; recharts loaded with `next/dynamic` only on graph routes; fonts preloaded (Sans only); no raster images.

## 8. Client data flow

- Server Components fetch view models through services; client components receive plain props.
- Mutations use Server Actions via `useActionState` or `useTransition` with optimistic UI only for stance chips and used marks (rolled back on error).
- The run pages poll `GET /api/v1/runs/{id}` every 5 s while a clock or window runs (`useRunPoll`), and refresh the RSC tree with `router.refresh()` when the state changes.
- The assistant reply is consumed with `fetch` + `ReadableStream` parsing of SSE lines in `useDelegation`.
- All strings via `t()`; dates via `Intl.DateTimeFormat` in the browser timezone (D-054).
