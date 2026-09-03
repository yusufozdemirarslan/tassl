# Claude Code Prompt — Generate Tassl's End-to-End Technical Build Documentation from the PRD

> **How to run:** Save this file as `docs/prompts/01-generate-tech-docs.md` in the Tassl repo (the repo root already contains the PRD, named `Tassl PRD`). Start Claude Code at the repo root with `claude --permission-mode acceptEdits` (or auto mode if your plan offers it) so it does not pause on file edits, then send:
> `Read docs/prompts/01-generate-tech-docs.md and execute it end to end. Do not stop for input.`

---

## 0. Fixed inputs — already decided, do not ask

| Field | Value |
|---|---|
| App name | **Tassl** (package name `tassl`, default branch `main`) |
| PRD | The file at the repo root whose name starts with `Tassl PRD` (any extension: `.md`, `.txt`, `.docx`, `.pdf`). Handling rules in Section 3.1. |
| Deployment target | **Vercel + Neon Postgres.** Environments: local (Docker Compose Postgres), preview (one per PR, backed by a Neon branch), production. No separate staging environment; previews serve that role. |
| Stack | Section 4, exactly as written. No overrides. |
| LLM provider (initial) | Xiaomi **MiMo-V2.5-Pro** through an OpenAI-compatible chat-completions API, behind a provider interface switchable by env only. `mock` provider is the default in every environment until a key is present. LLM integration is the **last** build phase before release. |
| Frontend design skill | **Impeccable** (`pbakaus/impeccable`) — mandatory for all UI work (Section 7). |
| Domain | The Vercel-assigned domain at launch. A custom domain is attached by a release-phase step that runs only when `APP_DOMAIN` is set in production env. |
| Locale | en-US only; all UI strings centralized so locales can be added later. |

## 1. Your role and mission

You are the founding staff engineer and architect for Tassl. Your only deliverable in this task is **documentation**: a complete, step-by-step, copy-paste-executable technical build plan that turns the PRD into a production-grade web application — frontend, backend, database, tests, CI/CD, deployment, observability, and LLM integration.

The documentation must be good enough that a **fresh** Claude Code session with no memory of this conversation — given only the repo, the PRD, and these docs — can build the entire app phase by phase without guessing, without asking a human anything, and without skipping steps.

## 2. Hard rules for this task

1. **Never stop for input.** There is no question channel. Run Sections 3.1 through 3.7 in one pass and stop only when everything is written and audited. Every gap, ambiguity, or missing detail is resolved by the Decision Policy (Section 3.3) and logged in `docs/tech/DECISIONS.md`. The single legitimate stop is if no PRD file exists anywhere in the repo — then report that and end.
2. **No placeholders, anywhere.** The finished docs contain no `TBD`, `TODO`, `XXX`, `[EDIT ME]`, `<your-value>`, `e.g. adjust as needed`, `optional` without a stated default, or "configure appropriately". Angle-bracket tokens exist only inside the Section 6 template as pattern variables that you fill in every real step. Secrets are the one exception: an env var whose value is a secret is documented by name, the exact console URL/path where the value is obtained, and a working non-secret default (`mock`, local address, or empty-means-disabled) so every step verifies without it.
3. **Documentation only.** Do not scaffold the app, install app dependencies, or write application code. You may run read-only and doc-supporting commands: `node -v`, `pnpm -v`, `npm view <pkg> version`, `git status`, `git remote -v`, `ls`, `cat`, PRD text extraction (Section 3.1), and web fetches to verify facts. The only non-documentation files you create are `CLAUDE.md` (Section 11) and `docs/tech/PROGRESS.md`.
4. **Read the entire PRD before writing anything.** No skimming, no summarizing from the first pages.
5. **The PRD is the source of truth for product scope.** Do not invent product features. Production necessities the PRD omits (login, settings, password reset, email verification, 404/500 pages, an admin area, privacy/terms pages when PII is collected) are added, tagged `SYS-###`, and logged in `DECISIONS.md`.
6. **Every PRD requirement is traceable**: it appears in the requirements register with an ID, in at least one build step, and in at least one test. No orphan requirements, no orphan steps.
7. **Every command is copy-paste executable** from the repo root, in the stated order, on macOS and Linux. Every file path is exact and repo-relative. Every package version is pinned to the latest stable version you verify with `npm view <pkg> version` while writing — never from memory. Node version: the current Active LTS line as reported by `node -v` on this machine, recorded in `.nvmrc` and `package.json` `engines`; if the machine is behind the current LTS, Phase 0 includes the `nvm install --lts && nvm use --lts` step.
8. **Production-grade by default**: auth, validation, error handling, logging, observability, security hardening, rate limiting, migrations, backups, CI gates, deployment, and rollback are in scope even where the PRD is silent.
9. **Build steps never require a human decision.** The only human-supplied inputs across the entire build are secret values (API keys, OAuth credentials, Vercel/Neon/Sentry/PostHog/Resend tokens). Each step that needs one names the env var, where to get it, and the non-secret default that lets the step's Verify block pass without it.
10. **Write for an AI builder, not a human reader**: imperative voice, exact paths, exact commands, explicit acceptance criteria, no motivational prose.
11. Other planning skills or plugins you have installed (Superpowers, Graphify, or similar) may help you think, but the file set, formats, and decisions defined here are mandatory and take precedence.
12. If context gets tight, write files incrementally and keep going; never summarize a file instead of writing it.

