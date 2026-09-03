# Phase 7 — Assistant and Delegation Log

**Purpose / Read this when:** the run reaches the working period (Phase 6) and the AI assistant must answer inside the scenario on the mock provider: the `LlmProvider` interface and registry, the mock, call logging, the assistant prompt and trigger matching, claim surfacing, the numeric guard, the Delegation Log with used marks and why lines, the outside-tool declaration, and the Sycophancy Probe reversal.

**Requirements covered:** FR-050 to FR-056, FR-060 to FR-064, AI-002 (mock path), AI-004 (deterministic path), DATA-033, DATA-034 (surfacing), DATA-049, UI-023 (assistant, log, declaration), NFR-012; decisions D-029, D-030, D-063, D-068, D-088.

## Goal

A student delegates to the assistant, sees claim objects surface as discrete items, marks claims used, adds why lines, declares outside-tool use, and everything is traced, with no API key anywhere.

## Prerequisites

- Phase 6 exit criteria pass.
- Read `11-llm-integration.md` §1–3, `10-backend-spec-modules.md` §7–8.

## Steps

### Step 7.1 — LlmProvider interface, registry, mock provider, structured helper, call logging
**Goal:** `getProvider()` returns the mock provider wrapped with logging; `structuredViaPrompt` parses, validates, and repairs.
**Covers:** AI-002 (infrastructure), DATA-049, NFR-012, D-029, D-063
**Prerequisites:** Phase 6 complete
**Files to create / modify:**
- `src/server/llm/provider.ts`, `src/server/llm/registry.ts`, `src/server/llm/structured.ts`, `src/server/llm/calls.ts` — create; `11-llm-integration.md` §1
- `src/server/llm/providers/mock/{index,templates,readers,generation}.ts` — create; `readers.ts` and `generation.ts` are implemented fully here (used by Phases 10 and 12) per D-063
- `src/server/llm/prompts/untrusted.ts`, `src/server/llm/prompts/define-prompt.ts` — create
- `src/server/llm/guardrails/numeric-guard.ts` — create; D-068
- `src/server/llm/providers/openai-compatible/index.ts`, `src/server/llm/providers/anthropic/index.ts` — not yet (Phase 14); the registry maps those names to a function that throws `LLM_PROVIDER_ERROR` with message "provider not installed" so `LLM_PROVIDER=openai-compatible` fails fast before Phase 14
**Commands (in order, from repo root):**
```bash
pnpm add ai@7.0.91
```
**Implementation notes:** `structuredViaPrompt` steps per `11-llm-integration.md` §1.2; every call writes `llm_calls` (feature, prompt, version, provider `mock`, tokens, latency, cost 0 for mock, outcome). The mock is seeded by `hash(request)` and never emits digits absent from its inputs.
**Secrets (if any):** none (`LLM_PROVIDER=mock`).
**Tests to write:**
- `tests/unit/llm/structured.test.ts` — valid JSON passes; invalid then repaired counts `repaired`; twice invalid throws `LLM_OUTPUT_INVALID`.
- `tests/unit/llm/numeric-guard.test.ts` — allowed numbers (thousands separators, percent, currency) pass; unknown numbers flagged; block mode replaces.
- `tests/unit/llm/mock.test.ts` — deterministic output for identical input; markers once per claim.
- `tests/integration/llm/calls.test.ts` — an `llm_calls` row per call with the documented fields.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/llm && pnpm test:integration -- tests/integration/llm
```
**Commit:** `feat(llm): provider interface, registry, mock provider, structured output, call log`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 7.2 — Assistant prompts and trigger matching
**Goal:** `assistant-reply@1` and `trigger-classify@1` prompts; deterministic trigger matching with the AI-004 fallback path wired (mock returns the deterministic result).
**Covers:** FR-051, FR-056, AI-002, AI-004, D-030, D-067
**Prerequisites:** Step 7.1 complete
**Files to create / modify:**
- `src/server/llm/prompts/assistant-reply.ts`, `src/server/llm/prompts/trigger-classify.ts` — create; `11-llm-integration.md` §2.1
- `src/server/modules/assistant/triggers.ts` — create; `normalize`, `matchTriggers`, `classifyWithModel` (called only when `flags.ai` and no deterministic match, or `TRIGGER_MATCHING=llm_first`)
- `src/server/llm/guardrails/defect-words.ts` — create; the filter from `11-llm-integration.md` §3
**Commands (in order, from repo root):** none.
**Implementation notes:** The system prompt contains the UNTRUSTED sentence and the "never mention evidence status, defects, or bands" rule. The reply assembly guarantees one marker per surfaced claim.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/assistant/triggers.test.ts` — substring, token-set, normalization (case, punctuation, NFKD), no false match on partial tokens, `llm_first` ordering.
- `tests/unit/assistant/defect-words.test.ts` — replacement and flagging.
- `evals/assistant/cases/*.json` and `evals/assistant/check.ts`, `evals/run.ts`, `evals/config.ts` — create; the 12 cases of `11-llm-integration.md` §5 (mock must pass 100 percent).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/assistant && pnpm evals
```
**Commit:** `feat(assistant): reply and classification prompts, trigger matching, evals scaffold`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 7.3 — Assistant service: delegate stream, surfacing, log, used marks, declaration, probe
**Goal:** Every function in `10-backend-spec-modules.md` §7 with its router and actions; `reliance.surfaceClaims` completed.
**Covers:** FR-050 to FR-055, FR-060 to FR-064, DATA-033, DATA-034, D-088
**Prerequisites:** Step 7.2 complete
**Files to create / modify:**
- `src/server/modules/assistant/{schema,service,repository,router,actions,index,errors}.ts` — create or complete
- `src/server/modules/reliance/service.ts` — modify; `surfaceClaims`, `surfaceDocumentClaims`, `listRunClaims` (student view; stances read-only until Phase 8)
- `src/app/api/v1/runs/[runId]/delegations/route.ts` (GET, POST stream with `export const maxDuration = 300`), `.../delegations/[delegationId]/route.ts`, `.../outside-tool-declaration/route.ts`, `src/app/api/v1/runs/[runId]/claims/route.ts` — create
- `src/server/modules/runs/service.ts` — modify; `pauseRun`/`resumeRun` and the `POST /runs/{id}/resume` route (needed by the assistant failure path); `getRunWorkspace` includes delegations, claims, declarations, pause info
**Commands (in order, from repo root):** none.
**Implementation notes:** The stream is `text/event-stream` with `segment` and `done` events (`07-api-spec.md` §7); the delegation row is inserted before streaming and completed after; provider failure marks `failed`, pauses the run with cause `assistant_failure`, and writes the `delegation` event with `failed: true`; `first_delegation_at` set on the first delegation; probe reversal per D-088 writes `probe_fired`. `updateDelegation` writes `claim_used { via: 'log_mark' }`. `declareOutsideTool` writes the event and nothing else. The forced-failure flag path (`flags.forced_failure_armed`) is honored here; the control that arms it arrives in Phase 8.
**Secrets (if any):** none.
**Tests to write:**
- `tests/integration/assistant/delegate.test.ts` — matched request surfaces the claim once; second request referencing the same claim does not duplicate `run_claims`; unmatched request surfaces nothing; `delegation` event payload; `ASSISTANT_LOCKED` in `framing`; request over 2,000 chars refused; rate bucket `llm` (11th call in a minute is 429).
- `tests/integration/assistant/failure.test.ts` — with `flags.forced_failure_armed`, the delegation fails, the run is `paused`, resume credits 0 for a delegation and writes `resume`.
- `tests/integration/assistant/log.test.ts` — why line saved; used mark writes `claim_used` and sets `relied_on_via`; declaration event; probe reversal when the probe claim is challenged (stance set through the repository until Phase 8 exposes the endpoint).
- `tests/integration/assistant/defect-leak.test.ts` — no reply contains defect words or band names across the eval cases.
- `tests/integration/api/assistant.test.ts` — endpoints and matrix rows.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test:integration -- tests/integration/assistant tests/integration/api/assistant.test.ts tests/integration/auth/matrix.test.ts && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(assistant): streamed delegation, claim surfacing, delegation log, declaration, probe`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 7.4 — Workspace screens: assistant panel, claim cards, delegation log, declaration control, paused overlay
**Goal:** UI-023's working state (without stance controls, actions, and the brief editor, which arrive in Phase 8) through the Impeccable loop.
**Covers:** UI-023 (assistant, log, declaration, paused), FR-051, FR-056, FR-060, FR-061
**Prerequisites:** Step 7.3 complete
**Files to create / modify:**
- `src/components/features/run/{assistant-panel,claim-card,delegation-log,declaration-control,paused-overlay}.tsx` — create (`ClaimCard` renders the stance control slot disabled until Phase 8)
- `src/lib/hooks/use-delegation.ts` — create; SSE reader over `fetch`
- `src/app/(app)/runs/[runId]/work/page.tsx` — modify; working state layout (three columns per `09-frontend-spec.md` §5)
**Commands (in order, from repo root):** Impeccable loop for `/runs/[runId]/work` (working state).
**Implementation notes:** "AI assistant" label; live region announces reply completion and the count of surfaced claims; unverified numbers render with a subtle marker and a tooltip "not from a claim or document"; the paused overlay is `role="alertdialog"` with the workspace `inert`; the declaration control shows the no-penalty sentence from `t('run.declaration.noPenalty')`.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/run/assistant-panel.test.tsx` — streams segments in order; claim cards rendered inline; no-commentary state.
- `tests/unit/components/run/delegation-log.test.tsx` — why line editing; used mark toggles.
- `tests/e2e/walkthrough/06-working-period.spec.ts` (part 1) — delegate "What is the premium payback?" and see claim C3 surface as a card; the log fills; mark used; declare outside-tool use and see the no-penalty sentence; assert events via the trace endpoint. (Stances, actions, and escalation assertions are appended in Phase 8.)
- `tests/e2e/a11y/student-run.spec.ts` — modify; workspace working state.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/run && pnpm test:e2e -- tests/e2e/walkthrough/06-working-period.spec.ts tests/e2e/a11y/student-run.spec.ts
```
**Commit:** `feat(runs): assistant panel, claim cards, delegation log, declaration, paused overlay`
**Rollback:** `git checkout -- . && git clean -fd`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm evals && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: FR-050, FR-051, FR-052 (flag mode), FR-053, FR-056, FR-057, FR-060, FR-061, FR-062, FR-063 (log side; graph side in Phase 10), FR-064 (scoring side in Phase 10), DATA-033, DATA-049, NFR-012 (mock). Partially: AI-002 and AI-004 (real provider in Phase 14), FR-054 and FR-055 (scoring and flagging in Phases 10–11), UI-023 (stances and brief in Phase 8).
