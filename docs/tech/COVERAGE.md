# COVERAGE — Requirements joined to build steps and tests

**Purpose / Read this when:** you need to know where a requirement is built and where it is tested, or you are checking that a phase closed every ID it claimed. Every ID from `01-prd-analysis.md` §5 appears exactly once below.

**Requirements covered:** all.

Conventions: steps are `N.M` in `build-plan/phase-NN-*.md`; test paths are relative to `tests/` unless they start with `evals/`; "e2e wt-NN" means `tests/e2e/walkthrough/NN-*.spec.ts`; "a11y" means the matching file in `tests/e2e/a11y/`. Requirements the PRD marks future-state (priority **W**) are listed in §9 with their design accommodation and have no build step by PRD scope (they are not gaps).

## 1. Functional requirements (build slice)

| ID | Build steps | Tests |
|---|---|---|
| FR-001 | 7.3, 8.2 | integration/assistant/failure.test.ts, integration/runs/pause.test.ts, e2e wt-07 |
| FR-002 | 11.1, 11.3 | integration/review/void.test.ts, e2e wt-15 |
| FR-003 | 11.1, 11.3 | integration/review/neutralize.test.ts, e2e wt-15 |
| FR-004 | 10.3, 11.5 | unit/scoring/bands.test.ts, e2e wt-17 |
| FR-005 | 10.3, 11.1 | unit/scoring/recompute.test.ts, integration/review/neutralize.test.ts |
| FR-006 | 13.5 | unit/copy/never-accuses.test.ts |
| FR-007 | 6.1, 10.1 | integration/trace/append.test.ts, integration/trace/export.test.ts |
| FR-008 | 11.1, 11.3 | integration/review/void.test.ts, integration/review/neutralize.test.ts, e2e wt-15 |
| FR-010 | 6.3, 6.5 | integration/runs/readiness.test.ts, e2e wt-02-05 |
| FR-011 | 5.2, 6.3 | integration/scenarios/lifecycle.test.ts, integration/runs/readiness.test.ts |
| FR-012 | 6.3, 6.5 | unit/runs/readiness-map.test.ts, e2e wt-02-05 |
| FR-013 | 6.3 | integration/runs/readiness.test.ts |
| FR-014 | 6.3, 11.3 | integration/runs/readiness.test.ts, e2e wt-12 |
| FR-015 | 10.2 | unit/scoring/graphs/stance-matrix.test.ts |
| FR-016 | 10.3 | unit/scoring/points.test.ts |
| FR-017 | 6.3, 6.5 | integration/runs/readiness.test.ts |
| FR-018 | 6.3 | integration/runs/readiness.test.ts |
| FR-020 | 6.4, 6.5 | integration/runs/documents.test.ts, e2e wt-02-05 |
| FR-021 | 5.1, 5.3 | unit/scenarios/validate.test.ts, unit/scenarios/fixture.test.ts |
| FR-022 | 6.4 | integration/runs/documents.test.ts, e2e wt-02-05 |
| FR-023 | 6.5 | e2e wt-02-05, a11y/student-run.spec.ts |
| FR-024 | 6.4, 10.2 | unit/runs/skim.test.ts, unit/scoring/graphs/clock-timeline.test.ts |
| FR-025 | 9.2 | unit/defense/selection.test.ts |
| FR-026 | 11.1 | integration/review/neutralize.test.ts |
| FR-027 | 5.2, 5.5 | integration/scenarios/lifecycle.test.ts, e2e author/confirm-workspace.spec.ts |
| FR-028 | 5.2 | integration/api/packages.test.ts, integration/security/student-view-invariants.test.ts |
| FR-030 | 5.1, 5.3 | unit/scenarios/validate.test.ts |
| FR-031 | 6.4 | integration/runs/documents.test.ts |
| FR-040 | 6.4, 6.5 | integration/runs/frame.test.ts, e2e wt-02-05 |
| FR-041 | 6.4 | integration/runs/frame.test.ts, integration/db/grants.test.ts |
| FR-042 | 6.4 | integration/runs/frame.test.ts |
| FR-043 | 6.4, 6.5 | integration/runs/frame.test.ts, unit/components/run/frame-form.test.tsx |
| FR-044 | 10.2 | unit/scoring/graphs/frame-beside-decision.test.ts |
| FR-050 | 7.3 | integration/assistant/delegate.test.ts |
| FR-051 | 7.2, 7.3, 7.4 | integration/assistant/delegate.test.ts, unit/components/run/assistant-panel.test.tsx, e2e wt-06 |
| FR-052 | 7.1, 14.2 | unit/llm/numeric-guard.test.ts, integration/llm/degradation.test.ts |
| FR-053 | 7.3 | integration/assistant/log.test.ts |
| FR-054 | 10.3, 10.4 | unit/scoring/bands.test.ts, unit/scoring/reads.test.ts |
| FR-055 | 11.1 | integration/api/review.test.ts |
| FR-056 | 7.2, 14.3 | integration/assistant/defect-leak.test.ts, evals/assistant |
| FR-057 | 5.1 | unit/scenarios/validate.test.ts |
| FR-060 | 7.3, 7.4 | integration/assistant/log.test.ts, unit/components/run/delegation-log.test.tsx, e2e wt-06 |
| FR-061 | 7.3, 7.4 | integration/assistant/log.test.ts, e2e wt-06 |
| FR-062 | 11.3 | e2e wt-12 |
| FR-063 | 7.3, 10.2 | unit/scoring/graphs/clock-timeline.test.ts, unit/scoring/graphs/stance-matrix.test.ts |
| FR-064 | 10.3, 10.4 | unit/scoring/bands.test.ts |
| FR-070 | 8.1, 8.3 | integration/reliance/actions.test.ts, e2e wt-06 |
| FR-071 | 8.1 | integration/reliance/actions.test.ts |
| FR-072 | 8.1 | integration/reliance/actions.test.ts |
| FR-073 | 8.3 | e2e wt-06 |
| FR-074 | 8.1 | integration/reliance/actions.test.ts |
| FR-075 | 10.3 | unit/scoring/facts.test.ts |
| FR-080 | 8.1, 8.3 | integration/reliance/stances.test.ts, unit/components/run/stance-control.test.tsx, e2e wt-06 |
| FR-081 | 8.1, 10.1 | integration/trace/export.test.ts |
| FR-082 | 5.2, 10.2 | integration/scenarios/lifecycle.test.ts, unit/scoring/graphs/stance-matrix.test.ts |
| FR-083 | 6.4, 8.2, 9.1, 10.2 | unit/scoring/graphs/confidence-line.test.ts |
| FR-084 | 8.2, 8.3 | integration/runs/lock.test.ts, unit/runs/lock-gate.test.ts, e2e wt-08 |
| FR-085 | 8.1 | integration/reliance/stances.test.ts |
| FR-086 | 8.2, 10.3 | integration/runs/lock.test.ts, unit/scoring/bands.test.ts |
| FR-087 | 10.3, 10.4 | unit/scoring/bands.test.ts, integration/scoring/score-run.test.ts |
| FR-090 | 8.1, 8.3 | integration/reliance/escalations.test.ts, e2e wt-06 |
| FR-091 | 8.1 | integration/reliance/escalations.test.ts |
| FR-092 | 8.1 | integration/reliance/escalations.test.ts |
| FR-093 | 5.2 | integration/api/packages.test.ts |
| FR-100 | 8.2, 8.3 | integration/runs/lock.test.ts, unit/components/run/brief-editor.test.tsx |
| FR-101 | 8.1, 8.2 | unit/reliance/relied-on.test.ts, integration/runs/lock.test.ts |
| FR-102 | 8.2 | integration/runs/lock.test.ts, integration/db/grants.test.ts |
| FR-103 | 5.1, 8.2 | unit/lib/words.test.ts, integration/runs/lock.test.ts |
| FR-104 | 4.1, 6.2 | integration/courses/service.test.ts, integration/runs/start.test.ts |
| FR-105 | 8.2, 8.3 | integration/runs/lock.test.ts, e2e wt-08 |
| FR-106 | 8.2 | integration/runs/lock.test.ts |
| FR-107 | 8.2, 8.3 | integration/runs/lock.test.ts, e2e wt-08 |
| FR-108 | 8.2 | integration/runs/lock.test.ts |
| FR-109 | 10.3, 10.4 | unit/scoring/bands.test.ts, unit/scoring/reads.test.ts |
| FR-110 | 9.1, 9.3 | unit/runs/timers.test.ts, integration/runs/turn.test.ts, e2e wt-09 |
| FR-111 | 9.1 | integration/runs/turn.test.ts |
| FR-112 | 9.1, 9.3 | integration/runs/turn.test.ts, e2e wt-09 |
| FR-113 | 9.1 | unit/runs/timers.test.ts, integration/runs/turn.test.ts |
| FR-114 | 5.1, 10.3 | unit/scenarios/validate.test.ts, unit/scoring/facts.test.ts |
| FR-115 | 9.1 | unit/runs/timers.test.ts |
| FR-117 | 6.2 | unit/runs/clock.test.ts |
| FR-118 | 8.2, 11.3 | integration/runs/pause.test.ts, e2e wt-07 |
| FR-120 | 9.2, 9.3 | integration/defense/flow.test.ts, e2e wt-10 |
| FR-121 | 9.2 | unit/defense/selection.test.ts |
| FR-122 | 9.2 | unit/defense/selection.test.ts |
| FR-123 | 9.2 | unit/defense/follow-up.test.ts, integration/defense/flow.test.ts |
| FR-124 | 9.2 | integration/defense/flow.test.ts |
| FR-125 | 9.2, 10.4 | unit/defense/follow-up.test.ts, unit/scoring/reads.test.ts, integration/scoring/score-run.test.ts |
| FR-126 | 9.2 | integration/defense/flow.test.ts |
| FR-130 | 10.4, 10.5 | integration/scoring/score-run.test.ts, e2e wt-11 |
| FR-131 | 10.3 | unit/scoring/field-names.test.ts |
| FR-132 | 10.2 | unit/scoring/graphs/confidence-line.test.ts |
| FR-133 | 10.2 | unit/scoring/graphs/clock-timeline.test.ts |
| FR-134 | 10.2 | unit/scoring/graphs/stance-matrix.test.ts |
| FR-135 | 10.2 | unit/scoring/graphs/frame-beside-decision.test.ts |
| FR-136 | 10.2, 10.3 | unit/scoring/bands.test.ts, unit/components/graphs/graph-frame.test.tsx |
| FR-137 | 10.3, 10.4 | unit/scoring/reads.test.ts, integration/scoring/score-run.test.ts |
| FR-138 | 10.3 | unit/scoring/bands.test.ts |
| FR-139 | 10.3, 10.4 | unit/scoring/bands.test.ts, evals/scoring |
| FR-140 | 10.4, 11.1, 11.3 | integration/scoring/score-run.test.ts, integration/review/held.test.ts |
| FR-141 | 10.4 | integration/scoring/score-run.test.ts |
| FR-142 | 10.3 | unit/scoring/bands.test.ts |
| FR-143 | 10.2 | unit/scoring/graphs/*.test.ts |
| FR-150 | 11.2, 11.4 | integration/debrief/flow.test.ts, e2e wt-11, e2e wt-13 |
| FR-151 | 11.2, 11.4 | unit/debrief/assembly.test.ts, e2e wt-13 |
| FR-152 | 11.2 | integration/debrief/flow.test.ts, e2e wt-13 |
| FR-153 | 11.2 | unit/debrief/assembly.test.ts |
| FR-154 | 11.2 | integration/debrief/flow.test.ts, integration/api/debrief.test.ts |
| FR-155 | 11.2 | unit/debrief/assembly.test.ts |
| FR-170 | 10.1, 11.1, 11.4 | integration/trace/export.test.ts, e2e wt-14 |
| FR-171 | 11.4 | unit/components/layout/illustrative-sample.test.tsx, e2e wt-14 |
| FR-172 | 10.1, 10.3 | integration/trace/export.test.ts, unit/scoring/field-names.test.ts |
| FR-180 | 5.2, 11.1, 11.3 | integration/api/review.test.ts, e2e wt-01, e2e wt-12 |
| FR-181 | 11.1, 11.3 | integration/review/decisions.test.ts, e2e wt-12 |
| FR-182 | 11.1 | integration/review/decisions.test.ts |
| FR-183 | 11.1, 11.3 | integration/review/void.test.ts, integration/review/neutralize.test.ts, e2e wt-15 |
| FR-184 | 11.1 | integration/review/decisions.test.ts, integration/review/neutralize.test.ts |
| FR-185 | 11.3 | e2e wt-12, a11y/instructor.spec.ts |
| FR-190 | 5.2, 5.4, 12.2, 12.3 | integration/scenarios/lifecycle.test.ts, integration/authoring/pipeline.test.ts, e2e author/generate-and-confirm.spec.ts |
| FR-191 | 12.1, 12.2, 12.3 | integration/authoring/pipeline.test.ts, unit/llm/mock-generation.test.ts, evals/authoring |
| FR-192 | 5.2, 5.5, 12.3 | integration/scenarios/lifecycle.test.ts, e2e author/confirm-workspace.spec.ts |
| FR-193 | 5.1, 5.3 | unit/scenarios/validate.test.ts, unit/scenarios/fixture.test.ts |
| FR-194 | 5.1, 12.2 | unit/scenarios/validate.test.ts, integration/authoring/pipeline.test.ts |
| FR-195 | 5.2, 5.4 | integration/scenarios/lifecycle.test.ts, e2e author/packages.spec.ts |
| FR-196 | 5.2, 5.4 | integration/api/packages.test.ts, e2e author/packages.spec.ts |
| FR-197 | 7.1, 14.1 | unit/llm/registry.test.ts, eslint boundaries (`pnpm lint`) |
| FR-198 | 12.2, 12.3 | integration/authoring/measures.test.ts, e2e author/generate-and-confirm.spec.ts |
| FR-200 | 4.1, 4.4, 5.3 | integration/courses/service.test.ts, e2e instructor/assignment.spec.ts |
| FR-201 | 4.1, 6.2, 6.5 | integration/courses/service.test.ts, integration/runs/start.test.ts, e2e wt-02-05 |
| FR-202 | 10.3, 11.1 | unit/scoring/points.test.ts, integration/review/decisions.test.ts |
| FR-203 | 10.4, 11.1 | integration/scoring/score-run.test.ts, integration/review/decisions.test.ts |
| FR-204 | 11.1, 11.4 | integration/review/decisions.test.ts, e2e wt-14 |
| FR-205 | 4.1 | integration/courses/service.test.ts |
| FR-206 | 11.2, 11.4 | integration/courses/mapping.test.ts, e2e instructor/mapping.spec.ts |
| FR-210 | 11.5 | a11y/keyboard-only-run.spec.ts |
| FR-211 | 13.8 | a11y/*.spec.ts |
| FR-212 | 10.2, 11.5 | unit/components/graphs/graph-frame.test.tsx, e2e wt-17 |
| FR-213 | 8.2, 9.1 | integration/runs/pause.test.ts, unit/runs/timers.test.ts |
| FR-214 | 9.3 | unit/components/run/defense-question.test.tsx, e2e wt-10 |
| FR-221 | 3.2 | integration/tenancy/agreements.test.ts |
| FR-230 | 3.2, 3.6 | integration/auth/permissions.test.ts, integration/auth/matrix.test.ts |
| FR-231 | 6.2, 9.1, 10.4, 11.1 | unit/runs/state-machine.test.ts |
| FR-232 | 11.1 | integration/review/neutralize.test.ts |
| FR-233 | 6.2 | unit/runs/clock.test.ts |
| FR-234 | 3.2 | integration/tenancy/agreements.test.ts |
| FR-235 | 6.2, 11.1 | integration/runs/start.test.ts, integration/api/courses.test.ts |
| FR-236 | 3.2 | integration/api/tenancy.test.ts |
| FR-240 | 10.1 | unit/trace/export-schema.test.ts, integration/trace/export.test.ts |
| FR-241 | 6.1, 10.1 | unit/trace/payloads.test.ts |
| FR-242 | 6.1, 10.4 | integration/trace/append.test.ts |
| FR-243 | 10.1 | integration/trace/export.test.ts |
| FR-250 | 11.5, 15.5 | e2e walkthrough suite; `docs/release/walkthrough-notes-<date>.md` |
| FR-251 | 11.5, 15.5 | e2e wt-08, e2e wt-16 |
| FR-252 | 11.5 | e2e wt-06, e2e wt-11, e2e wt-13 |
| FR-253 | 11.3 | e2e wt-12 |
| FR-254 | 11.4 | unit/components/layout/illustrative-sample.test.tsx, e2e wt-14 |

## 2. Non-functional requirements

| ID | Build steps | Tests |
|---|---|---|
| NFR-001 | 10.4, 10.5, 14.2 | integration/scoring/score-run.test.ts, e2e wt-11 (timing) |
| NFR-002 | 9.1 | unit/runs/timers.test.ts, e2e wt-09 |
| NFR-003 | 6.2 | unit/runs/clock.test.ts |
| NFR-004 | 2.6, 8.2 | integration/db/grants.test.ts, integration/runs/lock.test.ts |
| NFR-005 | 2.4, 6.1 | integration/db/runs-schema.test.ts, integration/trace/append.test.ts |
| NFR-006 | 1.6, 13.8 | a11y/*.spec.ts, `pnpm lhci` |
| NFR-007 | 13.1, 15.3 | unit/logging/ops-events.test.ts, launch checklist |
| NFR-008 | 13.1, 13.8, 15.3 | e2e/perf/web-vitals.spec.ts, integration latency summary, k6 |
| NFR-009 | 3.3, 13.6 | integration/identity/purge.test.ts, integration/identity/retention.test.ts |
| NFR-010 | 11.5 | Playwright projects chromium, firefox, webkit |
| NFR-011 | 13.3, 13.4 | unit/security/csp.test.ts, e2e/security/headers.spec.ts, integration/rate-limit/coverage.test.ts |
| NFR-012 | 7.1, 14.4 | unit/llm/mock.test.ts, `pnpm evals` |
| NFR-013 | 10.2, 13.8 | `scripts/bundle-budget.ts`, `pnpm lhci` |
| NFR-014 | 15.3 | k6 `scripts/load/run-loop.js` |
| NFR-015 | 13.6 | backup workflow run, `scripts/restore-drill.sh` |
| NFR-016 | 0.5, 13.1, 14.5 | unit/http/define-route.test.ts, integration/llm/observability.test.ts |
| NFR-017 | 0.2, 0.7 | unit/lib/i18n.test.ts |

## 3. Screens

| ID | Build steps | Tests |
|---|---|---|
| UI-001 | 3.4 | e2e auth/sign-up-verify-sign-in.spec.ts, a11y/public.spec.ts |
| UI-002 | 3.4 | e2e auth/sign-up-verify-sign-in.spec.ts, a11y/public.spec.ts |
| UI-003 | 3.4 | e2e auth/sign-up-verify-sign-in.spec.ts, a11y/public.spec.ts |
| UI-004 | 3.4 | e2e auth/reset-password.spec.ts, a11y/public.spec.ts |
| UI-005 | 3.5 | e2e auth/invitation.spec.ts, a11y/shell.spec.ts |
| UI-006 | 13.5 | a11y/public.spec.ts |
| UI-007 | 1.4, 13.5 | e2e system/errors.spec.ts |
| UI-008 | 1.4, 3.5 | unit/components/layout/app-shell.test.tsx, a11y/shell.spec.ts |
| UI-009 | 3.5, 6.5, 11.4 | a11y/shell.spec.ts |
| UI-010 | 3.5 | e2e auth/settings.spec.ts, a11y/shell.spec.ts |
| UI-011 | 11.4 | a11y/shell.spec.ts |
| UI-020 | 6.5 | e2e wt-02-05, a11y/student-run.spec.ts |
| UI-021 | 6.5 | e2e wt-02-05, a11y/student-run.spec.ts |
| UI-022 | 6.5 | e2e wt-02-05, a11y/student-run.spec.ts |
| UI-023 | 6.5, 7.4, 8.3 | e2e wt-06, a11y/student-run.spec.ts |
| UI-024 | 8.3 | e2e wt-08, a11y/student-run.spec.ts |
| UI-025 | 9.3 | e2e wt-09, a11y/student-run.spec.ts |
| UI-026 | 9.3 | e2e wt-10, a11y/student-run.spec.ts |
| UI-027 | 6.5, 9.3, 11.4 | e2e wt-10, a11y/student-run.spec.ts |
| UI-028 | 11.4 | e2e wt-11, e2e wt-13, a11y/student-run.spec.ts |
| UI-029 | 11.4 | e2e wt-14, a11y/student-run.spec.ts |
| UI-030 | 4.2, 11.4 | e2e instructor/courses.spec.ts, e2e instructor/mapping.spec.ts, a11y/instructor.spec.ts |
| UI-031 | 4.3 | e2e instructor/roster.spec.ts, a11y/instructor.spec.ts |
| UI-032 | 4.4, 6.5 | e2e instructor/assignment.spec.ts, a11y/instructor.spec.ts |
| UI-033 | 11.3 | e2e wt-12, e2e wt-15, a11y/instructor.spec.ts |
| UI-034 | 11.4 | a11y/instructor.spec.ts |
| UI-035 | 11.4 | e2e wt-14, a11y/instructor.spec.ts |
| UI-040 | 5.4 | e2e author/packages.spec.ts, a11y/author.spec.ts |
| UI-041 | 5.4, 12.3 | e2e author/generate-and-confirm.spec.ts, a11y/author.spec.ts |
| UI-042 | 12.3 | e2e author/generate-and-confirm.spec.ts, a11y/author.spec.ts |
| UI-043 | 5.5, 12.3 | e2e author/confirm-workspace.spec.ts, a11y/author.spec.ts |
| UI-044 | 5.4 | e2e author/packages.spec.ts, a11y/author.spec.ts |
| UI-050 | 13.5 | e2e admin/admin.spec.ts, a11y/admin.spec.ts |
| UI-060 | 1.5 | a11y/dev-components.spec.ts |

## 4. Entities

| ID | Build steps | Tests |
|---|---|---|
| DATA-001 to DATA-004 | 2.1 | integration/db/auth-schema.test.ts |
| DATA-005 | 2.1, 2.2 | integration/db/auth-schema.test.ts, integration/api/tenancy.test.ts |
| DATA-006, DATA-007 | 2.1, 3.5 | integration/tenancy/invitations.test.ts |
| DATA-008 to DATA-011 | 2.2, 4.1 | integration/db/courses-schema.test.ts, integration/courses/service.test.ts |
| DATA-012 to DATA-026 | 2.3, 5.2 | integration/db/package-frozen.test.ts, integration/scenarios/lifecycle.test.ts |
| DATA-027 | 2.3, 12.2 | integration/authoring/pipeline.test.ts |
| DATA-028 | 2.4, 6.2 | integration/db/runs-schema.test.ts, integration/runs/start.test.ts |
| DATA-029 | 2.4, 6.1 | integration/trace/append.test.ts |
| DATA-030 | 2.4, 6.3 | integration/runs/readiness.test.ts |
| DATA-031 | 2.4, 6.4 | integration/runs/documents.test.ts |
| DATA-032 | 2.4, 6.4 | integration/runs/frame.test.ts |
| DATA-033 | 2.4, 7.3 | integration/assistant/delegate.test.ts |
| DATA-034 | 2.4, 7.3, 8.1 | integration/reliance/stances.test.ts |
| DATA-035 | 2.4, 8.1 | integration/reliance/actions.test.ts |
| DATA-036 | 2.4, 8.1 | integration/reliance/escalations.test.ts |
| DATA-037 | 2.4, 8.2 | integration/runs/lock.test.ts |
| DATA-038 | 2.4, 9.1 | integration/runs/turn.test.ts |
| DATA-039 | 2.4, 9.2 | integration/defense/flow.test.ts |
| DATA-040 | 2.4, 8.2 | integration/runs/pause.test.ts |
| DATA-041 | 2.5, 10.4 | integration/scoring/score-run.test.ts |
| DATA-042 | 2.5, 10.4 | integration/scoring/score-run.test.ts |
| DATA-043 | 2.5, 11.2 | integration/debrief/flow.test.ts |
| DATA-044 | 2.5, 11.1 | integration/review/neutralize.test.ts |
| DATA-045 | 2.5, 11.1 | e2e wt-14 |
| DATA-046 | 2.5, 11.1 | integration/review/decisions.test.ts |
| DATA-047 | 2.5, 10.4 | integration/notifications/service.test.ts |
| DATA-048 | 2.5, 3.2, 13.5 | integration/admin/service.test.ts |
| DATA-049 | 2.5, 7.1 | integration/llm/calls.test.ts |
| DATA-050 | 2.5, 2.8 | integration/rate-limit/sliding-window.test.ts |
| DATA-051 | 2.7 | integration/jobs/queues.test.ts |
| DATA-052 | 2.2, 3.2 | integration/tenancy/agreements.test.ts |
| DATA-053 | 10.3 | unit/scoring/bands.test.ts |
| DATA-054 | 11.4 | unit/components/layout/illustrative-sample.test.tsx |
| DATA-055 | 2.2, 11.2 | integration/courses/mapping.test.ts |

## 5. Integrations

| ID | Build steps | Tests |
|---|---|---|
| INT-001 | 0.4, 0.6, 0.10 | integration/system/ready.test.ts |
| INT-002 | 0.10, 0.11, 15.4 | `scripts/smoke.sh` in production.yml |
| INT-003 | 3.1 | unit/email/templates.test.tsx, integration/email/send.test.ts |
| INT-004 | 3.2, 3.4 | integration/auth/flows.test.ts (provider config), unit/components/auth/sign-in-form.test.tsx (button visibility) |
| INT-005 | 13.2 | integration/analytics/track.test.ts |
| INT-006 | 13.1 | unit/logging/ops-events.test.ts, `scripts/sentry-test.ts` |
| INT-007 | 14.1, 14.6 | unit/llm/openai-compatible.test.ts, evals (real) |
| INT-008 | 14.1, 14.2 | unit/llm/anthropic.test.ts, unit/llm/circuit-breaker.test.ts |
| INT-009 | 0.8, 0.9 | workflow runs (`gh run list`) |
| INT-010 | 2.7 | integration/jobs/queues.test.ts |
| INT-011 | 1.1, 1.6, 13.7 | `scripts/impeccable-gate.mjs` in CI |

## 6. AI capabilities

| ID | Build steps | Tests |
|---|---|---|
| AI-001 | 12.1, 12.2, 14.1, 14.4 | integration/authoring/pipeline.test.ts, evals/authoring |
| AI-002 | 7.1, 7.2, 7.3, 14.1, 14.3 | integration/assistant/delegate.test.ts, evals/assistant |
| AI-003 | 10.4, 14.2 | unit/scoring/reads.test.ts, evals/scoring |
| AI-004 | 7.2 | unit/assistant/triggers.test.ts, evals/assistant |
| AI-005 | 12.1 | unit/llm/mock-generation.test.ts, unit/scenarios/validate.test.ts (readiness rule) |

## 7. Analytics

| ID | Build steps | Tests |
|---|---|---|
| AN-001 | 12.2, 13.2 | integration/authoring/measures.test.ts, unit/analytics/events.test.ts |
| AN-002 | 13.2 | unit/analytics/events.test.ts, integration/analytics/coverage.test.ts |
| AN-003 | 13.2 | unit/analytics/events.test.ts, integration/analytics/coverage.test.ts |
| AN-004 | 13.2 | unit/analytics/events.test.ts, integration/analytics/coverage.test.ts |
| AN-005 | 10.4, 13.2 | integration/scoring/score-run.test.ts, unit/analytics/events.test.ts |

## 8. Production necessities

| ID | Build steps | Tests |
|---|---|---|
| SYS-001 | 3.2, 3.4 | integration/auth/flows.test.ts, e2e auth/*.spec.ts |
| SYS-002 | 3.2, 3.4 | integration/auth/flows.test.ts |
| SYS-003 | 3.3, 3.5 | integration/identity/me.test.ts, e2e auth/settings.spec.ts |
| SYS-004 | 3.3, 3.5 | integration/identity/me.test.ts, integration/identity/purge.test.ts |
| SYS-005 | 3.1, 3.5, 4.3 | integration/tenancy/invitations.test.ts, e2e instructor/roster.spec.ts |
| SYS-006 | 13.5 | integration/admin/service.test.ts, e2e admin/admin.spec.ts |
| SYS-007 | 13.5, 15.3 | a11y/public.spec.ts, launch checklist (human review) |
| SYS-008 | 1.4 | e2e system/errors.spec.ts |
| SYS-009 | 0.6, 2.7 | integration/system/ready.test.ts, e2e system/health.spec.ts |
| SYS-010 | 3.1, 10.4, 11.4 | integration/notifications/service.test.ts |
| SYS-011 | 3.2, 11.1, 13.5 | integration/admin/service.test.ts, integration/review/*.test.ts (audit rows) |
| SYS-012 | 0.5, 2.8, 13.4 | integration/rate-limit/sliding-window.test.ts, integration/rate-limit/coverage.test.ts |
| SYS-013 | 0.4, 14.6 | unit/lib/config.test.ts, unit/llm/registry.test.ts |
| SYS-014 | 0.5, 13.1 | unit/logging/ops-events.test.ts |
| SYS-015 | 0.6, 13.3 | unit/security/csp.test.ts, e2e/security/headers.spec.ts |
| SYS-016 | 0.10, 13.6 | backup workflow run, restore drill |
| SYS-017 | 0.3, 0.8, 0.9 | workflow runs, branch protection check |
| SYS-018 | 1.5 | a11y/dev-components.spec.ts, unit/app/dev-guard.test.ts |
| SYS-019 | 0.7 and `pnpm openapi:check` in every phase | integration/api/coverage.test.ts |
| SYS-020 | 2.7 | integration/jobs/queues.test.ts |
| SYS-021 | 0.2 | unit/lib/i18n.test.ts |
| SYS-022 | 0.5 | unit/http/define-route.test.ts |
| SYS-023 | 0.4 | unit/lib/config.test.ts |
| SYS-024 | 2.9, 5.3 | integration/db/seed.test.ts |
| SYS-025 | 13.4, 14.2 | integration/logging/redaction.test.ts, integration/llm/no-pii-outbound.test.ts |
| SYS-026 | 5.2 | integration/scenarios/import-export.test.ts |
| SYS-027 | 3.3, 13.6 | integration/identity/retention.test.ts |
| SYS-028 | 3.2 | integration/tenancy/agreements.test.ts |

## 9. Deferred by PRD scope (priority W): no build step by design

| ID | Future-state capability | Design accommodation in the build |
|---|---|---|
| FR-019 | Readiness refresh, retakes, modes, thresholds, coaching flag, accommodation time | `runs.mode` enum, `readiness_expires_at`; every run opens Standard |
| FR-032 | Live stakeholder interviews | `action_type` enum includes `stakeholder_interview`; stakeholders as documents |
| FR-058 | Reliability calibration, live probe, extraction surfacing | Probe object supported when authored |
| FR-094 | Generative escalation colleague | Authored replies only |
| FR-116 | Library ratio, Turn re-authoring | Adaptation neutralization path exists per run |
| FR-127 | Spoken defense, 48-hour window, Defense Missed, deeper follow-ups | `run_state` includes `defense_missed`; scoring branch exists |
| FR-144 | Inter-rater measurement, batch confirmation, calibrated boundaries | Bands carry evidence; rubric versioned |
| FR-156 | Next-run lock, shown-back answers, harder variant, in-debrief appeal | Debrief answers stored |
| FR-160 | Critique Runs | `run_type` enum, `critique_weight_factor` |
| FR-173 | Multi-run record, summary export, verification link, hide, delete, transfer | `run_records.hidden_from_export` |
| FR-186 | Review queue, batch confirmation, cohort view, appeals, pattern flags | Illustrative queue rendered in 11.4 under the label |
| FR-199 | Human authoring from a blank page, calibration, publication | Package JSON import (SYS-026) |
| FR-207 | Defense Missed counting as Novice | Points branch exists |
| FR-208 | Setup flow, roster load, join codes, scheduling, gradebook integration, team scenarios | `courses.policy_overrides` |
| FR-215 | Accommodation information handling | `runs.accommodation_applied` |
| FR-216 | Accommodation workflow, captions, segmented defense | none required |
| FR-220 | Leak monitoring and rotation | `scenario_variants.retired_at` |
| AN-006 | Pilot-only metrics | none required |

## 10. Gaps

None. Every ID in `01-prd-analysis.md` §5 with priority M, S, or C has at least one build step and at least one test above; every W row is deferred by PRD §12 and carries its accommodation.