## 3. Process — do these in order, without stopping

### 3.1 Locate, extract, and analyze the PRD → `docs/tech/01-prd-analysis.md`

**Locate:** `ls -1 | grep -i '^tassl prd'`. If several match (versions, drafts), use the most recently modified one and record the choice in `DECISIONS.md`. If none match at the root, search the whole repo: `find . -iname '*prd*' -not -path './node_modules/*' -not -path './.git/*'`. If still nothing, report "No PRD found" and end (the only permitted stop).

**Extract to a canonical markdown copy** at `docs/prd/Tassl-PRD.md` (`mkdir -p docs/prd`); never modify the original:
- `.md` / `.txt`: `cp "Tassl PRD.md" docs/prd/Tassl-PRD.md` (adjust the extension to the real one).
- `.docx`: `pandoc "Tassl PRD.docx" -t gfm --wrap=none -o docs/prd/Tassl-PRD.md`. If `pandoc` is missing: `brew install pandoc` (macOS) or `sudo apt-get install -y pandoc` (Linux). If neither works: `python3 -m pip install python-docx` and extract every paragraph and table cell in document order with a short Python script.
- `.pdf`: `pdftotext -layout "Tassl PRD.pdf" docs/prd/Tassl-PRD.md`. If missing: `brew install poppler` / `sudo apt-get install -y poppler-utils`. Fallback: `python3 -m pip install pypdf` and extract all pages in order.
- Read the extracted file end to end. If extraction obviously lost content (empty sections, tables collapsed), open the original with your file reader as well and reconcile.

**Analyze** and write `01-prd-analysis.md` with:
- Product summary, personas, jobs-to-be-done, and success metrics exactly as the PRD states them.
- **Requirements register** — one row per requirement: `ID | Type | Description | PRD source | Priority (MoSCoW) | Acceptance criteria | Notes`. ID scheme: `FR-###` functional · `NFR-###` non-functional · `UI-###` screen/UX · `DATA-###` entity/data · `INT-###` external integration · `AI-###` LLM-powered feature · `AN-###` analytics/metric · `SYS-###` production necessity not in the PRD. Write acceptance criteria yourself wherever the PRD has none. If the PRD describes AI vaguely ("smart suggestions", "AI-powered"), define one concrete `AI-###` capability per mention with input, output schema, UI surface, and failure behavior.
- User flows (Mermaid `flowchart` / `sequenceDiagram`) for every end-to-end journey.
- Screen inventory: every page, modal, drawer, and distinct state implied by the PRD, with the requirement IDs it serves.
- Entity inventory: every noun that must be persisted, with relationships and ownership.
- Integration inventory: every external system — auth providers, email, payments, file storage, notifications, LLM capabilities.
- Explicit out-of-scope list, and a **PRD gaps** list. Every gap is resolved on the spot with the Decision Policy and written to `DECISIONS.md` — no gap is left open.

### 3.2 Decide the architecture → `docs/tech/03-adrs.md`

Apply Section 4 and the Decision Policy. Record every consequential choice as an ADR: **Context → Options considered (2–3) → Decision → Consequences → Requirement IDs affected → How to reverse**. Minimum ADR set: stack confirmation; deployment (Vercel + Neon chosen; Docker Compose on a VPS behind Cloudflare Tunnel recorded as the rejected alternative with a migration note); auth library; API style; ORM; multi-tenancy; jobs (or explicitly none); realtime (or none); storage/payments (or none); email; analytics; rate limiting; LLM provider abstraction; observability.

### 3.3 Decision Policy — how every gap is resolved (no questions, ever)

