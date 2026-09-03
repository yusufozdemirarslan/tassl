# 17 — Analytics Events

**Purpose / Read this when:** you add a screen, a service function, or a metric and need to know which PostHog event fires, with which typed properties, from where. It also fixes the privacy rules every event obeys and the insight definitions that compute the PRD §10 metrics and the build-onward authoring measures. Read it before touching `src/lib/analytics/**`, `src/server/analytics/**`, `src/instrumentation-client.ts`, or the `/ingest` rewrites.

**Requirements covered:** AN-001, AN-002, AN-003, AN-004, AN-005, AN-006 (deferred), FR-198, FR-201, FR-235, INT-005, NFR-016, SYS-025; decisions D-023, D-024, D-066, D-098.

## 1. Rules that apply to every event

1. PostHog is the only analytics sink (D-024). Client events go through `posthog-js@1.425.1`; server events go through `posthog-node@5.51.6`. Both are no-ops when `NEXT_PUBLIC_POSTHOG_KEY` is empty (D-098); tests run without a key.
2. Event names are `snake_case` `object_verb` (`04-repo-structure.md` §3). The catalogue in §3 is exhaustive: an event that is not in `EVENTS` (`src/lib/analytics/events.ts`) does not compile.
3. Properties are ids, enums, counts, durations, shares (0 to 1), and booleans. Never names, emails, free text, claim texts, document bodies, defense answers, justifications, escalation statements, "why" lines, declaration purposes, notes, or IP addresses. The Zod schemas are `z.strictObject`, so an unknown key fails validation (allowlist by construction).
4. The person identity is `sha256(user.id)` truncated to the first 16 hex characters, computed server-side (`hashUserId`). PostHog never receives the raw user id, the email, or the name. No person properties are ever set.
5. Every event carries `app_env` and `organization_id` (the institution id, D-006) and the `organization` group. Every run-scoped event carries `is_walkthrough` (FR-235) so pilot analysis excludes walkthrough runs with one filter.
6. Server events fire after the transaction that wrote the trace commits, never inside it. Analytics never changes control flow: `track()` never throws in preview or production; in `APP_ENV=local` and `APP_ENV=test` an invalid payload throws so the bug is caught in development.
7. These events exist for product operations and for the pilot's research questions. Counts of checks, actions, or documents opened are never shown to students and never become student-facing performance targets (PRD §10 Engagement). No screen, debrief section, or export reads from PostHog.
8. Trace events (`run_events`, FR-241) and analytics events are different things. The trace is the record; analytics is a derived, lossy, privacy-reduced mirror. Nothing scored, exported, or displayed is built from analytics.

## 2. Pipeline

```mermaid
flowchart LR
  subgraph browser[Browser]
    ic[src/instrumentation-client.ts<br/>posthog.init api_host=/ingest]
    cl[src/lib/analytics/client.ts<br/>trackClient, identifyClient, resetClient]
    id[AnalyticsIdentity client component<br/>identify(hash) + group(organization)]
  end
  subgraph server[Next.js server]
    ev[src/lib/analytics/events.ts<br/>EVENTS: name -> z.strictObject]
    tr[src/server/analytics/track.ts<br/>track(name, props, actor)]
    ph[src/server/analytics/posthog.ts<br/>posthog-node client per request<br/>flushAt 20, flushInterval 10000<br/>shutdown via after()]
    svc[module services, job handlers,<br/>llm/calls.ts, rate-limit, auth hooks]
    rw[next.config.ts rewrites<br/>/ingest/* -> us.i.posthog.com]
  end
  svc --> tr --> ev
  tr --> ph
  cl --> ev
  ic --> rw
  ph -->|HTTPS| posthog[(PostHog US cloud)]
  rw -->|HTTPS| posthog
  id --> cl
```

Client and server validate against the same `EVENTS` map. The browser talks only to the app origin (`/ingest`), so the CSP `connect-src 'self'` and `script-src 'self'` in `12-security.md` need no PostHog host. `proxy.ts` excludes `/ingest/:path*` from its matcher so no auth redirect, request id, or `X-Requested-With` check touches ingest traffic.

## 3. Event catalogue

Shared property groups used in the tables:

| Group | Properties (every property is required; nullable ones are marked) |
|---|---|
| `R` run context | `run_id: uuid`, `assignment_id: uuid`, `package_version_id: uuid`, `variant: enum(defective\|sound)`, `mode: enum(guided\|standard\|open)`, `attempt_no: int`, `is_walkthrough: boolean` |
| `P` package context | `package_id: uuid`, `package_version_id: uuid`, `version: int` |
| `C` claim context | `claim_id: uuid`, `importance: enum(load_bearing\|supporting)`, `consequence_level: enum(low\|medium\|high)`, `in_turn_window: boolean` |
| common (added by `track` on the server; by `posthog.register` super properties on the client) | `app_env: enum(local\|test\|preview\|production)`, `organization_id: string \| null`, `request_id: uuid \| null` (server only), `source: enum(server\|client)` |

Triggers name the service function (`02-architecture.md` §6) or the client interaction. "Server" events are fired with `track()`; "client" events with `trackClient()`.

### 3.1 AN-002 Activation (sign-up to first configured assignment, first and second run)

| Event | Trigger | Properties | Screen | Serves |
|---|---|---|---|---|
| `sign_up_completed` | Better Auth `databaseHooks.user.create.after` in `src/server/auth/auth.ts` (server) | `method: enum(password\|google)` | UI-002 `/sign-up` | AN-002 |
| `email_verified` | Better Auth `emailVerification.afterEmailVerification` (server) | `ms_since_sign_up: int` | UI-003 `/verify-email` | AN-002 |
| `sign_in_succeeded` | Better Auth `hooks.after` when `ctx.context.newSession` is set; `method` from `ctx.path`: `/sign-in/email` → `password`, `/callback/google` → `google`, `/verify-email` → `verification` (server) | `method: enum(password\|google\|verification)` | UI-001 `/sign-in` | AN-002 |
| `invitation_accepted` | `tenancy.acceptInvitation` (server) | `invitation_id: uuid`, `role: enum(student\|instructor\|teaching_assistant\|scenario_author\|program_lead)`, `ms_since_invited: int` | UI-005 `/invitations/[id]` | AN-002 |
| `course_created` | `courses.createCourse` (server) | `course_id: uuid`, `outside_ai_policy: enum(open\|declared\|in_environment_only)`, `mapping_is_default: boolean`, `ms_since_first_sign_in: int` | UI-030 `/courses` | AN-002 |
| `assignment_configured` | `courses.createAssignment` (`is_new: true`) and `courses.updateAssignment` (`is_new: false`) (server) | `assignment_id: uuid`, `course_id: uuid`, `section_id: uuid`, `package_version_id: uuid`, `variant: enum(defective\|sound)`, `is_new: boolean`, `is_walkthrough: boolean`, `working_clock_seconds: int`, `weight_overridden: boolean`, `ms_since_first_sign_in: int` | UI-032 `/assignments/[assignmentId]` | AN-002, FR-200 |
| `policy_displayed` | `runs.startRun`, mirrors the `policy_displayed` trace event written when the student clicks Begin (server) | `R`, `outside_ai_policy: enum(open\|declared\|in_environment_only)`, `weight_percent: number`, `mapping_is_default: boolean` | UI-021 `/runs/[runId]/start` | AN-002, FR-201 |
| `run_started` | `runs.startRun`, mirrors the `lifecycle` event `assigned → readiness` (server) | `R`, `is_reoffer: boolean`, `run_index_for_student: int` (count of runs this student has started across all assignments, including this one) | UI-021 `/runs/[runId]/start` | AN-002, AN-003 |

`ms_since_first_sign_in` is `now − user.created_at`: the account row is created at sign-up or at the first Google sign-in, which is the PRD's "instructor access" instant (§10 Activation).

### 3.2 AN-001 Authoring operating measures (FR-198)

| Event | Trigger | Properties | Screen | Serves |
|---|---|---|---|---|
| `package_created_from_seed` | `scenarios.createPackageFromSeed` (server) | `P`, `seed_chars: int`, `concept_count: int` | UI-041 `/packages/new` | AN-001 |
| `generation_step_completed` | `authoring.runGenerationStep` job handler, on `succeeded` and on `failed` (server, from the drain route or the worker) | `P`, `generation_run_id: uuid`, `step: enum(reskin_brief_stakeholders\|documents\|answer_space_fields\|claims_and_states\|turn_and_probe\|question_bank_and_counterfactual\|readiness_items)`, `pass_number: int`, `status: enum(succeeded\|failed)`, `duration_ms: int`, `failed_rules: RuleCode[]`, `input_tokens: int`, `output_tokens: int`, `provider: enum(mock\|openai-compatible\|anthropic)` | UI-042 `/packages/[packageId]/versions/[versionId]/generation` | AN-001 |
| `element_decided` | `scenarios.decideElement` (server); `review_ms = decided_at − opened_at` from `element_confirmations` | `P`, `element_type: enum(brief\|document\|stakeholder\|answer_space_position\|named_field\|claim\|variant_claim_state\|probe\|turn\|defense_question\|readiness_item\|counterfactual\|general_escalation_reply\|clock_and_difficulty\|seed_reskin)`, `revision: int`, `decision: enum(confirmed\|edited\|rejected)`, `review_ms: int`, `edited_fields_count: int` | UI-043 `/packages/[packageId]/versions/[versionId]/confirm` | AN-001 |
| `package_confirmed` | `scenarios.confirmVersion`, values from `authoring.computeAuthoringMeasures` (server) | `P`, `seed_to_confirmed_ms: int` (`confirmed_at − seed_records.created_at`), `edit_rate: share` (elements whose final decision is `edited` over all elements), `rejected_share: share` (elements with at least one `rejected` revision over all elements), `generation_passes: int` (count of `generation_runs` rows), `generation_max_pass: int` (max `pass_number`), `elements_count: int`, `review_ms_total: int`, `review_ms_per_element: int`, `claims_count: int`, `documents_count: int` | UI-043, UI-044 `/packages/[packageId]/versions/[versionId]` | AN-001, FR-198 |

