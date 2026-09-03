# 10 — Backend Specification: Cross-Cutting

**Purpose / Read this when:** you write any server code. This file defines the patterns every module uses: error handling, logging fields, request context, rate limiting, sanitization, transactions, jobs, timers, the run state machine, and the clock. Per-module behavior is in `10-backend-spec-modules.md`.

**Requirements covered:** SYS-009, SYS-012, SYS-020, SYS-022, SYS-023, SYS-025, SYS-027, FR-001, FR-072, FR-105, FR-110, FR-113, FR-117, FR-231, NFR-003, NFR-005, NFR-016; decisions D-012, D-026, D-042, D-043, D-044, D-046, D-086.

## 1. Error handling

`src/lib/errors.ts`

```ts
export class AppError extends Error {
  constructor(public code: ErrorCode, message?: string, public opts: { status?: number; details?: unknown } = {}) {
    super(message ?? DEFAULT_MESSAGES[code]); this.name = 'AppError'
  }
  get status() { return this.opts.status ?? DEFAULT_STATUS[this.code] }
}
```

Global codes (module codes are listed in `10-backend-spec-modules.md` and added to the same registry):

| Code | Status | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Zod failure; `details` = flattened issues |
| `UNAUTHENTICATED` | 401 | no session or deleted user |
| `FORBIDDEN` | 403 | permission helper failed |
| `NOT_FOUND` | 404 | missing or cross-tenant resource |
| `CONFLICT` | 409 | generic state conflict when no specific code exists |
| `RATE_LIMITED` | 429 | sliding window exceeded; `Retry-After` header |
| `LLM_BUDGET_EXCEEDED` | 402 | budgets (`11-llm-integration.md`) |
| `LLM_PROVIDER_ERROR` | 502 | provider failure after retries |
| `LLM_CIRCUIT_OPEN` | 503 | breaker open and no fallback |
| `LLM_OUTPUT_INVALID` | 502 | structured output failed after repair |
| `INTERNAL_ERROR` | 500 | anything unexpected (reported to Sentry) |

Envelope (SYS-022): `{ "error": { "code": "...", "message": "...", "details": ..., "requestId": "..." } }`. 4xx are logged at `info` and not sent to Sentry; 5xx are logged at `error` and sent with the request id as a tag.

## 2. Route and action wrappers

`src/server/http/define-route.ts`

```ts
type RouteSpec<I, O> = {
  auth: 'session' | 'cron' | 'public'
  input?: { params?: ZodType; query?: ZodType; body?: ZodType }
  output: ZodType<O>
  rateLimit?: { bucket: 'read' | 'write' | 'auth' | 'llm' | 'run-events'; key?: (ctx) => string }
  openapi: { operationId: string; summary: string; tags: string[]; status?: number }
}
export function defineRoute<I, O>(spec: RouteSpec<I, O>, handler: (ctx: RouteContext<I>) => Promise<O>): (req: Request, routeCtx: { params: Promise<Record<string, string>> }) => Promise<Response>
```

Behavior, in order: create request context (request id from `x-request-id` if it is a UUID, else `crypto.randomUUID()`; child logger); `auth: 'session'` → `requireSession()`; `auth: 'cron'` → compare `Authorization: Bearer <CRON_SECRET>` with `timingSafeEqual`; non-GET with cookie auth requires header `X-Requested-With: tassl` (CSRF, `08-auth-authz.md` §2.7); parse params/query/body with Zod; rate limit; run handler inside `runWithContext`; validate output with `spec.output` in non-production (strips unknown keys everywhere); serialize JSON; set `x-request-id`, `Cache-Control: no-store`; catch and map errors. Every route registers itself in `src/server/http/openapi-registry.ts` for `pnpm openapi:generate`.

`src/server/http/define-action.ts`: `defineAction(schema, handler)` returns a `'use server'` function `(input) => Promise<ActionResult<O>>`; same context, session, validation, and error mapping; never throws to the client; calls `revalidatePath` as instructed by the handler's return `{ data, revalidate?: string[] }`.

