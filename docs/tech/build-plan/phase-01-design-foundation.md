# Phase 1 — Design Foundation

**Purpose / Read this when:** the pipeline is proven (Phase 0) and the visual foundation must exist before any feature screen: Impeccable installed and initialized, `PRODUCT.md` and `DESIGN.md`, fonts and tokens, shadcn wired to the tokens, the app shell, error pages, and the dev component gallery.

**Requirements covered:** UI-007, UI-008 (shell without data), UI-060, SYS-008, SYS-018, INT-011, NFR-006 (baseline), NFR-013 (baseline), decisions D-005, D-025.

## Goal

A themed, accessible shell that every later screen slots into, recorded as Impeccable's design authority, with the component gallery reviewed by `critique`, `audit`, `harden`, and `polish`.

## Prerequisites

- Phase 0 exit criteria pass.
- Read `09-frontend-spec.md` §2–4 and `16-performance-a11y-budgets.md` §fonts.

## Steps

### Step 1.1 — Install Impeccable and write PRODUCT.md
**Goal:** The Impeccable skill is installed project-wide and `PRODUCT.md` describes Tassl.
**Covers:** INT-011
**Prerequisites:** Phase 0 complete; Claude Code session at the repo root
**Files to create / modify:**
- `.impeccable/config.json`, `.claude/skills/impeccable/**` — created by the installer (tracked, except the ignore block)
- `PRODUCT.md` — created by `/impeccable init`
- `.gitignore` — modify; append the Impeccable ignore block from `09-frontend-spec.md` §4
**Commands (in order, from repo root):**
```bash
npx impeccable@3.6.1 install -y --providers=claude --scope=project
```
Reload Claude Code, then in the session run `/impeccable init` and answer every question from `09-frontend-spec.md` §4 item 2 (users, job, mechanism, constraints, voice, platform `web`, stack "delegated: Next.js 16 App Router, already scaffolded"). Do not give aesthetic answers during init.
**Implementation notes:** D-005: this Impeccable version has no product/brand lanes; the app is an Operate-mode surface and there is no marketing surface. Keep the design hook enabled. If `init` asks whether to write `DESIGN.md`, decline; Step 1.2 writes it from the spec.
**Secrets (if any):** none.
**Tests to write:** none.
**Verify (all must pass):**
```bash
test -f PRODUCT.md && grep -q 'impeccable:product-schema' PRODUCT.md && test -f .impeccable/config.json && grep -q 'impeccable-ignore-start' .gitignore && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```
**Commit:** `chore(design): install impeccable and write PRODUCT.md`
**Rollback:** `rm -rf .impeccable .claude/skills/impeccable PRODUCT.md && git checkout -- .gitignore`