`RuleCode` is a string matching `^[A-Z0-9_]+$` (the validation codes of FR-194, for example `ANSWER_SPACE_SINGLE`).

### 3.3 AN-003 Engagement inside a run (student seat)

| Event | Trigger | Properties | Screen | Serves |
|---|---|---|---|---|
| `readiness_submitted` | `runs.submitReadiness` (`skipped: false`) and `runs.skipReadiness` (`skipped: true`) (server) | `R`, `skipped: boolean`, `expired: boolean`, `answered_count: int`, `held_count: int`, `not_held_count: int`, `unknown_count: int`, `duration_ms: int` | UI-022 `/runs/[runId]/readiness` | AN-003, FR-010 |
| `document_opened` | `runs.closeDocument` (server; fires at close so `duration_ms` is the server-capped value of FR-022; a tab hidden or navigated away sends the close) | `R`, `document_id: uuid`, `document_role: enum(supporting\|superseded\|interpretation_as_fact\|irrelevant)`, `open_index: int`, `before_first_delegation: boolean`, `in_turn_window: boolean`, `skim: boolean`, `duration_ms: int` | UI-023 `/runs/[runId]/work` | AN-003, FR-022, FR-024 |
| `frame_locked` | `runs.lockFrame` (server) | `R`, `confidence: int`, `ms_since_room_opened: int`, `documents_opened_count: int`, `words_total: int` | UI-023 | AN-003, FR-041 |
| `delegation_made` | `assistant.delegate` after the stream ends or fails (server) | `R`, `delegation_id: uuid`, `seq: int`, `claims_surfaced: int`, `in_turn_window: boolean`, `unverified_numbers_count: int`, `failed: boolean`, `has_why: boolean`, `latency_ms: int`, `before_any_document_open: boolean` | UI-023, UI-025 `/runs/[runId]/turn` | AN-003, FR-052, FR-060 |
| `claim_marked_used` | `assistant.updateDelegation` (`via: log_mark`), `runs.saveBriefDraft` named-field match (`via: named_field`), Turn-window surfacing (`via: turn_window`) (server) | `R`, `C`, `via: enum(log_mark\|named_field\|turn_window)` | UI-023, UI-025 | AN-003, FR-084, FR-101 |
| `stance_set` | `reliance.setStance` (server) | `R`, `C`, `stance: enum(accept\|verify\|challenge\|reject\|escalate)`, `previous_stance: stance \| null`, `had_prior_action: boolean`, `is_change: boolean`, `ms_since_surfaced: int` | UI-023, UI-025 | AN-003, FR-080, FR-085 |
| `action_run` | `reliance.runAction` (server) | `R`, `C`, `action_id: uuid`, `type: enum(source_trace\|replication_check\|decomposition_check)`, `clock_cost_ms: int`, `clock_remaining_ms: int` | UI-023, UI-025 | AN-003, FR-070 to FR-072 |
| `escalation_made` | `reliance.escalate` (server) | `R`, `C`, `escalation_id: uuid`, `response_kind: enum(claim\|general)`, `counts_against_limit: boolean`, `clock_cost_ms: int` | UI-023, UI-025 | AN-003, FR-090 to FR-092 |
| `probe_fired` | `assistant.delegate` when the scripted reversal is returned (server) | `R`, `claim_id: uuid` | UI-023 | AN-003, FR-053 |
| `outside_tool_declared` | `assistant.declareOutsideTool` (server); the purpose text is never sent | `R`, `course_policy: enum(open\|declared\|in_environment_only)` | UI-023, UI-024, UI-025 | AN-003, FR-061, FR-062 |
| `lock_refused` | `runs.lockDecision` refusal branch (server) | `R`, `claim_id: uuid`, `unstanced_relied_on_count: int`, `clock_remaining_ms: int` | UI-024 lock dialog | AN-003, FR-084 |
| `decision_locked` | `runs.lockDecision` (`auto_locked: false`) and `runs.materializeTimers` expiry branch (`auto_locked: true`) (server) | `R`, `auto_locked: boolean`, `speed_outlier: boolean`, `elapsed_ms: int` (frame lock to decision lock), `confidence: int \| null`, `relied_on_count: int`, `unstanced_count: int`, `empty_fields_count: int`, `clock_remaining_ms: int` | UI-024, UI-023 | AN-003, FR-102, FR-105, FR-106 |
| `addendum_added` | `runs.addAddendum` (server) | `R`, `ms_since_lock: int` | UI-024 `/runs/[runId]/locked` | AN-003, FR-107 |
| `run_paused` | the `runs` pause writer called by the failure branches of `assistant.delegate`, `runs.openDocument`, `reliance.runAction`, `reliance.escalate` (server) | `R`, `pause_id: uuid`, `cause: enum(assistant_failure\|document_failure\|action_failure\|connection)`, `forced_by_test_control: boolean` | UI-023 paused overlay | AN-003, FR-001, FR-118 |
| `run_resumed` | the `runs` resume writer (server) | `R`, `pause_id: uuid`, `paused_ms: int`, `credited_ms: int` | UI-023 | AN-003, FR-001 |
| `turn_delivered` | `runs.materializeTimers` when it writes `turn_delivered` (server); `lag_ms = read time − turn_due_at` | `R`, `lag_ms: int`, `delivered_offline: boolean` (`lag_ms > 720000`) | UI-025 | AN-003, FR-110, FR-115, NFR-002 |
| `turn_response_locked` | `runs.respondToTurn` (`implicit: false`) and `runs.materializeTimers` window expiry (`implicit: true`) (server) | `R`, `response: enum(hold\|revise\|reverse)`, `implicit: boolean`, `confidence: int \| null`, `ms_since_delivered: int`, `window_claims_count: int` | UI-025 | AN-003, FR-112, FR-113 |
| `defense_completed` | `defense.completeDefense` (server) | `R`, `questions_count: int`, `follow_ups_count: int`, `answered_count: int`, `duration_ms: int` (defense opened to completed), `nothing_answered: boolean` | UI-026 `/runs/[runId]/defense` | AN-002, AN-003, FR-120 to FR-125 |
| `debrief_opened` | `debrief.getDebrief` on every render; `first_open: true` when it writes the `debrief_opened` trace event (server) | `R`, `bands_status: enum(draft\|confirmed)`, `first_open: boolean`, `ms_since_scored: int` | UI-028 `/runs/[runId]/debrief` | AN-003, FR-150, FR-152 |
| `debrief_answered` | `debrief.answerDebrief` (server) | `R`, `ms_since_first_open: int` | UI-028 | AN-003, FR-152 |
| `record_opened` | `records.getRecord` (server) | `R`, `viewer: enum(owner\|reviewer)` | UI-029 `/records/[runId]` | AN-003, FR-170 |

### 3.4 AN-004 Faculty review (faculty seat)