Request context (`src/server/http/request-context.ts`): `AsyncLocalStorage<{ requestId, actor: SessionUser | null, logger, startedAt }>`; `getRequestContext()` returns the store or `undefined` outside a request (callers that require one use `requireRequestContext()`); jobs create their own context with `requestId = 'job:<jobId>'`.

## 3. Structured logging

pino JSON, one line per request and per significant event. Field set (NFR-016):

| Field | Always | Source |
|---|---|---|
| `level`, `time`, `msg` | yes | pino |
| `requestId` | yes | context |
| `userId` | when signed in | sha256(user id) first 12 hex |
| `orgId` | when known | active organization |
| `route`, `method`, `status`, `durationMs` | per request | wrapper |
| `event` | for domain events | e.g. `stance_set`, `run.transition` |
| `runId`, `packageVersionId`, `jobId`, `claimId` | when relevant | handler |
| `err` | on error | serialized without secrets |

Redaction paths: `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.token`, `*.apiKey`, `*.api-key`, `*.email`, `*.seedText`, `*.request_text`, `*.response_text`, `*.answer`, and every env var name that is a secret (`05-environment-config.md`). Levels: `debug` for request bodies' shapes (never contents) and SQL timing in local; `info` for requests and domain events; `warn` for rate limits, retries, circuit half-open; `error` for 5xx and job failures.

## 4. Rate limiting

`src/server/rate-limit/sliding-window.ts` implements a two-bucket sliding window on `rate_limit_buckets(key, window_start, count)`:

```
window = 60 s; current = floor(now/window); previous = current - 1
count = count(current) + count(previous) × (1 − (now − current×window)/window)
allow if count < limit; then INSERT ... ON CONFLICT DO UPDATE SET count = count + 1
```

Buckets and limits (D-026): `read` 600/min per user; `write` 60/min per user; `auth` 10/min per IP and per account (applied in our wrappers for `/api/v1/me/*` sensitive routes; Better Auth applies its own to `/api/auth/*`); `llm` 10/min per user; `run-events` 300/min per user (document open/close, stance set, brief autosave). Anonymous requests are keyed by IP (`x-forwarded-for` first hop). Exceeding returns `RATE_LIMITED` with `Retry-After` = seconds to the next window. Rows older than two windows are deleted by the same statement's cleanup (`DELETE ... WHERE window_start < now() - interval '3 minutes'` every 100th call).

## 5. Input sanitization

- All text is trimmed. Brief and frame fields pass `stripMarkup()` (removes HTML tags, markdown link syntax, and control characters except newlines) before word counting (FR-103).
- Word counting: `countWords(text) = text.trim().split(/\s+/).filter(Boolean).length` (D-075), identical on client and server.
- Numbers: `z.coerce.number().finite()`; named field values additionally bounded to `[-1e12, 1e12]`.
- Ids: `z.string().uuid()`; enum values via `z.enum`.
- Output: student view models are built by explicit `toStudentXView()` mappers; no spreading of DB rows into responses (student-facing invariants, `12-security.md`).

## 6. Transaction boundaries

- Each writing service function runs in one `db.transaction(async (tx) => …)`; repositories accept `tx` (type `DbOrTx`).
- Trace append and read-model writes are in the same transaction (ADR-017). The run row is locked with `SELECT … FOR UPDATE` at the start of any run mutation to serialize concurrent writes and to allocate `next_event_seq`.
- Jobs are enqueued after commit via `enqueueAfterCommit(tx, queue, payload, options)` which registers a `tx` completion hook; if the enqueue fails after commit the error is logged and the daily sweep re-enqueues from the state (e.g. runs in `defense_complete` with `scoring_status = 'idle'`).
- Long LLM calls never hold a transaction: services read, release, call the model, then open a new transaction to write results, re-checking state.

## 7. Background jobs

`src/server/jobs/boss.ts`

```ts
import PgBoss from 'pg-boss'
import { env } from '@/server/config'
let boss: PgBoss | null = null
export async function getBoss(): Promise<PgBoss> {
  if (boss) return boss
  boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: 'pgboss', supervise: false, schedule: false, migrate: false, max: 2 })
  await boss.start()
  return boss
}
```

