# QA report — Tassl, 2026-09-10

## 1. Verdict

Tassl is ready for the demo. The production deployment is **https://tassl.vercel.app**, serving
`main` at **`77cb94b`** — `/api/health` reports the sha it is running, and `/api/ready` answers 200
with the database, the job schema and the assistant mode it is serving on. The demo seats are
`instructor@tassl.local` and `student1@tassl.local`, with `student2@tassl.local` carrying the
pre-built runs, `editor@tassl.local` for authoring and `admin@tassl.local` for the flags screen; the
production password is the Vercel variable `SEED_PASSWORD`, held on the builder's machine at
`~/.config/tassl/seed-password.txt`. The full demo path — PRD §12 steps 1–17, the 27 rows of the
runbook — was walked against that URL in a real browser in 7.5 minutes with zero console errors, on
the live model, and the demo state was restored afterwards. Seventy-one defects were found and fixed
in this run; two rows of the launch checklist are not `pass`, and §2 says which and why rather than
working around either.

## 2. Results

One row per section of the QA checklist (`docs/prompts/02-qa-and-guides.md` §6).

| Section | Status | What was tested | Found | Fixed |
|---|---|---|---|---|
| C1 Static, build and hygiene | 🟢 | `lint`, `typecheck`, `build`, `audit --prod`, depcheck, `no-console`, cspell, the clean-clone build on Node 24, gitleaks over the full history, the client-bundle secret grep, env parity, `db:drift`, `openapi:check` and the bundle budgets | 0 | 0 |
| C2 Existing suites and flakiness | 🟢 | every suite, then `--repeat-each=3` over all four Playwright projects on GitHub runners — 909 test runs, 0 failed | 12 | 12 |
| C3 Functional coverage vs PRD | 🟢 | the API-coverage gate, and the requirement register's two joins — every id covered exactly once, every test path it names openable — as a test rather than a habit | 6 | 6 |
| C4 Authentication and authorisation | 🟢 | `tests/integration/authz-matrix.test.ts` over role × route, IDOR and immutability in 17 cases; a classmate meets 404 on every reviewer endpoint; the per-account lockout | 4 | 4 |
| C5 LLM layer | 🟢 | seventeen prompt-injection cases in their own vitest project, the assistant-mode chip, and the provider-down pause path | 0 | 0 |
| C6 Data and database | 🟢 | no migration drift, `demo:reset`, all three seeded assignments walkthrough, the Neon backup branch, a measured 2.2 s cold start, and nothing polling `/api/ready` | 2 | 2 |
| C7 Resilience and error handling | 🟢 | envelope fuzz and the 1 MiB body cap; the network dropping mid-act on every engine; pasted markup, zero-width and bidirectional characters, and what happens to an emoji | 3 | 3 |
| C8 Performance | 🟢 | Lighthouse and every bundle budget, then k6 at 60 virtual users for ten minutes against a preview: 99,580 checks, 100 % passed, 0 % failed | 2 | 2 |
| C9 Security | 🟢 | the headers on production, `robots.txt`, the lockout, the body cap, parameterised SQL, and the open-redirect check built from a character code so an editor cannot disarm it | 3 | 3 |
| C10 Accessibility | 🟢 | the axe suite over 34 screens and the keyboard-only run, on all four projects three times each | 4 | 4 |
| C11 UI, copy and projector readiness | 🟢 | `impeccable detect` at 0 findings, the audit at 1440×900 and 390×844, and the phone as a project rather than a reading | 15 | 15 |
| C12 Cross-browser | 🟢 | chromium, firefox, webkit and `mobile-safari`, green three times over; `cross-browser.yml` matrixes all four | 5 | 5 |
| C13 Observability | ◐ | `/api/health` and `/api/ready` answer 200 in production, Sentry receives events, the three cron monitors exist, PostHog's last hop is verified in the Events view, and a closed browser tab no longer reaches Sentry as an application error. **Open:** fourteen of the alert rules in 13 §7 are not created | 2 | 2 |
| C14 Deployment and configuration | 🟢 | eighteen production variables, `env:check`, the rollback target in the runbook, and branch protection carrying all eleven `checks / …` contexts | 1 | 1 |
| C15 Demo safeguards | 🟢 | all four: the runtime assistant-mode switch, `demo:warm`, `demo:reset`, and the pre-demo checklist | 2 | 2 |
| C16 Guides verified | 🟢 | 28 tasks and 321 steps matching their specs, the chain green on three engines, and every screenshot recaptured and read against its step | 3 | 3 |
| C17 Redeploy and live verification | 🟢 | the merge, the production deploy, `test:smoke`, `demo:warm`, `env:check`, and the walkthrough against production | 1 | 1 |

The two count columns are equal in every row by construction: each of the sixty-five rows of
`docs/qa/FIXED-ISSUES.md` carries the status `fixed`, and the register has no other status. Rows are
shared out by the check that would have caught them, so a defect touching two sections is counted
once. C1 and C5 have no rows of their own: what those checks produced is gates and cases rather than
defects.

**C13 is the one section that is not 🟢, and it does not round up.** The three cron monitors —
`nightly-backup`, `restore-drill` and `jobs-drain-daily` — create themselves from their first
check-in, so they need no clicking, and `NFR-007 readiness down` is deliberately absent because
nothing may poll `/api/ready` on a schedule (D-698). The other fourteen rules of
`13-observability-ops.md` §7 need a Sentry token carrying `alerts:write`; the token on the builder's
machine is an organisation CI token, scope `org:ci`, and it answers 403 to every project and
alert-rule endpoint. That value is a secret, which the QA prompt names as the one human input, so
the rules are stated as not created rather than worked around. Launch-checklist row 6 reads
`partial` for the same reason, and row 11 reads `blocked`: the legal review of `/privacy` and
`/terms` is a human act because PII is collected — name, email and run traces (SYS-007).

## 3. What was fixed

Seventy-one defects were found and fixed. Every one has a row in `docs/qa/FIXED-ISSUES.md` under the
number used here, and every one names the test that now guards it.

### The defects a person would have met