| Event | Trigger | Properties | Screen | Serves |
|---|---|---|---|---|
| `replay_opened` | `review.getReplay` (server). On the first open per run it stores `replay_first_opened_at` (ISO timestamp) in `runs.flags` so `run_confirmed.review_duration_ms` can be computed server-side (decision recorded in this file's return payload; `06-data-model.md` gains the key) | `R`, `first_open: boolean`, `scoring_status: enum(idle\|queued\|running\|held\|done)` | UI-033 `/review/runs/[runId]` | AN-004 |
| `band_decided` | `review.decideBand` and each dimension decided by `review.confirmRemaining` (server) | `R`, `dimension: enum(framing\|delegation\|verification\|calibration\|decision_quality\|adaptation\|ownership)`, `decision: enum(confirmed\|overridden\|unassessed)`, `draft_status: enum(drafted\|unassessed)`, `changed_from_draft: boolean`, `has_note: boolean`, `ms_since_replay_opened: int` | UI-033 | AN-004, FR-181 |
| `run_confirmed` | the call of `review.decideBand` or `review.confirmRemaining` that decides the seventh dimension (server) | `R`, `review_duration_ms: int` (`confirmed_at − flags.replay_first_opened_at`), `override_count: int`, `unassessed_count: int`, `points_present: boolean`, `ms_since_scored: int` | UI-033 | AN-004, FR-181 |
| `export_written` | `records.writeCourseExport` (server) | `R`, `export_id: uuid`, `version: int`, `reason: enum(initial\|override\|neutralization\|mapping_change\|unassessed)` | UI-035 `/assignments/[assignmentId]/exports`, UI-033 | AN-004, FR-184, FR-204 |
| `claim_neutralized` | `review.neutralizeClaim` (server) | `R`, `claim_id: uuid`, `reason: enum(unintended_defect\|wrong_verification_result\|misbehaving_material\|adaptation_failed\|record_lost\|other)`, `credit_challenge: boolean`, `dimensions_recomputed: int`, `bands_raised_count: int`, `review_requested: boolean` | UI-033 | AN-004, FR-003, FR-005 |
| `run_voided` | `runs.voidRun` (server) | `R`, `state_at_void: enum(assigned\|readiness\|framing\|working\|paused\|decision_locked\|turn_open\|turn_locked\|defense_pending\|defense_complete\|scored\|confirmed\|recorded)`, `reason: enum(unscoreable\|scoring_held\|walkthrough\|other)` | UI-033 | AN-004, FR-002 |
| `run_reoffered` | `runs.reofferRun` (server); `R` is the new run's context | `R`, `from_run_id: uuid`, `same_variant: boolean` | UI-033 | AN-004, FR-002 |

The void dialog on UI-033 offers the four `reason` values as radio buttons; the selected value is stored in `runs.void_reason` (text) and is the only thing sent.

### 3.5 AN-005 Per-run product measures at scoring

| Event | Trigger | Properties | Screen | Serves |
|---|---|---|---|---|
| `run_scored` | `scoring.scoreRun` job handler after the seven `draft_band` events are written (server, from the drain route or the worker) | `R`, `false_challenge_rate: share \| null`, `matched_stance_share: share \| null`, `accept_share: share \| null` (claims stanced Accept over consequential claims), `unassessed_count: int`, `provisional_count: int`, `scoring_latency_ms: int` (defense completed to scored), `rubric_version: string ^v[0-9]+$`, `provider: enum(mock\|openai-compatible\|anthropic)`, `consequential_claims_count: int`, `surfaced_claims_count: int`, `delegations_count: int`, `actions_count: int`, `escalations_count: int`, `documents_opened_count: int`, `duration_ms: int` (frame lock to defense completed), `confidence_at_frame: int \| null`, `confidence_at_lock: int \| null`, `confidence_after_turn: int \| null`, `accuracy_at_lock: share \| null`, `band_framing`, `band_delegation`, `band_verification`, `band_calibration`, `band_decision_quality`, `band_adaptation`, `band_ownership: enum(novice\|developing\|proficient\|professional\|unassessed)`, `all_novice: boolean`, `all_professional: boolean`, `held: boolean` | UI-027 `/runs/[runId]` (status), UI-033 | AN-005, FR-130, FR-134, FR-140, NFR-001 |

When scoring is held (FR-140) the event still fires with `held: true`, every band `unassessed`, and null shares.

### 3.6 Operations (INT-005, NFR-016; no AN id)

| Event | Trigger | Properties | Screen | Serves |
|---|---|---|---|---|
| `llm_call` | `src/server/llm/calls.ts` right after the `llm_calls` row is inserted (server) | `feature: enum(assistant\|band_read\|generation\|trigger_classify\|eval)`, `prompt: string ^[a-z0-9-]+$`, `version: int`, `provider: enum(mock\|openai-compatible\|anthropic)`, `model: string ^[A-Za-z0-9._:-]+$`, `outcome: enum(ok\|validation_failed\|repaired\|timeout\|error\|budget_exceeded\|circuit_open)`, `latency_ms: int`, `input_tokens: int`, `output_tokens: int`, `cost_usd: number`, `fallback_used: boolean`, `run_id: uuid \| null`, `package_version_id: uuid \| null` | none | NFR-016, D-065 |
| `rate_limited` | `src/server/rate-limit` `enforce()` refusal branch (server) | `bucket: enum(user_writes\|user_reads\|auth\|llm\|run_events)`, `scope: enum(user\|ip)` | none | SYS-012, D-026 |
| `error_shown` | client: the shared `ErrorView` rendered by every `error.tsx` boundary (`code: 'INTERNAL_ERROR'`) and the single helper that raises the toast for an `ActionResult` failure (`code` from the envelope) | `code: string ^[A-Z0-9_]+$`, `status: int \| null`, `route: string ^/[A-Za-z0-9\[\]/-]*$` (the route template such as `/runs/[runId]/work`, never the concrete path) | UI-007 and every screen | SYS-008, SYS-022 |

Page views are captured automatically by `posthog-js` (`$pageview` on load and on App Router navigation, `$pageleave` on exit) with the query string and hash stripped (§5.6). No other automatic event exists: autocapture, session replay, surveys, web experiments, heatmaps, and exception capture are off.

## 4. Screen index

| Screen | Route | Events (server unless marked client) |
|---|---|---|
| UI-001 Sign-in | `/sign-in` | `sign_in_succeeded` |
| UI-002 Sign-up | `/sign-up` | `sign_up_completed` |
| UI-003 Verify email | `/verify-email` | `email_verified`, `sign_in_succeeded` (method `verification`) |
| UI-005 Accept invitation | `/invitations/[id]` | `invitation_accepted` |
| UI-007 Error pages | `error.tsx`, `global-error.tsx` | `error_shown` (client) |
| UI-008 App shell | `(app)/layout.tsx` | `identify` + `group` on session load (client, not an event); `resetClient()` on sign-out |
| UI-021 Policy display | `/runs/[runId]/start` | `policy_displayed`, `run_started` |
| UI-022 Readiness | `/runs/[runId]/readiness` | `readiness_submitted` |
| UI-023 Run workspace | `/runs/[runId]/work` | `document_opened`, `frame_locked`, `delegation_made`, `claim_marked_used`, `stance_set`, `action_run`, `escalation_made`, `probe_fired`, `outside_tool_declared`, `decision_locked`, `run_paused`, `run_resumed` |
| UI-024 Lock dialogs, addendum | inside UI-023, `/runs/[runId]/locked` | `lock_refused`, `decision_locked`, `addendum_added`, `outside_tool_declared` |
| UI-025 Turn window | `/runs/[runId]/turn` | `turn_delivered`, `delegation_made`, `claim_marked_used`, `stance_set`, `action_run`, `escalation_made`, `turn_response_locked` |
| UI-026 Defense | `/runs/[runId]/defense` | `defense_completed` |
| UI-027 Run status | `/runs/[runId]` | `run_scored` (job; the screen polls the result) |
| UI-028 Debrief | `/runs/[runId]/debrief` | `debrief_opened`, `debrief_answered` |
| UI-029 Judgment Record | `/records/[runId]` | `record_opened` |
| UI-030 Courses | `/courses`, `/courses/[courseId]` | `course_created` |
| UI-032 Assignment configuration | `/assignments/[assignmentId]` | `assignment_configured` |
| UI-033 Faculty replay | `/review/runs/[runId]` | `replay_opened`, `band_decided`, `run_confirmed`, `claim_neutralized`, `run_voided`, `run_reoffered`, `export_written`, `run_paused` (`forced_by_test_control: true`) |
| UI-035 Course export | `/assignments/[assignmentId]/exports` | `export_written` |
| UI-041 New package from seed | `/packages/new` | `package_created_from_seed` |
| UI-042 Generation progress | `/packages/[packageId]/versions/[versionId]/generation` | `generation_step_completed` (job) |
| UI-043 Element confirmation | `/packages/[packageId]/versions/[versionId]/confirm` | `element_decided`, `package_confirmed` |
| UI-044 Package version view | `/packages/[packageId]/versions/[versionId]` | `package_confirmed` (when confirmed from this screen) |
| every screen | | `$pageview`, `$pageleave` (client), `error_shown` (client), `rate_limited`, `llm_call` (server, no screen) |

Screens with no events: UI-004, UI-006, UI-009, UI-010, UI-011, UI-020, UI-031, UI-034 (illustrative data only, FR-254), UI-050, UI-060. They get page views only.

## 5. Code

### 5.1 `src/lib/analytics/events.ts`

```ts
import { z } from 'zod'

// Primitive vocabulary. Only these leaf kinds are allowed (tests/unit/analytics/events.test.ts enforces it).
const Uuid = z.uuid()
const Int = z.int().nonnegative()
const Share = z.number().min(0).max(1)
const RuleCode = z.string().regex(/^[A-Z0-9_]+$/)

export const Variant = z.enum(['defective', 'sound'])
export const Mode = z.enum(['guided', 'standard', 'open'])
export const Stance = z.enum(['accept', 'verify', 'challenge', 'reject', 'escalate'])
export const Band = z.enum(['novice', 'developing', 'proficient', 'professional', 'unassessed'])
export const Dimension = z.enum(['framing', 'delegation', 'verification', 'calibration', 'decision_quality', 'adaptation', 'ownership'])
export const Provider = z.enum(['mock', 'openai-compatible', 'anthropic'])
export const OutsideAiPolicy = z.enum(['open', 'declared', 'in_environment_only'])
export const ElementType = z.enum(['brief', 'document', 'stakeholder', 'answer_space_position', 'named_field', 'claim', 'variant_claim_state', 'probe', 'turn', 'defense_question', 'readiness_item', 'counterfactual', 'general_escalation_reply', 'clock_and_difficulty', 'seed_reskin'])
export const GenerationStep = z.enum(['reskin_brief_stakeholders', 'documents', 'answer_space_fields', 'claims_and_states', 'turn_and_probe', 'question_bank_and_counterfactual', 'readiness_items'])
export const RunState = z.enum(['assigned', 'readiness', 'framing', 'working', 'paused', 'decision_locked', 'turn_open', 'turn_locked', 'defense_pending', 'defense_complete', 'scored', 'confirmed', 'recorded'])

const runContext = {
  run_id: Uuid,
  assignment_id: Uuid,
  package_version_id: Uuid,
  variant: Variant,
  mode: Mode,
  attempt_no: z.int().positive(),
  is_walkthrough: z.boolean(),
}
const packageContext = { package_id: Uuid, package_version_id: Uuid, version: z.int().positive() }
const claimContext = {
  claim_id: Uuid,
  importance: z.enum(['load_bearing', 'supporting']),
  consequence_level: z.enum(['low', 'medium', 'high']),
  in_turn_window: z.boolean(),
}
const run = <T extends z.ZodRawShape>(shape: T) => z.strictObject({ ...runContext, ...shape })
const pkg = <T extends z.ZodRawShape>(shape: T) => z.strictObject({ ...packageContext, ...shape })
const claim = <T extends z.ZodRawShape>(shape: T) => run({ ...claimContext, ...shape })

export const EVENTS = {
  // AN-002 activation
  sign_up_completed: z.strictObject({ method: z.enum(['password', 'google']) }),
  email_verified: z.strictObject({ ms_since_sign_up: Int }),
  sign_in_succeeded: z.strictObject({ method: z.enum(['password', 'google', 'verification']) }),
  invitation_accepted: z.strictObject({
    invitation_id: Uuid,
    role: z.enum(['student', 'instructor', 'teaching_assistant', 'scenario_author', 'program_lead']),
    ms_since_invited: Int,
  }),
  course_created: z.strictObject({ course_id: Uuid, outside_ai_policy: OutsideAiPolicy, mapping_is_default: z.boolean(), ms_since_first_sign_in: Int }),
  assignment_configured: z.strictObject({
    assignment_id: Uuid, course_id: Uuid, section_id: Uuid, package_version_id: Uuid, variant: Variant,
    is_new: z.boolean(), is_walkthrough: z.boolean(), working_clock_seconds: z.int().positive(),
    weight_overridden: z.boolean(), ms_since_first_sign_in: Int,
  }),
  policy_displayed: run({ outside_ai_policy: OutsideAiPolicy, weight_percent: z.number().nonnegative(), mapping_is_default: z.boolean() }),
  run_started: run({ is_reoffer: z.boolean(), run_index_for_student: z.int().positive() }),

  // AN-001 authoring measures
  package_created_from_seed: pkg({ seed_chars: Int, concept_count: Int }),
  generation_step_completed: pkg({
    generation_run_id: Uuid, step: GenerationStep, pass_number: z.int().positive(), status: z.enum(['succeeded', 'failed']),
    duration_ms: Int, failed_rules: z.array(RuleCode), input_tokens: Int, output_tokens: Int, provider: Provider,
  }),
  element_decided: pkg({
    element_type: ElementType, revision: z.int().positive(), decision: z.enum(['confirmed', 'edited', 'rejected']),
    review_ms: Int, edited_fields_count: Int,
  }),
  package_confirmed: pkg({
    seed_to_confirmed_ms: Int, edit_rate: Share, rejected_share: Share, generation_passes: Int, generation_max_pass: Int,
    elements_count: Int, review_ms_total: Int, review_ms_per_element: Int, claims_count: Int, documents_count: Int,
  }),

  // AN-003 engagement
  readiness_submitted: run({
    skipped: z.boolean(), expired: z.boolean(), answered_count: Int, held_count: Int, not_held_count: Int, unknown_count: Int, duration_ms: Int,
  }),
  document_opened: run({
    document_id: Uuid, document_role: z.enum(['supporting', 'superseded', 'interpretation_as_fact', 'irrelevant']), open_index: z.int().positive(),
    before_first_delegation: z.boolean(), in_turn_window: z.boolean(), skim: z.boolean(), duration_ms: Int,
  }),
  frame_locked: run({ confidence: z.int().min(0).max(100), ms_since_room_opened: Int, documents_opened_count: Int, words_total: Int }),
  delegation_made: run({
    delegation_id: Uuid, seq: z.int().positive(), claims_surfaced: Int, in_turn_window: z.boolean(), unverified_numbers_count: Int,
    failed: z.boolean(), has_why: z.boolean(), latency_ms: Int, before_any_document_open: z.boolean(),
  }),
  claim_marked_used: claim({ via: z.enum(['log_mark', 'named_field', 'turn_window']) }),
  stance_set: claim({ stance: Stance, previous_stance: Stance.nullable(), had_prior_action: z.boolean(), is_change: z.boolean(), ms_since_surfaced: Int }),
  action_run: claim({ action_id: Uuid, type: z.enum(['source_trace', 'replication_check', 'decomposition_check']), clock_cost_ms: Int, clock_remaining_ms: z.int() }),
  escalation_made: claim({ escalation_id: Uuid, response_kind: z.enum(['claim', 'general']), counts_against_limit: z.boolean(), clock_cost_ms: Int }),
  probe_fired: run({ claim_id: Uuid }),
  outside_tool_declared: run({ course_policy: OutsideAiPolicy }),
  lock_refused: run({ claim_id: Uuid, unstanced_relied_on_count: z.int().positive(), clock_remaining_ms: z.int() }),
  decision_locked: run({
    auto_locked: z.boolean(), speed_outlier: z.boolean(), elapsed_ms: Int, confidence: z.int().min(0).max(100).nullable(),
    relied_on_count: Int, unstanced_count: Int, empty_fields_count: Int, clock_remaining_ms: z.int(),
  }),
  addendum_added: run({ ms_since_lock: Int }),
  run_paused: run({ pause_id: Uuid, cause: z.enum(['assistant_failure', 'document_failure', 'action_failure', 'connection']), forced_by_test_control: z.boolean() }),
  run_resumed: run({ pause_id: Uuid, paused_ms: Int, credited_ms: Int }),
  turn_delivered: run({ lag_ms: Int, delivered_offline: z.boolean() }),
  turn_response_locked: run({
    response: z.enum(['hold', 'revise', 'reverse']), implicit: z.boolean(), confidence: z.int().min(0).max(100).nullable(),
    ms_since_delivered: Int, window_claims_count: Int,
  }),
  defense_completed: run({ questions_count: z.int().min(6).max(9), follow_ups_count: Int, answered_count: Int, duration_ms: Int, nothing_answered: z.boolean() }),
  debrief_opened: run({ bands_status: z.enum(['draft', 'confirmed']), first_open: z.boolean(), ms_since_scored: Int }),
  debrief_answered: run({ ms_since_first_open: Int }),
  record_opened: run({ viewer: z.enum(['owner', 'reviewer']) }),

  // AN-004 faculty review
  replay_opened: run({ first_open: z.boolean(), scoring_status: z.enum(['idle', 'queued', 'running', 'held', 'done']) }),
  band_decided: run({
    dimension: Dimension, decision: z.enum(['confirmed', 'overridden', 'unassessed']), draft_status: z.enum(['drafted', 'unassessed']),
    changed_from_draft: z.boolean(), has_note: z.boolean(), ms_since_replay_opened: Int,
  }),
  run_confirmed: run({ review_duration_ms: Int, override_count: z.int().min(0).max(7), unassessed_count: z.int().min(0).max(7), points_present: z.boolean(), ms_since_scored: Int }),
  export_written: run({ export_id: Uuid, version: z.int().positive(), reason: z.enum(['initial', 'override', 'neutralization', 'mapping_change', 'unassessed']) }),
  claim_neutralized: run({
    claim_id: Uuid, reason: z.enum(['unintended_defect', 'wrong_verification_result', 'misbehaving_material', 'adaptation_failed', 'record_lost', 'other']),
    credit_challenge: z.boolean(), dimensions_recomputed: Int, bands_raised_count: Int, review_requested: z.boolean(),
  }),
  run_voided: run({ state_at_void: RunState, reason: z.enum(['unscoreable', 'scoring_held', 'walkthrough', 'other']) }),
  run_reoffered: run({ from_run_id: Uuid, same_variant: z.boolean() }),

  // AN-005 per-run measures
  run_scored: run({
    false_challenge_rate: Share.nullable(), matched_stance_share: Share.nullable(), accept_share: Share.nullable(),
    unassessed_count: z.int().min(0).max(7), provisional_count: z.int().min(0).max(7), scoring_latency_ms: Int,
    rubric_version: z.string().regex(/^v[0-9]+$/), provider: Provider,
    consequential_claims_count: Int, surfaced_claims_count: Int, delegations_count: Int, actions_count: Int, escalations_count: Int,
    documents_opened_count: Int, duration_ms: Int,
    confidence_at_frame: z.int().min(0).max(100).nullable(), confidence_at_lock: z.int().min(0).max(100).nullable(),
    confidence_after_turn: z.int().min(0).max(100).nullable(), accuracy_at_lock: Share.nullable(),
    band_framing: Band, band_delegation: Band, band_verification: Band, band_calibration: Band,
    band_decision_quality: Band, band_adaptation: Band, band_ownership: Band,
    all_novice: z.boolean(), all_professional: z.boolean(), held: z.boolean(),
  }),

  // operations
  llm_call: z.strictObject({
    feature: z.enum(['assistant', 'band_read', 'generation', 'trigger_classify', 'eval']), prompt: z.string().regex(/^[a-z0-9-]+$/), version: z.int().positive(),
    provider: Provider, model: z.string().regex(/^[A-Za-z0-9._:-]+$/),
    outcome: z.enum(['ok', 'validation_failed', 'repaired', 'timeout', 'error', 'budget_exceeded', 'circuit_open']),
    latency_ms: Int, input_tokens: Int, output_tokens: Int, cost_usd: z.number().nonnegative(), fallback_used: z.boolean(),
    run_id: Uuid.nullable(), package_version_id: Uuid.nullable(),
  }),
  rate_limited: z.strictObject({ bucket: z.enum(['user_writes', 'user_reads', 'auth', 'llm', 'run_events']), scope: z.enum(['user', 'ip']) }),
  error_shown: z.strictObject({ code: z.string().regex(/^[A-Z0-9_]+$/), status: z.int().min(100).max(599).nullable(), route: z.string().regex(/^\/[A-Za-z0-9[\]\/-]*$/) }),
} as const satisfies Record<string, z.ZodType>

export type EventName = keyof typeof EVENTS
export type EventProps<N extends EventName> = z.infer<(typeof EVENTS)[N]>
export type AnyEvent = { [N in EventName]: { name: N; props: EventProps<N> } }[EventName]
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[]

// Property names that can never appear in any schema (tests/unit/analytics/events.test.ts).
export const FORBIDDEN_PROPERTY_PATTERN =
  /(^|_)(name|email|text|body|ip|address|answer|statement|purpose|justification|why|note|title|url|password|token|phone)$/
```

Type-level union `AnyEvent` gives call sites exhaustive checking; `EVENT_NAMES` is used by tests and by the PostHog data-management import in §7.

### 5.2 `src/server/analytics/distinct-id.ts`

```ts
import { createHash } from 'node:crypto'

/** PostHog distinct id: sha256(user.id), first 16 hex characters. Never reversible to the id, stable per user. */
export function hashUserId(userId: string): string {
  return createHash('sha256').update(userId, 'utf8').digest('hex').slice(0, 16)
}
```

### 5.3 `src/server/analytics/posthog.ts`

```ts
import { PostHog } from 'posthog-node'
import { after } from 'next/server'
import { env } from '@/server/config'
import { getRequestContext } from '@/server/http/request-context'

const perRequest = new WeakMap<object, PostHog>()
let processClient: PostHog | null = null

function create(): PostHog {
  return new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
    host: env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 20,
    flushInterval: 10000,
    disableGeoip: true,
  })
}

/**
 * Returns null when NEXT_PUBLIC_POSTHOG_KEY is empty (D-098).
 * Inside a request: one client per request, shut down (flushed) by after() when the response is done.
 * Outside a request (pnpm jobs:worker, scripts): one process-wide client, shut down by shutdownPosthog().
 */
export function getPosthogServer(): PostHog | null {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return null
  const ctx = getRequestContext()
  if (ctx) {
    const existing = perRequest.get(ctx)
    if (existing) return existing
    const client = create()
    try {
      after(() => client.shutdown(2000))
      perRequest.set(ctx, client)
      return client
    } catch {
      // after() is unavailable in this scope (static render); fall through to the process client.
    }
  }
  processClient ??= create()
  return processClient
}

/** Called by scripts/jobs-worker.ts on SIGINT/SIGTERM and by tests. */
export async function shutdownPosthog(): Promise<void> {
  if (!processClient) return
  const client = processClient
  processClient = null
  await client.shutdown(2000)
}
```

`getRequestContext()` returns the per-request `AsyncLocalStorage` store described in `02-architecture.md` §7 (`requestId`, `actor`, `logger`, `startedAt`) or `undefined` outside a request; the store object is the `WeakMap` key, so no field is added to it. `scripts/jobs-worker.ts` registers `process.on('SIGTERM', () => shutdownPosthog())` and the same for `SIGINT`.

### 5.4 `src/server/analytics/track.ts`

```ts
import { EVENTS, type EventName, type EventProps } from '@/lib/analytics/events'
import { env } from '@/server/config'
import { logger } from '@/server/logging/logger'
import { getRequestContext } from '@/server/http/request-context'
import { getPosthogServer } from './posthog'
import { hashUserId } from './distinct-id'

export type TrackActor = { userId: string | null; organizationId?: string | null }

/**
 * Server-side analytics. Synchronous and never throws in preview/production.
 * Call it after the writing transaction has committed, never inside it.
 */
export function track<N extends EventName>(name: N, props: EventProps<N>, actor: TrackActor): void {
  const parsed = EVENTS[name].safeParse(props)
  if (!parsed.success) {
    if (env.APP_ENV === 'local' || env.APP_ENV === 'test') {
      throw new Error(`ANALYTICS_PROPS_INVALID ${name}: ${parsed.error.message}`)
    }
    logger.warn({ event: name, issues: parsed.error.issues.map((i) => i.path.join('.')) }, 'analytics props invalid; event dropped')
    return
  }
  const client = getPosthogServer()
  if (!client) return
  const ctx = getRequestContext()
  const organizationId = actor.organizationId ?? null
  const distinctId = actor.userId ? hashUserId(actor.userId) : 'system'
  try {
    client.capture({
      distinctId,
      event: name,
      properties: {
        ...parsed.data,
        app_env: env.APP_ENV,
        organization_id: organizationId,
        request_id: ctx?.requestId ?? null,
        source: 'server',
        ...(actor.userId ? {} : { $process_person_profile: false }),
      },
      ...(organizationId ? { groups: { organization: organizationId } } : {}),
    })
  } catch (error) {
    logger.warn({ event: name, err: error }, 'analytics capture failed')
  }
}
```

Call pattern inside a service (example from `reliance.service.setStance`):

```ts
const result = await db.transaction(async (tx) => { /* trace append + read model update */ })
track('stance_set', { ...runContext(result.run), ...claimContext(result.claim), stance, previous_stance, had_prior_action, is_change, ms_since_surfaced }, { userId: actor.id, organizationId: result.run.organizationId })
return result
```

`runContext(run)` and `claimContext(claim)` are two pure helpers in `src/server/modules/runs/analytics-context.ts` that project a `runs` row and a `run_claims` join into the `R` and `C` groups. Job handlers (`scoring.scoreRun`, `authoring.runGenerationStep`) pass `{ userId: null, organizationId }`.

### 5.5 `src/lib/analytics/client.ts`

```ts
'use client'
import posthog from 'posthog-js'
import { publicEnv } from '@/lib/env.public'
import { EVENTS, type EventName, type EventProps } from './events'

export const analyticsEnabled = publicEnv.NEXT_PUBLIC_POSTHOG_KEY !== ''

/** Browser-side event. Same schemas as the server; drops invalid payloads in production, throws in development. */
export function trackClient<N extends EventName>(name: N, props: EventProps<N>): void {
  if (!analyticsEnabled) return
  const parsed = EVENTS[name].safeParse(props)
  if (!parsed.success) {
    if (process.env.NODE_ENV !== 'production') throw new Error(`ANALYTICS_PROPS_INVALID ${name}: ${parsed.error.message}`)
    return
  }
  posthog.capture(name, { ...parsed.data, source: 'client' })
}

/** Super properties sent with every client event, including $pageview. Registered by the root layout (§5.5). */
export function registerEnvironment(appEnv: 'local' | 'test' | 'preview' | 'production'): void {
  if (analyticsEnabled) posthog.register({ app_env: appEnv })
}

/** distinctId is hashUserId(user.id) computed on the server (§5.2); the browser never sees the raw id in analytics. */
export function identifyClient(distinctId: string, organizationId: string | null): void {
  if (!analyticsEnabled) return
  if (posthog.get_distinct_id() !== distinctId) posthog.identify(distinctId)
  if (organizationId) {
    posthog.group('organization', organizationId)
    posthog.register({ organization_id: organizationId })
  } else {
    posthog.unregister('organization_id')
  }
}

/** Call before authClient.signOut() so the next visitor on this browser gets a fresh anonymous id. */
export function resetClient(): void {
  if (analyticsEnabled) posthog.reset()
}
```

Two client components wire this in. `src/components/layout/analytics-environment.tsx` is rendered by the root `src/app/layout.tsx` (a Server Component that reads `env.APP_ENV` from `@/server/config`) so `app_env` is on every client event, page views included:

```tsx
'use client'
import { useEffect } from 'react'
import { registerEnvironment } from '@/lib/analytics/client'

export function AnalyticsEnvironment({ appEnv }: { appEnv: 'local' | 'test' | 'preview' | 'production' }) {
  useEffect(() => {
    registerEnvironment(appEnv)
  }, [appEnv])
  return null
}
```

`src/components/layout/analytics-identity.tsx` is rendered once by `src/app/(app)/layout.tsx`, which computes `distinctId = hashUserId(session.user.id)` and passes `session.activeOrganizationId`:

```tsx
'use client'
import { useEffect } from 'react'
import { identifyClient } from '@/lib/analytics/client'

export function AnalyticsIdentity({ distinctId, organizationId }: { distinctId: string; organizationId: string | null }) {
  useEffect(() => {
    identifyClient(distinctId, organizationId)
  }, [distinctId, organizationId])
  return null
}
```

The account menu's sign-out handler calls `resetClient()` and then `authClient.signOut()`.

### 5.5a Auth hook wiring in `src/server/auth/auth.ts`

The three activation events that Better Auth owns are fired from its hooks; the config fragment below is merged into the `betterAuth({...})` call shown in `08-auth-authz.md` §1.

```ts
import { createAuthMiddleware } from 'better-auth/api'
import { track } from '@/server/analytics/track'

// inside betterAuth({ ... })
databaseHooks: {
  user: {
    create: {
      after: async (user, ctx) => {
        const method = ctx?.path?.startsWith('/callback/') ? 'google' : 'password'
        track('sign_up_completed', { method }, { userId: user.id })
      },
    },
  },
},
emailVerification: {
  // ...fields from 08-auth-authz.md §1
  afterEmailVerification: async (user) => {
    track('email_verified', { ms_since_sign_up: Math.max(0, Date.now() - user.createdAt.getTime()) }, { userId: user.id })
  },
},
hooks: {
  after: createAuthMiddleware(async (ctx) => {
    const session = ctx.context.newSession
    if (!session) return
    const method = ctx.path.startsWith('/callback/') ? 'google' : ctx.path === '/verify-email' ? 'verification' : ctx.path === '/sign-in/email' ? 'password' : null
    if (method) track('sign_in_succeeded', { method }, { userId: session.user.id })
  }),
},
```

### 5.6 `src/instrumentation-client.ts` (PostHog part; the Sentry part is in `13-observability-ops.md`)

```ts
import posthog from 'posthog-js'
import { publicEnv } from '@/lib/env.public'

function stripQueryAndHash(value: unknown): unknown {
  if (typeof value !== 'string' || !/^https?:\/\//.test(value)) return value
  const cut = value.search(/[?#]/)
  return cut === -1 ? value : value.slice(0, cut)
}

function sanitize(props: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(props)) {
    const value = props[key]
    props[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? sanitize(value as Record<string, unknown>)
        : stripQueryAndHash(value)
  }
  return props
}

if (publicEnv.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(publicEnv.NEXT_PUBLIC_POSTHOG_KEY, {
    api_host: '/ingest',
    ui_host: publicEnv.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: '2025-05-24',
    capture_pageview: 'history_change',
    capture_pageleave: true,
    capture_exceptions: false,
    autocapture: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    persistence: 'localStorage+cookie',
    person_profiles: 'identified_only',
    mask_all_text: true,
    mask_all_element_attributes: true,
    ip: false,
    sanitize_properties: (props) => sanitize(props),
  })
}
```

Why each option: `api_host: '/ingest'` sends every request to the same origin (reverse proxy, §5.7); `ui_host` is used only for links to the PostHog UI; `defaults: '2025-05-24'` selects the current option defaults; `capture_pageview: 'history_change'` records the first load and every App Router navigation (`true` records the first load only, which loses every in-app navigation; decision recorded in this file's return payload); `capture_exceptions: false` because Sentry owns exceptions (D-027); `autocapture: false`, `mask_all_text`, and `mask_all_element_attributes` mean no DOM text or input value ever leaves the page; `disable_session_recording`, `disable_surveys`, `disable_web_experiments`, and `disable_external_dependency_loading` stop every remote script and recorder; `advanced_disable_flags` stops the flags request because Tassl has no flag service (D-023); `person_profiles: 'identified_only'` creates no person for anonymous visitors; `ip: false` asks PostHog not to store the client IP; `sanitize_properties` strips query strings and hashes from every URL-shaped property so verification and reset tokens (`/verify-email?token=`, `/reset-password?token=`) never reach PostHog.

### 5.7 `next.config.ts` (reverse proxy)

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ]
  },
}

