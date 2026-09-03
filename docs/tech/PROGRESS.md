# PROGRESS — Build checklist

**Purpose / Read this when:** starting or ending any build session. Tick a step only after its Verify block passed and its commit exists. Tick a phase only after its exit criteria passed.

**Requirements covered:** tracking only; see `COVERAGE.md` for the ID map.

## Phase 0 — Bootstrap (`build-plan/phase-00-bootstrap.md`)
- [x] 0.1 Install the toolchain and initialize the repository
- [x] 0.2 Scaffold the Next.js application with pinned dependencies
- [x] 0.3 Lint, format, layering rule, and commit hooks
- [x] 0.4 Local Postgres, environment file, and fail-fast configuration
- [x] 0.5 Logging, request context, error model, route and action wrappers, analytics helper
- [x] 0.6 Database client, health and readiness endpoints, request proxy
- [x] 0.7 Test tooling, OpenAPI generator, docs build, smoke script
- [x] 0.8 CI workflows
- [ ] 0.9 GitHub repository and branch protection
- [x] 0.10 Vercel project, Neon project, environment variables, CI secrets
- [x] 0.11 First production deploy of the "hello" build
- [ ] Phase 0 exit criteria

## Phase 1 — Design foundation (`build-plan/phase-01-design-foundation.md`)
- [x] 1.1 Install Impeccable and write PRODUCT.md
- [x] 1.2 Fonts, tokens, and DESIGN.md
- [ ] 1.3 shadcn/ui against the tokens
- [ ] 1.4 Layout components, app shell, public layout, error pages
- [ ] 1.5 Dev component gallery route
- [ ] 1.6 Impeccable review loop on the shell and gallery, then DESIGN.md reconciliation
- [ ] Phase 1 exit criteria

## Phase 2 — Data layer (`build-plan/phase-02-data-layer.md`)
- [ ] 2.1 Better Auth schema generation
- [ ] 2.2 Tenancy and courses tables
- [ ] 2.3 Scenario package tables
- [ ] 2.4 Run tables and the trace
- [ ] 2.5 Scoring, review, records, and platform tables
- [ ] 2.6 Immutability grants and the application role
- [ ] 2.7 pg-boss schema, queues, drain, worker, ready check
- [ ] 2.8 Repository layer, tenant enforcement, pagination, Postgres rate limiter
- [ ] 2.9 Factories, seed, reset script
- [ ] Phase 2 exit criteria

## Phase 3 — Authentication, tenancy, roles (`build-plan/phase-03-auth.md`)
- [ ] 3.1 Email module: transport, templates, send_email job
- [ ] 3.2 Better Auth wiring: route handler, client, session helpers, permissions
- [ ] 3.3 Identity module: me, profile, export, deletion, purge job
- [ ] 3.4 Public screens: sign-in, sign-up, verify, forgot and reset password
- [ ] 3.5 Shell wiring, home, account settings, invitations
- [ ] 3.6 Authorization matrix test and E2E fixtures
- [ ] Phase 3 exit criteria

## Phase 4 — Courses and assignments (`build-plan/phase-04-courses-and-assignments.md`)
- [ ] 4.1 Courses module: schemas, service, repository, router, actions
- [ ] 4.2 Courses screens
- [ ] 4.3 Section roster screen
- [ ] 4.4 Assignment configuration screen
- [ ] Phase 4 exit criteria

## Phase 5 — Scenario packages (`build-plan/phase-05-scenario-packages.md`)
- [ ] 5.1 Package schemas and validatePackage
- [ ] 5.2 Scenarios service, import and export, confirmation, freezing
- [ ] 5.3 Fixture package and seed assignments
- [ ] 5.4 Packages list, new-from-seed, and version view screens
- [ ] 5.5 Element confirmation workspace
- [ ] Phase 5 exit criteria

## Phase 6 — Run core (`build-plan/phase-06-run-core.md`)
- [ ] 6.1 Trace module: append, sequencing, reading
- [ ] 6.2 Runs module: state machine, clock, limits, start, policy acknowledgement
- [ ] 6.3 Readiness Check service
- [ ] 6.4 Evidence Room opens and the frame
- [ ] 6.5 Student screens: runs list, policy display, readiness, run frame and clock, workspace (framing)
- [ ] Phase 6 exit criteria