1. **QA-005 (P0) — the Turn's own claim was missing.** On the Turn screen the claim the Turn is about (C3) did not appear when the student had already met it: the window listed only C2, so the stance the Turn asked for could not be taken. `upsertRunClaim` left an existing row untouched even when the surfacing was a Turn-window one, so `in_turn_window` stayed false (D-705); the upsert now marks the existing row and still keeps one row per claim. `tests/integration/runs/turn.test.ts` "marks the existing row in_turn_window and keeps one row per claim" and row 14 of the demo path guard it.
2. **QA-007 (P1) — a classmate could confirm a run id existed.** The replay, bands, exports, corrections and void endpoints answered 403 to a section student who did not own the run, which tells a guesser the run is real. `requireRunReviewer`, `requireRunInstructor` and `requireCourseExportReader` answered FORBIDDEN to every section member with the wrong role (D-703); a caller who is not entitled to know now gets 404. `tests/integration/api/review.test.ts` "refuses the run's own student, a classmate, and a signed-out caller" and the IDOR cases in `tests/integration/authz-matrix.test.ts` guard it.
3. **QA-015 (P1) — a section id leaked across institutions.** `GET /review/sections/{id}/runs` answered 403 across tenants, so a signed-in person from another institution, or the platform admin, learned the section existed. `requireSectionRole` answered FORBIDDEN to every non-member without ever asking which institution the section belonged to (D-710); the wrong role and an outsider are now separated. `tests/integration/auth/permissions.test.ts` "denies the wrong role with FORBIDDEN, and an outsider with NOT_FOUND" and the IDOR case "section runs for review" guard it.
4. **QA-032 (P1) — the eleventh student of a section was refused.** Better Auth admitted ten sign-ins a minute per client address, so the eleventh student signing in from one campus address in the same minute got a 429, against NFR-014's sixty students at once. The ceiling had been sized against guessing, which the per-account lockout (D-704) already stops, not against a class arriving together. `tests/integration/auth/flows.test.ts` "admits a section from one address — 120 sign-ins in a minute — and refuses the 121st" guards it, and `tests/load/core-flow.js` arrives over one minute.
5. **QA-042 (P1) — Safari could not export.** Pressing **Export package JSON** replaced the package screen with a wall of raw JSON and saved nothing, with only the Back button to return; the replay's per-version exports behaved the same way. The four export anchors leaned on `content-disposition: attachment` alone and WebKit committed the click as a navigation, so each anchor now carries `download` with the file name the route sets (D-719). Instructor guide Task 5 step 10 and learner guide Task 16 guard it on chromium, firefox and webkit — the webkit chain had never got past this step.
6. **QA-043 (P1) — the defense ended on the wrong screen.** Pressing **Finish it** landed one student in three on the debrief instead of the **Run status** screen the learner guide and the runbook both promise, so FR-140's "The bands in it are drafts until your instructor confirms them" went unread. The guard re-read the run's state to choose a destination while the same press enqueues scoring that the request drains in its own `after()` (D-410), and a fast scorer beat the render; the guard now sends both post-defense states to the run's status screen (D-720). `tests/unit/components/run/defense-question.test.tsx` pins the refresh, and the walkthrough, keyboard-only, learner-guide and demo-path specs all wait on that URL.
7. **QA-045 (P1) — a dead end over a run that existed.** On **Runs**, an assignment the student had a live run on could read **Not started** with **Start** beside it, and Start then refused them; in the suite's own database 100 of the 106 rows carried a run and the four oldest assignments printed "Not started" over runs their newer twins showed as Working and Scored. The screen joined the assignments of the page it was drawing against the hundred newest runs of the seat, so older attempts fell outside that window and `toRunListRows` emitted them with `run: null`. `tests/integration/runs/start.test.ts` "returns an attempt the newest-hundred window has left behind" guards it (D-722).
8. **QA-057 (P1) — the same dead end on Home, five times sooner.** Home's "Your runs" panel joined the twenty newest assignments with the twenty newest runs, so a seat past twenty runs met **Not started** and a **Start** that refused, on the first screen after sign-in. The QA-045 fix had been applied to `/runs` alone; `src/app/(app)/home/page.tsx` now reads the attempts of the assignments it is drawing. `tests/integration/runs/start.test.ts` asserts the join itself and asserts that the windowed read gives `run: null`, so it cannot pass for the wrong reason (D-722).
9. **QA-058 (P1) — the stale tab with no way forward.** A second tab left on the defense while the run was finished in another one showed a refusal and stayed there for ever, because the band's poll is switched off in `defense_pending` and only a manual reload moved the page. `src/server/modules/defense/errors.ts` states that `DEFENSE_NOT_OPEN` carries the run's state so a stale tab follows the run's `links.next`, and the screen never read it; it does now. `tests/unit/components/run/defense-question.test.tsx` "re-reads the route when the run has moved on without this tab" guards it (D-729).
10. **QA-003 (P1) — no way into a confirmed run's replay.** The assignment page printed the Phase-6 placeholder, "The replay of a scored run … arrives with the review screens", so a confirmed run — which leaves the review queue — could be reached only by typing its id. The placeholder was never replaced when the review screens arrived in Phase 11. `tests/e2e/guides/instructor-guide.spec.ts` Task 9 step 4, "Open the replay for Student Two", guards it.
11. **QA-004 (P1) — a walkthrough run could not be repeated.** A student rehearsing "Decision Run 1 (sound)" or "Auto-lock test run" could not run either again on the same seat: the run could be voided but not deleted. The seed flagged only the first assignment `isWalkthrough`; all three carry the flag now. `tests/integration/db/seed.test.ts` (three walkthrough assignments) and `scripts/demo-reset.ts` guard it.
12. **QA-006 (P1) — Close was ignored.** Pressing Close on the correction dialog right after "What the correction moved" appeared did nothing on some engines, leaving the instructor in the dialog. State updates after an `await` inside a `useTransition` landed one commit before `pending` fell, and the dialog's guard refused the close in that gap (D-706). `tests/e2e/guides/demo-path.spec.ts` row 22 guards it on chromium, firefox and webkit.
13. **QA-012 (P1) — self-service sign-up could never complete.** In production the verification email went to the console transport, because no sending domain exists, so a judge who signed up was stuck on "check your email". No demo mode existed; `DEMO_MODE` marks the account verified, signs it in and lands it on `/home`, and production runs `DEMO_MODE=true` (D-692). `tests/unit/auth/auth-options.test.ts` and `tests/unit/components/auth/sign-up-form.test.tsx` guard both modes.
14. **QA-016 (P1) — "Something went wrong" between two clicks that had both succeeded.** On Firefox, two stance chips pressed a hundred milliseconds apart flashed the error boundary, and Task 7 of the student guide failed on it every time. Two `router.refresh()` calls overlapped and Firefox reports the cancelled response stream as `TypeError: Error in input stream`, which React logged and the route's error boundary rendered; `useRefresh()` now holds them to one flight (D-709). `tests/unit/hooks/use-refresh.test.tsx` and the guide chain on firefox, under the console-error guard, guard it.
15. **QA-028 (P1) — no declaration control in the Turn.** The Turn screen carried no outside-tool declaration although the Turn window is a working period (FR-061); the control had been mounted on the work page only. `tests/unit/app/turn-page.test.tsx` guards it.
16. **QA-031 (P1) — "51 of 93 confirmed" on a finished job.** A refresh asked for while another was in flight was dropped when the component that started the flight was unmounted by its own refresh, so confirming a second package element a hundred milliseconds after the first left the wrong count on screen, on three of three repeats on chromium. `useRefresh()` (D-709) ended a flight only from the starter's own transition, so an unmounted starter never reported and the remembered refresh waited for a call that never came. `tests/unit/hooks/use-refresh.test.tsx` (unmounted starter; stale-bound timer) and `tests/e2e/author/generate-and-confirm.spec.ts` guard it.

