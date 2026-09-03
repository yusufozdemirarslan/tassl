# 03 — Architecture Decision Records

**Purpose / Read this when:** you need to know why the architecture is shaped the way it is, what was rejected, and how to reverse a choice. Read before proposing a structural change.

**Requirements covered:** cross-cutting; each ADR lists affected IDs.

Format: Context → Options considered → Decision → Consequences → Requirement IDs affected → How to reverse.

---

## ADR-001 Stack confirmation

**Context.** The generation prompt fixes the stack (TypeScript strict, pnpm, Next.js App Router with RSC on the Node runtime, Tailwind + shadcn/ui, react-hook-form + Zod, Drizzle + postgres-js, Better Auth, Resend, PostHog, Vercel AI SDK, Sentry + pino, Vitest + Playwright + MSW + Lighthouse CI, ESLint + Prettier, GitHub Actions, Vercel + Neon). Versions must be the latest stable verified with `npm view` on 2026-09-02.

**Options considered.** (1) Take every `latest` tag as-is. (2) Take `latest` except where a peer-dependency range in the toolchain excludes it. (3) Pin to an older "known good" set.

**Decision.** Option 2. Versions: `next@16.3.4`, `react@19.2.8`, `react-dom@19.2.8`, `typescript@6.0.3` (see ADR-014), `tailwindcss@4.3.3`, `@tailwindcss/postcss@4.3.3`, `postcss@8.5.26`, `zod@4.5.4`, `react-hook-form@7.87.0`, `@hookform/resolvers@5.9.1`, `drizzle-orm@0.45.2`, `drizzle-kit@0.31.10`, `postgres@3.4.9`, `better-auth@1.7.2`, `@better-auth/drizzle-adapter@1.7.2`, `resend@6.25.0`, `react-email@6.9.3`, `@react-email/components@1.0.12`, `@react-email/render@2.1.0`, `posthog-js@1.425.1`, `posthog-node@5.51.6`, `ai@7.0.91`, `@ai-sdk/openai-compatible@3.0.43`, `@ai-sdk/anthropic@4.0.49`, `@ai-sdk/react@4.0.94`, `@sentry/nextjs@10.73.0`, `pino@10.3.1`, `pino-pretty@13.1.3`, `vitest@4.1.11`, `@vitest/coverage-v8@4.1.11`, `vite@8.2.2`, `@vitejs/plugin-react@6.1.1`, `vite-tsconfig-paths@6.1.1`, `@testing-library/react@16.3.3`, `@testing-library/dom@10.4.1`, `@testing-library/jest-dom@7.0.1`, `@testing-library/user-event@14.6.7`, `jsdom@30.0.1`, `@playwright/test@1.62.1`, `@axe-core/playwright@4.13.0`, `msw@2.15.0`, `@lhci/cli@0.15.1`, `eslint@10.9.1`, `eslint-config-next@16.3.4`, `typescript-eslint@8.69.0`, `eslint-plugin-boundaries@7.2.0`, `eslint-config-prettier@10.1.8`, `prettier@3.9.6`, `prettier-plugin-tailwindcss@0.8.1`, `zod-openapi@6.0.2`, `pg-boss@12.29.0`, `shadcn@4.20.1` (CLI), `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.6.0`, `lucide-react@1.39.0`, `tw-animate-css@1.4.0`, `next-themes@0.4.6`, `sonner@2.0.8`, `recharts@3.10.1`, `tsx@4.23.13`, `dotenv@17.4.2`, `yaml@2.9.0`, `husky@9.1.7`, `lint-staged@17.4.1`, `@commitlint/cli@21.2.2`, `@commitlint/config-conventional@21.2.2`, `@faker-js/faker@10.6.0`, `date-fns@4.4.0`, `server-only@0.0.1`, `@types/node@26.4.1`, `@types/react@19.2.18`, `@types/react-dom@19.2.5`, `vercel@59.11.2` (CLI), `neon@4.14.0` (CLI), `impeccable@3.6.1` (CLI), `@sentry/wizard@7.0.3`, `auth@1.7.2` (Better Auth CLI). Node 24 LTS, pnpm 11.25.0, Postgres 17.

**Consequences.** Next 16 means `proxy.ts` (not `middleware.ts`), no `next lint` (ESLint CLI), `after()` stable, Node runtime by default. AI SDK 7 means `generateText` with `Output.object` for structured output. Better Auth 1.7 means the Drizzle adapter is the separate package `@better-auth/drizzle-adapter` and the CLI is `npx auth`.