Queues (`src/server/jobs/queues.ts`), created by `scripts/pgboss-migrate.ts` (`boss.createQueue(name, options)` with `retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 280, deadLetter: '<name>_dead'`) which runs `new PgBoss({ connectionString, schema: 'pgboss' }).start()` once (this migrates the schema) and then creates the queues idempotently:

| Queue | Payload | Handler | Singleton key |
|---|---|---|---|
| `score_run` | `{ runId }` | `scoring.scoreRun` | `score_run:<runId>` |
| `generate_package_step` | `{ packageVersionId, step, passNumber }` | `authoring.runGenerationStep` | `generate:<versionId>:<step>` |
| `send_email` | `{ to, template, props }` | `email.deliver` | none |
| `purge_deleted_accounts` | `{}` | `identity.purgeDeletedAccounts` | `purge:<date>` |
| `recompute_exports` | `{ courseId }` | `courses.recomputeExports` | `recompute:<courseId>` |

Drain (`src/server/jobs/drain.ts`): `drainQueues({ maxMs })` loops over the queues in priority order (`score_run`, `generate_package_step`, `recompute_exports`, `send_email`, `purge_deleted_accounts`), calls `boss.fetch(name, { batchSize: 5 })`, runs each handler inside its own job context, then `boss.complete(name, id)` or `boss.fail(name, id, { message })`, until every queue is empty or `maxMs` (270,000) elapses.

Triggers (D-012): `enqueue()` calls `after(() => drainQueues({ maxMs: 240000 }))` when `JOBS_DRAIN_ON_ENQUEUE=true`; `POST /api/internal/jobs/drain` (cron `0 4 * * *`, `maxDuration = 300`) runs the same drain plus `scheduleDailyMaintenance()` which enqueues `purge_deleted_accounts` with `singletonKey: 'purge:<date>'`; locally `pnpm jobs:worker` runs `boss.work(name, handler)` for every queue.

Idempotency: handlers check state first (`score_run` returns early if `runs.scoring_status = 'done'`), and singleton keys prevent duplicates while a job is queued or active.

## 8. Timers (lazy materialization, ADR-019)

`runs.service.materializeTimers(run)` is called at the start of every run read and mutation. In one transaction with the run row locked:

1. `readiness`: if `now ≥ readiness_expires_at` and not submitted → auto-submit unanswered as `unknown` (`readiness_item` events for unanswered items with `correct: null`), transition to `framing`.
2. `working`: if `remaining_ms ≤ 0` → auto-lock: load the `run_briefs` draft, call `reliance.markReliedOnFromNamedFields(tx, run, draft.namedValues ?? {})`, then write `decision_locked` at `occurred_at = expiry instant` with `auto: true`, the draft's fields (empty as empty), `named_values` from the draft, `relied_on_claim_ids`, and `unstanced_relied_on_claim_ids` from `reliance.findUnstancedReliedOn`; transition; set `turn_due_at`.
3. `decision_locked`: if `now ≥ turn_due_at` → `turn_delivered` event at `occurred_at = turn_due_at`; state `turn_open`; `turn_delivered_at = now`, `turn_window_ends_at = max(now, turn_due_at) + 12 min` (FR-115).
4. `turn_open`: if `now ≥ turn_window_ends_at` → implicit hold `turn_response_locked` at the window end; state `turn_locked` then `defense_pending` (automatic).
5. `paused`: no timer action; the clock is frozen.

The expiry instant used for `occurred_at` is computed from the run's clock fields, so the event timestamp is exact regardless of when the read happens (NFR-002).

## 9. Run state machine

`src/server/modules/runs/state-machine.ts` holds the transition table (PRD §8, FR-231):

| From | To | Trigger | Irreversible |
|---|---|---|---|
| assigned | readiness | `acknowledgePolicy` (policy display acknowledged; `startRun` creates the run in `assigned`) | until submit |
| readiness | framing | submit or skip | yes |
| framing | working | `lockFrame` | yes |
| working | paused | component failure | no |
| paused | working | resume | no |
| turn_open | paused | component failure in the Turn window (D-133) | no |
| paused | turn_open | resume; `turn_window_ends_at` extended by the paused time | no |
| working | decision_locked | `lockDecision` or clock expiry | yes |
| decision_locked | turn_open | `turn_due_at` reached | yes |
| turn_open | turn_locked | response or window expiry | yes |
| turn_locked | defense_pending | automatic | yes |
| defense_pending | defense_complete | `completeDefense` | yes |
| defense_complete | scored | `scoreRun` | yes |
| scored | confirmed | last band decision | yes |
| confirmed | recorded | debrief answered | yes |
| confirmed, recorded | (same, `adjusted_at` set) | neutralization recompute | — |
| any except voided | voided | `voidRun` | yes |