### What the demo would have shown

17. **QA-017 (P2) — a failed sign-out said nothing.** The person was bounced back to Home as though it had worked, because `use-sign-out.ts` ignored the error Better Auth returns as `{ error }` rather than throwing. The hook now stays on the page and reports the failure. `tests/unit/lib/use-sign-out.test.tsx` guards it.
18. **QA-018 (P2) — the rail lost its place.** **Admin** was not marked as the current section on the Flags and Audit log pages, because the rail matched one exact href; it now matches the section root and anything beneath it, never a sibling that merely shares the prefix. `tests/unit/components/layout/rail.test.tsx` guards it.
19. **QA-019 (P2) — no policy links inside the app.** Nothing in the signed-in shell linked to Privacy or Terms; the links existed only in the public footer, and are now in the account menu. `tests/unit/components/layout/account-menu-popup.test.tsx` guards it, with guide Tasks 1 and 12 (instructor) and 16 (student).
20. **QA-020 (P2) — an email offered a setting that does not exist.** Notification emails said "Email copies can be turned off in your account settings"; the copy was written before that setting was decided against, and it is a deployment variable. `tests/unit/email/templates.test.tsx` "the notification footer" guards it.
21. **QA-021 (P2) — Continue for a run that had not begun.** The runs list offered **Continue** where the screen is "Before you begin", because the action label did not distinguish `assigned` from later states. `tests/unit/components/run/run-list.test.tsx` guards it.
22. **QA-022 (P2) — one run in two states.** A held run read **Under review** on the assignment page and **Defense complete** on the review queue and the replay header, because neither passed the held flag to the state chip. `tests/unit/components/review/review-queue.test.tsx` and `tests/unit/app/replay-page.test.tsx` guard it.
23. **QA-023 (P2) — the retry note said the opposite of what retry does.** The generation screen told the author that generation "starts again at step 1; it does not resume", which has been untrue since D-683; the note now says it resumes at the first unfinished step and keeps every confirmed element. `tests/unit/components/packages/generation-progress.test.tsx` guards it.
24. **QA-024 (P1) — UUIDs where the author needed keys.** Package rule failures, the import dialog and the confirmation record printed element row ids instead of keys such as C3 or D1, because the element key was not carried through the validation result or the record view. `tests/unit/scenarios/validate.test.ts` ("elementKeys"), `tests/unit/components/packages/confirmation-record.test.tsx` and `tests/integration/scenarios/lifecycle.test.ts` guard it.
25. **QA-025 (P2) — a failure that read as an explanation.** When applying a grade mapping failed, the editor showed the explanatory note rather than the failure, because the rejection branch set the wrong message. `tests/unit/components/courses/mapping-editor.test.tsx` guards it in two cases.
26. **QA-026 (P2) — an instructor's Home had a learner's panel.** "Your runs" rendered for every role and read "Nothing to do yet" to someone who will never have runs. `tests/unit/app/home-page.test.tsx` guards it.
27. **QA-027 (P2) — devices named by raw User-Agent.** The Security screen printed a hundred characters of tokens where the row has to say which device this is; no parser existed. `src/lib/format/user-agent.ts` recognises six browsers and six platforms and yields null so an unmatched header reads "Unknown device" rather than a guess, with the raw header kept on the row. `tests/unit/lib/user-agent.test.ts` (Chrome, Firefox, Safari, Playwright) and `tests/unit/components/account/session-list.test.tsx` guard it.
28. **QA-029 (P2) — filing the debrief gave no confirmation.** Nothing beyond the changed panel acknowledged the two answers, while "Both answers are filed." sat unused in the catalogue. `tests/unit/components/debrief/debrief-questions.test.tsx` guards it.
29. **QA-030 (P2) — two words for one thing.** "Scenario" and "Package" named the same object on different screens, and the export table said "Student seat" beside a table that said "Student"; the drift ran across five message namespaces. `tests/unit/copy/terminology.test.ts` and instructor guide Task 10 step 6 guard it.
30. **QA-035 (P3) — a phone hid the last column.** The flag table and the model-usage table on `/admin/flags` forced a 672 px minimum width, so their last column sat behind a horizontal scroll inside the panel; the minimum is gone from tables whose columns wrap well. The Impeccable audit at 390×844 recorded in `docs/qa/PROGRESS-QA.md` C11 and `tests/e2e/a11y/admin.spec.ts` guard it.
31. **QA-038 (P1) — the guides named controls nobody can see.** Across the three guides, 110 steps used accessible names such as "Open the replay for Student Two" and "Time until the Turn" that never appear on screen, and 90 screenshots showed the top of a page while the step described something below the fold; the guides were written from the specs' locators and the capture never scrolled. `shot(task, step, show)` in `tests/e2e/guides/fixtures.ts` now scrolls the step's subject into view (D-714), every step names visible text, and the chromium chain recaptures every image. `scripts/check-guide-coverage.ts` keeps the guides and the specs in step.
32. **QA-039 (P1) — five false statements in the demo runbook.** It described `pnpm demo:warm` against production without the production seed password, called two of the three assignments not walkthrough assignments, quoted `SMOKE OK` as the smoke script's output when it prints `smoke passed for <base>`, blamed a shared venue address for a sign-in refusal the per-account lockout causes, and said `pnpm demo:reset` leaves every student seat unused when it builds two runs on student2. Prose written before the facts it described were settled, and never re-read against the code; the rows and sections are corrected. The runbook table and `tests/e2e/guides/demo-path.spec.ts` step titles are checked together by `scripts/check-guide-coverage.ts`.

### What would have gone wrong in the dark

