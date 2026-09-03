# 09 — Frontend Specification: Screens

**Purpose / Read this when:** you build a specific screen. Each entry gives purpose, data (which service, action, or endpoint), component tree, every state, validation and inline errors, responsive behavior, keyboard and screen-reader notes, and the analytics events fired. Shared rules (tokens, components, Impeccable loop, breakpoints) are in `09-frontend-spec.md`.

**Requirements covered:** UI-001 to UI-060 and the FR-### each screen serves (listed per screen).

Common to every screen: `loading.tsx` renders the panel skeletons; `error.tsx` renders `ErrorState` with the request id; strings come from `t()`; every form uses react-hook-form with the module's Zod schema and shows inline errors under the field with `aria-describedby`; success and failure toasts via `sonner`; analytics events are the names in `17-analytics-events.md`. States listed as "loading, empty, error, partial, success" are always implemented even when a state is rare.

## Public

### UI-001 Sign-in (`/sign-in`) — SYS-001, SYS-002

- **Data:** `authClient.signIn.email`, `authClient.signIn.social({ provider: 'google' })`; `GOOGLE_CLIENT_ID` presence via `flags`-like prop from the layout (`googleEnabled`).
- **Tree:** `PublicCard` → `PageHeader` (serif "Sign in to Tassl") → `Form` (email, password, "Keep me signed in" checkbox) → `Button` primary → divider → Google button (hidden when disabled) → links (forgot password, create account).
- **States:** default; submitting (button disabled, spinner); error `INVALID_EMAIL_OR_PASSWORD` (one inline message under the form, never says which field); `EMAIL_NOT_VERIFIED` (message + "Resend verification" action); rate limited (message with retry seconds); success redirects to `next` or `/home`.
- **Validation:** email format; password non-empty.
- **Responsive:** single column, card max 420 px.
- **A11y:** autofocus on email; `autocomplete` attributes; error message in a live region.
- **Events:** `sign_in_succeeded`.

### UI-002 Sign-up (`/sign-up`) — SYS-001

- **Data:** `authClient.signUp.email`.
- **Tree:** `PublicCard` → header → `Form` (name, email, password with a strength hint "12 to 128 characters") → submit → link to sign in.
- **States:** default; submitting; error (email already used: same success message as new, then "check your email"); success → `/verify-email?sent=1`.
- **Validation:** name 1–120; email; password 12–128 (no composition rules).
- **Events:** `sign_up_completed`.

### UI-003 Verify email (`/verify-email`) — SYS-001

- **Data:** query `sent`, `token` handled by Better Auth's callback; `authClient.sendVerificationEmail`.
- **States:** sent (instructions, "Resend" button with 60 s cooldown); verified (success, "Continue" → `/home`); expired/invalid token (message + resend form).
- **Events:** `email_verified` (server-side on verification).

### UI-004 Forgot and reset password (`/forgot-password`, `/reset-password`) — SYS-001

- **Data:** `authClient.requestPasswordReset`, `authClient.resetPassword`.
- **States:** forgot: default, submitted (always "If that address exists, we sent a link"); reset: default (new password twice), invalid or expired token, success → sign in.
- **Validation:** password 12–128; confirmation matches.

### UI-005 Accept invitation (`/invitations/[invitationId]`) — SYS-005

- **Data:** invitation from Better Auth (`organization.getInvitation`); `acceptInvitationAction`.
- **States:** loading; valid (institution name, role, "Accept"); email mismatch (message explaining the signed-in email differs, with sign-out link); expired; accepted → `/home`.
- **Events:** `invitation_accepted`.

### UI-006 Privacy and Terms (`/privacy`, `/terms`) — SYS-007

Static RSC pages generated from `src/lib/legal/privacy.ts` and `terms.ts` (content derived from `06-data-model.md` and `01-prd-analysis.md` §9: what is collected, purposes, retention per D-018, processors: Neon, Vercel, Resend, PostHog, Sentry, the LLM provider; contact address from `EMAIL_FROM`). A "Last reviewed" date constant and the release checklist item require human review (`15-cicd-deployment.md`).