When the PRD is silent or ambiguous, decide in this order and log the result in `DECISIONS.md` as `ID | Gap | Rule applied | Decision | Rationale | How to reverse`:
1. The PRD's text and implied intent (personas, flows, metrics).
2. Production safety: security, data integrity, privacy.
3. Fewest moving parts: no new service or vendor unless a requirement needs it.
4. The most standard, best-documented option for the chosen stack.
5. Reversibility: prefer choices that can change later without a data migration.
Tie-breaker: the option a senior engineer would choose for a two-person team shipping in eight weeks.

Pre-made decisions for common gaps — apply these directly:

| Gap | Decision |
|---|---|
| Multi-tenancy | If the PRD mentions organizations, teams, workspaces, companies, classes, or groups that share data → multi-tenant: `tenant_id` on every tenant-scoped table, enforced in the repository layer, tenant switcher in the UI. Otherwise single-tenant with per-user ownership. |
| Roles | Derive one role per PRD persona; always add `admin` (`SYS`) for support and operations. Least privilege by default. |
| Sign-in methods | Email + password (verification required before first use) and Google OAuth. Add other providers only if the PRD names them. |
| Transactional email | Always required (verification, reset, invitations): Resend with react-email templates; local dev uses a console/mock transport, so no key is needed to build or test. |
| File uploads | If the PRD mentions upload, attachment, image, file, avatar, or document → Cloudflare R2 (S3-compatible) with presigned uploads, 10 MB per file, images + PDF allowed; local dev uses a `local` storage driver that writes to `./.data/uploads` (gitignored) so no bucket is needed until production. Otherwise none. |
| Payments | If the PRD mentions pricing, plans, subscriptions, credits, checkout, or billing → Stripe Checkout + webhooks, with a `free` plan as default. Otherwise none. |
| Background jobs | If the PRD needs scheduled work, reminders, digests, exports, bulk processing, or AI work that must outlive a request → pg-boss (Postgres-backed, no Redis). Otherwise none; LLM calls run in-request with streaming. |
| Realtime | If the PRD mentions live, real-time, presence, collaborative editing, or chat between users → Server-Sent Events first; WebSockets only for bidirectional needs. Otherwise none. |
| Search | If the PRD needs search → Postgres full-text search (`tsvector` + GIN index). No external search service. |
| Notifications | In-app notification center + email. Push/SMS only if the PRD names them. |
| Admin tooling | A minimal `/admin` area (`SYS`): user list and roles, feature-flag view, basic audit log. Nothing more unless the PRD asks. |
| Legal pages | If any PII is collected → Privacy Policy and Terms pages whose content is generated from the actual data model and integrations, with "reviewed by a human" as a release-checklist item. |
| Data retention & deletion | Business data retained indefinitely; application logs 30 days; deleted accounts soft-deleted immediately and purged after 30 days; users can export their data as JSON. |
| Identifiers & time | UUID v4 (`gen_random_uuid()` DB default); `timestamptz` in UTC; every table has `created_at`, `updated_at`; business entities have `deleted_at` (soft delete); join and log tables hard-delete. |
| Pagination | Cursor-based, default page size 20, maximum 100, stable sort by `(created_at, id)`. |
| Password & session | Password 12–128 characters, no composition rules, breached-password rejection via the auth library if available; cookie sessions, 30-day rolling expiry, rotated on privilege change; login rate-limited per IP and per account. |
| Timezone display | Store UTC, display in the browser's timezone; date-only fields stored as `date`. |
| Naming | DB `snake_case`; TypeScript `camelCase`; files and routes `kebab-case`; env vars and error codes `SCREAMING_SNAKE_CASE`; API under `/api/v1`. |
| Feature flags | A typed `flags` object read from env (`FEATURE_AI=false` default); no flag service. |
| Analytics | PostHog always; if the PRD defines no metrics, instrument sign-up, activation (first core action), and the top three core flows. |
| Brand & design | Impeccable's `DESIGN.md` must record concrete fonts, palette, spacing, and radius. Derive from PRD brand cues; if the PRD has none, derive from the product category and personas (calm, high-contrast, product-lane defaults) — still concrete, still recorded. |
| Rate limiting | Postgres-backed sliding window in the service layer (works on serverless, no Redis); defaults 60 requests/minute per user for writes, 600 for reads, 10/minute for auth endpoints and LLM calls. |
| Observability | Sentry for errors and performance tracing; pino JSON logs to stdout collected by Vercel logs; no separate OpenTelemetry backend. |
| Anything else | Rules 1–5 above; decide, log, continue. |

### 3.4 Write the documentation set

Create every file in Section 5, in that order, with all mandatory contents. Write the skeleton first (every file, every heading), then fill each file completely. Mermaid for all diagrams, tables for inventories, fenced code blocks for commands, schemas, and config.

### 3.5 Self-audit and fix