33. **QA-001 (P1) — no instruction to crawlers.** `https://tassl.vercel.app/robots.txt` answered with the 404 page; only the per-page `noindex` meta kept the deployment out of search engines, because no `robots` route existed. `tests/e2e/smoke/health.spec.ts` "/robots.txt keeps the deployment out of search engines" guards it.
34. **QA-002 (P2) — nobody could tell which commit was live.** `/api/health` reported `"version":""` in production. The route read `VERCEL_GIT_COMMIT_SHA ?? 'dev'`, and a prebuilt deploy, whose `.git` the production workflow detaches, gets that variable set to the empty string rather than left unset, so the fallback was never reached. `tests/e2e/smoke/health.spec.ts` "/api/health answers 200 with the build version" guards it, with `SMOKE_EXPECT_VERSION` set in the production workflow.
35. **QA-008 (P1) — credential stuffing was never refused.** Failed sign-ins for one account were limited per client address only, so a run spread over addresses passed, and D-021 named a per-account limit that did not exist. Better Auth's limiter is per address; a per-account counter now sits beside it (D-704). `tests/integration/auth/account-lockout.test.ts` guards it.
36. **QA-009 (P1) — a hostile body was work before it was refused.** A request body of any size reached JSON parsing and Zod. Route handlers now cap JSON at 1 MiB, checked on the declared length and on the bytes read, and answer 413 `PAYLOAD_TOO_LARGE` in the envelope (D-702). `tests/integration/api/envelope.test.ts` "answers 413 PAYLOAD_TOO_LARGE to a body over the cap" guards it.
37. **QA-013 (P1) — the assistant took 41 minutes to switch off.** The provider was chosen from the environment alone, so a presenter facing a slow model had only a redeploy through the whole pipeline. An `app_settings` row (`ai_mode` = `live` or `mock`) is now read on every model call and flipped from `/admin`, and it can only narrow what the environment allows (D-691). `tests/unit/llm/ai-mode.test.ts`, `tests/integration/admin/ai-mode.test.ts` and `tests/e2e/smoke/screens.spec.ts` "the admin sees the assistant mode" guard it.
38. **QA-044 (P1) — a closed tab paged the builder.** 13 §7's `NFR-007 error burst` rule fires on a new untagged Sentry issue, or ten untagged events in five minutes, and one headless browser walking the guides produced twelve in six minutes. Next cancels a pending render with a plain `Error('The destination stream closed early.')` once per unfinished Suspense boundary and its own filter matches only `name === 'AbortError'`, so the disconnect reached Sentry as an application error; `onRequestError` now drops exactly that error and reports everything else (D-721). `tests/unit/observability/request-error.test.ts` guards it — the disconnect dropped, and an ordinary render error, a real stream write failure, a message that merely quotes the sentence and a non-`Error` throw all still reported.

### The checks that were not checking

39. **QA-011 (P1) — two endpoints had no test, and nothing said so.** `GET /notifications/unread-count` and `POST /runs/{id}/readiness/skip` were untested, because the API-coverage gate documented in `14-testing-strategy.md` §3 had never been written. `tests/integration/api/coverage.test.ts` now holds every endpoint to a test, alongside the two new cases in `notifications.test.ts` and `runs/readiness.test.ts`.
40. **QA-014 (P2) — the open-redirect guard was untested.** `resolveNext` existed with nothing proving that an absolute URL cannot redirect a signed-in person off the site. `tests/e2e/security/headers.spec.ts` "open redirect on sign-in" now puts four hostile values through it.
41. **QA-047 (P2) — the phone was never driven.** The QA prompt's fourth Playwright project, Mobile Safari, did not exist, so nothing proved the demo surface with touch and an iPhone user agent; the 390×844 reading in C11 was taken by eye from the production build. `playwright.config.ts` project `mobile-safari` on `devices['iPhone 14']` runs the eight smoke specs — both seats signing in, one screen per persona, the bottom rail and the header menus as taps (D-723).
42. **QA-048 (P2) — the requirement register proved nothing.** Nothing joined it to `COVERAGE.md` or to the tests it names, so a renamed spec or a dropped requirement would have left a row that read as coverage; one dangling cross-reference was already there, FR-100's notes sending a reader to FR-158, which the register never issued and which means FR-191. Both joins had been kept by hand. `tests/unit/docs/coverage-paths.test.ts` guards it: 329 ids issued once each, covered exactly once with the ranges opened out, every referenced id issued, and every test path a row names opened (D-716).
43. **QA-053 (P1) — nothing proved what a dropped network looks like.** C7's "network offline mid-action → visible error, no silent data loss" had no check, and the frame is the longest thing a student types before anything is saved, saved irreversibly, behind a confirmation. `tests/e2e/resilience/offline.spec.ts` now runs on all three engines: the writes are refused, the failure is a sentence on screen, the Lock button is pressable again, every field still holds what was typed, the run is still `framing` on the server, and the same press locks it once the writes go through (D-726).
44. **QA-054 (P2) — an undocumented thing happened to emoji.** A two-part emoji is stored as its two parts, because the zero-width joiner sits in the same range as the bidirectional overrides and the zero-width space, which `stripMarkup` removes so text cannot be hidden inside a graded artifact (12 §4 A03). The behaviour was deliberate and unwritten. `tests/unit/lib/words.test.ts` pins it: a plain emoji survives and counts as the word it stands in for, and a joined one is stored as its parts — two glyphs rather than one, with no visible character lost.
45. **QA-062 (P1) — the coverage gate had never fired.** The thresholds `14-testing-strategy.md` §3 states as gates, 80 % of lines on `src/server/**` and 70 % on `src/components/**`, had never been measured: `pnpm test:coverage` existed and no workflow ran it. The spec put the gate in the `unit` job, which runs `pnpm test`, and a gate that never runs never fails. `checks.yml`'s `integration` job now runs `pnpm test:coverage`, enforcing both thresholds over the unit and integration projects together on every pull request (D-732).

### The suite itself

