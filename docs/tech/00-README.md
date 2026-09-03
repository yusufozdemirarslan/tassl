# 00 — How to use these docs with Claude Code

**Purpose / Read this when:** you are starting any build session. This file is the operating procedure; `CLAUDE.md` at the repo root points here.

**Requirements covered:** none directly; governs how every other ID is delivered.

## Operating procedure for every build session

1. Read `CLAUDE.md`.
2. Read `docs/tech/PROGRESS.md` and find the first unchecked step.
3. Read the phase file that contains it (`docs/tech/build-plan/phase-NN-*.md`) and only the spec files that phase's steps reference.
4. Execute the steps in order. Each step lists files, commands, implementation notes, tests, a Verify block, a commit message, and a rollback.
5. Run each step's **Verify** block and read the output. A Verify block that does not pass means the step is not done.
6. Commit with the given message (conventional commits).
7. Tick the step in `docs/tech/PROGRESS.md` and commit that too (`chore(progress): tick step N.M`).
8. At the phase end, run the **Phase exit criteria** commands, then stop and report: steps completed, tests passing, decisions added.

## Builder rules

- Never skip a Verify block. Never mark a step done with failing tests.
- Never start the next phase with failing tests in the current one.
- Never ask a human for a decision. Apply `docs/tech/DECISIONS.md` and its Decision Policy, append a new `D-NNN` row for anything new, and continue.
- If a step's assumption turns out false (a version, a command flag, a library API), fix `DECISIONS.md` and the affected spec first, then continue with the corrected step.
- The only human-supplied inputs are secret values. Every step that needs one names the env var, the exact console page where it is obtained, and the non-secret default that lets Verify pass without it.
- `main` is protected from Phase 0 Step 0.9 on: work on a branch (`feat/<phase>-<slug>`), commit each step there, and land it with `gh pr create --fill` then `gh pr merge --squash --auto --delete-branch` once the ten checks pass (D-134). A step's "Commit" line names the commit message; the pull request is how it reaches `main`.
- Keep the layering (`route handler / action → service → repository → DB`), naming, and error conventions in `04-repo-structure.md`.
- All UI work goes through the Impeccable loop in `09-frontend-spec.md` §Impeccable workflow, using the design tokens recorded there. When Impeccable asks a taste or direction question, answer with those recorded values.
- Package versions are pinned in `04-repo-structure.md` §Versions; use those exact versions in every `pnpm add`.
- Secrets never enter git, logs, or prompts.

## File map of `docs/tech/`

| File | One line |
|---|---|
| `00-README.md` | This procedure and the file map |
| `01-prd-analysis.md` | Product summary, personas, the requirements register (all IDs), flows, screen and entity inventories, resolved gaps |
| `02-architecture.md` | C4 diagrams, request lifecycles, module boundaries, cross-cutting concerns, NFR targets |
| `03-adrs.md` | Architecture decision records with reversal notes |
| `04-repo-structure.md` | Directory tree, naming and layering rules, conventions, `package.json` scripts, pinned versions |
| `05-environment-config.md` | Every env var, `.env.example`, Zod config loading, secrets management |
| `06-data-model.md` | ERD, every table with columns and indexes, migration policy, seed data, backup and restore |
| `07-api-spec.md` | Every endpoint with schemas, auth, errors, examples; global conventions |
| `openapi.yaml` | OpenAPI 3.1 document (generated from Zod; committed) |
| `08-auth-authz.md` | Auth flows, sessions, CSRF, password policy, deletion and export, permission matrix and enforcement |
| `09-frontend-spec.md` | Route map, design system tokens, component inventory, Impeccable workflow, accessibility target |
| `09-frontend-spec-screens.md` | Per-screen specification for every screen in the inventory |
| `10-backend-spec.md` | Cross-cutting backend patterns: errors, logging, request context, rate limiting, transactions, jobs |
| `10-backend-spec-modules.md` | Per-module responsibilities, entities, service and repository functions, rules, error codes |
| `11-llm-integration.md` | Provider interface, MiMo adapter facts, prompt library, guardrails, observability, evals, rollout |
| `12-security.md` | Threat model, OWASP and LLM controls, headers, cookies, CI scanning, PII, audit, incident basics |
| `13-observability-ops.md` | Logging, Sentry, health endpoints, dashboards, alerts, runbooks |
| `14-testing-strategy.md` | Test pyramid, tooling and configs, coverage gates, conventions, test data |
| `15-cicd-deployment.md` | GitHub Actions YAML, branch protection, Vercel and Neon setup commands, launch checklist |
| `16-performance-a11y-budgets.md` | Core Web Vitals, bundle, latency, DB query rules, image and font strategy, CI measurement |
| `17-analytics-events.md` | Every metric mapped to events; typed helper; privacy constraints |
| `build-plan/phase-00-bootstrap.md` … `phase-15-release.md` | The ordered build plan; one file per phase; every step in the mandatory template |
| `DECISIONS.md` | The decision policy and every resolved gap |
| `COVERAGE.md` | Requirements joined to build steps and tests; Gaps section (empty) |
| `PROGRESS.md` | Checklist of every phase and step for build sessions to tick |

The consolidated single-file edition is `docs/TASSL-TECHNICAL-DOCUMENTATION.md`, regenerated by `pnpm docs:build`. The folder is the source of truth.

## Phase order

| Phase | File | Outcome |
|---|---|---|
| 0 | `phase-00-bootstrap.md` | Repo, tooling, Docker Postgres, config, health endpoints, CI skeleton, GitHub repo, Vercel + Neon projects, first production deploy |
| 1 | `phase-01-design-foundation.md` | Impeccable installed, PRODUCT.md, DESIGN.md, tokens, shell, shadcn, component gallery |
| 2 | `phase-02-data-layer.md` | Schema, migrations, seed, repositories, integration tests |
| 3 | `phase-03-auth.md` | Better Auth flows, organizations, RBAC, protected routes, email templates |
| 4 | `phase-04-courses-and-assignments.md` | Courses, sections, roster, assignments, policy display config |
| 5 | `phase-05-scenario-packages.md` | Package model, import/export, validation, package and claim views |
| 6 | `phase-06-run-core.md` | Run lifecycle, clock, policy display, readiness, brief and room, frame |
| 7 | `phase-07-assistant-and-delegation.md` | LlmProvider interface + mock, assistant, delegation log, declaration |
| 8 | `phase-08-reliance-and-lock.md` | Stances, actions, escalation, lock gate, addendum, pause and test control |
| 9 | `phase-09-turn-and-defense.md` | Turn delivery and response, defense selection and answers |
| 10 | `phase-10-trace-and-scoring.md` | Trace export, four graphs, rubric, bands, points |
| 11 | `phase-11-review-debrief-record.md` | Faculty replay, confirmations, void/re-offer/neutralize, debrief, record, exports, notifications |
| 12 | `phase-12-authoring-pipeline.md` | Generation jobs on mock, confirmation workspace, authoring record, measures |
| 13 | `phase-13-cross-cutting-hardening.md` | Observability, security, rate limits, error pages, admin, legal, Impeccable hardening, a11y and perf gates |
| 14 | `phase-14-llm-integration.md` | MiMo and Anthropic adapters, prompt library, guardrails, evals, `FEATURE_AI` rollout |
| 15 | `phase-15-release.md` | Launch checklist, production promotion, monitoring verification, custom domain, walkthrough script, post-launch runbook |

The sentence that starts the first build session:

`Read CLAUDE.md and docs/tech/build-plan/phase-00-bootstrap.md and execute Phase 0 step by step. Do not stop for input.`