`transition(run, to, event)` throws `ILLEGAL_TRANSITION` (409) unless the pair is listed; it writes a `lifecycle` event `{ from, to, cause }` and stamps the matching `*_at` column. Future-state states (`abandoned`, `defense_missed`, `under_appeal`, `expired`) have no transitions in the build table.

## 10. Clock

`src/server/modules/runs/clock.ts` (D-042):

```ts
export function remainingMs(run, now = new Date()): number | null {
  if (!run.workingStartedAt || !['working','paused'].includes(run.state)) return null
  const elapsed = now - run.workingStartedAt
  const pausedNow = run.pausedAt ? now - run.pausedAt : 0
  return run.workingClockSeconds*1000 - elapsed + run.totalPausedMs + pausedNow + run.creditedMs - run.chargedMs
}
export function chargeCost(run, costMs): void  // asserts remaining > 0, increments charged_ms
export function credit(run, ms): void         // increments credited_ms
```

Action costs (FR-070, FR-071, FR-090): Source Trace 60,000 ms; Replication Check 180,000 ms; Decomposition Check 240,000 ms; escalation 300,000 ms. Costs are charged before the result is returned; an action that started with `remaining > 0` completes (FR-072). Every event written during `working`/`paused`/`turn_open` stores `clock_remaining_ms` (for the Turn window, the window's remaining ms).

Turn window (D-132): `remainingWindowMs = turn_window_ends_at − now − (paused ? now − paused_at : 0)`; interrogation actions and escalations in the window deduct their cost from the window (`turn_window_ends_at -= cost`), are refused with `TURN_WINDOW_EXPIRED` when the remaining window is ≤ 0, and are recorded with `clock_cost_ms` charged and `clock_remaining_ms` = the window remaining. A pause during the window (D-133) freezes the window and `resumeRun` extends `turn_window_ends_at` by the paused time.

Pause (FR-001): the service functions `runs.pauseRun(run, cause, relatedDelegationId)` (sets `paused_at`, writes `pause`) and `runs.resumeRun(actor, runId)` (adds `now − paused_at` to `total_paused_ms`, or extends `turn_window_ends_at` when the run paused in `turn_open`, credits the failed action's cost: delegation 0, action its cost, escalation 300,000 ms; writes `resume { clock_credited_ms }`) wrap the `clock.ts` primitives `pause()` and `resume()`.

## 11. Pagination, idempotency, request ids

- List endpoints accept `?cursor=<opaque>&limit=20` (max 100) and return `{ items, nextCursor }`; cursor = base64 of `(created_at, id)` of the last item; sort `created_at desc, id desc` (D-020).
- Idempotency: mutations that create runs, exports, and generation steps accept an optional `Idempotency-Key` header; the key is stored in `rate_limit_buckets` under `idem:<userId>:<key>` for 24 h with the response id; a repeat returns the same resource.
- Request ids (D-086): honored from `x-request-id` when a UUID; returned on every response.

## 12. Caching and scheduled tasks

- No application data cache. RSC pages are dynamic. Static assets immutable (`16-performance-a11y-budgets.md`).
- Scheduled tasks: Vercel Cron daily drain and maintenance (§7); the nightly backup workflow (`15-cicd-deployment.md`). No other schedulers.

## 13. Health and readiness (SYS-009)

`GET /api/health` → `200 { status: 'ok', version }` with no dependencies. `GET /api/ready` → `SELECT 1` with a 2 s timeout and `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss'` → `200 { status: 'ready', checks: { db: 'ok', jobs: 'ok' } }` or `503` with the failing check. Both are `Cache-Control: no-store` and excluded from auth and rate limiting.