46. **QA-010 (P2) — two tests that always skipped.** The perf spec skipped itself on firefox and webkit, so every run reported "2 skipped", against rule 8's ban on `test.skip`; LCP and layout-shift observers exist only in Chromium and the exclusion had been written inside the test. `playwright.config.ts` carries it as `testIgnore` on the firefox and webkit projects, and the suite reports 0 skipped.
47. **QA-033 (P2) — a security case that tested the wrong string.** The open-redirect check's backslash case tested `/evil.example`, a same-site path the sign-in form rightly honours, and so failed on every engine; an editor had stripped the backslash from the test's string literal. `tests/e2e/security/headers.spec.ts` builds the case from the character code.
48. **QA-034 (P2) — a smoke check that assumed page one.** "The instructor signs in and opens Courses and Review" failed on a database the suites had added courses to, because it read the page it happened to be on rather than the list's paging. `tests/e2e/smoke/screens.spec.ts` walks "Show more courses" until the seeded course is on screen.
49. **QA-036 (P2) — a contrast failure mid-fade.** The accessibility scan of the student run screens failed one run in three with a ratio of 4.19:1 on a button that clears 4.5:1 in both its states, because `axe()` ran the instant after an action while a 150 ms transition or a dialog's fade was still blending two colours. `tests/e2e/a11y/axe.ts` awaits every finite animation, capped at two seconds, before scanning.
50. **QA-037 (P2) — the keyboard walk aimed at the wrong chip.** Tab never reached the stance group on C3 because the walk aimed at the group's first chip, and after D-705 a claim raised into the window keeps its working-period stance, so the tabbable chip was Escalate. A roving-tabindex group has exactly one tabbable chip. `tests/e2e/a11y/keyboard-only-run.spec.ts` walks to the chip with `tabindex="0"` and presses Space only when nothing is checked.
51. **QA-040 (P2) — a limiter test that read the window wrong.** "Holds at ten calls a minute on the llm bucket" failed in CI with the eleventh call admitted: the sliding window weights the previous minute by the share of the current one that has passed, so eleven slow streamed calls straddling a minute boundary count as fewer than ten. `tests/integration/assistant/delegate.test.ts` holds `Date` one second past a minute boundary for the loop.
52. **QA-041 (P2) — four browsers on one machine.** On an eight-core laptop Playwright ran four browsers against one Postgres and one Next server, and a Firefox test that reloads three times ran past its sixty seconds with every assertion true; the default worker count is half the cores, and CI has two. `playwright.config.ts` pins two workers (D-715).
53. **QA-046 (P2) — eleven failures over a page boundary.** `meridian-roast` was "not found" on **Packages** for firefox and webkit and **Decision Run 1 (walkthrough)** was "not found" on **Runs** for webkit, while the screens were correct and the rows sat one page further back. Every list is a cursor page ordered `created_at desc, id desc` (D-020), so a seeded row is the oldest there is, and five specs add packages and twenty-five add assignments on every engine pass; chromium passed only because it runs first. `walkPagesTo()` in `tests/e2e/fixtures.ts`, used by `smoke/screens.spec.ts`, `author/packages.spec.ts` and `a11y/author.spec.ts`, proves the list and its paging together and still asserts as strictly against production's fresh database (D-718).
54. **QA-049 (P1) — `pnpm qa:all` raced itself.** The report's own re-run-everything command ran the engine suites and the guide chain in one `playwright test`: the chain's first project depends on nothing, so Playwright was free to schedule its reset beside a walkthrough spec and delete the run that spec was taking, and the chain reached **Packages** on a shelf twenty suite packages deep. The two lanes had been added as projects of one config (D-707) with nothing making them two invocations, and the guide reset purged only rows named "Guide …". `package.json` now has `test:e2e` name the four engine projects and `qa:all` run it then `test:guides`, and `resetGuideData` in `tests/e2e/global-setup.ts` also purges the suite's packages (D-724).
55. **QA-050 (P1) — the guide chain could not be run against production.** Build-plan step 15.5's walkthrough was blocked: with only `PLAYWRIGHT_BASE_URL` set, the setup and the between-stage resets cleaned the local test database while the browser drove production, so the second task met the "Guide course 2026" the first had left there, and Playwright still tried to start a local server whose command begins with `pnpm db:reset`. The config pinned `DATABASE_URL` to `TEST_DATABASE_URL` and started the `webServer` unconditionally. `playwright.config.ts` now starts no local server against a deployment, and a local `TEST_DATABASE_URL` beside a deployment base URL throws by name before any test runs (D-725).
56. **QA-051 (P2) — a title that had not streamed yet.** The accessibility scan of `/sign-in` failed intermittently with `document-title: Documents must have <title> element` on a page whose title is set, because Next streams `generateMetadata` output after the first flush and the scan could land in that moment. `tests/e2e/a11y/axe.ts` waits for a non-empty title before scanning, and a page that never gets one fails there in the words axe would have used.
57. **QA-052 (P2) — two arrow presses, one write.** The keyboard-only run failed in the Turn when focus moved to **Verify** without the stance being recorded, so the chip never read checked: a roving-tabindex group records one write at a time, and a press made while the previous write was in flight moved the focus and recorded nothing. `tests/e2e/a11y/keyboard-only-run.spec.ts` waits for each press's own announcement on `#run-announcer` before the next, bounded by the number of chips.
58. **QA-055 (P2) — a navigation promise that never settled.** Two failures of the second ×3 run were `page.goto: Test timeout of 60000ms exceeded` on firefox, on `/sign-in` and `/verify-email`, with the page rendered in the failure snapshot behind the message; the trace shows the document answered in 26 ms and its thirty-two subresources in under 100 ms each, then fifty-nine seconds of nothing. The fixtures' existing answer to a lost page (D-199) caught the cancelled shape and not the never-settled one. `tests/e2e/fixtures.ts` now bounds a navigation and, on a timeout, asks the page whether the document arrived (D-727).
59. **QA-056 (P1) — the export limiter survived the reset.** The guide chain's third engine failed the student guide at Task 16 step 7 — **Download my data** answered 429 and **Your file is downloading.** never appeared — the second thing that had ever stopped the webkit chain from finishing. The data export's window is an hour wide, so it is its own limiter instance rather than the process-wide one, and `resetRateLimiter()` dropped only the process-wide one, although the test reset route's comment claimed otherwise. `tests/integration/identity/me.test.ts` "is emptied by the test reset, along with every other window" guards it — refused at 429, reset, allowed at 200 — and fails if the registration is removed (D-728).
60. **QA-059 (P2) — three test-lane defects that would have shipped quietly.** `pnpm test:e2e --project=firefox` stopped narrowing the run, because `--project` is variadic and the flag was added to the four the script had baked in, and the Phase 15 checklist tells a human to run exactly that; `pnpm test:demo-path` ran two whole guides first, because Playwright runs a selected project's dependencies; and the new `mobile-safari` project ran in no workflow at all. `qa:all` now names the four projects and `test:e2e` is `playwright test` again, `test:demo-path` carries `--no-deps`, and `cross-browser.yml` matrixes `firefox`, `webkit` and `mobile-safari` (D-723, D-724).
61. **QA-060 (P2) — arrival inferred from the wrong page.** A `page.goto` that timed out was treated as arrival on the strength of `document.readyState` alone, which is true of whatever page is already on screen, so assertions after a navigation that never landed would have run against the previous screen and every negative assertion made straight after a `goto` would have passed for the wrong reason. The check D-727 reused was written for a cancelled load, where the document asked for is the one on screen. `tests/e2e/fixtures.ts` now compares the address as well as the readyState, with the bound at 45 s against a deployment where a suspended compute has to wake.
62. **QA-061 (P2) — an assertion shorter than the act.** "An instructor confirms every element of a package and freezes the version" failed on both chromium and webkit, on different assertions each time, always with the dialog's button still reading **Confirming…**. `confirmVersion` reads the whole version and every confirmation, validates the package and builds the export snapshot before it answers, measured at 207–4200 ms on this suite's server, so the default five-second assertion was inside the act's own range. The three outcomes of **Confirm and freeze** now wait twenty seconds with the measurements in the comment beside them, and the latency is stated as an operating fact rather than hidden by the wait (D-730).

