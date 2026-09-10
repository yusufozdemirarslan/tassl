# Demo path — what a judge sees, click by click

The demo path is PRD §12 "The walkthrough" (steps 1–17) on the seeded Meridian Roast package. Every
later QA section treats it as P0. Seats: the **Instructor** (`instructor@tassl.local`) and the
**Student** (`student1@tassl.local`; `student2@tassl.local` for the sound variant). Personas use the
product's own words: the PRD and the UI say Student and Instructor (`src/lib/i18n/messages/role.ts`);
"Learner" is never a persona in either.

What the seed leaves on the machine (`src/server/db/seed.ts`): institution Walkthrough University;
course "Marketing Strategy Walkthrough" (term 2026-fall, outside-AI policy Declared, default run
weight 2.5), section A with the instructor and both students; package "Meridian Roast (fixture)"
version 1, confirmed; three assignments on section A: "Decision Run 1 (walkthrough)" (defective
variant), "Decision Run 1 (sound)" (sound variant), "Auto-lock test run" (defective, 120-second
working clock). All three are walkthrough assignments, so a run on any of them can be deleted from the
assignment page and the demo can be repeated.

## Timings a presenter must know

| Moment | Time | Source |
|---|---|---|
| Readiness Check | 8 minutes, 16 items | `src/server/modules/runs/limits.ts` |
| Working clock | 25 minutes (starts when the frame is locked) | fixture `workingClockSeconds: 1500` |
| Source Trace / Replication / Decomposition | 1 / 3 / 4 minutes of the clock | fixture |
| Escalation | 5 minutes of the clock, two per run | fixture, `limits.ts` |
| The Turn | 90 seconds after the decision is filed | fixture `turnDelaySeconds: 90` |
| Turn window | 12 minutes | `limits.ts` |
| Auto-lock test run | 2 minutes after the frame is locked | seed `workingClockSeconds: 120` |
| Scoring on the scripted assistant | under 5 seconds | NFR-001 |

There is no time travel in a live demo: the advance-clock route exists only under `APP_ENV=test`.

## The path

### A. Instructor sets up (optional in front of a judge; the seed already did it)

1. `/sign-in` → **Sign in** → Home. Rail: Home, Courses, Review, Packages.
2. **Courses** → **New course** → Course name, Term → **Create course** → toast "{name} is ready." → course page with views Sections, Assignments, Policy, Mapping.
3. **Sections** → **New section** → Section name → **Add section** → **Open the roster for {name}** → **Add member** → Email address, Role in this section → **Add to section**.
4. **Assignments** → **New assignment** → Assignment name, Section, Scenario package version ("Meridian Roast (fixture) · version 1"), Variant (Defective / Sound), Working clock (seconds), Weight, Walkthrough switch → **Create assignment** → toast "{label} is ready."

### B. The student runs the defective variant (PRD steps 2–11)

5. Student: **Runs** → **Start Decision Run 1 (walkthrough)** → "Before you begin": run type, weight, outside-AI policy, band-to-points table, working clock, "The Readiness Check comes first" → **Begin the Readiness Check**.
6. "Readiness Check": 16 items, **Next item**, **Submit the check** → dialog **Submit** → "What the check read" (one sentence per concept, no score) → **Open the scenario**.
7. "The scenario": read **Scenario brief**; in **Evidence Room** click **Open {document}** on two or three documents (opens are recorded). The **AI assistant** panel is locked until the frame is locked.
8. **Your frame**: The decision (50 words), three Load-bearing assumptions (25 each), Your position now (100), Confidence → **Lock the frame** → dialog **Lock it** → chip "Working", **Working clock** starts, the assistant unlocks.
9. **AI assistant** → Your request: "What is the premium payback?" → **Ask the assistant** → "Reply complete. One claim surfaced." → card **Claim C3**. Ask "What is the price sensitivity, is the value tier saturated, and what did the survey find?" → three more claims (C5, C8, C7).
10. On each claim card: **Your stance on claim …** → Accept / Verify / Challenge / Reject / Escalate. **Check claim C5** → **Source Trace 1 min** → dialog shows Document, Passage, Date, Author. Change the stance afterwards → "Changed from …". **Reject** on C8. **Escalate claim C7** → "What you cannot settle" → **Send it** → "They answered".
11. **Delegation Log**: "Why you asked, delegation 1" → **Save**; **Mark claim C3 as used**. **Declare outside-tool use** → What you used, and what for → **Record it** → "Recorded. It sits with the run and changes nothing about it."
12. (Forced failure, PRD step 7.) Instructor: **Courses** → **Open Marketing Strategy Walkthrough** → **Assignments** → **Configure Decision Run 1 (walkthrough)** → in **Runs**, **Open the replay for Student One** → **Actions** → **Arm the outage**. Student sends any request → dialog "The run is paused" → **Resume the run**; the clock stopped meanwhile.
13. **Your decision brief**: Your recommendation (120), Why (250), three assumptions, What would change your mind (60), Confidence, "Premium payback you are betting on, in months" = 11 → **Lock the decision** → dialog "File this decision?" — refused while a relied-on claim has no stance ("A claim you leaned on has no stance") → take the stance → **File it** → "Decision locked" page: the filed decision, the locked frame, **Time until the Turn**, **Add an addendum** (50 words, one per run).
14. After 90 seconds the page moves to **The Turn**: "What arrived" (stakeholder message: month-three retention is 61 percent, not 78), **Turn window** 12:00, claims C2 and C3 need a stance, Hold / Revise / Reverse, Why (150 words), Confidence → **File the response** → the defense opens.
15. **The defense**: 6–9 questions, **Your answer**, **Submit answer**; an unsourced answer gets a **Follow-up**; **Finish the defense** → dialog **Finish it** → "Run status": "Your run is being scored" → "Your debrief is ready" → **Read the debrief**: chip Draft, seven "Draft band" cards, "Provisional points, draft", the twelve sections.