export default nextConfig
```

`13-observability-ops.md` wraps this export with `withSentryConfig`; the `rewrites` array and `skipTrailingSlashRedirect` are unchanged by the wrapper. `skipTrailingSlashRedirect: true` is required because PostHog endpoints end with a slash (`/ingest/e/`, `/ingest/batch/`). The destinations are the US cloud hosts, matching the `NEXT_PUBLIC_POSTHOG_HOST` default `https://us.i.posthog.com`; a project created in the EU cloud changes the two destination strings to `https://eu-assets.i.posthog.com` and `https://eu.i.posthog.com` and the env default to `https://eu.i.posthog.com`.

`src/proxy.ts` matcher: `['/((?!api/auth|api/health|api/ready|ingest|_next/static|_next/image|fonts|favicon.svg).*)']`.

## 6. Privacy constraints

| Constraint | Enforcement |
|---|---|
| No names, emails, free text, claim texts, document bodies, defense answers, justifications, statements, purposes, notes, IP addresses | `z.strictObject` schemas with only id, enum, count, duration, share, boolean, and regex-constrained string leaves; `FORBIDDEN_PROPERTY_PATTERN` test; `ip: false` on the client; `disableGeoip: true` on the server (server IP is Vercel's, not the user's) |
| Hashed identity | `hashUserId` (sha256, 16 hex) is the only distinct id; anonymous server events use `system` with `$process_person_profile: false`; no `$set` or `$set_once` calls anywhere (an ESLint `no-restricted-syntax` rule in `eslint.config.mjs` forbids `posthog.setPersonProperties`, `posthog.people`, and `identify(` with a second argument) |
| No session replay, no autocapture, no input values | `disable_session_recording: true`, `autocapture: false`, `mask_all_text: true`, `mask_all_element_attributes: true`, `disable_external_dependency_loading: true`; PostHog project setting "Session replay" is also off (§7) |
| No tokens in URLs | `sanitize_properties` strips query and hash from URL-shaped values, including nested `$set_once` initial-URL properties |
| Walkthrough exclusion | `is_walkthrough` on every `R` event from `runs.is_walkthrough` (FR-235); the pilot dashboard's global filter is `is_walkthrough = false` |
| Organization scoping | `organization_id` property and `organization` group; no organization name is sent (`groupIdentify` is never called) |
| Same policy as LLM calls | D-066 applies: opaque ids only; PostHog never receives student-authored text |
| Not student-facing | No screen reads PostHog; counts of actions and documents opened reach students only through the trace-built debrief, which reports them without targets (FR-153, PRD §10 Engagement) |
| Runs without keys | `NEXT_PUBLIC_POSTHOG_KEY` empty makes both helpers return before any network call (D-098); CI never sets the key |
| Account deletion | PostHog holds only `hashUserId(user.id)` and ids; once the purge job (D-093) removes the user row, nothing links the hash to a person, so no PostHog deletion call is made and no PostHog personal API key exists in the system. The data-export JSON (SYS-004) states that product analytics hold pseudonymous usage events under a one-way hash of the account id |
| Data residency | PostHog US cloud (`us.i.posthog.com`). A pilot data agreement (D-055, PRD §9) that requires another region changes the project region and the three host strings in §5.7 before the pilot starts; walkthrough data has no such constraint (PRD §12 Data) |