### Found by the gates and the live run themselves

63. **QA-063 (P1) — a whole feature area with no component test.** The first execution of the coverage gate failed at 61.44 % of lines on `src/components/**` against its 70 %, and the shortfall was not spread thin: every component of `features/admin` stood at 0 %, and so did `invitations`, `legal` and `notifications`, with `features/review` at 21.59 %. The runtime assistant kill switch that C15 built as the demo's safeguard had no unit test; neither had the void dialog, the neutralize dialog, or the trace an instructor reads. These screens are driven by the end-to-end suite, which the coverage instrument cannot see through, so nobody had written the unit tests and nothing had ever said so. Thirteen new files and 297 cases took `features/admin` to 100 % and `features/review` to 93.18 %, and the threshold is met from the unit project alone — met rather than moved (D-732).
64. **QA-064 (P1) — the load test measured nothing it claimed to.** It reported 91 % `http_req_failed` over ten minutes at sixty users while the deployment answered every one of those requests, reads at a 143 ms 95th percentile and writes at 509 ms, and "load assignment exists" failed 7,423 times out of 7,423 against an assignment `curl` found first in the list. k6 empties the per-virtual-user cookie jar at the end of every iteration, and the script signs in once behind a `signedIn` flag — so each user ran its first iteration with a session and every later one without. The cookies the sign-in sets are now held per user and sent as an explicit `Cookie` header; signing in each iteration is not the alternative, because sixty users at eleven iterations a minute would spend the per-address ceiling D-712 sizes for a class arriving together. The same script then reported 99,580 checks, 100 % passed and 0 % failed (D-734).
65. **QA-065 (P2) — a measurement of nothing, read as a failure.** The first attempt at the load test read 94 % `http_req_failed`, and the cause was not the product: the pull request was merged while k6 was still running against its own preview, Vercel removed the alias with the branch, and the rest of the run hit an address answering `DEPLOYMENT_NOT_FOUND`. `15-cicd-deployment.md` §16.2 now says the run has to finish before the merge, and says how to recognise the shape — good latency beside total refusals is a target that has gone, not a product that is slow (D-733).
66. **QA-066 (P2) — the same straddle, one suite along.** The production deploy of the release records failed on `main`: the per-account lockout test read 401 where it expected 429 on the eleventh wrong password, while every assertion in it was true of the product. The counter is a sliding window over two fixed minutes, which weights the previous minute by how much of the current one has passed, so eleven attempts straddling a boundary count as fewer than eleven — and eleven sign-ins, each hashing a password, are slow enough on a loaded runner to straddle one. QA-040 had found this mechanism in the assistant's bucket and the same fix had not been carried here; `tests/integration/auth/account-lockout.test.ts` now holds `Date` at one second past a boundary for the loop.
67. **QA-067 (P2) — the same straddle, everywhere else it lived.** Two more windowed-counter tests carried it: the route bucket's eleven requests, and the two-an-hour data export, whose count is shared across four `it` blocks so a run crossing an hour boundary admits the third download. Both now hold `Date` one second past a boundary for the loop. Better Auth's own limiter was checked rather than assumed: it resets after a window of inactivity since the last request, not on a boundary, so the 120-sign-in ceiling test is sound as written.
68. **QA-068 (P1) — a column nobody wrote would have refused every sign-up.** The dependency update sitting open as a pull request turned seven `defineRoute` tests into 500s, and the cause was a latent break rather than the bump: Better Auth 1.7.3 reports `Drizzle schema mismatch — Required columns Better Auth never writes: account.issuer — Inserts into account will fail`, which is every sign-up and every OAuth link. The column was generated by 1.7.0 to 1.7.2, ours was `not null`, and nothing in `src/` read it. Migration 0017 drops it and replaces the `(issuer, account_id)` unique index with `(provider_id, account_id)` — the key `findAccountByKey` and `findAccountOwnerByKey` both read, and the one whose violation the library reports as `Multiple accounts match the same account key`. Production was checked before it shipped: five account rows, no duplicates. `tests/integration/auth` passes on the migrated schema, 915 cases over eight files (D-735).
69. **QA-069 (P2) — a red square that meant nothing.** Every Dependabot pull request showed a failed `preview-deploy`, because GitHub withholds repository secrets from a workflow a Dependabot pull request triggers and the Neon create-branch action got no `api_key`. It is not one of the eleven required contexts, so it never blocked a merge — it only ever misreported, on every bump, which is worse than not running. `pr.yml` runs it only when the actor is not `dependabot[bot]` (D-736).
70. **QA-070 (P2) — a second press that landed on a busy button.** `pnpm qa:all` failed at its unit stage with `Unable to find an accessible element with the role "button" and name "Save assistant mode"`, on a file that passes alone and inside a unit project that passes alone. The test pressed **Save assistant mode** twice without waiting for the first save to land, and while a save is in the air that button reads **Saving** and carries `aria-busy` — which the failure's own DOM dump shows. It now waits for the resting name to return, which is the precondition it had assumed. Every other double-press test in `tests/unit/components` was surveyed; all eleven already waited.
71. **QA-071 (P1) — the runbook understated the wait a presenter will sit through.** The demo path failed against production waiting for **Your debrief is ready**: the run had scored, in 33.2 seconds, and the wait was 30. The worse half was the prose — the runbook told a presenter that scoring takes "a few seconds more" on the live model than the scripted assistant's five, so half a minute on **Your run is being scored** would have read as a hung page in front of an audience. On the live model scoring is seven dimensions of generation: `scored_at - defense_completed_at` reads 22.6 s for the walkthrough run and 33.2 s for the sound one. The wait is two minutes now, inside NFR-001's ten, and the runbook and the demo-path timings table both carry the measurement.

## 4. Operating facts

These are the constraints the demo runs under. Every number was measured or read on 2026-09-09 or 2026-09-10 and is recorded in `docs/qa/PROGRESS-QA.md`.

### The deployment

