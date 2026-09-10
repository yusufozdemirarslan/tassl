# Walkthrough notes — 2026-09-10

**Purpose / Read this when:** you are running Step 15.5 of `build-plan/phase-15-release.md`, or you
want to know that PRD §12 steps 1–17 were completed on the production deployment and what was
observed at each.

Release: `main` at `77cb94b`, served by `https://tassl.vercel.app` (`/api/health` reports
`77cb94baf31f14ebcecd72820277b163836ceb4a`). Assistant mode **live**, effective provider
`openai-compatible` (MiMo). `FEATURE_TEST_CONTROLS` is on, which walkthrough step 7 needs (D-023).

**How it was walked.** In a real Chromium against the production URL, driven by
`tests/e2e/guides/demo-path.spec.ts` — the same 27 rows as `docs/guides/demo-runbook.md`, which
`scripts/check-guide-coverage.ts` keeps in step with it. There is no time travel on production: the
advance-clock route answers 404 outside `APP_ENV=test`, so every clock in this walk was waited out
(D-109, D-725). Command:

```bash
PLAYWRIGHT_BASE_URL=https://tassl.vercel.app \
TEST_DATABASE_URL="$(cat ~/.config/tassl/neon-url.txt)" \
SEED_PASSWORD="$(cat ~/.config/tassl/seed-password.txt)" \
GUIDE_SCREENSHOT_ROOT=<scratch>/prod-shots \
pnpm test:demo-path
```

Result: **passed in 7.5 minutes**, 27 screenshots captured against production, and **zero console
errors or uncaught page errors** — the guide fixture fails the test on either (`consoleGuard`,
`tests/e2e/guides/fixtures.ts`). Seats were the two the runbook names: `instructor@tassl.local`
and `student1@tassl.local`, with `student2@tassl.local` carrying the pre-built runs.

## The seventeen steps

| Step | Seat | What was observed | Result |
|---|---|---|---|
| 1 Package | faculty | The package view for Meridian Roast (fixture) version 1: its id, its version, and the confirmation record naming who confirmed it and when. | pass |
| 2 Run start | student | The policy display before anything else: the outside-AI policy **Declared**, the weight 2.5, the mapping, and the sentence that this run counts. | pass |
| 3 Readiness | student | Sixteen items on an eight-minute clock, counted down from a server timestamp; the concept-map result afterwards carries no score, rank or percentile; Standard Mode. | pass |
| 4 Brief and room | student | The brief inside 200 words; the Evidence Room's nine dated, attributed documents; opens and closes recorded; the assistant panel saying it unlocks when the frame is locked. | pass |
| 5 Frame | student | Every field required inside its own limit, an incomplete frame refused, the lock irreversible, and the assistant unlocking without comment the moment it is locked. | pass |
| 6 Working period | student | The planted claim surfaced as a versioned claim object; the Delegation Log filling; Source Trace returning document, passage, date and author at one minute of the clock; a stance changed after the action with both kept; Challenge and Reject on non-load-bearing claims; Escalate with the authored reply at five minutes; the outside-tool declaration with its no-penalty sentence. | pass |
| 7 Forced failure | faculty then student | The instructor armed the outage from the replay's test controls; the next assistant call failed; the run went to **Paused** with the clock stopped, and the cost was credited on resume. The log row reads "No answer came back. The run paused, your clock stopped, and the time was given back when you resumed." | pass |
| 8 Lock | student | The lock refused while a relied-on claim had no stance, naming that claim; then the completed lock with typed numbers inside their word limits; a post-lock edit refused; the 50-word Addendum offered. The auto-lock run locked itself with empty fields and unstanced claims recorded. | pass |
| 9 The Turn | student | Fired 90 seconds after the decision was filed — waited out, not skipped; the assistant, the room and the actions reopened for twelve minutes; the window claim needed a stance; the response filed inside 150 words with an updated confidence beside the frozen record. | pass |
| 10 Defense | student | Typed questions including the provenance question for the stale figure; one authored follow-up; no assistant and no room; the brief, the frame and the Turn response visible while answering. | pass |
| 11 Scoring and draft debrief | student | Seven draft bands with evidence or marked unassessed; no composite score anywhere; the draft debrief with the mapping, the weight and the draft points. | pass |
| 12 Faculty replay | faculty | The trace in order; the four graphs; bands with their evidence one click away; one confirmed, one overridden with a note, the rest confirmed; the run left Scored only after the seventh; the default mapping applied with its arithmetic shown. | pass |
| 13 Debrief | student | The confirmed bands and the instructor's note in place of the drafts; claim by claim in run order; the missed defect with its document and the action that would have surfaced it; something done well; the confidence line; the Turn beside the frame; the clock; the counterfactual; the two questions, answered, moving the run to **Recorded**. | pass |
| 14 Export and record | faculty then student | The course export file carrying bands, mapping and points; the Judgment Record with the four graphs, the confirmed bands, the mode and variant, and the record trace — and carrying no weight, no mapping and no points. | pass |
| 15 Neutralize and void | faculty | One claim neutralised: the recompute did not lower the result, and the export was written again. The short run voided with a re-offer, leaving no partial result. | pass |
| 16 Sound variant | swapped | Steps 2–14 on the sound variant: the sound claim that warranted Accept was accepted without checking and scored as the stance it warranted. | pass |
| 17 Standing rules and accessibility | faculty then student | One dimension set unassessed and the points recomputed over the remaining dimensions; the whole run completed in text; every graph opening to its own table and description. Keyboard-only operation and the screen-reader path are proven on every engine by `tests/e2e/a11y/keyboard-only-run.spec.ts` and the axe suite over 34 screens rather than by this session. | pass |

Seventeen of seventeen. Nothing in the walk needed a code change, a restart, or an edit to stored
data; the one test control used is step 7's, which is what it exists for (FR-118).

**After the walk.** `pnpm demo:reset` was run against production, so the demo state is the one the
runbook describes: the seeded course, the three walkthrough assignments, and on `student2` one
recorded run and one scored run so the review screens are never empty.