### UI-007 Not found and errors — SYS-008

`not-found.tsx`: serif "Not found", one sentence, link home. `error.tsx`: `ErrorState` with request id and "Try again" (`reset()`). `global-error.tsx`: minimal HTML shell with the same content and `Sentry.captureException`.

## Shell and account

### UI-008 App shell (`(app)/layout.tsx`) — SYS-010

- **Data:** `getCurrentUser`, unread notification count, institutions.
- **Tree:** `AppShell` → `Rail` (Home, Runs, Courses when member of a section as instructor or a course exists, Review when reviewer, Packages when author or editor, Admin when admin) → `InstitutionSwitcher` (`setActiveInstitutionAction`) → `NotificationsBell` (count badge) → `AccountMenu` (name, settings, sign out) → `main`.
- **States:** one institution (switcher shows the name, no menu); several; zero memberships (rail shows Home only with an empty state explaining to await an invitation).
- **Responsive:** rail collapses to a bottom bar under `md`.
- **A11y:** skip link to `main`; rail is `nav` with `aria-current`.

### UI-009 Home (`/home`)

- **Data:** `listMyAssignments`, `listCourses` (instructor), `listPackages` (author/editor), `listNotifications({ unread })`, pending held runs (reviewer).
- **Tree:** `PageHeader` (greeting, institution) → role panels: "Your runs" (next action per assignment: Start, Continue, Read debrief), "Review" (scored runs awaiting decisions, held runs), "Packages" (drafts awaiting confirmation, generation in progress), "Courses".
- **States:** loading skeleton; empty per panel (`EmptyState` with the single relevant action); error per panel.
- **Events:** page view.

### UI-010 Account settings (`/settings`, `/settings/security`, `/settings/data`) — SYS-003, SYS-004

- **Data:** `getCurrentUser`, `updateProfileAction`, `authClient.changePassword`, `authClient.listSessions`, `revokeSession`, `revokeOtherSessions`, `POST /me/export`, `requestAccountDeletionAction`.
- **Tree:** tabs (Profile, Security, Data) → forms; Data: "Download my data" (JSON), "Delete account" (`AlertDialog` requiring typing the email; explains the 30-day purge and that course records keep a pseudonymous copy).
- **States:** saving; session list with current device marked; export rate-limited message; deletion pending (signed out immediately).
- **Events:** none beyond page view.

### UI-011 Notifications (`/notifications`) — SYS-010

- **Data:** `listNotifications` (cursor), `markReadAction`, `markAllReadAction`.
- **Tree:** list rows (type icon, title, body, time, link) with unread emphasis; "Mark all read".
- **States:** empty; paginated ("Load more"); optimistic read marking.

## Student run flow

### UI-020 Runs list (`/runs`) — FR-235

- **Data:** `listMyAssignments`, `listMyRuns`.
- **Tree:** `PageHeader` → table: assignment label, `walkthrough` chip when flagged, attempt, state chip, next action button.
- **States:** empty ("No assignments yet"); voided runs shown struck with "re-offered" link; held run shows "Under review".
- **Events:** page view.

### UI-021 Policy display (`/runs/[runId]/start`) — FR-201