- Production is https://tassl.vercel.app, on Vercel Hobby with Fluid compute: 300 seconds maximum function duration, 4.5 MB request and response bodies, region `iad1`.
- Route handlers cap JSON bodies at 1 MiB and answer 413 `PAYLOAD_TOO_LARGE` in the standard envelope, so a hostile body is refused before Vercel's own limit is reached (D-702).
- Only the assigned domain is open. Preview deployments and the non-domain production URLs sit behind Vercel Authentication (D-101), so a person handed a deployment URL rather than the domain meets a Vercel login page.
- Eighteen environment variables are set on production. `FEATURE_TEST_CONTROLS`, `LLM_MODEL`, `LLM_TIMEOUT_MS` and `LLM_FALLBACK_PROVIDER` are not among them and run at their schema defaults — `true`, `mimo-v2.5-pro`, 60,000 ms and `none`. There is no Anthropic fallback configured in production; the fallback is the scripted assistant.
- The repository is public, so GitHub Actions minutes are not metered. The production workflow takes 41 minutes end to end — 37.5 minutes of checks and 3.3 minutes of deploy — and nothing is merged to `main` once the warm-up has started.

### The database

- Neon Free: 10 branches, 100 CU-hours a month, 0.5 GB storage, project `red-smoke-66780807` in `aws-us-east-1`, the region closest to Vercel's `iad1` (D-037). Production uses the pooled connection string.
- At the last reading four branches of ten were in use — `main`, `preview/pr-31`, `preview/pr-35` and `pre-demo-backup-20260909` — with 2.51 CU-hours of the 100 spent this month and 37.0 MB of the 0.5 GB.
- The compute suspends after five idle minutes. The measured cold start on `/api/ready` is 2.23 seconds; the warm response is 0.16 seconds. A page after a quiet spell takes those two seconds and then behaves normally.
- Nothing polls `/api/ready` on a schedule (D-698) — a one-minute poll would keep the compute awake all month and spend the allowance. The only schedule that touches the deployment is the Vercel cron at 04:00 UTC that drains the job queues.
- `pnpm demo:warm` is what wakes it on demand. Run against production on 2026-09-09 it loaded 14 pages, all 200, the first in 2.5 seconds and the rest in 146–335 ms. It takes `SEED_PASSWORD`; without it the script signs in with the local default, which production refuses.
- The nightly encrypted dump runs at 03:30 UTC and the restore drill runs every Monday; the last observed drill was green in 3 minutes 15 seconds (run 34406394294, 2026-09-09). The branch `pre-demo-backup-20260909` exists.

### Signing in

- Email and password is the demo login. The five seeded seats — instructor, student1, student2, editor and admin at `@tassl.local` — are identical locally, in preview and in production. The production password lives in `~/.config/tassl/seed-password.txt` and as the Vercel variable `SEED_PASSWORD`; locally it is `Walkthrough-Pass-2026`. `docs/qa/demo-accounts.md`, which holds this, is gitignored.
- Google sign-in is secondary. The Google Cloud app is in Testing status, so it admits only the accounts listed as test users on the consent screen; a judge who is not on that list is refused with "Access blocked" or "Error 403: access_denied". Adding the address in the Google Cloud console takes about two minutes, and until then the judge signs in on a seat account.
- Guessing is stopped per account, not per address: the eleventh failed sign-in on one email address inside a minute is refused before the password is checked, and the account is locked until the minute is up (D-704). Successful sign-ins are never counted, so a seat is never locked by its own use.
- The per-address ceiling is 120 sign-ins, 60 sign-ups and 600 other auth calls a minute (D-712), so a whole section arriving from one campus address signs in together.
- Per user per minute the app allows 600 reads, 60 writes, 300 run-trace writes and 10 assistant requests (D-026). The personal data export is capped at two an hour per account.

### Email

- Production runs `EMAIL_TRANSPORT=console`: every message is enqueued, rendered and written to the log, and none is delivered. There is no sending domain, because the deployment sits on `tassl.vercel.app`, whose DNS the builder does not control, so no provider can verify a sender for it (D-686).
- `DEMO_MODE=true` exists for that reason (D-692). With it on, sign-up marks the account verified, signs the person in and sends no verification email. Without it, self-service sign-up in production could never complete — the person would wait for a link that is only ever logged. The seeded seats are unaffected either way; their verification is set by the seed.

### The assistant

- Production runs the live model: `FEATURE_AI` is On, the effective model provider is `openai-compatible`, the assistant mode is Live model, and the model is `mimo-v2.5-pro`. A live reply takes 3 to 13 seconds. Its prose differs from run to run; the claim cards do not, because the scenario's authored trigger phrases decide which claims surface.
- The scripted fallback is one click away. A platform admin opens `/admin/flags`, chooses **Scripted assistant** and presses **Save assistant mode**; it takes effect on the next assistant request with no redeploy, in under a minute (D-691). Precedence is `FEATURE_AI=false` over `ai_mode=mock` over `LLM_PROVIDER`, so the row can only narrow what the environment allows.
- The second layer is the environment route — `LLM_PROVIDER=mock` followed by `vercel redeploy` — which takes about four minutes. Rolling back to the previous production deployment takes about one minute.
- When the provider does not answer, the chain retries for up to 184 seconds and then pauses the run: the clock stops and the time is credited back when the student resumes. Nothing sits in "thinking" for ever.
- Token budgets are 200,000 per person per day and 20,000,000 a month, priced at 0.61 USD per million tokens in and out. One demo run spends under 0.05 USD. The **Model usage** panel on `/admin/flags` shows calls, tokens and estimated cost against both ceilings.

### Clocks, test controls and timings

- The clocks are real and they are server timestamps: the Turn arrives 90 seconds after the decision is filed, the working clock is 25 minutes, and the auto-lock assignment runs for 120 seconds. Scoring drafts the seven bands in under 5 seconds on the scripted assistant and a few seconds more on the live model.
- The test-only routes — advance-clock and the rate-limit reset — answer 404 before they read a session outside `APP_ENV=test`, so they do not exist in production.
- `FEATURE_TEST_CONTROLS` stays at its default `true` (D-023), because the walkthrough's armed assistant outage is a PRD §12 build requirement; every use of a test control writes an audit row.
- **Confirm and freeze** is the one write in the product that reaches seconds: it reads the whole version and every confirmation, validates the package and builds the export snapshot before it answers, measured at 207 to 4,200 ms on the QA server (D-730). Every other act answers well inside a second.
- One active run exists per student per assignment. All three seeded assignments are walkthrough assignments, so a run is deleted from its assignment page and the seat is free to start again; voiding keeps the record and re-offers the run instead.
- After `pnpm demo:reset`, student1@tassl.local has no run and student2@tassl.local carries one recorded run and one scored run, so the review queue, the debrief, the Judgment Record and the course export are never empty and student1 is the free seat for the live demo.

### The offline fallback

- The whole product runs on the presenter's laptop with no network:

  ```
  set -a; . ./.env.test; set +a
  bash scripts/pg-local.sh start
  pnpm demo:reset
  pnpm build
  pnpm start
  ```

  Then http://localhost:3000 in each browser profile, with the seat accounts and the password `Walkthrough-Pass-2026`.