**Requirement IDs affected.** All.

**How to reverse.** Re-run the `npm view` sweep and update `04-repo-structure.md` §Versions and every `pnpm add` line in the phase files.

## ADR-002 Deployment: Vercel + Neon

**Context.** Fixed input: Vercel + Neon, environments local (Docker Compose Postgres), preview (one per PR on a Neon branch), production; no staging.

**Options considered.** (1) Vercel + Neon with the Vercel CLI in GitHub Actions. (2) Docker Compose on a VPS behind Cloudflare Tunnel (rejected alternative the prompt asks to record). (3) Vercel Git integration auto-deploys without Actions.

**Decision.** Option 1. GitHub Actions runs the gate order, then `vercel pull` → `vercel build` → migrate → `vercel deploy --prebuilt`. Production database provisioned through the Neon Marketplace integration (env injection); preview branches created by the PR workflow with Neon's GitHub Action so migrations run before the deployment exists (DECISIONS D-071). Vercel Git auto-deploys disabled with `"git": { "deploymentEnabled": false }` in `vercel.json` so there is one deploy path.

**Consequences.** Every deploy is reproducible from CI; previews are protected by Vercel Authentication; cron on Hobby is daily (jobs use `after()` for immediacy, ADR-007). Function duration cap 300 s on Hobby.

**Rejected alternative and migration note.** Docker Compose on a VPS behind Cloudflare Tunnel would run `next start` plus Postgres and a pg-boss worker on one machine. It gives a persistent worker and no function limits, at the cost of patching, backups, and TLS on the operator. To migrate later: build the same Next app into a container (`output: 'standalone'`), run `docker compose up` with the existing `compose.yaml` extended with the app service and a `cloudflared` sidecar, point `DATABASE_URL` at the local Postgres, run `pnpm db:migrate`, restore the latest `pg_dump` from the backup workflow, and replace the cron with the worker process. No code changes are required because all server code already targets the Node runtime.

**Requirement IDs affected.** INT-001, INT-002, SYS-017, NFR-007, NFR-015.

**How to reverse.** Follow the migration note.

## ADR-003 Auth library: Better Auth with the Drizzle adapter

**Context.** Fixed input: Better Auth with its Drizzle adapter, organizations plugin if multi-tenant; fall back to Auth.js if the adapter is incompatible with the pinned Drizzle.

**Options considered.** (1) Better Auth 1.7.2 + `@better-auth/drizzle-adapter@1.7.2` (peer `drizzle-orm ^0.45.2 || >=1.0.0-rc.1`), with the `organization` plugin. (2) Auth.js. (3) Hand-rolled sessions.

**Decision.** Option 1; the adapter is compatible with `drizzle-orm@0.45.2`. Plugins: `organization` (with a custom access-control statement for the PRD roles), `nextCookies`. Rate limiting stored in the database. Sessions 30-day rolling.

**Consequences.** Auth tables are generated by `npx auth generate` into `src/server/db/schema/auth.ts`; additional user columns are declared through `additionalFields`. Route handler at `src/app/api/auth/[...all]/route.ts`. Organization = institution.

**Requirement IDs affected.** SYS-001 to SYS-005, FR-230, DATA-001 to DATA-007.

**How to reverse.** Replace `src/server/auth/*` with Auth.js; keep the `identity` service interface (`getCurrentUser`, `requireRole`) unchanged.

## ADR-004 API style: services first, REST + Server Actions as thin wrappers, OpenAPI from Zod

**Context.** Fixed input: RSC read through services; UI mutations via Server Actions; REST route handlers under `/api/v1` for every service; OpenAPI 3.1 from Zod.

**Options considered.** (1) As fixed, with `zod-openapi`. (2) tRPC. (3) GraphQL.

**Decision.** Option 1. Every module exports `schema.ts` (Zod), `service.ts`, `repository.ts`, `router.ts` (route handlers), `actions.ts` (server actions). `zod-openapi@6.0.2` builds the document from the router registrations; `pnpm openapi:generate` writes `docs/tech/openapi.yaml`.

**Consequences.** One validation source; programmatic access and tests hit the same code as the UI. Error envelope `{ error: { code, message, details?, requestId } }`.

**Requirement IDs affected.** SYS-019, SYS-022, all FR with endpoints.

**How to reverse.** Routers are isolated; another transport can wrap the same services.

## ADR-005 ORM: Drizzle 0.45 stable, expand/contract migrations