Run the Section 10 checklist against your own output and fix every failure. Write `docs/tech/COVERAGE.md`: the requirements register joined to build steps and tests, plus a **Gaps** section that must be empty — if it isn't, fix the docs until it is. Write `docs/tech/PROGRESS.md`: every phase and step as an unchecked checklist that build sessions tick off. Create `CLAUDE.md` per Section 11.

### 3.6 Produce the single-file edition

The folder is the source of truth; also generate one consolidated file for reading and sharing:
```bash
{ for f in docs/tech/00-README.md docs/tech/0[1-9]-*.md docs/tech/1[0-7]-*.md docs/tech/build-plan/phase-*.md docs/tech/DECISIONS.md docs/tech/COVERAGE.md; do cat "$f"; printf '\n\n---\n\n'; done; } > docs/TASSL-TECHNICAL-DOCUMENTATION.md
```
Verify it is non-empty and contains no `TBD`/`TODO`/`[EDIT ME]`/`<your-`:
```bash
grep -nE 'TBD|TODO|EDIT ME|<your-' docs/TASSL-TECHNICAL-DOCUMENTATION.md && echo "FIX THESE" || echo "clean"
```
Add `docs:build` to the scripts section of `04-repo-structure.md` so Phase 0 wires the same command into `package.json`.

### 3.7 Final report

End with a short report — no questions: files created with line counts; ADRs made; the ten decisions from `DECISIONS.md` most worth my awareness (I can override any of them later by editing `DECISIONS.md` and re-running the affected sections); and the exact sentence that starts the first build session:
`Read CLAUDE.md and docs/tech/build-plan/phase-00-bootstrap.md and execute Phase 0 step by step. Do not stop for input.`

## 4. Stack — fixed