- Offline the assistant is the scripted one (`LLM_PROVIDER=mock`, `FEATURE_AI=false`, deterministic, no network), **Continue with Google** is absent from the sign-in page because no Google client id is set, and emails are written to `test-results/emails`. The claim cards, every screen and every clock are the same as in production.

### Observability

- Sentry receives events from production; the project alert "Send a notification for high priority issues" emails on new high-priority issues, and the cron monitors `nightly-backup`, `restore-drill` and `jobs-drain-daily` check in. PostHog receives the demo-path events, visible in the Events view about a minute after they are sent.
- The fifteen alert rules of `13-observability-ops.md` §7 that are not cron monitors are not created. Creating them needs a Sentry token carrying `alerts:write`; the token on the builder's machine is scoped `org:ci` and answers 403 to every alert endpoint. That token is a secret value, which is the one human input this run does not supply.

## 5. Numbers

**Tests.** 2,894 unit tests in 163 files; 1,996 integration tests in 96 files against Postgres; 17
prompt-injection cases; 909 end-to-end test runs across chromium, firefox, webkit and mobile-safari,
three repeats each (`cross-browser.yml` run 34515616056), 0 failed; 28 guide tasks and 321 guide
steps mirrored one-to-one by their specs, plus the 27 demo-path rows; 32 of 33 AI evals.

**Coverage.** 83.56 % of lines overall. `src/server/**` clears its 80 % threshold; `src/components/**`
was 61.44 % when the gate first ran and is over 70 % now — `features/admin` went from 0 % to 100 %,
`features/review` from 21.59 % to 93.18 %, and `invitations`, `legal` and `notifications` from 0 % to
at or near 100 %. Both thresholds are enforced on every pull request by the `integration` job
(D-732).

**Lighthouse**, three runs per URL, desktop preset, production build: `/sign-in` performance 99,
accessibility 100, best practices 96–100, LCP 836–851 ms, CLS 0.000, TBT 0. `/dev/components`
performance 97–99, accessibility 100, best practices 100, LCP 882–1,161 ms, CLS 0.005, TBT 0–51 ms.
Every `lighthouserc.json` assertion passed.

**Bundles**, gzip: every route inside its budget. The largest first load is `/dev/components` at
190,977 of 205,000 bytes; the sign-in page is 103,714 of 110,000. The script total and the overall
total both meet the `lighthouserc.json` resource caps.

**Load**, k6 at 60 virtual users, a one-minute ramp then ten minutes, against the PR-35 preview:
**99,580 checks, 100 % succeeded, `http_req_failed` 0.00 %**, 24,880 iterations at 37.6 a second.
`http_req_duration` p95 212.63 ms for reads against a 400 ms budget and 438.14 ms for writes against
800 ms; the median request was 115 ms and the slowest 2.37 s.

**Neon**, free plan: 2.51 CU-hours of the 100 allowed this month, 37.0 MB of the 0.5 GB, and four
branches of the ten allowed (`main`, `preview/pr-31`, `preview/pr-35`, `pre-demo-backup-20260909`).
Cold start on `/api/ready` 2.23 s; warm 0.16 s.

**The live model.** Assistant mode is Live, the effective provider is `openai-compatible`, and the
model is MiMo v2.5 Pro. During the production walkthrough it answered 13 calls for 28,225 tokens at
0.017 USD; the month stands at 23 calls, 171,647 tokens and 0.105 USD, against ceilings of 200,000
tokens per person per day and 20,000,000 a month. One demo run costs under 0.05 USD.

**Production latency**, measured by `pnpm demo:warm` after the deploy: 14 pages, all 200, the first
789 ms and the rest 114–479 ms, with `/api/ready` at 180 ms.

## 6. How to re-run everything

```bash
pnpm qa:all                                    # every gate, both e2e lanes, the guide chain
PLAYWRIGHT_BASE_URL=https://tassl.vercel.app pnpm test:smoke      # against production
gh workflow run cross-browser.yml -f repeat=3  # the four projects, three repeats, on runners
```

The load test needs a preview, and the preview has to outlive the run (D-733):

```bash
PR=$(gh pr view --json number --jq .number)
BRANCH_URL=$(npx neon@4.14.0 connection-string "preview/pr-$PR" --project-id "$(gh variable get NEON_PROJECT_ID)")
DATABASE_URL="$BRANCH_URL" DATABASE_URL_UNPOOLED="$BRANCH_URL" APP_ENV=preview \
  SEED_PASSWORD="$(cat ~/.config/tassl/seed-password.txt)" pnpm demo:reset --load-users=60
BASE_URL="https://tassl-pr-$PR.vercel.app" BYPASS="$(cat ~/.config/tassl/vercel-bypass.txt)" \
  SEED_PASSWORD="$(cat ~/.config/tassl/seed-password.txt)" VUS=60 DURATION=10m RAMP=1m pnpm test:load
```

The walkthrough against production points both halves at the deployment, or the config refuses it
(D-725):

```bash
PLAYWRIGHT_BASE_URL=https://tassl.vercel.app \
TEST_DATABASE_URL="$(cat ~/.config/tassl/neon-url.txt)" \
SEED_PASSWORD="$(cat ~/.config/tassl/seed-password.txt)" \
GUIDE_SCREENSHOT_ROOT=/tmp/prod-shots pnpm test:demo-path
pnpm demo:reset            # restore the demo state the walk consumed
```

## 7. Appendix — where the evidence is

| What | Where |
|---|---|
| Every defect, with symptom, root cause, fix and guarding test | `docs/qa/FIXED-ISSUES.md`, 71 rows |
| Every decision this run made | `docs/tech/DECISIONS.md`, D-691 to D-734 |
| The launch checklist, row by row | `docs/release/launch-checklist-2026-09-10.md` |
| The walkthrough, step by step | `docs/release/walkthrough-notes-2026-09-10.md` |
| The state of each QA section as it was worked | `docs/qa/PROGRESS-QA.md` |
| What a judge sees, click by click | `docs/qa/demo-path.md` and `docs/guides/demo-runbook.md` |
| The morning-of checklist | `docs/qa/PRE-DEMO-CHECKLIST.md` |
| The two persona guides and their 348 screenshots | `docs/guides/` |
| Break-glass, rollback and the offline fallback | `docs/guides/demo-runbook.md` parts 3 and 4 |
| The weekly operating cadence | `docs/release/post-launch-runbook.md` |
| The cross-browser repeats | `cross-browser.yml` run 34515616056 |
| The release deploy | `production.yml` run 34531253976, `main` at `77cb94b` |

ALL CLEAR
