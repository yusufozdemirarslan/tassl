# PROGRESS — Build checklist

**Purpose / Read this when:** starting or ending any build session. Tick a step only after its Verify block passed and its commit exists. Tick a phase only after its exit criteria passed.

**Requirements covered:** tracking only; see `COVERAGE.md` for the ID map.

**The phase exit-criteria boxes were ticked at the 2026-09-10 release.** Each is the same command block — `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, and the phase's own additions — and the release verification ran all of them over the merged tree: every check on pull request #33 green, 909 end-to-end runs across four projects three times each, and the walkthrough against production. They record that the criteria hold of the code that shipped, not that each was observed on the day its phase closed.

## Phase 0 — Bootstrap (`build-plan/phase-00-bootstrap.md`)
- [x] 0.1 Install the toolchain and initialize the repository
- [x] 0.2 Scaffold the Next.js application with pinned dependencies
- [x] 0.3 Lint, format, layering rule, and commit hooks
- [x] 0.4 Local Postgres, environment file, and fail-fast configuration
- [x] 0.5 Logging, request context, error model, route and action wrappers, analytics helper
- [x] 0.6 Database client, health and readiness endpoints, request proxy
- [x] 0.7 Test tooling, OpenAPI generator, docs build, smoke script
- [x] 0.8 CI workflows
- [x] 0.9 GitHub repository and branch protection
- [x] 0.10 Vercel project, Neon project, environment variables, CI secrets
- [x] 0.11 First production deploy of the "hello" build
- [x] Phase 0 exit criteria

## Phase 1 — Design foundation (`build-plan/phase-01-design-foundation.md`)
- [x] 1.1 Install Impeccable and write PRODUCT.md
- [x] 1.2 Fonts, tokens, and DESIGN.md
- [x] 1.3 shadcn/ui against the tokens
- [x] 1.4 Layout components, app shell, public layout, error pages
- [x] 1.5 Dev component gallery route
- [x] 1.6 Impeccable review loop on the shell and gallery, then DESIGN.md reconciliation
- [x] Phase 1 exit criteria

## Phase 2 — Data layer (`build-plan/phase-02-data-layer.md`)
- [x] 2.1 Better Auth schema generation
- [x] 2.2 Tenancy and courses tables
- [x] 2.3 Scenario package tables
- [x] 2.4 Run tables and the trace
- [x] 2.5 Scoring, review, records, and platform tables
- [x] 2.6 Immutability grants and the application role
- [x] 2.7 pg-boss schema, queues, drain, worker, ready check
- [x] 2.8 Repository layer, tenant enforcement, pagination, Postgres rate limiter
- [x] 2.9 Factories, seed, reset script
- [x] Phase 2 exit criteria

## Phase 3 — Authentication, tenancy, roles (`build-plan/phase-03-auth.md`)
- [x] 3.1 Email module: transport, templates, send_email job
- [x] 3.2 Better Auth wiring: route handler, client, session helpers, permissions
- [x] 3.3 Identity module: me, profile, export, deletion, purge job
- [x] 3.4 Public screens: sign-in, sign-up, verify, forgot and reset password
- [x] 3.5 Shell wiring, home, account settings, invitations
- [x] 3.6 Authorization matrix test and E2E fixtures
- [x] Phase 3 exit criteria

## Phase 4 — Courses and assignments (`build-plan/phase-04-courses-and-assignments.md`)
- [x] 4.1 Courses module: schemas, service, repository, router, actions
- [x] 4.2 Courses screens
- [x] 4.3 Section roster screen
- [x] 4.4 Assignment configuration screen
- [x] Phase 4 exit criteria

## Phase 5 — Scenario packages (`build-plan/phase-05-scenario-packages.md`)
- [x] 5.1 Package schemas and validatePackage
- [x] 5.2 Scenarios service, import and export, confirmation, freezing
- [x] 5.3 Fixture package and seed assignments
- [x] 5.4 Packages list, new-from-seed, and version view screens
- [x] 5.5 Element confirmation workspace
- [x] Phase 5 exit criteria

## Phase 6 — Run core (`build-plan/phase-06-run-core.md`)
- [x] 6.1 Trace module: append, sequencing, reading
- [x] 6.2 Runs module: state machine, clock, limits, start, policy acknowledgement
- [x] 6.3 Readiness Check service
- [x] 6.4 Evidence Room opens and the frame
- [x] 6.5 Student screens: runs list, policy display, readiness, run frame and clock, workspace (framing)
- [x] Phase 6 exit criteria

## Phase 7 — Assistant and delegation log (`build-plan/phase-07-assistant-and-delegation.md`)
- [x] 7.1 LlmProvider interface, registry, mock provider, structured helper, call logging
- [x] 7.2 Assistant prompts and trigger matching
- [x] 7.3 Assistant service: delegate stream, surfacing, log, used marks, declaration, probe
- [x] 7.4 Workspace screens: assistant panel, claim cards, delegation log, declaration control, paused overlay
- [x] Phase 7 exit criteria

## Phase 8 — Reliance, interrogation, escalation, Decision Lock (`build-plan/phase-08-reliance-and-lock.md`)
- [x] 8.1 Reliance service: stances, actions, escalations, relied-on detection, lock-gate query
- [x] 8.2 Brief draft, lock gate, Decision Lock, addendum, auto-lock, pause and resume, test control
- [x] 8.3 Screens: stance controls, action results, escalation dialog, brief editor, lock dialogs, addendum, locked page
- [x] Phase 8 exit criteria

## Phase 9 — The Turn and the defense (`build-plan/phase-09-turn-and-defense.md`)
- [x] 9.1 Turn delivery, window, response, implicit hold
- [x] 9.2 Defense service: selection, follow-ups, answers, completion
- [x] 9.3 Screens: Turn window, defense, run status
- [x] Phase 9 exit criteria

## Phase 10 — Trace export and scoring (`build-plan/phase-10-trace-and-scoring.md`)
- [x] 10.1 Trace export in two forms
- [x] 10.2 Graph builders and graph components
- [x] 10.3 Rubric v1, categorical facts, band rules, points
- [x] 10.4 Band-read prompts, mock readers, scoring job, held path, notifications service
- [x] 10.5 E2E: scoring reachable from the run, export by API
- [x] Phase 10 exit criteria

## Phase 11 — Faculty replay, debrief, record, exports, notifications (`build-plan/phase-11-review-debrief-record.md`)
- [x] 11.1 Review service: replay, band decisions, confirm, neutralize, void and re-offer, manual banding, flagging
- [x] 11.2 Debrief service and mapping change with recompute
- [x] 11.3 Faculty replay screen
- [x] 11.4 Debrief, record, run status, exports, notifications, queue screens
- [x] 11.5 Full walkthrough E2E on both variants, standing rules, keyboard-only run
- [x] Phase 11 exit criteria

## Phase 12 — AI-assisted authoring pipeline (`build-plan/phase-12-authoring-pipeline.md`)
- [x] 12.1 Generation prompts, warranted-stance table, mock generation
- [x] 12.2 Authoring service and generation jobs
- [x] 12.3 Generation progress screen and confirmation workspace regeneration
- [x] Phase 12 exit criteria

## Phase 13 — Cross-cutting hardening (`build-plan/phase-13-cross-cutting-hardening.md`)
- [x] 13.1 Sentry: manual setup, release tagging, ops events, alerts
- [x] 13.2 PostHog: client and server transports, reverse proxy, event catalogue, identity
- [x] 13.3 Security headers, CSP, cookies, secret scanning, dependency updates
- [x] 13.4 Rate-limit coverage, student-view invariants, PII redaction audit
- [x] 13.5 Admin area, legal pages, error-page polish, copy review
- [x] 13.6 Backups, restore drill, incident tooling, retention
- [x] 13.7 Impeccable app-wide passes: adapt, optimize, extract
- [x] 13.8 Accessibility sweep and performance budgets in CI
- [x] Phase 13 exit criteria

## Phase 14 — LLM integration (`build-plan/phase-14-llm-integration.md`)
- [x] 14.1 OpenAI-compatible (MiMo) and Anthropic adapters
- [x] 14.2 Guardrails: redaction, budgets, timeouts, retries, circuit breaker, fallback, degradation
- [x] 14.3 Prompt hardening and injection evals
- [x] 14.4 Evals against the real provider (local)
- [x] 14.5 LLM observability panel and alerts
- [x] 14.6 Rollout to preview, then production
- [x] Phase 14 exit criteria

## Phase 15 — Release and walkthrough (`build-plan/phase-15-release.md`)
- [x] 15.1 Production database role and connection strings
- [x] 15.2 Production seeds and the real scenario package
- [x] 15.3 Launch checklist execution
- [x] 15.4 Custom domain (conditional on APP_DOMAIN) — no-op: APP_DOMAIN is not set, so the Vercel-assigned domain is the active one
- [x] 15.5 The walkthrough (definition of done)
- [x] 15.6 Post-launch: monitoring verification, test controls, runbook handover, progress close-out
- [x] Phase 15 exit criteria