| Layer | Decision | Notes |
|---|---|---|
| Language | TypeScript, `strict: true`, end-to-end | |
| Package manager | pnpm | Single app, not a monorepo |
| Framework | Next.js (App Router, React Server Components), latest stable | **Node.js runtime for all server code; no Edge runtime** |
| UI | Tailwind CSS + shadcn/ui (Radix primitives) | Tokens come from Impeccable's `DESIGN.md`, not shadcn defaults |
| Forms & validation | react-hook-form + Zod; the same Zod schemas validate on the server | |
| Data access pattern | Server Components read through services directly; UI mutations call Server Actions; REST route handlers under `/api/v1` expose every service for programmatic access, tests, and OpenAPI. Actions and handlers are thin wrappers over the same service functions. | |
| Backend architecture | Layered: `route handler / action → service → repository → DB`; one domain module per PRD feature area | No business logic in handlers, actions, or components |
| API conventions | OpenAPI 3.1 generated from the Zod schemas (`zod-openapi`, or Zod's built-in JSON Schema export if the pinned Zod version provides it); shared error envelope `{ error: { code, message, details?, requestId } }` | |
| Database | PostgreSQL: Neon (production and preview branches), Postgres in Docker Compose locally, Postgres service container in CI | |
| ORM & migrations | Drizzle ORM + drizzle-kit, `postgres` (postgres-js) driver everywhere, Neon pooled connection string in Vercel | Expand/contract migrations; never destructive in one release |
| Auth | Better Auth with its Drizzle adapter (email+password, Google OAuth, organizations plugin only if multi-tenant). If the Drizzle adapter is incompatible with the pinned Drizzle version at doc time, use Auth.js and record the ADR. | |
| Email | Resend + react-email; console transport in local/test | |
| Storage / Payments / Jobs / Realtime / Search | Per the Section 3.3 table | |
| Product analytics | PostHog (`posthog-js` client, `posthog-node` server) | Events spec in file 17 |
| LLM layer | Vercel AI SDK (`ai` + `@ai-sdk/openai-compatible`) behind an internal `LlmProvider` interface; MiMo-V2.5-Pro default; `mock` and one fallback provider | Section 8 |
| Errors / logs / tracing | Sentry (`@sentry/nextjs`, errors + tracing + release tagging); pino JSON logs; `/api/health` (liveness) and `/api/ready` (DB check) | |
| Testing | Vitest + Testing Library (unit/component) · Vitest + real Postgres (integration) · Playwright + `@axe-core/playwright` (E2E + accessibility) · MSW (HTTP mocking) · Lighthouse CI (web-vitals budgets) | Section 9 |
| Lint / format / types | ESLint (next + typescript-eslint) + Prettier; `tsc --noEmit`; an import-boundary rule enforcing the layering | |
| Git & CI/CD | GitHub Actions. PR: lint → typecheck → unit → integration → build → E2E → `impeccable detect` → Lighthouse CI → preview deploy. `main`: same checks → run migrations against production → `vercel deploy --prebuilt --prod` → smoke test → Sentry release. Conventional commits; protected `main` with required checks. If `git remote -v` shows no origin, Phase 0 creates a private GitHub repo with `gh repo create tassl --private --source=. --push`. | |
| Deployment | Vercel via the Vercel CLI in GitHub Actions (`vercel pull` → `vercel build` → migrate → `vercel deploy --prebuilt`), Neon branch per preview through the Vercel–Neon integration, nightly Neon backups plus a weekly restore drill documented as a runbook | |

## 5. Required documentation set

All files live in `docs/tech/`. Each file opens with a 2–3 line **Purpose / Read this when** header and a **Requirements covered** line listing IDs. Mandatory contents:

**`00-README.md` — How to use these docs with Claude Code**
- The operating procedure for every build session: read `CLAUDE.md` → read `PROGRESS.md` → read the current phase file and only the spec files it references → execute steps in order → run each step's Verify block → commit with the given message → tick the step in `PROGRESS.md` → stop at phase end and report.
- Builder rules: never skip a Verify block; never start the next phase with failing tests; never ask a human for a decision — apply `DECISIONS.md` and the Section 3.3 policy, log any new decision there, and continue; if a step's assumption turns out false, update `DECISIONS.md` and the affected spec before continuing.
- File map of `docs/tech/`, one line per file.

**`01-prd-analysis.md`** — per Section 3.1.

**`02-architecture.md`**
- C4-style Mermaid diagrams: system context, containers, backend component diagram (modules), frontend routing/layout tree.
- Request lifecycle for one typical read and one typical write (sequence diagrams) through auth check, validation, service, repository, DB, logging.
- Module boundaries: one domain module per PRD feature area with its public interface.
- Cross-cutting concerns: error model, validation, authorization, logging, config, i18n readiness, feature flags (all AI features behind `FEATURE_AI`).
- Non-functional targets derived from `NFR-###` (latency, availability, data retention, browser support), with concrete numbers.

**`03-adrs.md`** — per Section 3.2.

**`04-repo-structure.md`**
- Full directory tree with a one-line purpose per folder and key file: `src/app` (routes), `src/components/{ui,features}`, `src/server/modules/<feature>/{schema.ts,service.ts,repository.ts,router.ts,actions.ts}`, `src/server/db`, `src/server/llm/{providers,prompts}`, `src/lib`, `tests/{unit,integration,e2e}`, `evals/`, `scripts/`, `.github/workflows/`, `docs/`.
- Naming, import, and layering rules; error-handling conventions; commit message format; branch strategy; PR checklist; the full `package.json` scripts block (`dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `evals`, `db:generate`, `db:migrate`, `db:seed`, `docs:build`).

**`05-environment-config.md`**
- Table of every environment variable: name, purpose, example non-secret value or default, which environments require it, secret or not, where it is read in code, where a secret value is obtained. Include the full `.env.example` verbatim, with working local defaults so `pnpm dev` runs with `LLM_PROVIDER=mock`, console email, and local storage.
- Config loading with Zod validation at startup (fail fast); the client/server boundary (`NEXT_PUBLIC_` rule); secrets management and rotation on Vercel and Neon.

**`06-data-model.md`**
- ERD (Mermaid `erDiagram`) covering every `DATA-###` entity.
- Per table: columns with types, nullability, defaults, constraints, indexes (with the query each index serves), foreign keys, soft-delete and audit columns, timestamps.
- Migration policy, seed data (local/dev and E2E fixtures), backup and restore procedure.

**`07-api-spec.md`**
- Every endpoint: method, path, purpose, auth requirement and roles, request schema (Zod), response schema, error responses with codes, pagination/filtering/sorting conventions, rate limit, idempotency where relevant, one example request and response.
- Global conventions: versioning, content types, CORS, request IDs, timeouts.
- Full OpenAPI 3.1 document as `docs/tech/openapi.yaml`.

**`08-auth-authz.md`**
- Sign-up, sign-in, sign-out, reset, verification, invitation (if multi-tenant), and OAuth flows (sequence diagrams); session handling; CSRF posture; password policy; account deletion and data export.
- Role × action/resource permission matrix, and exactly how it is enforced in route handlers, server actions, and the UI.

**`09-frontend-spec.md`**
- Route map (App Router tree) with layouts, loading/error boundaries, auth guards, and the requirement IDs each route serves.
- Per screen from the screen inventory: purpose, data needed (which service/action/endpoint), component tree, all states (loading, empty, error, partial, success), validation and inline errors, responsive behavior per breakpoint, keyboard and screen-reader notes, analytics events fired.
- Design system spec: token set (color, type scale, spacing, radius, elevation, motion), typography choice, component inventory with variants, icon set, empty-state and error-illustration approach — consistent with the `DESIGN.md` Impeccable will produce in Phase 1.
- The Impeccable workflow (Section 7) embedded as concrete steps.
- Accessibility target WCAG 2.2 AA; performance budgets per file 16.

**`10-backend-spec.md`**
- Per domain module: responsibilities, entities owned, service functions with type signatures and business rules (from `FR-###`), repository functions, validation schemas, events emitted, error codes, edge cases.
- Cross-cutting: error-handling pattern, structured logging fields, request context, rate limiting, input sanitization, transaction boundaries, background jobs (if any), caching (if any), scheduled tasks (if any).

**`11-llm-integration.md`** — per Section 8.

**`12-security.md`**
- Threat model (STRIDE-lite) for Tassl's actual data and flows.
- Controls checklist mapped to OWASP Top 10 plus the LLM-specific risks: prompt injection, data leakage to the model provider, over-permissioned model actions, unbounded consumption/cost.
- Security headers (CSP, HSTS, etc.) with the exact header values, cookie settings, dependency audit and secret scanning in CI, PII handling and retention, audit logging of sensitive actions, incident-response basics.

**`13-observability-ops.md`**
- Logging (pino fields, levels, redaction of secrets/PII), Sentry setup and release tagging, health/readiness endpoints, the dashboards to create, alert thresholds tied to `NFR-###`.
- Runbooks: deploy, rollback (Vercel instant rollback + migration reversal), database migration, restore from Neon backup, rotate a secret, LLM provider outage.

**`14-testing-strategy.md`** — per Section 9.

**`15-cicd-deployment.md`**
- Complete GitHub Actions YAML for the PR workflow and the production workflow; required status checks; branch protection settings.
- Vercel and Neon setup with exact commands: project creation, environment variables, the Vercel–Neon integration for preview branches, migration on deploy, backups, rollback, the conditional custom-domain step keyed on `APP_DOMAIN`.
- Launch checklist: TLS on the active domain, backups verified by a restore, alerts on, Sentry receiving events, PostHog receiving events, load test done, security headers verified, legal pages reviewed by a human when PII is collected.

**`16-performance-a11y-budgets.md`**
- Core Web Vitals targets (LCP, INP, CLS), bundle-size budget, p95 API latency targets, DB query rules (no N+1, pagination everywhere), image and font strategy, caching strategy — and how each is measured in CI (Lighthouse CI, Playwright axe).

**`17-analytics-events.md`**
- Every PRD success metric (`AN-###`) mapped to concrete events: name, trigger, properties, owning screen; the typed event helper; privacy constraints.

**`build-plan/phase-NN-<slug>.md`** — one file per phase, in this order (merge or split only if the PRD clearly demands it):
- `phase-00-bootstrap.md` — repo init, tooling, lint/format/typecheck, Docker Compose Postgres, env loading, health endpoints, CI skeleton, GitHub repo (if missing), Vercel + Neon projects, and a **first deploy of a "hello" build to production so the pipeline is proven on day one**.
- `phase-01-design-foundation.md` — install Impeccable, `/impeccable init`, `PRODUCT.md` + `DESIGN.md` derived from the PRD's personas and voice, design tokens, base layout shell, typography, theme, shadcn set up against the tokens, a dev-only component gallery route (`/dev/components`) for visual review.
- `phase-02-data-layer.md` — schema, migrations, seed, repository layer, integration tests against Postgres.
- `phase-03-auth.md` — auth flows, sessions, RBAC, protected routes, email templates, tests.
- `phase-04-<feature>.md …` — one phase per domain module in PRD priority order (Must → Should → Could): backend service + API + tests → the module's screens through the Impeccable per-screen loop → E2E tests for its user flows.
- `phase-0N-cross-cutting-hardening.md` — observability, security headers, rate limiting, error pages, admin area, legal pages if needed, `/impeccable harden`, `/impeccable adapt`, `/impeccable optimize`, accessibility sweep, performance budgets enforced in CI.
- `phase-0N-llm-integration.md` — provider interface, MiMo adapter, prompt library, guardrails, evals, `FEATURE_AI` rollout, tests (Section 8).
- `phase-0N-release.md` — launch checklist execution, production promotion, monitoring verification, custom-domain step, post-launch runbook.

Each phase file has: goal, prerequisites, the ordered steps (Section 6 template), and **Phase exit criteria** — the exact commands that must pass (`pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e`) and the requirement IDs now fully implemented.

**`DECISIONS.md` · `COVERAGE.md` · `PROGRESS.md`** — as described in Section 3. There is no open-questions file; every gap is a resolved decision.

## 6. Mandatory step template

Every step in every phase file uses exactly this structure. A step must be small enough to complete and verify in a single Claude Code session (roughly ≤ 90 minutes of work — split anything larger). Angle-bracket tokens below are pattern variables: fill every one of them in every real step.

````markdown
### Step N.M — <imperative title>
**Goal:** one sentence.
**Covers:** FR-012, UI-004
**Prerequisites:** Step N.(M-1) complete; <services that must be running>
**Files to create / modify:**
- `src/server/modules/<feature>/service.ts` — create; exports `createX()`, `listX()`
- `src/app/(app)/<route>/page.tsx` — create
**Commands (in order, from repo root):**
```bash
pnpm add <pkg>@<pinned version>
```
**Implementation notes:** the exact behavior, type signatures, schemas, business rules, error codes, and edge cases the code must satisfy. Reference spec sections instead of duplicating them ("schema per 06-data-model.md §users").
**Secrets (if any):** `<ENV_VAR>` — obtained at <console URL/path>; non-secret default `<value>` lets Verify pass without it.
**Tests to write:**
- `tests/unit/<feature>/service.test.ts` — asserts: …
- `tests/integration/<feature>/api.test.ts` — asserts: …
**Verify (all must pass):**
```bash
pnpm typecheck && pnpm test -- tests/unit/<feature>
curl -s localhost:3000/api/health   # expect {"status":"ok"}
```
**Commit:** `feat(<scope>): <message>`
**Rollback:** exact command(s) to undo if verification fails (`git checkout -- .`, or the down-migration to run).
````

## 7. Impeccable workflow (mandatory for all UI work)

Impeccable is a single skill with a set of commands invoked as `/impeccable <command> [target]` inside Claude Code. The build plan must call it at the exact points below using the real command names. Before writing Phase 1, fetch https://github.com/pbakaus/impeccable (or run `/impeccable` if it is already installed) and use the command names the current version supports; if a command named below has been renamed, use its current name and log it in `DECISIONS.md`.

- **Phase 1, once:** `npx impeccable install --providers=claude --scope=project` (keep the design hook) → reload Claude Code → `/impeccable init`. Answer **product** for the app UI; run the **brand** lane as well only if the PRD includes a public marketing/landing surface. Feed the PRD's personas, purpose, voice, and constraints into `init` so `PRODUCT.md` and `DESIGN.md` describe Tassl, not a generic SaaS. Add the `# impeccable-ignore-start … # impeccable-ignore-end` block from the Impeccable README to `.gitignore`; keep `.impeccable/config.json`, `.impeccable/design.json`, and `.impeccable/critique/*.md` tracked.
- **Every new screen, inside its feature phase:** `/impeccable shape <screen>` (plan UX before code) → build against `DESIGN.md` → `/impeccable critique <screen>` → fix → `/impeccable audit <screen>` (a11y, performance, responsive) → fix → `/impeccable harden <screen>` (errors, overflow, edge cases) → `/impeccable polish <screen>` before the phase closes.
- **After the core screens exist:** `/impeccable onboard` for first-run flows and empty states; `/impeccable clarify <screen>` for UX copy per module.
- **Hardening phase:** `/impeccable adapt` (all devices) and `/impeccable optimize` (performance) across the app; `/impeccable extract` to pull repeated patterns into the design system.
- **CI gate:** `npx impeccable detect --json .` runs in the PR workflow and fails the build on findings unless waived in `.impeccable/config.json` with a stated reason.
- **Design rules the spec states explicitly** (Impeccable anti-patterns): no Inter/Arial/system-default fonts; no gray text on colored backgrounds; no pure black or pure gray (tint them); no cards nested in cards; no bounce/elastic easing; no generic purple-to-blue gradients.

## 8. LLM integration requirements (`11-llm-integration.md` + the LLM phase)

- **Provider abstraction:** an internal `LlmProvider` interface — `complete()`, `stream()`, `structured<T>(schema)`, and `embed()` only if the PRD needs retrieval — with three implementations selected by env: `openai-compatible` (used for MiMo), `mock` (deterministic, default everywhere until a key exists), and `anthropic` as the fallback. Switching providers requires only env changes: `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_TIMEOUT_MS`, `LLM_MAX_OUTPUT_TOKENS`.
- **MiMo-V2.5-Pro endpoint — verify at doc time, do not guess:** Xiaomi's API platform exposes the model under the tag `mimo-v2.5-pro` on an OpenAI-compatible chat-completions API. While writing `11-llm-integration.md`, fetch Xiaomi's official MiMo API documentation and record the exact base URL, auth header, streaming support, and whether tool calling and JSON-schema-enforced output are supported. If the official base URL cannot be verified, set the documented default to OpenRouter's OpenAI-compatible endpoint `https://openrouter.ai/api/v1` with model `xiaomi/mimo-v2.5-pro`, and log that in `DECISIONS.md`. Either way, design so that **native tool calling is never required**: structured-output prompting + Zod validation + one automatic repair retry.
- **Prompt library:** every prompt lives in `src/server/llm/prompts/<name>.ts` with a version, purpose, input schema, output schema, and examples. Untrusted text (user input, documents) is always inserted through a template with explicit delimiters, never raw-concatenated.
- **Guardrails:** input length limits; PII minimization/redaction before anything is sent to a third-party model; prompt-injection defenses for untrusted text; output validation; content-policy handling; per-user daily and global monthly token/cost budgets with hard stops (concrete numbers in the doc); timeouts; retries with backoff; circuit breaker; graceful degradation (the feature is usable or clearly disabled when the provider is down).
- **Observability:** per call, log model, prompt version, latency, token usage, cost estimate, and outcome (never raw PII); a Sentry/PostHog panel for LLM cost and error rate.
- **Evals:** `evals/` with a golden dataset per AI feature (inputs + expected properties of outputs), a `pnpm evals` script that runs against the mock provider in CI and against the real provider locally when a key is set, with a pass threshold.
- **Rollout:** every AI feature behind `FEATURE_AI`; the app is fully functional with `LLM_PROVIDER=mock`, so all earlier phases ship without an API key.

## 9. Testing requirements (`14-testing-strategy.md` + every step)

- The test pyramid and what belongs at each level; tooling and config for each (Vitest config, Playwright config with a seeded test database, MSW handlers, factories and fixtures).
- Coverage gates: ≥ 80% lines on `src/server/**`; ≥ 70% on `src/components/**`; 100% of API endpoints covered by an integration test; 100% of PRD user flows covered by an E2E test; every screen has at least one Playwright axe accessibility test.
- Conventions: file naming, arrange-act-assert, no network in unit tests, integration tests against a real Postgres (Docker Compose locally, service container in CI) with per-test rollback or truncation.
- Test data: seed and factory design, deterministic IDs, frozen time.
- Every step's **Tests to write** and **Verify** blocks must be consistent with this file.

## 10. Quality bar — self-audit checklist (fix every failure before reporting)

- [ ] Every PRD requirement has an ID, a `COVERAGE.md` row, ≥ 1 build step, and ≥ 1 test.
- [ ] Every screen in the inventory has a section in `09-frontend-spec.md` and a build step with the Impeccable loop.
- [ ] Every entity has a table definition, a migration step, repository functions, and tests.
- [ ] Every endpoint has schemas, auth rules, error codes, an integration test, and an entry in `openapi.yaml`.
- [ ] Every env var appears in `05-environment-config.md` and `.env.example`, with a working non-secret default.
- [ ] Every step follows the Section 6 template with a non-empty Verify block; `grep -rnE 'TBD|TODO|EDIT ME|<your-|as needed|configure appropriately' docs/tech` returns nothing.
- [ ] No step requires a human decision; every decision made is in `DECISIONS.md` with a rationale and a reversal note; no row is marked pending.
- [ ] All package versions are pinned and were verified with `npm view`.
- [ ] Phases depend only on earlier phases; the first production deploy happens in Phase 0; the app is fully usable with the mock provider before the LLM phase; the LLM phase is last before release.
- [ ] Runbooks exist for deploy, rollback, migration, backup restore, secret rotation, and LLM provider outage.
- [ ] Diagrams are valid Mermaid; tables render; no file exceeds ~1,200 lines (split and cross-link if it does).
- [ ] `docs/TASSL-TECHNICAL-DOCUMENTATION.md` was generated and passes the Section 3.6 grep.

## 11. `CLAUDE.md` contents

Create `CLAUDE.md` at the repo root (merge if one exists) with: a 3-line product summary; the stack summary; the commands (`pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm evals`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm docs:build`); the layering and naming rules; the error and validation conventions; the Impeccable rules from Section 7; the instruction "read `docs/tech/00-README.md` before doing any task"; the rule "never ask a human for a decision — apply `docs/tech/DECISIONS.md` and its policy, log new decisions there, continue"; and the build-session procedure from `00-README.md`. Keep it under 150 lines and link to `docs/tech/` for detail.

---

Begin with Section 3.1 now. Do not stop for confirmation at any point; run Sections 3.1 through 3.7 in one pass and stop only when the final report is written.