## Phase 7 — Assistant and delegation log (`build-plan/phase-07-assistant-and-delegation.md`)
- [ ] 7.1 LlmProvider interface, registry, mock provider, structured helper, call logging
- [ ] 7.2 Assistant prompts and trigger matching
- [ ] 7.3 Assistant service: delegate stream, surfacing, log, used marks, declaration, probe
- [ ] 7.4 Workspace screens: assistant panel, claim cards, delegation log, declaration control, paused overlay
- [ ] Phase 7 exit criteria

## Phase 8 — Reliance, interrogation, escalation, Decision Lock (`build-plan/phase-08-reliance-and-lock.md`)
- [ ] 8.1 Reliance service: stances, actions, escalations, relied-on detection, lock-gate query
- [ ] 8.2 Brief draft, lock gate, Decision Lock, addendum, auto-lock, pause and resume, test control
- [ ] 8.3 Screens: stance controls, action results, escalation dialog, brief editor, lock dialogs, addendum, locked page
- [ ] Phase 8 exit criteria

## Phase 9 — The Turn and the defense (`build-plan/phase-09-turn-and-defense.md`)
- [ ] 9.1 Turn delivery, window, response, implicit hold
- [ ] 9.2 Defense service: selection, follow-ups, answers, completion
- [ ] 9.3 Screens: Turn window, defense, run status
- [ ] Phase 9 exit criteria

## Phase 10 — Trace export and scoring (`build-plan/phase-10-trace-and-scoring.md`)
- [ ] 10.1 Trace export in two forms
- [ ] 10.2 Graph builders and graph components
- [ ] 10.3 Rubric v1, categorical facts, band rules, points
- [ ] 10.4 Band-read prompts, mock readers, scoring job, held path, notifications service
- [ ] 10.5 E2E: scoring reachable from the run, export by API
- [ ] Phase 10 exit criteria

## Phase 11 — Faculty replay, debrief, record, exports, notifications (`build-plan/phase-11-review-debrief-record.md`)
- [ ] 11.1 Review service: replay, band decisions, confirm, neutralize, void and re-offer, manual banding, flagging
- [ ] 11.2 Debrief service and mapping change with recompute
- [ ] 11.3 Faculty replay screen
- [ ] 11.4 Debrief, record, run status, exports, notifications, queue screens
- [ ] 11.5 Full walkthrough E2E on both variants, standing rules, keyboard-only run
- [ ] Phase 11 exit criteria

## Phase 12 — AI-assisted authoring pipeline (`build-plan/phase-12-authoring-pipeline.md`)
- [ ] 12.1 Generation prompts, warranted-stance table, mock generation
- [ ] 12.2 Authoring service and generation jobs
- [ ] 12.3 Generation progress screen and confirmation workspace regeneration
- [ ] Phase 12 exit criteria

## Phase 13 — Cross-cutting hardening (`build-plan/phase-13-cross-cutting-hardening.md`)
- [ ] 13.1 Sentry: manual setup, release tagging, ops events, alerts
- [ ] 13.2 PostHog: client and server transports, reverse proxy, event catalogue, identity
- [ ] 13.3 Security headers, CSP, cookies, secret scanning, dependency updates
- [ ] 13.4 Rate-limit coverage, student-view invariants, PII redaction audit
- [ ] 13.5 Admin area, legal pages, error-page polish, copy review
- [ ] 13.6 Backups, restore drill, incident tooling, retention
- [ ] 13.7 Impeccable app-wide passes: adapt, optimize, extract
- [ ] 13.8 Accessibility sweep and performance budgets in CI
- [ ] Phase 13 exit criteria

## Phase 14 — LLM integration (`build-plan/phase-14-llm-integration.md`)
- [ ] 14.1 OpenAI-compatible (MiMo) and Anthropic adapters
- [ ] 14.2 Guardrails: redaction, budgets, timeouts, retries, circuit breaker, fallback, degradation
- [ ] 14.3 Prompt hardening and injection evals
- [ ] 14.4 Evals against the real provider (local)
- [ ] 14.5 LLM observability panel and alerts
- [ ] 14.6 Rollout to preview, then production
- [ ] Phase 14 exit criteria

## Phase 15 — Release and walkthrough (`build-plan/phase-15-release.md`)
- [ ] 15.1 Production database role and connection strings
- [ ] 15.2 Production seeds and the real scenario package
- [ ] 15.3 Launch checklist execution
- [ ] 15.4 Custom domain (conditional on APP_DOMAIN)
- [ ] 15.5 The walkthrough (definition of done)
- [ ] 15.6 Post-launch: monitoring verification, test controls, runbook handover, progress close-out
- [ ] Phase 15 exit criteria