**Context.** Drizzle has a `1.0.0-rc` line; Better Auth supports both.

**Options considered.** (1) `drizzle-orm@0.45.2` + `drizzle-kit@0.31.10` (latest stable). (2) `1.0.0-rc.4`. (3) Prisma.

**Decision.** Option 1. Migrations generated by `drizzle-kit generate`, applied by `drizzle-kit migrate` (local, CI, and the production workflow). Expand/contract: add nullable → backfill → constrain → drop in a later release. Never destructive in one release.

**Consequences.** Relational queries v1 API; upgrade to Drizzle 1.0 later is a code change, not a data migration.

**Requirement IDs affected.** All DATA IDs.

**How to reverse.** Upgrade path documented by Drizzle; the repository layer isolates queries.

## ADR-006 Multi-tenancy: institution as organization, tenant column everywhere

**Context.** PRD names institutions, departments, courses, sections.

**Options considered.** (1) Organization plugin tables as the tenant, `organization_id` on tenant-scoped tables, repository-enforced. (2) Schema-per-tenant. (3) Single tenant.

**Decision.** Option 1 (DECISIONS D-006). Repositories take `tenantId` as the first argument of every tenant-scoped query; a lint rule forbids importing `db` outside repositories.

**Consequences.** Platform roles (`tassl_scenario_editor`, `admin`) cross tenants under explicit checks (data agreement gate for identified records, D-055).

**Requirement IDs affected.** DATA-005 to DATA-011, FR-230, FR-234.

**How to reverse.** Drop the column and the argument; not planned.

## ADR-007 Background jobs: pg-boss with a serverless drain

**Context.** Scenario generation (multi-step, minutes) and scoring (LLM reads) outlive a request; Vercel has no persistent worker; Hobby cron runs once a day.

**Options considered.** (1) pg-boss 12 with `after()` kick + cron sweep + local worker. (2) Vercel Workflows or Queues (vendor-specific). (3) A hand-written jobs table.

**Decision.** Option 1 (DECISIONS D-012). Queues: `generate_package_step`, `score_run`, `send_email`, `purge_deleted_accounts`, `recompute_exports`. Each queue: `retryLimit 3`, `retryDelay 30`, `retryBackoff true`, `expireInSeconds 280`, dead-letter queue `<name>_dead`.

**Consequences.** pg-boss brings the `pg` driver alongside postgres-js (accepted). Timers that the PRD defines (Turn delay, clock expiry, window expiry) do not use jobs; they are lazy materializations (D-043, D-044).

**Requirement IDs affected.** AI-001, FR-130, SYS-020, SYS-027, NFR-001.

**How to reverse.** Replace `src/server/jobs/boss.ts` with another queue behind the same `enqueue(name, payload)` and `drain()` functions.

## ADR-008 Realtime: none; polling

**Context.** Turn arrival, clock, and paused state must reach the browser.

**Options considered.** (1) Polling every 5 s. (2) SSE. (3) WebSockets.

**Decision.** Option 1 (D-013). All timers are server timestamps; the client renders countdowns from them.

**Consequences.** Observation delay ≤ 5 s (NFR-002); no long-lived connections on serverless.

**Requirement IDs affected.** FR-110, FR-113, FR-105, NFR-002.

**How to reverse.** Add an SSE route.

## ADR-009 Storage and payments: none in the build

**Context.** See D-010 and D-011.

**Decision.** No object storage, no payments.

**Consequences.** One fewer vendor and secret each; seed case is pasted text.

**Requirement IDs affected.** FR-190, FR-236.

**How to reverse.** Add `StorageDriver` (local/R2) and Stripe.

## ADR-010 Email: Resend + react-email, console transport locally

**Decision.** `src/server/email/transport.ts` with `console` and `resend` implementations selected by `EMAIL_TRANSPORT`; templates in `src/server/email/templates/*.tsx`; all sends go through the `send_email` job.

**Requirement IDs affected.** SYS-001, SYS-005, SYS-010.

**How to reverse.** Add a transport.

## ADR-011 Analytics: PostHog client and server

**Decision.** `posthog-js` in `instrumentation-client.ts` with a reverse proxy at `/ingest`; `posthog-node` in `src/server/analytics/posthog.ts`; a typed `track(event, props)` helper generated from `17-analytics-events.md`. No-op without keys.

**Requirement IDs affected.** AN-001 to AN-005.

## ADR-012 Rate limiting: Postgres sliding window in the service layer

