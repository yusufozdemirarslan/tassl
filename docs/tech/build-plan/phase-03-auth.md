# Phase 3 — Authentication, Tenancy, and Roles

**Purpose / Read this when:** the schema exists (Phase 2) and people must be able to sign up, verify, sign in, reset passwords, use Google, belong to institutions, accept invitations, manage their account, and be authorized by role everywhere.

**Requirements covered:** SYS-001 to SYS-005, SYS-011 (audit helper), SYS-021, SYS-028, FR-230, FR-234, FR-221, UI-001 to UI-005, UI-008 (data wiring), UI-009 (base), UI-010, DATA-052, NFR-009 (purge), NFR-011 (auth part); decisions D-007, D-008, D-009, D-021, D-055, D-093, D-097.

## Goal

Complete authentication and authorization: Better Auth flows with email templates, the permission matrix enforced by helpers and proven by the auth matrix test, institution membership and invitations, account settings with export and deletion, and the audit helper.

## Prerequisites

- Phase 2 exit criteria pass.
- Read `08-auth-authz.md`, `10-backend-spec-modules.md` §1–2, `09-frontend-spec-screens.md` §Public and §Shell.

## Steps

### Step 3.1 — Email module: transport, templates, `send_email` job
**Goal:** Emails render from react-email templates and are delivered by the console transport locally and Resend in production, through the job queue.
**Covers:** SYS-001 (emails), SYS-005 (invitation email), SYS-010 (transport), INT-003
**Prerequisites:** Phase 2 complete
**Files to create / modify:**
- `src/server/email/transport.ts` — create; `EmailTransport` interface, `consoleTransport` (logs subject, to, and the text body at `info`), `resendTransport` (Resend SDK), `getTransport()` by `EMAIL_TRANSPORT`
- `src/server/email/templates/{verify-email,reset-password,invitation,notification,incident-notice}.tsx` — create; react-email components using `t()` strings and the token palette (plain, no images)
- `src/server/email/send.ts` — create; `sendEmail({ to, template, props })` renders with `@react-email/render` and enqueues `send_email`; `deliver` job handler calls the transport
- `src/server/jobs/handlers/send-email.ts` — create; registered in the handler registry
**Commands (in order, from repo root):**
```bash
pnpm add resend@6.25.0 @react-email/components@1.0.12 @react-email/render@2.1.0
pnpm add -D react-email@6.9.3
```
**Implementation notes:** Resend `from` is `EMAIL_FROM`; failures throw so pg-boss retries (3 attempts, backoff). `pnpm email:dev` previews templates on port 3001.
**Secrets (if any):** `RESEND_API_KEY` — https://resend.com/api-keys; non-secret default: empty with `EMAIL_TRANSPORT=console`.
**Tests to write:**
- `tests/unit/email/templates.test.tsx` — each template renders its props and contains the link.
- `tests/integration/email/send.test.ts` — `sendEmail` enqueues; draining delivers through the console transport (spy on the logger).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/email && pnpm test:integration -- tests/integration/email
```
**Commit:** `feat(email): transports, react-email templates, send_email job`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 3.2 — Better Auth wiring: route handler, client, session helpers, permissions
**Goal:** Auth endpoints are mounted; server session helpers and every permission helper from `08-auth-authz.md` §5 exist.
**Covers:** SYS-001, SYS-002, INT-004, FR-221, FR-230, FR-234, FR-236, SYS-028
**Prerequisites:** Step 3.1 complete
**Files to create / modify:**
- `src/server/auth/auth.ts` — modify; the full config from `08-auth-authz.md` §1 (emails via `sendEmail`, Google when configured, rate limit storage `database`, organization plugin with `ac`/`roles`)
- `src/app/api/auth/[...all]/route.ts` — create
- `src/lib/auth-client.ts` — create
- `src/server/auth/session.ts` — create; `import 'server-only'`; `getSession()`, `requireSession()`
- `src/server/auth/permissions.ts` — create; every helper in `08-auth-authz.md` §5
- `src/server/modules/tenancy/{schema,service,index}.ts` — create; `listMyInstitutions`, `setActiveInstitution`, `requireMembership`, `canReadIdentifiedRecords`, `getInstitutionSettings`, `updateInstitutionSettings`, `upsertDataAgreement`, `listDataAgreements`, `createInstitution` (admin), `inviteMember`, `acceptInvitation`
- `src/server/modules/admin/{service,index}.ts` — create; `audit()` helper only (the admin screens arrive in Phase 13)
- `src/server/http/define-route.ts` — modify; `auth: 'session'` uses `requireSession()`; add the `X-Requested-With` CSRF check for non-GET cookie requests
- `src/proxy.ts` — modify; optimistic redirect for `(app)` paths using `getSessionCookie`
**Commands (in order, from repo root):**
```bash
pnpm db:generate && pnpm db:migrate
```
(Regenerate the auth schema first if the config changed: `npx auth@1.7.2 generate --adapter drizzle --dialect pg --config src/server/auth/auth.ts --output src/server/db/schema/auth.ts -y`.)
**Implementation notes:** Deleted users are treated as signed out (`requireSession` checks `deleted_at`). `canReadIdentifiedRecords` per D-055. `createInstitution` creates the organization through `auth.api.createOrganization` as the admin, inserts `institution_settings`, and adds the program lead member. Invitations expire after 7 days.
**Secrets (if any):** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web), redirect `${NEXT_PUBLIC_APP_URL}/api/auth/callback/google`; non-secret default: empty (button hidden, D-097).
**Tests to write:**
- `tests/integration/auth/flows.test.ts` — sign-up creates an unverified user; sign-in before verification returns `EMAIL_NOT_VERIFIED`; verification token signs in; reset revokes sessions; rate limit on `/sign-in/email` after 10 attempts.
- `tests/integration/auth/permissions.test.ts` — each helper's allow and deny cases with factory users.
- `tests/integration/tenancy/agreements.test.ts` — `canReadIdentifiedRecords` false without an agreement, true with an active one, false after `ends_at`.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test:integration -- tests/integration/auth tests/integration/tenancy
```
**Commit:** `feat(auth): better auth wiring, session and permission helpers, tenancy service`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 3.3 — Identity module: me, profile, export, deletion, purge job
**Goal:** `/api/v1/me` endpoints and the purge job exist.
**Covers:** SYS-003, SYS-004, NFR-009, D-093
**Prerequisites:** Step 3.2 complete
**Files to create / modify:**
- `src/server/modules/identity/{schema,service,repository,router,actions,index,errors}.ts` — create; `10-backend-spec-modules.md` §1
- `src/app/api/v1/me/route.ts`, `src/app/api/v1/me/export/route.ts`, `src/app/api/v1/me/assignments/route.ts` (returns an empty page until Phase 4), `src/app/api/v1/me/runs/route.ts` (empty until Phase 6) — create
- `src/server/jobs/handlers/purge-deleted-accounts.ts` — create; registered
- `src/server/modules/identity/retention.ts` — create; `PURGE_AFTER_DAYS = 30`
**Commands (in order, from repo root):** none.
**Implementation notes:** Export rate bucket `auth` 2/hour (`EXPORT_RATE_LIMITED`). Deletion revokes sessions and removes memberships and invitations; purge re-points references to the org placeholder user and nulls `audit_logs.actor_id` and `llm_calls.user_id` (append-only tables are never deleted, D-112).
**Secrets (if any):** none.
**Tests to write:**
- `tests/integration/identity/me.test.ts` — GET/PATCH/DELETE `/me`; export contains profile and memberships; third export in an hour is 429.
- `tests/integration/identity/purge.test.ts` — a user deleted 31 days ago is purged and their run (factory) points to the placeholder; a user deleted yesterday is kept.
**Verify (all must pass):**
```bash
pnpm typecheck && pnpm test:integration -- tests/integration/identity && pnpm openapi:generate && pnpm openapi:check
```
**Commit:** `feat(identity): me endpoints, data export, account deletion and purge job`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 3.4 — Public screens: sign-in, sign-up, verify, forgot and reset password
**Goal:** UI-001 to UI-004 built through the Impeccable loop.
**Covers:** UI-001 to UI-004, SYS-001, SYS-002
**Prerequisites:** Step 3.3 complete
**Files to create / modify:**
- `src/app/(public)/{sign-in,sign-up,verify-email,forgot-password,reset-password}/page.tsx` — create
- `src/components/features/auth/{sign-in-form,sign-up-form,verify-email-panel,forgot-password-form,reset-password-form,google-button}.tsx` — create
- `src/lib/i18n/en-US.ts` — modify; auth strings
- `src/app/page.tsx` — modify; redirect to `/home` when signed in, else `/sign-in`
**Commands (in order, from repo root):** in the session, per screen: `/impeccable shape /sign-in`, build, `/impeccable critique /sign-in`, `/impeccable audit /sign-in`, `/impeccable harden /sign-in`, `/impeccable polish /sign-in`; repeat for `/sign-up`, `/verify-email`, `/forgot-password`, `/reset-password`.
**Implementation notes:** Per `09-frontend-spec-screens.md` §UI-001 to UI-004 (states, validation, a11y). The Google button renders only when `googleEnabled` (from the server layout reading `env.GOOGLE_CLIENT_ID`).
**Secrets (if any):** none beyond Step 3.2.
**Tests to write:**
- `tests/unit/components/auth/sign-in-form.test.tsx` — validation messages; submit disabled while pending.
- `tests/e2e/auth/sign-up-verify-sign-in.spec.ts` — sign up, read the verification link from the console transport log (the E2E server writes emails to `test-results/emails/*.json` when `EMAIL_TRANSPORT=console` and `APP_ENV=test`), verify, sign in, land on `/home`; axe on each page.
- `tests/e2e/auth/reset-password.spec.ts` — request, follow the link, set a new password, sign in.
- `tests/e2e/a11y/public.spec.ts` — axe on the five public pages.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/auth && pnpm test:e2e -- tests/e2e/auth tests/e2e/a11y/public.spec.ts
```
**Commit:** `feat(auth): public sign-in, sign-up, verification, and reset screens`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 3.5 — Shell wiring, home, account settings, invitations
**Goal:** The app shell shows real memberships and notifications count; settings and invitation acceptance work.
**Covers:** UI-005, UI-008, UI-009 (base), UI-010, SYS-003, SYS-004, SYS-005
**Prerequisites:** Step 3.4 complete
**Files to create / modify:**
- `src/app/(app)/layout.tsx` — modify; `requireSession()`, load memberships and unread count, render `FlagsProvider`
- `src/components/layout/{institution-switcher,notifications-bell,account-menu}.tsx` — modify; real data and actions
- `src/app/(app)/home/page.tsx` — modify; role panels with empty states (data panels fill in later phases)
- `src/app/(app)/settings/{page,security/page,data/page}.tsx` — create; `src/components/features/account/*` — create
- `src/app/(app)/invitations/[invitationId]/page.tsx` — create
- `src/server/modules/tenancy/{router,actions}.ts` — create; institutions, invitations, agreements endpoints and actions
- `src/app/api/v1/institutions/**`, `src/app/api/v1/invitations/[invitationId]/accept/route.ts`, `src/app/api/v1/agreements/[agreementId]/route.ts` — create
**Commands (in order, from repo root):** Impeccable loop for `/home`, `/settings`, `/settings/security`, `/settings/data`, `/invitations/[invitationId]`.
**Implementation notes:** `setActiveInstitution` refreshes the tree. Deletion dialog requires typing the email. Sessions list marks the current session.
**Secrets (if any):** none.
**Tests to write:**
- `tests/integration/tenancy/invitations.test.ts` — invite → accept with matching email → member; mismatched email refused.
- `tests/integration/api/tenancy.test.ts` — every endpoint in `07-api-spec.md` §4 with allow and deny cases.
- `tests/e2e/auth/settings.spec.ts` — change name, change password (revokes other sessions), download export, delete account (signed out).
- `tests/e2e/auth/invitation.spec.ts` — instructor invites; invitee accepts; appears in memberships.
- `tests/e2e/a11y/shell.spec.ts` — axe on `/home`, `/settings`, `/notifications` (empty).
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test:integration -- tests/integration/tenancy tests/integration/api/tenancy.test.ts && pnpm test:e2e -- tests/e2e/auth tests/e2e/a11y/shell.spec.ts && pnpm openapi:check
```
**Commit:** `feat(shell): session-aware shell, home, account settings, invitations`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 3.6 — Authorization matrix test and E2E fixtures
**Goal:** Every "—" cell in `08-auth-authz.md` §4 that has an endpoint so far is proven denied; Playwright can sign in as any seat.
**Covers:** FR-230, NFR-011
**Prerequisites:** Step 3.5 complete
**Files to create / modify:**
- `tests/integration/auth/matrix.test.ts` — create; table-driven over the endpoints that exist, extended in every later phase
- `tests/e2e/fixtures.ts` — modify; `signInAs(seat)` using the seed accounts and `SEED_PASSWORD`
- `tests/setup/integration.ts` — modify; `asUser(user)` helper creating real sessions
**Commands (in order, from repo root):** none.
**Implementation notes:** The matrix test reads a JSON table `tests/integration/auth/matrix.json` (`operationId`, `role`, `expected`) so later phases only append rows.
**Secrets (if any):** none.
**Tests to write:** the files above.
**Verify (all must pass):**
```bash
pnpm test:integration -- tests/integration/auth/matrix.test.ts && pnpm test:e2e -- tests/e2e/auth
```
**Commit:** `test(auth): permission matrix and e2e sign-in fixtures`
**Rollback:** `git checkout -- tests`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm openapi:check && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: SYS-001, SYS-002, SYS-003, SYS-004, SYS-005, SYS-028, UI-001 to UI-005, UI-008, UI-010, FR-234, FR-221, DATA-052, INT-003, INT-004, D-093. Partially: FR-230 (matrix grows with endpoints), UI-009 (panels fill in later phases), SYS-011 (audit helper; screens in Phase 13).