- **Data:** `getPolicyDisplay`, `acknowledgePolicyAction`.
- **Tree:** `RunFrame` (state "Not started") → `PolicyDisplay` panel: outside-AI policy in plain language, run weight ("2.5 percent of the course grade"), band-to-points mapping table, the statement "This run counts toward the course grade. Run one counts.", working clock length with the `uncalibrated` chip → "Begin the Readiness Check" button.
- **States:** loading; already started (redirect to the state's route); error.
- **A11y:** the counts statement is an `h2`; the mapping is a real table.
- **Events:** `policy_displayed` (server), `run_started` (server).

### UI-022 Readiness Check and result (`/runs/[runId]/readiness`, `/readiness/result`) — FR-010 to FR-018

- **Data:** `getReadiness`, `answerReadinessItemAction`, `submitReadinessAction`, `skipReadinessAction`; result from `run_readiness_results`.
- **Tree:** `ReadinessTimer` (8:00 countdown, live region at 1:00) → item navigator (16 numbered buttons showing answered state) → `ReadinessItem` (stem, four radio options, Next/Previous) → "Submit" (confirm dialog listing unanswered count).
- **States:** in progress; submitting; expired (auto-submitted message → result); submit failed (error with "Skip the check" offered per FR-018); resumed at the first unanswered item (FR-017).
- **Result page:** `ConceptMap`: one row per concept with `held`, `not held`, or `unknown` in plain language ("You showed a working grasp of retention." / "Survey error looks thin." / "We could not tell about AI pushback."); no totals; "Open the scenario" button.
- **Validation:** none beyond selection.
- **A11y:** radio group per item with fieldset/legend; keyboard navigation between items with arrow keys on the navigator.
- **Events:** `readiness_submitted`.

### UI-023 Run workspace (`/runs/[runId]/work`) — FR-020 to FR-108

The largest screen; a three-column layout (see `09-frontend-spec.md` §5).

- **Data:** `getRunWorkspace` (RSC) + `useRunPoll`; actions: `openDocumentAction`, `closeDocumentAction`, `lockFrameAction`, delegation route (stream), `updateDelegationAction`, `declareOutsideToolAction`, `setStanceAction`, `runActionAction`, `escalateAction`, `saveBriefDraftAction` (debounced 800 ms), `briefSignalAction`, `lockDecisionAction`, `resumeRunAction`.
- **Tree:** `RunFrame` (label, state chip, `Clock`, "Frame" toggle → `FramePanel`, `DeclarationControl`) → columns:
  - Left: `BriefPanel` (scenario brief) and `EvidenceRoom` (document list: title, author, date; `DocumentReader` opens in place, sends open on mount and close on unmount, tab hide, or navigation).
  - Middle: state `framing`: `FrameForm` (decision 50 words, three assumptions 25 words each, position 100 words, confidence 0–100 slider + number; live word counts; "Lock the frame" with an `AlertDialog` stating it is permanent and the assistant unlocks after). State `working`: `AssistantPanel` (labeled "AI assistant"; request box; streamed reply with `ClaimCard`s inline; each card: text, `StanceControl`, actions menu (Source Trace 1 min; Replication Check 3 min; Decomposition Check 4 min, only when authored), Escalate (5 min), "Used" mark), and a `DelegationLog` tab.
  - Right: `BriefEditor` (recommendation 120, rationale 250, three assumptions 25, what would change your mind 60, named numeric fields with unit labels, confidence) with autosave status; "Lock the decision" button → `LockDialog`.
- **States:** framing (assistant and brief editor disabled with the sentence "The assistant unlocks after you lock your frame"); working; paused (`PausedOverlay` modal: cause in plain language, "Resume" button, note that the clock stopped and the cost is credited); clock under 5:00 (amber clock), under 1:00 (red clock, live region), expired (redirect to `/locked` after the poll materializes the auto-lock); assistant streaming; assistant no-commentary; assistant failure (overlay); rate limited (toast with seconds); lock refused (`LockDialog` shows "A claim you relied on has no stance" with the claim text and a "Go to claim" button that scrolls to and focuses the card); brief invalid (inline field errors from `details.field`); document open failure (toast; run paused if the server paused it).
- **Validation:** word limits live on the client with the same `countWords`; numeric fields accept digits, decimal point, minus; server errors mapped to fields.
- **Responsive:** `md`: two columns (left, middle) with the brief in a `Sheet`; under `md`: single column with a bottom tab bar (Room, Assistant, Brief, Log).
- **A11y:** the assistant reply is a live region (`aria-live="polite"`) that announces "Reply complete, N claims surfaced"; each `ClaimCard` is an `article` with a heading; `StanceControl` is a radio group; actions menu is a `DropdownMenu`; the clock is `role="timer"` with polite announcements only at thresholds; document reader is an `article`; the frame panel is a disclosure.
- **Events:** `frame_locked`, `document_opened`, `delegation_made`, `stance_set`, `action_run`, `escalation_made`, `outside_tool_declared`, `lock_refused`, `decision_locked`, `run_paused` (all server-side).

### UI-024 Lock dialogs and addendum (`/runs/[runId]/locked`) — FR-084, FR-102, FR-107

- **Data:** `getRun`, `addAddendumAction`.
- **Tree:** `RunFrame` → panel "Decision locked" with the locked brief read-only, the frozen frame, and the message "The Turn will arrive shortly" with the countdown to `turnDueAt`; "Add an addendum" (`AddendumDialog`: 50 words, explains it is visible to reviewers and never part of the original decision; disabled once used).
- **States:** waiting for the Turn (poll); addendum saved; redirect to `/turn` when `turn_open`.
- **A11y:** Turn arrival announced in a live region and focus moved to the Turn panel after navigation.
- **Events:** `turn_delivered` (server).

### UI-025 Turn window (`/runs/[runId]/turn`) — FR-110 to FR-115

- **Data:** `getTurn`, `respondToTurnAction`; the assistant, room, claims, and actions as in UI-023 but scoped to the window.
- **Tree:** `RunFrame` (window countdown 12:00) → `TurnPanel`: the message in the world's voice with the voice type as a chip ("Stakeholder message"); window claims as `ClaimCard`s requiring a stance; reopened `AssistantPanel` and `EvidenceRoom` (collapsible); response form: hold / revise / reverse radio, justification 150 words, updated confidence; the frozen pre-Turn record beside (frame and locked brief) in the `FrameBesideDecision` layout.
- **States:** open; submitting; window under 1:00; expired (implicit hold notice → redirect to `/defense`); refused because a window claim is unstanced (the claim is named).
- **Responsive:** frozen record stacks below the form under `lg`.
- **Events:** `turn_response_locked` (server).

### UI-026 Defense (`/runs/[runId]/defense`) — FR-120 to FR-126

- **Data:** `getDefense`, `answerDefenseQuestionAction`, `completeDefenseAction`.
- **Tree:** `RunFrame` (no clock; "Defense" state) → two columns: `DefenseQuestion` list with the current question expanded (answer textarea, "Submit answer"; follow-up appears beneath when triggered, labeled "Follow-up"); `DefenseArtifacts` (frame, locked brief, addendum, Turn response) read-only; no assistant, no room. "Finish the defense" appears when every question has an answer (empty answers allowed after a confirm dialog: "Unanswered questions count as no answer").
- **States:** in progress (resumes at the first unanswered); submitting; complete → `/runs/[runId]` status page.
- **Validation:** ≤ 5,000 characters.
- **A11y:** questions are a list with headings; the current question receives focus; duration is captured from focus to submit.
- **Events:** `defense_completed` (server).

### UI-027 Run status (`/runs/[runId]`) — FR-140

- **Data:** `getRunStatus`.
- **States:** pending scoring ("Your run is being scored"; poll); under review (`held`: "Your run is under review by your instructor"); scored → link to the debrief; confirmed/recorded → links to debrief and record; voided → message with the re-offered run link; any active state → redirect to its route.

### UI-028 Run Debrief (`/runs/[runId]/debrief`) — FR-150 to FR-155

- **Data:** `getDebrief`, `answerDebriefAction`.
- **Tree:** `PageHeader` ("Run Debrief", draft or confirmed chip, `uncalibrated` chip, walkthrough chip) → `DebriefSections` in the fixed order: `FrameBesideDecision`; `StanceMatrix` with `ClaimWalkthroughRow` under each row (what you did, what it warranted, why, from the package rationale); `MissedDefect` rows (document, action, cost); `ProbeTranscript` (if fired); `ConfidenceLine`; Turn beside frame; `ClockTimeline`; `Counterfactual`; `BandCard` × 7 (draft or confirmed; graph link; evidence drawer; quotes; instructor note); `PointsSummary` (mapping table, weight, provisional points labeled draft or confirmed points); `DoneWell`; `DebriefQuestions` (two textareas, 100 words each; disabled after answering with the answers shown).
- **States:** draft; confirmed (bands replaced in place, note shown); partial (sections `not available` with reason); questions answered; reviewer view (same content, no question form, "Viewing as reviewer" chip).
- **Responsive:** graphs full-width stacked; matrix scrolls horizontally under `lg`.
- **A11y:** each section is a labeled region; every graph through `GraphFrame` (table + description); band cards are `article`s.
- **Events:** `debrief_opened`, `debrief_answered` (server).

### UI-029 Judgment Record (`/records/[runId]`) — FR-170 to FR-172, FR-254

- **Data:** `getRecord`, `GET /runs/{id}/record/export`.
- **Tree:** `PageHeader` ("Judgment Record", walkthrough chip) → four graphs → confirmed bands with evidence and notes → mode and variant → "Download record" (JSON) → `IllustrativeSample` panel "Four-run trajectory" from `sample.trajectory()` when `flags.sampleData`, with the mandatory label and a sentence that it is not this student's data.
- **States:** not available (before confirmation); available; sample data hidden when the flag is off.
- **Events:** `record_opened`.

## Instructor

### UI-030 Courses (`/courses`, `/courses/[courseId]`) — FR-200, FR-205, FR-206

- **Data:** `listCourses`, `getCourse`, `createCourseAction`, `updateCoursePolicyAction`, `previewMappingChangeAction`, `changeMappingAction`, `createSectionAction`.
- **Tree:** list: table (name, term, sections, assignments) + "New course" (`CourseForm`). Detail: `PageHeader` → tabs: Sections (list with roster links, "New section"), Assignments (list with state summary, link to configuration), Policy (`PolicyForm`: outside-AI policy radio with plain-language descriptions, default run weight, taught concepts), Mapping (`MappingEditor`: four numeric inputs; "Preview changes" shows affected runs with points now and after; "Apply" requires ticking "I understand every confirmed run will be re-exported").
- **States:** empty; saving; preview loading; mapping invalid (inline); applied (toast with the recompute count).
- **Events:** `course_created`.

### UI-031 Section roster (`/courses/[courseId]/sections/[sectionId]/roster`) — SYS-005

- **Data:** `listSectionMembers`, `addSectionMemberAction`, `removeSectionMemberAction`, `inviteMemberAction`.
- **Tree:** table (name, email, role, remove) → "Add member" (email + role; error when the email is not an institution member with an inline "Invite to institution" action that opens the invitation form) → invitations list (pending, expired).
- **States:** empty; remove blocked (`MEMBER_HAS_RUNS` message).

### UI-032 Assignment configuration and runs (`/assignments/[assignmentId]`) — FR-200

- **Data:** `getAssignment`, `createAssignmentAction` (from the course page), `updateAssignmentAction`, `listAssignmentRuns`, `deleteWalkthroughRunAction`.
- **Tree:** `AssignmentForm` (label, package version select showing only confirmed versions with the `uncalibrated` chip, variant radio (defective/sound), working clock seconds with the package default shown, weight with the course default shown, walkthrough toggle, opens at) → `AssignmentRunsTable` (student, attempt, state, decisions made, export version, actions: Open replay, Delete (walkthrough only)).
- **States:** locked fields when runs exist (`ASSIGNMENT_IN_USE` explanation); empty runs; saving.
- **Events:** `assignment_configured`.

### UI-033 Faculty replay (`/review/runs/[runId]`) — FR-180 to FR-185, FR-118, FR-003, FR-008

- **Data:** `getReplay`, `decideBandAction`, `confirmRemainingAction`, `voidRunAction`, `neutralizeClaimAction`, `forceAssistantFailureAction`, `flagDelegationAction`, `bandHeldRunManuallyAction`, exports list.
- **Tree:** `PageHeader` (student seat label, run label, state chip, `uncalibrated` and walkthrough chips) → tabs:
  - Overview: four graphs (`GraphFrame`s) with the defense transcript beneath (question, answer, follow-up, expected-answer notes in a muted panel); `ConceptMap`; declarations with the course policy; unverified numbers list; flags (`nothing_answered`, `all_novice`, speed outlier).
  - Bands: seven `BandCard`s each with `BandDecisionControl` (four bands + unassessed radio, note textarea, "Confirm draft" shortcut) and `EvidenceDrawer` (the graph it was read from, the event list, quotes); progress "N of 7 decided"; "Confirm remaining"; after all seven: `PointsSummary` with the mapping arithmetic ("(3 + 2 + 3 + 2 + 3 + 3 + 2) / 7 = 2.571") and the export link.
  - Trace: `ReplayTrace` (seq, clock remaining, type, summary; expandable payload; filter by type).
  - Package: `PackageView` (id, version, confirmation record table, authoring record, measures) and `ClaimObjectView` per claim (both variants' states; the current variant highlighted).
  - Actions: `VoidDialog` (reason, re-offer toggle, variant select), `NeutralizeDialog` per claim (reason, credit challenge checkbox with the PRD sentence, note; shows the recompute result after), `TestControls` (shown only when `capabilities.canForceFailure`: "Force the next assistant call to fail" with an explanation that it exists for the walkthrough's step 7), held-run manual banding form when `scoringStatus = 'held'`.
- **States:** scored (decisions open); confirmed/recorded (decisions shown, re-decision allowed with the re-export note); TA view (cannot change instructor-decided bands; no void/neutralize/test controls); held; voided (read-only with the re-offer link).
- **Responsive:** tabs stack; graphs full width.
- **A11y:** the decision control is a radio group per dimension with the draft pre-selected but not submitted; the trace table has sticky headers and row expansion by keyboard.
- **Events:** `replay_opened`, `band_decided`, `run_confirmed`, `claim_neutralized`, `run_voided`, `run_reoffered`, `export_written` (server).

### UI-034 Review queue (`/review`) — FR-186, FR-254

- **Data:** `getQueue`.
- **Tree:** `IllustrativeSample` panel "Review queue (illustrative)" with sample rows (Coherence Gaps, boundary cases, appeals, pattern flags, batch) under the mandatory label → divider "Walkthrough runs" → real scored runs table with links to replays.
- **States:** sample hidden when the flag is off; no real runs (empty state).

### UI-035 Course export (`/assignments/[assignmentId]/exports`) — FR-204, FR-184

- **Data:** `listAssignmentExports`, `GET /runs/{id}/exports/{version}`.
- **Tree:** table (run, student seat, version, reason, created, download) with the note "Enter bands, mapping, and points in the gradebook of record; Tassl holds no grade."
- **States:** empty; download error.

## Author and editor

### UI-040 Packages list (`/packages`) — FR-190

- **Data:** `listPackages`.
- **Tree:** table (title, family, latest version, status chip, calibration chip, warnings such as "family lacks an ethical-shortcut defect") + "New package from a seed case".
- **States:** empty; generation in progress indicator.

### UI-041 New package from seed (`/packages/new`) — FR-190

- **Data:** `createPackageFromSeedAction`, then `startGenerationAction`.
- **Tree:** `SeedForm`: title, family key (auto from title, editable), concept set (tag input, ≥ 4), seed case: title, publisher, license terms (textarea), "The license permits adaptation" checkbox (required), seed text (textarea, counter to 200,000 characters, paste-friendly); "Create and generate" and "Create only".
- **States:** validating; created; generation started → redirect to progress; error (`LICENSE_NOT_CONFIRMED`, `CONFLICT` on family key).
- **Events:** `package_created_from_seed`.

### UI-042 Generation progress (`/packages/[packageId]/versions/[versionId]/generation`) — FR-191, FR-198

- **Data:** `getGenerationStatus` (poll every 5 s while running), `regenerateElementAction`.
- **Tree:** seven step rows (name, status chip, pass number, tokens, cost estimate, failed rules with the PRD rule text, error) → validation report (rule failures with links to the element) → "Open confirmation workspace" when every step succeeded → "Retry step" per failed step.
- **States:** queued; running; succeeded; failed (with retry); validation failing (explains what to edit by hand).
- **Events:** `generation_step_completed` (server).

### UI-043 Element confirmation workspace (`/packages/[packageId]/versions/[versionId]/confirm`) — FR-192

- **Data:** `getPackageVersion` (full draft), `updateElementAction`, `decideElementAction`, `regenerateElementAction`, `confirmVersionAction`.
- **Tree:** left `ElementList` grouped by type with decision status counts (brief; documents; stakeholders; answer space; named fields; claims (per claim: base fields and the two variant states side by side); probe; Turn; question bank; counterfactual; general escalation reply; readiness items; clock and difficulty; seed re-skin log) → right `ElementEditor` for the selected element (typed form; `opened_at` captured when selected) → `ConfirmBar` (Confirm, Save edits (records `edited`), Reject with note, Regenerate) → top `VersionHeader` with progress "N of M confirmed", "Teaching note checked against the answer space and claims" checkbox, and "Confirm version" (disabled until complete; shows `validatePackage` failures inline).
- **States:** draft editing; element confirmed (read-only until "Reopen"); rejected (regeneration queued); version confirmed (everything read-only with the frozen chip); validation failures listed.
- **Validation:** per element schema (word limits, roles, 6/4/6 items, stance enums).
- **Responsive:** list becomes a top select under `lg`.
- **A11y:** list is a tree with keyboard navigation; editor fields labeled; the confirm bar is a toolbar.
- **Events:** `element_decided`, `package_confirmed` (server).

### UI-044 Package version view (`/packages/[packageId]/versions/[versionId]`) — FR-180, FR-195, FR-198

- **Data:** `getPackageVersion`, `exportPackage`, `regenerateVersionAction`.
- **Tree:** `VersionHeader` (package id, version, status, calibration chip "uncalibrated: no field calibration; difficulty profile is the authority's estimate") → `ConfirmationRecord` table (element, decision, by, when, revision) → authoring record (model, generated at, confirmed by/at, seed case title, publisher, license terms relied on, re-skin log) → `AuthoringMeasures` (seed to confirmed, edit rate, rejected share, passes, review time per element) → claims table linking to `ClaimObjectView` → "Export package JSON", "Create next version".
- **States:** draft (links to confirm workspace); confirmed; reviewer read-only (no seed record for TAs).

## Admin and dev

### UI-050 Admin (`/admin/users`, `/admin/flags`, `/admin/audit`) — SYS-006

- **Data:** `listUsers` (search), `setPlatformRoleAction`, `getFlags`, `listAuditLog`.
- **Tree:** users table with `RoleSelect` (confirm dialog: "This signs the user out"); flags table (name, value, source "env", effective LLM provider); audit table (time, actor, action, target, org, request id; filter by org).
- **States:** empty; saving; search.

### UI-060 Component gallery (`/dev/components`) — SYS-018

Renders every component in `09-frontend-spec.md` §3 in each variant and state with fixture data (including all four graphs from `tests/fixtures/scoring/marco-8-of-11.json`), grouped by folder, with a theme token table. Returns 404 outside `local` and `test`. Used by `/impeccable critique` and by the Lighthouse CI run.