### C. The instructor reviews (PRD steps 12, 14, 15)

16. Instructor: **Review** → **Open the replay for Student One** → **Overview**: the four graphs (Confidence line, Clock timeline, Stance matrix, Frame beside decision), each with **Show data table**; Defense transcript; Delegation log. **Trace** tab: every event in order.
17. **Bands** tab: on Framing **Confirm the draft: {band}**; on Verification choose another band, write a **Note for the student (optional)**, **Record {band} instead**; **Confirm the remaining drafts** → dialog **Put the remaining drafts on the record** → "7 of 7 decided", the points table "({terms}) / 7 = {total}", **Course exports** → **Download version 1**.
18. **Package** tab (claim C3): Defective variant / Sound variant, Evidence status, Failure family "Stale evidence", the passage, Planted, how the claim was confirmed.
19. **Actions** tab: **Enter a correction on C3…** → reason, optional "Credit the student's challenge as correct", **Enter the correction** → "What the correction moved" (a correction never lowers a band; export version 2 is written) → **Close**. The auto-lock run's replay is reached the same way (**Configure Auto-lock test run** → **Open the replay for Student One**): **Void this run…** → reason, **Offer the student another run** → **Void the run** → the student's Runs page shows "This attempt was voided." and a new attempt.

### D. The student closes the run (PRD steps 13, 14)

20. Student: **Runs** → the run → **Read the debrief**: chip Confirmed, "Confirmed band" on every card, the overridden dimension shows "Your instructor wrote …", "Defects the decision rested on" names Claim C3 with the check that would have shown it, the confidence line, the Turn beside the frozen frame, the clock timeline, the counterfactual, "One thing this run did", Confirmed points. **Two questions** (100 words each) → **File both answers** → "Both answers are filed." → the run is Recorded.
21. **Judgment Record** (`/records/{runId}`): the four graphs, the seven confirmed bands with notes, Mode Standard, Variant Defective, **Download record** ("It carries no course arithmetic, so nothing in it is a grade.").

### E. The auto-lock branch (PRD step 8)

22. Student: **Start Auto-lock test run** → Readiness Check → lock the frame → do nothing for two minutes → the page moves to "Decision locked" with "Left empty." on every field and "No figure." on the named fields; the trace records the auto-lock. The instructor voids this run in step 19.

### F. The sound variant (PRD step 16), seats swapped

23. Student Two runs "Decision Run 1 (sound)": ask "What is the value tier payback?" → **Claim C1** → stance **Accept** without a check → **Mark claim C1 as used** → lock → the Turn (stance Verify on C2 and C3) → Revise → defense → the instructor confirms the remaining drafts → the confirmed debrief shows C1 "Your stance Accept / Warranted Accept / Same" and "Defects the decision rested on" is "Not drawn for this run"; the record shows Variant Sound.

### G. Standing rules and accessibility (PRD step 17)

24. Instructor: on `#band-ownership` choose **Unassessed** → **Record this dimension as Unassessed** → the points table divides by 6. Every run screen has one h1, a **Skip to main content** link, and every control reachable by Tab; each graph has **Show data table**.

## What must never appear on a student screen before scoring

The variant name, warranted stances, evidence status, failure families, the planted flag, verification results, the question bank, expected-answer notes, the seed record, and any other student's run. The scripted assistant never names a defect.