## 7. PostHog project setup

1. Create the project at https://us.posthog.com/organization/projects/new named `tassl`. Region US (matches the rewrites in §5.7).
2. Copy the project API key from https://us.posthog.com/settings/project#variables ("Project API key", starts with `phc_`) into `NEXT_PUBLIC_POSTHOG_KEY`: `vercel env add NEXT_PUBLIC_POSTHOG_KEY production` and `vercel env add NEXT_PUBLIC_POSTHOG_KEY preview`. Local `.env` keeps it empty.
3. Project settings (https://us.posthog.com/settings/project): Autocapture off; Session replay off; Heatmaps off; Surveys off; Web vitals off; "Discard client IP data" on; Group analytics: group type `organization` appears automatically after the first event with `groups`.
4. Data management: PostHog creates event and property definitions on first ingest; after the first walkthrough, paste each event's §3 description into its definition under https://us.posthog.com/data-management/events.
5. Create the dashboards in §8.3 under the names given there. Every pilot insight has the filter `is_walkthrough = false` and `app_env = production`.

## 8. Metrics to events and insight definitions

Insight vocabulary: **Trend** = Product analytics → Trends with the named series and math; **Funnel** = Funnels with the ordered steps, conversion window, and "time to convert" for durations; **Retention** = Retention insight. Breakdown and filters are property-based. "Build onward" means the number exists from the first walkthrough; "pilot" means it needs real cohorts (AN-006 rows are pilot-only and have no build events).

### 8.1 PRD §10 metrics

| Metric | Events and properties | Insight definition | Availability |
|---|---|---|---|
| Calibration Gain (primary) | `run_scored.matched_stance_share`, `run_scored.attempt_no`, person = student | Trend: series `run_scored`, math = average of `matched_stance_share`, breakdown by `run_index_for_student` joined from the person's `run_started` (use the funnel variant: Funnel `run_started` (run_index 1) → `run_scored` → `run_started` (run_index ≥ 2) → `run_scored`, compare `matched_stance_share` at the first and last step). Baseline 55 percent and target 73 percent are hypotheses, not thresholds in the insight | Pilot (needs two comparable runs per student) |
| False Challenge Rate | `run_scored.false_challenge_rate` | Trend: average and p90 of `false_challenge_rate`, breakdown by `variant`; reference line 0.15 drawn as an annotation | Build onward (per run) |
| Indiscriminate verification | `run_scored.actions_count`, `consequential_claims_count` | Trend: average of `actions_count`, breakdown by `variant`; second series average of `consequential_claims_count` for the ratio | Build onward |
| Blanket escalation | `run_scored.escalations_count` | Trend: share of runs with `escalations_count = 2` (series A: `run_scored` where `escalations_count = 2`, series B: all `run_scored`, formula A/B) | Build onward |
| Passive acceptance | `run_scored.accept_share` | Trend: average of `accept_share`; alert when the cohort average exceeds 0.8 | Build onward |
| Median run duration | `run_scored.duration_ms` | Trend: median of `duration_ms`, breakdown by `variant` and `mode` | Build onward |
| Activation: configured pilot within 14 days | `sign_in_succeeded`, `course_created`, `assignment_configured.ms_since_first_sign_in` | Funnel: `sign_in_succeeded` → `course_created` → `assignment_configured` (`is_new = true`, `is_walkthrough = false`), conversion window 14 days, person filter role instructor (breakdown by `organization_id`) | Pilot |
| Activation: setup under 25 minutes | `course_created`, `assignment_configured` | Funnel `course_created` → `assignment_configured` with time to convert; median under 25 minutes | Pilot |
| Activation: 85 percent first-run completion | `run_started` (`run_index_for_student = 1`) → `defense_completed` | Funnel, conversion window 7 days, filter `is_walkthrough = false` | Pilot (mechanics verified in the walkthrough) |
| Activation: 92 percent second-run continuation | `defense_completed` (attempt with `run_index_for_student = 1`) → `run_started` (`run_index_for_student = 2`) | Funnel, conversion window 60 days | Pilot |
| Engagement: completed runs | `defense_completed` | Trend: unique persons and total count per week, breakdown by `organization_id` | Build onward |
| Engagement: interrogation behavior | `action_run.type`, `escalation_made` | Trend: count of `action_run` breakdown by `type`; count of `escalation_made` breakdown by `counts_against_limit`; never shown to students | Build onward |
| Engagement: Evidence Room use before delegation | `document_opened.before_first_delegation`, `run_scored.documents_opened_count`, `delegation_made.before_any_document_open` | Trend: share of `document_opened` with `before_first_delegation = true`; share of first `delegation_made` per run with `before_any_document_open = true` | Build onward |
| Engagement: defense completion | `defense_completed.nothing_answered`, `answered_count`, `questions_count` | Trend: share of `defense_completed` with `nothing_answered = false`; average `answered_count / questions_count` via formula | Build onward |
| Engagement: debrief engagement | `debrief_opened`, `debrief_answered` | Funnel `run_scored` → `debrief_opened` (`first_open = true`) → `debrief_answered`, conversion window 14 days | Build onward |
| Retention: 70 percent re-adoption | `course_created` per instructor across terms | Retention insight: persons who did `course_created` in term N and again in term N+1 (term inferred from event dates) | Pilot (AN-006) |
| Retention: expansion to three courses | `course_created.organization_id` | Trend: unique `course_id` per `organization_id` | Pilot (AN-006) |
| Retention: 15 percent voluntary use | no build event; voluntary practice outside a course is future-state (FR-160, FR-199) | none | Pilot (AN-006) |
| Retention: 12 then 6 minutes from opening graphs to confirming bands | `replay_opened` (`first_open = true`) → `run_confirmed`; `run_confirmed.review_duration_ms` | Funnel with time to convert (median), and Trend median of `review_duration_ms` over time | Build onward (walkthrough gives the first data point) |
| Retention: 10 to 25 percent override range | `band_decided.decision` | Trend: series A `band_decided` where `decision = overridden`, series B all `band_decided`, formula A/B; breakdown by `dimension` | Build onward |
| Retention: total faculty hours per course | `element_decided.review_ms`, `run_confirmed.review_duration_ms` | Trend: sum of `review_ms` plus sum of `review_duration_ms`, breakdown by `organization_id` | Build onward (authoring and review parts only; appeals are future-state) |
| Outcomes: coherence between decision and defense | `run_scored.band_ownership`, `band_decision_quality` | Trend: distribution of `band_ownership` (breakdown), compared across `run_index_for_student` | Pilot |
| Outcomes: proportional adaptation | `run_scored.band_adaptation`, `turn_response_locked.response`, `implicit` | Trend: breakdown of `band_adaptation`; share of `turn_response_locked` with `implicit = true` | Pilot (per-run values from the build) |
| Outcomes: confidence calibration | `run_scored.confidence_at_lock`, `accuracy_at_lock` | Trend: average of `confidence_at_lock` and of `accuracy_at_lock` × 100 as two series; the gap is the calibration error | Pilot (per-run values from the build) |
| Outcomes: appropriate verification and escalation | `run_scored.band_verification`, `escalations_count`, `actions_count` | Trend: breakdown of `band_verification`; average `actions_count` per `consequential_claims_count` | Pilot |
| Outcomes: transfer to a novel scenario | needs a second scenario family | none in the build | Pilot (AN-006) |
| Appeals | future-state (D-058) | none | Pilot (AN-006) |

### 8.2 Build-onward authoring operating measures (FR-198, AN-001)

| Measure | Events and properties | Insight definition |
|---|---|---|
| Review hours per generated element | `element_decided.review_ms`, `package_confirmed.review_ms_per_element` | Trend: average of `review_ms` breakdown by `element_type` (divide by 3,600,000 for hours); Trend: `review_ms_per_element` per `package_confirmed` |
| Share of generated elements rejected or edited | `element_decided.decision`, `package_confirmed.edit_rate`, `rejected_share` | Trend: series A `element_decided` where `decision in (edited, rejected)`, series B all `element_decided`, formula A/B, breakdown by `element_type`; `edit_rate` and `rejected_share` per version on `package_confirmed` |
| Generation passes needed to satisfy the §7.18 rules | `generation_step_completed.pass_number`, `failed_rules`, `package_confirmed.generation_passes`, `generation_max_pass` | Trend: count of `generation_step_completed` breakdown by `step` and `status`; Trend: average `generation_max_pass` on `package_confirmed`; table of `failed_rules` values by frequency |
| Time from seed case to confirmed scenario | `package_created_from_seed` → `package_confirmed`, `package_confirmed.seed_to_confirmed_ms` | Funnel with time to convert; Trend median of `seed_to_confirmed_ms` |
| Edit rate at confirmation | `package_confirmed.edit_rate` | Trend: value per version; an edit rate near zero is the PRD §11 warning sign ("approving rather than reviewing") and is shown with that annotation |

These measures are also rendered from the database on the UI-044 "authoring measures" panel (`authoring.computeAuthoringMeasures`), so the walkthrough sees them without PostHog. PostHog holds the cross-version history.

### 8.3 Dashboards

| Dashboard | Insights |
|---|---|
| `Tassl · Operations` | `llm_call` count by `outcome` and `provider`; sum of `cost_usd` per day; p95 `latency_ms` by `feature`; `rate_limited` by `bucket`; `error_shown` by `code`; `run_paused` by `cause`; `run_scored` p95 `scoring_latency_ms` (NFR-001 alert at 480000 ms); `turn_delivered` p95 `lag_ms` (NFR-002) |
| `Tassl · Authoring measures` | §8.2 rows |
| `Tassl · Run loop` | §8.1 rows marked build onward |
| `Tassl · Pilot` | §8.1 rows marked pilot; global filter `is_walkthrough = false`, `app_env = production` |

## 9. Testing

### 9.1 `tests/factories/analytics.ts`

One example payload per event; the mapped type makes a missing example a compile error.

```ts
import type { EventName, EventProps } from '@/lib/analytics/events'

const R = {
  run_id: '11111111-1111-4111-8111-111111111111', assignment_id: '22222222-2222-4222-8222-222222222222',
  package_version_id: '33333333-3333-4333-8333-333333333333', variant: 'defective', mode: 'standard', attempt_no: 1, is_walkthrough: true,
} as const
const P = { package_id: '44444444-4444-4444-8444-444444444444', package_version_id: R.package_version_id, version: 1 } as const
const C = { claim_id: '55555555-5555-4555-8555-555555555555', importance: 'load_bearing', consequence_level: 'high', in_turn_window: false } as const
const U = '66666666-6666-4666-8666-666666666666'

export const eventExamples: { [N in EventName]: EventProps<N> } = {
  sign_up_completed: { method: 'password' },
  email_verified: { ms_since_sign_up: 120000 },
  sign_in_succeeded: { method: 'google' },
  invitation_accepted: { invitation_id: U, role: 'student', ms_since_invited: 3600000 },
  course_created: { course_id: U, outside_ai_policy: 'declared', mapping_is_default: true, ms_since_first_sign_in: 600000 },
  assignment_configured: { assignment_id: R.assignment_id, course_id: U, section_id: U, package_version_id: R.package_version_id, variant: 'sound', is_new: true, is_walkthrough: true, working_clock_seconds: 1500, weight_overridden: false, ms_since_first_sign_in: 900000 },
  policy_displayed: { ...R, outside_ai_policy: 'declared', weight_percent: 2.5, mapping_is_default: true },
  run_started: { ...R, is_reoffer: false, run_index_for_student: 1 },
  package_created_from_seed: { ...P, seed_chars: 48000, concept_count: 6 },
  generation_step_completed: { ...P, generation_run_id: U, step: 'claims_and_states', pass_number: 2, status: 'succeeded', duration_ms: 42000, failed_rules: ['DEFECT_NOT_CONSEQUENTIAL'], input_tokens: 12000, output_tokens: 3000, provider: 'mock' },
  element_decided: { ...P, element_type: 'claim', revision: 1, decision: 'edited', review_ms: 95000, edited_fields_count: 2 },
  package_confirmed: { ...P, seed_to_confirmed_ms: 7200000, edit_rate: 0.31, rejected_share: 0.08, generation_passes: 9, generation_max_pass: 2, elements_count: 52, review_ms_total: 5400000, review_ms_per_element: 103846, claims_count: 8, documents_count: 9 },
  readiness_submitted: { ...R, skipped: false, expired: false, answered_count: 16, held_count: 5, not_held_count: 1, unknown_count: 0, duration_ms: 420000 },
  document_opened: { ...R, document_id: U, document_role: 'superseded', open_index: 3, before_first_delegation: true, in_turn_window: false, skim: false, duration_ms: 48000 },
  frame_locked: { ...R, confidence: 60, ms_since_room_opened: 300000, documents_opened_count: 4, words_total: 110 },
  delegation_made: { ...R, delegation_id: U, seq: 1, claims_surfaced: 2, in_turn_window: false, unverified_numbers_count: 0, failed: false, has_why: true, latency_ms: 1800, before_any_document_open: false },
  claim_marked_used: { ...R, ...C, via: 'named_field' },
  stance_set: { ...R, ...C, stance: 'verify', previous_stance: 'accept', had_prior_action: true, is_change: true, ms_since_surfaced: 90000 },
  action_run: { ...R, ...C, action_id: U, type: 'source_trace', clock_cost_ms: 60000, clock_remaining_ms: 840000 },
  escalation_made: { ...R, ...C, escalation_id: U, response_kind: 'claim', counts_against_limit: true, clock_cost_ms: 300000 },
  probe_fired: { ...R, claim_id: C.claim_id },
  outside_tool_declared: { ...R, course_policy: 'declared' },
  lock_refused: { ...R, claim_id: C.claim_id, unstanced_relied_on_count: 1, clock_remaining_ms: 120000 },
  decision_locked: { ...R, auto_locked: false, speed_outlier: false, elapsed_ms: 1320000, confidence: 70, relied_on_count: 4, unstanced_count: 0, empty_fields_count: 0, clock_remaining_ms: 180000 },
  addendum_added: { ...R, ms_since_lock: 30000 },
  run_paused: { ...R, pause_id: U, cause: 'assistant_failure', forced_by_test_control: true },
  run_resumed: { ...R, pause_id: U, paused_ms: 12000, credited_ms: 0 },
  turn_delivered: { ...R, lag_ms: 2100, delivered_offline: false },
  turn_response_locked: { ...R, response: 'revise', implicit: false, confidence: 55, ms_since_delivered: 400000, window_claims_count: 1 },
  defense_completed: { ...R, questions_count: 7, follow_ups_count: 2, answered_count: 9, duration_ms: 780000, nothing_answered: false },
  debrief_opened: { ...R, bands_status: 'draft', first_open: true, ms_since_scored: 60000 },
  debrief_answered: { ...R, ms_since_first_open: 600000 },
  record_opened: { ...R, viewer: 'owner' },
  replay_opened: { ...R, first_open: true, scoring_status: 'done' },
  band_decided: { ...R, dimension: 'calibration', decision: 'overridden', draft_status: 'drafted', changed_from_draft: true, has_note: true, ms_since_replay_opened: 240000 },
  run_confirmed: { ...R, review_duration_ms: 660000, override_count: 1, unassessed_count: 0, points_present: true, ms_since_scored: 3600000 },
  export_written: { ...R, export_id: U, version: 1, reason: 'initial' },
  claim_neutralized: { ...R, claim_id: C.claim_id, reason: 'unintended_defect', credit_challenge: true, dimensions_recomputed: 2, bands_raised_count: 1, review_requested: true },
  run_voided: { ...R, state_at_void: 'decision_locked', reason: 'walkthrough' },
  run_reoffered: { ...R, attempt_no: 2, from_run_id: U, same_variant: false },
  run_scored: {
    ...R, false_challenge_rate: 0.7273, matched_stance_share: 0.5, accept_share: 0.25, unassessed_count: 0, provisional_count: 5, scoring_latency_ms: 4200,
    rubric_version: 'v1', provider: 'mock', consequential_claims_count: 8, surfaced_claims_count: 6, delegations_count: 3, actions_count: 2, escalations_count: 1,
    documents_opened_count: 5, duration_ms: 2400000, confidence_at_frame: 60, confidence_at_lock: 70, confidence_after_turn: 55, accuracy_at_lock: 0.75,
    band_framing: 'proficient', band_delegation: 'developing', band_verification: 'developing', band_calibration: 'novice', band_decision_quality: 'proficient',
    band_adaptation: 'proficient', band_ownership: 'developing', all_novice: false, all_professional: false, held: false,
  },
  llm_call: { feature: 'band_read', prompt: 'band-read-framing', version: 1, provider: 'mock', model: 'mock-v1', outcome: 'ok', latency_ms: 12, input_tokens: 900, output_tokens: 120, cost_usd: 0, fallback_used: false, run_id: R.run_id, package_version_id: null },
  rate_limited: { bucket: 'run_events', scope: 'user' },
  error_shown: { code: 'LOCK_REFUSED_UNSTANCED_CLAIM', status: 409, route: '/runs/[runId]/work' },
}
```

### 9.2 `tests/unit/analytics/events.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EVENTS, EVENT_NAMES, FORBIDDEN_PROPERTY_PATTERN } from '@/lib/analytics/events'
import { eventExamples } from '@tests/factories/analytics'

type Def = { type: string; innerType?: z.ZodType; element?: z.ZodType; format?: string; checks?: unknown[]; shape?: Record<string, z.ZodType> }
const def = (s: z.ZodType) => (s as unknown as { def: Def }).def

function unwrap(s: z.ZodType): z.ZodType {
  const d = def(s)
  return d.type === 'optional' || d.type === 'nullable' ? unwrap(d.innerType as z.ZodType) : s
}

function assertAllowedLeaf(path: string, s: z.ZodType) {
  const d = def(unwrap(s))
  if (d.type === 'array') return assertAllowedLeaf(`${path}[]`, d.element as z.ZodType)
  if (d.type === 'boolean' || d.type === 'number' || d.type === 'enum') return
  if (d.type === 'string') {
    const constrained = d.format === 'uuid' || (d.checks?.length ?? 0) > 0
    expect(constrained, `${path} is a free-form string`).toBe(true)
    return
  }
  throw new Error(`${path}: leaf kind ${d.type} is not allowed`)
}

describe('analytics events', () => {
  it('has an example for every event and every example validates', () => {
    for (const name of EVENT_NAMES) {
      const result = EVENTS[name].safeParse(eventExamples[name])
      expect(result.success, `${name}: ${result.success ? '' : result.error.message}`).toBe(true)
    }
  })

  it('rejects unknown properties (allowlist)', () => {
    for (const name of EVENT_NAMES) {
      const result = EVENTS[name].safeParse({ ...eventExamples[name], email: 'x@y.z' })
      expect(result.success, name).toBe(false)
    }
  })

  it('never declares a forbidden property name and only allowed leaf kinds', () => {
    for (const name of EVENT_NAMES) {
      const shape = def(EVENTS[name]).shape as Record<string, z.ZodType>
      for (const [key, schema] of Object.entries(shape)) {
        expect(FORBIDDEN_PROPERTY_PATTERN.test(key), `${name}.${key}`).toBe(false)
        assertAllowedLeaf(`${name}.${key}`, schema)
      }
    }
  })

  it('uses snake_case object_verb names', () => {
    for (const name of EVENT_NAMES) expect(name).toMatch(/^[a-z]+(_[a-z]+)+$/)
  })

  it('carries is_walkthrough on every run-scoped event', () => {
    for (const name of EVENT_NAMES) {
      const shape = def(EVENTS[name]).shape as Record<string, z.ZodType>
      if ('run_id' in shape) expect(shape.is_walkthrough, name).toBeDefined()
    }
  })
})
```

### 9.3 `tests/integration/analytics/track.test.ts`

Runs in the `integration` project (node environment). It needs no database; it fakes `posthog-node`, `next/server`, the request context, and the config module.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const captured: unknown[] = []
const shutdowns: number[] = []
const afterCallbacks: Array<() => unknown> = []

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(public key: string, public options: Record<string, unknown>) {}
    capture(payload: unknown) { captured.push(payload) }
    async shutdown(timeout: number) { shutdowns.push(timeout) }
  },
}))
vi.mock('next/server', () => ({ after: (cb: () => unknown) => { afterCallbacks.push(cb) } }))
vi.mock('@/server/logging/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn() } }))

const requestStore = { requestId: '77777777-7777-4777-8777-777777777777', actor: null, startedAt: 0 }
vi.mock('@/server/http/request-context', () => ({ getRequestContext: () => requestStore }))

async function loadTrack(key: string) {
  vi.resetModules()
  vi.doMock('@/server/config', () => ({
    env: { APP_ENV: 'test', NEXT_PUBLIC_POSTHOG_KEY: key, NEXT_PUBLIC_POSTHOG_HOST: 'https://us.i.posthog.com' },
  }))
  const mod = await import('@/server/analytics/track')
  const ph = await import('@/server/analytics/posthog')
  return { track: mod.track, shutdownPosthog: ph.shutdownPosthog }
}

const props = { method: 'password' } as const
const expectedDistinctId = createHash('sha256').update('user_1', 'utf8').digest('hex').slice(0, 16)

describe('track (server)', () => {
  beforeEach(() => { captured.length = 0; shutdowns.length = 0; afterCallbacks.length = 0 })
  afterEach(() => vi.doUnmock('@/server/config'))

  it('is a no-op without a key', async () => {
    const { track } = await loadTrack('')
    track('sign_up_completed', props, { userId: 'user_1', organizationId: 'org_1' })
    expect(captured).toHaveLength(0)
    expect(afterCallbacks).toHaveLength(0)
  })

  it('enqueues with a key, hashes the user id, sets the group, and schedules shutdown', async () => {
    const { track } = await loadTrack('phc_test')
    track('sign_up_completed', props, { userId: 'user_1', organizationId: 'org_1' })
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      distinctId: expectedDistinctId,
      event: 'sign_up_completed',
      properties: { method: 'password', app_env: 'test', organization_id: 'org_1', request_id: requestStore.requestId, source: 'server' },
      groups: { organization: 'org_1' },
    })
    expect(expectedDistinctId).toHaveLength(16)
    expect(afterCallbacks).toHaveLength(1)
    await afterCallbacks[0]!()
    expect(shutdowns).toEqual([2000])
  })

  it('uses the system distinct id without a person profile for actor-less events', async () => {
    const { track } = await loadTrack('phc_test')
    track('rate_limited', { bucket: 'auth', scope: 'ip' }, { userId: null })
    expect(captured[0]).toMatchObject({ distinctId: 'system', properties: { $process_person_profile: false } })
    expect(captured[0]).not.toHaveProperty('groups')
  })

  it('throws on an invalid payload in the test environment', async () => {
    const { track } = await loadTrack('phc_test')
    expect(() => track('sign_up_completed', { method: 'password', email: 'x@y.z' } as never, { userId: 'user_1' })).toThrow(/ANALYTICS_PROPS_INVALID/)
    expect(captured).toHaveLength(0)
  })
})
```

### 9.4 Other checks

- `tests/e2e/walkthrough/*.spec.ts` run without `NEXT_PUBLIC_POSTHOG_KEY`; a Playwright request interceptor asserts that no request to `/ingest/` is made during the walkthrough (proves the no-op path, D-098).
- `tests/unit/analytics/instrumentation-client.test.ts` imports the `sanitize` function (exported for tests) and asserts `https://app/verify-email?token=abc#x` becomes `https://app/verify-email`, including inside a nested `$set_once` object.
- The ESLint rule `no-restricted-imports` forbids importing `posthog-js` outside `src/instrumentation-client.ts` and `src/lib/analytics/client.ts`, and `posthog-node` outside `src/server/analytics/posthog.ts`, so every event passes through the typed helpers.

## 10. Adding an event

1. Add the schema to `EVENTS` in `src/lib/analytics/events.ts` using only the primitive vocabulary at the top of the file; add the example to `tests/factories/analytics.ts` (the type forces it).
2. Add a row to the right §3 table (name, trigger, properties, screen, AN id) and to the §4 screen index; if it serves a §8 metric, update that row.
3. Fire it with `track()` after the transaction commits, or with `trackClient()` from the component.
4. Run `pnpm test -- tests/unit/analytics` and `pnpm test:integration -- tests/integration/analytics`.