**Decision.** `rate_limit_buckets(key, window_start, count)` with two-window weighting; `enforceRateLimit(key, limit, windowMs)` called from services; limits in D-026. Better Auth's own database rate limiter covers `/api/auth/*`.

**Requirement IDs affected.** SYS-012, NFR-011.

## ADR-013 LLM provider abstraction

**Context.** Fixed input: Vercel AI SDK behind an internal `LlmProvider` interface; MiMo default; mock and Anthropic fallback; native tool calling never required.

**Options considered.** (1) `LlmProvider { complete, stream, structured }` implemented by `openai-compatible` (MiMo through `createOpenAICompatible`), `anthropic`, and `mock`; structured = prompt-enforced JSON + Zod + one repair retry. (2) Direct `fetch` against the chat completions API. (3) LangChain.

**Decision.** Option 1 (D-028, D-029, D-063). `embed()` is not implemented because the PRD needs no retrieval.

**Consequences.** Prompts live in `src/server/llm/prompts/<name>.ts` with version, purpose, input and output schemas, and examples. Every call is logged to `llm_calls`. Budgets and a circuit breaker wrap the provider.

**Requirement IDs affected.** AI-001 to AI-005, INT-007, INT-008, DATA-049.

**How to reverse.** Add a provider file; change `LLM_PROVIDER`.

## ADR-014 TypeScript 6.0.3 rather than 7.0.2

**Context.** See D-003.

**Decision.** Pin 6.0.3.

**Consequences.** Full toolchain compatibility; bump when typescript-eslint supports 7.

## ADR-015 Observability: Sentry + pino, no OpenTelemetry backend

**Decision.** `@sentry/nextjs` with tracing (10 percent sample in production, 100 percent in preview), release = git SHA, source maps uploaded in the production workflow; pino JSON to stdout with redaction paths; request id propagation; `/api/health` and `/api/ready`.

**Requirement IDs affected.** SYS-014, NFR-016, SYS-009.

## ADR-016 Scenario package storage: normalized element tables per immutable version

**Context.** The package has ~15 element kinds, element-by-element confirmation, versioning where a version in use is never altered, and claims referenced by run events.

**Options considered.** (1) Normalized tables keyed by `package_version_id` with per-element confirmation rows and a derived JSON snapshot on the version. (2) One JSONB document per version. (3) Event-sourced package.

**Decision.** Option 1. Claims have stable UUIDs; per-variant attributes live in `variant_claim_states`. `package_versions.snapshot` (JSONB) is written at confirmation for the package view and for import/export. A trigger refuses element updates once the version is confirmed (NFR-004).

**Consequences.** Referential integrity from `run_claims.claim_id`; queryable confirmation measures (FR-198).

**Requirement IDs affected.** DATA-012 to DATA-027, FR-190 to FR-199.

**How to reverse.** The snapshot format is the export format; a JSONB-only design could read it.

## ADR-017 Run trace: append-only event table plus write-through read models

**Context.** "Every graph is plotted from the trace and nothing else."

**Decision.** `run_events(run_id, seq, occurred_at, clock_remaining_ms, type, payload)` is the source of truth; read models (`run_claims`, `run_frames`, …) are written in the same transaction for queries and constraints; graph builders and the exporter read events only. A property test regenerates graphs from an export and compares.

**Requirement IDs affected.** FR-007, FR-240 to FR-243, NFR-005.

## ADR-018 Scoring engine: deterministic categorical pass, model reads, versioned rubric

**Decision.** `scoreRun(events, packageVersion, rubric)` → graphs (pure) → categorical facts → five model reads (AI-003) → seven bands with evidence; points computed separately from confirmed bands (FR-202). Rubric v1 in code (D-033).

**Requirement IDs affected.** FR-130 to FR-143, FR-202.

## ADR-019 Timers without a scheduler: lazy materialization

**Decision.** Turn delivery, clock expiry auto-lock, and window expiry are materialized on read with exact authored timestamps (D-043, D-044).

**Requirement IDs affected.** FR-105, FR-110, FR-113, NFR-002.

## ADR-020 Preview database branching in CI, not by the integration

**Decision.** D-071.

**Requirement IDs affected.** INT-001, SYS-017.

## ADR-021 Charts: recharts with mandatory data tables

**Decision.** D-074; every graph component exposes `data_table` and `description`.

**Requirement IDs affected.** FR-132 to FR-136, FR-212, NFR-006.
