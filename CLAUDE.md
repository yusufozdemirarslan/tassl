# CLAUDE.md — Tassl

## Product
Tassl is the AI decision simulator for higher education: students make a consequential business decision with an AI assistant in the room, take a stance on every consequential claim, lock an irreversible decision under a clock, respond to a Turn, and defend the result unaided. Tassl records the run as a trace, plots four graphs, drafts seven bands, and the instructor confirms them; the course maps confirmed bands to points. The build is one vertical slice of one Decision Run, accepted by the walkthrough in the PRD (`docs/prd/Tassl-PRD.md` §12).

## Stack
TypeScript strict · pnpm 11 · Node 24 · Next.js 16 App Router (Node runtime only, `proxy.ts`, Server Actions) · Tailwind 4 + shadcn/ui themed by `DESIGN.md` · react-hook-form + Zod 4 · Drizzle + postgres-js on Postgres 17 (Docker locally, Neon in preview/production) · Better Auth (email+password, Google, organizations) · Resend + react-email · pg-boss jobs · Vercel AI SDK 7 behind `LlmProvider` (`mock` default; MiMo-V2.5-Pro via OpenAI-compatible API; Anthropic fallback) · Sentry + pino · PostHog · Vitest, Testing Library, Playwright + axe, MSW, Lighthouse CI · ESLint (boundaries) + Prettier · GitHub Actions → Vercel CLI.

## Before any task
Read `docs/tech/00-README.md`. Then `docs/tech/PROGRESS.md` to find the current step, then the phase file and only the spec files it references.

## Commands
```
pnpm dev                 # next dev (needs: docker compose up -d --wait; cp .env.example .env)
pnpm lint                # eslint + prettier check
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest unit (jsdom)
pnpm test:integration    # vitest against Postgres (TEST_DATABASE_URL)
pnpm test:e2e            # playwright (builds, seeds, starts the app)
pnpm evals               # AI evals (mock in CI; real provider locally with a key)
pnpm db:generate | db:migrate | db:seed | db:reset -- --dev
pnpm openapi:generate | openapi:check
pnpm jobs:worker         # local pg-boss worker
pnpm docs:build          # regenerate docs/TASSL-TECHNICAL-DOCUMENTATION.md
```

## Build-session procedure
1. Read `CLAUDE.md`, `docs/tech/PROGRESS.md`, the current phase file, and its referenced specs.
2. Execute steps in order. Each step: create the listed files, run the commands, write the tests, run the **Verify** block and read its output.
3. Commit with the step's message on the phase branch (`feat/<phase>-<slug>`); `main` is protected, so land work with `gh pr create --fill` and `gh pr merge --squash --auto --delete-branch` after the ten checks pass. Tick the step in `PROGRESS.md` and commit (`chore(progress): tick step N.M`).
4. At the phase end run the exit criteria, then stop and report: steps done, tests passing, decisions added.
Never skip a Verify block. Never start the next phase with failing tests.

## Decisions
Never ask a human for a decision. Apply `docs/tech/DECISIONS.md` and its Decision Policy (PRD intent → production safety → fewest moving parts → most standard option → reversibility), append a `D-NNN` row for anything new, and continue. If a step's assumption is false, fix the decision and the spec before continuing. The only human inputs are secret values; every step names the env var, where to get it, and the non-secret default that lets Verify pass without it.

## Layering and naming
`route handler / server action / server component → service → repository → db`. No business logic in handlers, actions, or components. Modules live in `src/server/modules/<name>/{schema,service,repository,router,actions,index,errors}.ts`; import other modules only through `index.ts`; only repositories import `src/server/db/client`; `src/lib` never imports `src/server`; components import module `schema` types and `actions` only. Every tenant-scoped repository function takes `tenantId` first. DB `snake_case`; TS `camelCase`; files and routes `kebab-case`; env vars and error codes `SCREAMING_SNAKE_CASE`; API under `/api/v1`. Every UI string goes through `t()` from `src/lib/i18n/en-US.ts`.

## Errors and validation
Services throw `AppError(code, message, { status, details })` from `src/lib/errors.ts`. Routes use `defineRoute`, actions use `defineAction` (`src/server/http`); both validate with the module's Zod schema and return the envelope `{ error: { code, message, details?, requestId } }`. Actions return `ActionResult<T>` and never throw to the client. One Zod schema per input, shared by form, action, and route. Word limits via `wordLimit(n)`; run free text is markup-stripped. Every run mutation appends a trace event in the same transaction; locked frames, briefs, Turn responses, and confirmed package versions are immutable.

## Impeccable (mandatory for all UI)
Installed with `npx impeccable@3.6.1 install --providers=claude --scope=project`; `/impeccable init` wrote `PRODUCT.md`; `DESIGN.md` records the tokens from `docs/tech/09-frontend-spec.md` §2 (IBM Plex Sans/Mono/Serif; cool paper `#F6F7F9`, tinted ink `#141A26`, deep teal primary `#0F6E74`; 4 px spacing; radii 2/6/10; ease-out 150–200 ms). Every new screen: `/impeccable shape <route>` → build against `DESIGN.md` → `/impeccable critique` → fix → `/impeccable audit` → fix → `/impeccable harden` → `/impeccable polish` before the phase closes. After core screens: `/impeccable onboard`, `/impeccable clarify`. Hardening phase: `/impeccable adapt`, `/impeccable optimize`, `/impeccable extract`. CI runs `npx impeccable@3.6.1 detect --json .` through `scripts/impeccable-gate.mjs`; waivers only via `detector.ignore*` in `.impeccable/config.json` with a reason. When Impeccable asks a taste or direction question, answer "Operate; follow DESIGN.md and 09-frontend-spec.md §2". Rules: no Inter/Arial/system fonts; no gray text on colored backgrounds; no pure black or gray; no cards inside cards; no bounce easing; no gradients.

## Product invariants to protect
- Students never see warranted stances, evidence status, failure families, planted flags, or verification results before their run is scored; never the question bank, expected-answer notes, the seed record, or other students' runs (`src/server/auth/student-view.ts`).
- Nothing Tassl observes is treated as misconduct; no composite score, rank, or percentile anywhere; the assistant never reveals defect status; declaring outside-tool use never affects scoring.
- `FEATURE_AI=false` forces the mock provider; the app must be fully usable with no API key.
- Timers are server timestamps materialized lazily on read; the client only polls and displays.

## Where to look
`docs/tech/01-prd-analysis.md` (requirement IDs) · `06-data-model.md` (tables) · `07-api-spec.md` + `openapi.yaml` (endpoints) · `08-auth-authz.md` (permission matrix) · `09-frontend-spec*.md` (screens) · `10-backend-spec*.md` (modules, events, rules) · `11-llm-integration.md` (provider, prompts, guardrails) · `12`–`17` (security, ops, testing, CI/CD, budgets, analytics) · `build-plan/` (phases) · `DECISIONS.md` · `COVERAGE.md` · `PROGRESS.md`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