### Step 1.2 — Fonts, tokens, and DESIGN.md
**Goal:** IBM Plex self-hosted, all design tokens in `globals.css`, and `DESIGN.md` recording them verbatim.
**Covers:** NFR-013, NFR-006, UI-008
**Prerequisites:** Step 1.1 complete
**Files to create / modify:**
- `public/fonts/*.woff2` — add; the seven files named in `16-performance-a11y-budgets.md` §6 (IBM Plex Sans 400/500/600, Mono 400/500, Serif 500/600) copied from the npm packages `@ibm/plex-sans@1.1.0`, `@ibm/plex-mono@2.5.0`, `@ibm/plex-serif@2.0.0` with the script in that section (OFL license; `public/fonts/LICENSE.txt`, D-124)
- `src/app/fonts.ts` — create; `next/font/local` definitions exporting `plexSans`, `plexMono`, `plexSerif` with `variable: '--font-plex-sans'` etc., `display: 'swap'`, `preload: true` for Sans only
- `src/app/layout.tsx` — modify; apply the three font variables to `<html className>`
- `src/app/globals.css` — modify; `:root` tokens from `09-frontend-spec.md` §2.2–2.3, `@theme inline` mapping, `prefers-reduced-motion` rule, focus outline, `font-feature-settings: "tnum"` on `.tabular`
- `DESIGN.md` — create; sections Typography, Color, Spacing, Radius, Elevation, Motion, Iconography, Empty states, Components, with the exact values from `09-frontend-spec.md` §2 and the rule list from §4 (no Inter/Arial/system fonts, no gray-on-color, no pure black or gray, no nested cards, no bounce, no gradients)
**Commands (in order, from repo root):**
```bash
mkdir -p public/fonts
```
Download the woff2 files (exact commands in `16-performance-a11y-budgets.md` §fonts), then write the files above.
**Implementation notes:** D-025 tokens are the design authority; `DESIGN.md` copies them so Impeccable's detector and `document` command see one truth. Contrast pairs must meet the ratios in `16-performance-a11y-budgets.md` §contrast.
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/design/tokens.test.ts` — asserts every token named in `DESIGN.md` §Color appears in `globals.css` with the same value (parse both files).
**Verify (all must pass):**
```bash
pnpm test -- tests/unit/design && pnpm build && ls public/fonts | grep -c woff2 | grep -qE '^[7-9]|^[1-9][0-9]' && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```
**Commit:** `feat(design): ibm plex fonts, design tokens, DESIGN.md`
**Rollback:** `git checkout -- . && git clean -fd public/fonts`

### Step 1.3 — shadcn/ui against the tokens
**Goal:** The shadcn primitives from `09-frontend-spec.md` §3 exist and use the Tassl tokens, not zinc defaults.
**Covers:** UI-008, NFR-006
**Prerequisites:** Step 1.2 complete
**Files to create / modify:**
- `components.json` — created by the CLI (`base-nova` preset, D-154); then set `aliases.utils` to `@/lib/cn` per `09-frontend-spec.md` §2.6
- `src/components/ui/*.tsx` — created by the CLI for: button, input, textarea, label, select, checkbox, radio-group, switch, dialog, alert-dialog, sheet, popover, tooltip, dropdown-menu, tabs, table, badge, separator, scroll-area, progress, skeleton, field, sonner
- `src/app/globals.css` — modify; map shadcn variables to the tokens (`09-frontend-spec.md` §2.6)
- `src/lib/cn.ts` — verify the CLI did not create a duplicate `src/lib/utils.ts`; if it did, re-export `cn` from `cn.ts` and delete `utils.ts`
**Commands (in order, from repo root):**
```bash
pnpm dlx shadcn@4.20.1 init -d --no-monorepo
pnpm dlx shadcn@4.20.1 add button input textarea label select checkbox radio-group switch dialog alert-dialog sheet popover tooltip dropdown-menu tabs table badge separator scroll-area progress skeleton form sonner -y -o
pnpm add lucide-react@1.39.0 class-variance-authority@0.7.1 next-themes@0.4.6 sonner@2.0.8 react-hook-form@7.87.0 @hookform/resolvers@5.9.1
pnpm lint:fix
```
**Implementation notes:** `init -d` accepts the defaults non-interactively (`--no-monorepo` answers the remaining prompt); `add ... -y -o` skips confirmation and overwrites. After generation, replace zinc color references in the generated CSS with the token variables and remove any pure black (`#000`, `oklch(0 0 0)`) values. Button `primary` uses `--primary`/`--primary-ink`; `destructive` uses `--red`. Radius variables map to 2/6/10 px. Do not nest `Card` components; the `Card` primitive is intentionally not added (panels use `Panel`).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/ui/button.test.tsx` — renders variants; has visible focus class; disabled state.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components && ! grep -rEn '#000000|#000\b|oklch\(0 0 0\)' src/app/globals.css src/components/ui
```
**Commit:** `feat(ui): shadcn primitives themed with tassl tokens`
**Rollback:** `git checkout -- . && git clean -fd src/components/ui components.json`

### Step 1.4 — Layout components, app shell, public layout, error pages
**Goal:** The `(public)` and `(app)` layouts, the shell components, and the not-found and error pages exist (the shell renders without data until Phase 3 adds sessions).
**Covers:** UI-007, UI-008, SYS-008
**Prerequisites:** Step 1.3 complete
**Files to create / modify:**
- `src/components/layout/{app-shell,rail,institution-switcher,notifications-bell,account-menu,page-header,panel,empty-state,error-state,illustrative-sample,label-chip}.tsx` — create per `09-frontend-spec.md` §3 (institution switcher, bell, and account menu accept props and render placeholders from `t()` until Phase 3 wires data)
- `src/app/(public)/layout.tsx` — create; centered card layout
- `src/app/(app)/layout.tsx` — create; renders `AppShell` (session check added in Phase 3)
- `src/app/(app)/home/page.tsx` — create; empty-state home ("Nothing to do yet")
- `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx` — create; `09-frontend-spec-screens.md` §UI-007 (`global-error` reports to Sentry from Phase 13; until then it logs to console)
- `src/app/(app)/loading.tsx`, `src/app/(public)/loading.tsx` — create; skeletons
- `src/lib/i18n/en-US.ts` — modify; add every shell and error string
- `src/lib/hooks/use-focus-on-route-change.ts` — create; moves focus to `h1` on navigation
**Commands (in order, from repo root):** none beyond writing files.
**Implementation notes:** Skip link to `main`; `nav` with `aria-current`; the rail collapses to a bottom bar under `md` (`09-frontend-spec.md` §5); `IllustrativeSample` refuses to render without its label prop (throws in development, renders the label in production).
**Secrets (if any):** none.
**Tests to write:**
- `tests/unit/components/layout/app-shell.test.tsx` — skip link present; rail items rendered from props; `aria-current` on the active item.
- `tests/unit/components/layout/illustrative-sample.test.tsx` — always renders the label text "Illustrative sample data".
- `tests/e2e/system/errors.spec.ts` — `/does-not-exist` renders the not-found page with a link home; axe passes.
**Verify (all must pass):**
```bash
pnpm lint && pnpm typecheck && pnpm test -- tests/unit/components/layout && pnpm test:e2e -- tests/e2e/system
```
**Commit:** `feat(shell): app shell, public layout, error pages`
**Rollback:** `git checkout -- . && git clean -fd`

### Step 1.5 — Dev component gallery route
**Goal:** `/dev/components` renders every component in every state for visual review and Lighthouse CI.
**Covers:** UI-060, SYS-018
**Prerequisites:** Step 1.4 complete
**Files to create / modify:**
- `src/app/dev/layout.tsx` — create; `notFound()` unless `env.APP_ENV` is `local` or `test`
- `src/app/dev/components/page.tsx` — create; sections per component folder with fixture props; a token table
- `src/app/dev/components/fixtures.ts` — create; fixture props (graph fixtures are added in Phase 10)
- `lighthouserc.json` — modify; add `/dev/components` to the URL list for the `test` environment
**Commands (in order, from repo root):** none.
**Implementation notes:** `jsx-no-literals` is disabled for `src/app/dev/**` (fixture text). The page is server-rendered and static apart from interactive demos.
**Secrets (if any):** none.
**Tests to write:**
- `tests/e2e/a11y/dev-components.spec.ts` — axe passes on `/dev/components` with zero serious or critical violations.
- `tests/e2e/system/dev-guard.spec.ts` — with `APP_ENV=test` the route renders; the production guard is covered by a unit test of the layout's condition (`tests/unit/app/dev-guard.test.ts`).
**Verify (all must pass):**
```bash
pnpm test -- tests/unit/app && pnpm test:e2e -- tests/e2e/a11y/dev-components.spec.ts tests/e2e/system/dev-guard.spec.ts && pnpm lhci
```
**Commit:** `feat(dev): component gallery route`
**Rollback:** `git checkout -- . && git clean -fd src/app/dev`

### Step 1.6 — Impeccable review loop on the shell and gallery, then DESIGN.md reconciliation
**Goal:** The shell and gallery pass `critique`, `audit`, `harden`, `polish`, and `DESIGN.md` is reconciled with the built code.
**Covers:** INT-011, NFR-006
**Prerequisites:** Step 1.5 complete
**Files to create / modify:**
- `.impeccable/critique/*.md` — created by the commands (tracked)
- `DESIGN.md` — modify only if `/impeccable document` finds a mismatch with the built tokens; keep §2 values unless contrast requires a change (log a `D-` row)
- any component files the review changes
**Commands (in order, from repo root):** in the Claude Code session:
```
/impeccable shape /dev/components
/impeccable critique /dev/components
/impeccable audit /dev/components
/impeccable harden /dev/components
/impeccable polish /dev/components
/impeccable critique /home
/impeccable audit /home
/impeccable document
```
Answer every direction or taste question with "Operate; follow DESIGN.md and 09-frontend-spec.md §2".
**Implementation notes:** Fix every high or medium finding; low findings may be waived in `.impeccable/config.json` with a `reason`. `document` must not change the palette or fonts; if it proposes to, keep the spec and record the proposal in `.impeccable/critique/`.
**Secrets (if any):** none.
**Tests to write:** none beyond re-running the existing suites.
**Verify (all must pass):**
```bash
npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e -- tests/e2e/a11y tests/e2e/system && pnpm lhci
```
**Commit:** `chore(design): impeccable review of shell and gallery; reconcile DESIGN.md`
**Rollback:** `git checkout -- . && git clean -fd .impeccable/critique`

## Phase exit criteria

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build && pnpm lhci && npx impeccable@3.6.1 detect --json . > impeccable-report.json && node scripts/impeccable-gate.mjs impeccable-report.json .impeccable/config.json
```

Requirement IDs now fully implemented: UI-007, UI-060, SYS-008, SYS-018, INT-011. Partially: UI-008 (data wiring in Phase 3), NFR-006, NFR-013.
