# Tassl guides

Three documents live in this folder. Each one is written for one reader, in the product's own words: Student, Instructor, Scenario author, Platform admin; Decision Run; scenario package; claim; stance; the Turn; the defense; band; debrief; Judgment Record.

| File | Reader | What it covers |
|---|---|---|
| [instructor-guide.md](instructor-guide.md) | Instructor | Setting up a course, a section and an assignment; reading a run in the replay; confirming the seven bands; entering a correction; voiding a run; exporting to the gradebook. |
| [learner-guide.md](learner-guide.md) | Student (the file name says learner; the product and the guide say Student) | Starting a Decision Run; the Readiness Check; the Evidence Room; locking the frame; working with the AI assistant; taking stances on claims; filing the decision; the Turn; the defense; reading the debrief and the Judgment Record. |
| [demo-runbook.md](demo-runbook.md) | Presenter of a judged demo | The T-60 warm-up, the demo path click by click with what to say, the break-glass table, the fully offline fallback, and the seat plan. |

## Who reads what

**Instructor.** You teach a section, assign a Decision Run to it, and confirm the bands Tassl drafts on every run. Read `instructor-guide.md` from the top once; afterwards use its Tasks section as a reference, one task per thing you do. The section "What the AI does and does not do" tells you which parts of a run a model read and which parts came from the recorded events alone.

**Student.** You take one Decision Run: you lock a frame, work with the AI assistant under a clock, take a stance on every claim you rely on, file a decision, respond to the Turn, and defend the result without help. Read `learner-guide.md` before your first run; its Tasks follow the run in the order you meet it, and "Working with the AI assistant" explains what the assistant will and will not do for you.

**Presenter.** You are showing Tassl to a judge on the production deployment, with a live model and a real clock. Read `demo-runbook.md` the day before, run its T-60 list an hour before the demo, keep its break-glass table open on a second screen during the demo, and rehearse its offline fallback once on the laptop you will present from.

**Scenario author and Platform admin.** The Scenario author's screens (Packages, New package from a seed case, the generation steps, the confirmation workspace) and the Platform admin's screens (Users, Flags, Audit log) appear in the guides only where a demo or a task touches them: the instructor guide shows the confirmed package version that an assignment runs on, and the demo runbook uses the admin's Flags page as the first layer of the kill switch.

## Demo accounts

The same five seat accounts exist locally, in preview, and in production. They belong to the institution Walkthrough University, whose course is Marketing Strategy Walkthrough, section A.

| Email | Role in the product | Used by |
|---|---|---|
| instructor@tassl.local | Instructor member of Walkthrough University; instructor of section A; owner of the seeded course | Instructor guide; demo runbook (the Instructor seat) |
| student1@tassl.local | Student member, section A | Student guide; demo runbook (the Student seat on the defective variant) |
| student2@tassl.local | Student member, section A | Demo runbook (the Student seat on the sound variant) |
| editor@tassl.local | Scenario author member of Walkthrough University; platform role Scenario editor | Package authoring and confirmation |
| admin@tassl.local | Platform admin; no institution membership | The Admin area: Users, Flags, Audit log; the assistant kill switch |

The password is in `docs/qa/demo-accounts.md`, which is gitignored and never leaves the builder's machine:

- Local and CI: `Walkthrough-Pass-2026` (the value of `SEED_PASSWORD` in `.env.test`).
- Production (https://tassl.vercel.app): the value of the Vercel production variable `SEED_PASSWORD`, also held in `~/.config/tassl/seed-password.txt` on the builder's machine. The seed refuses the local default in production, so the two passwords are never the same.

## Guides and tests are one artifact

Guides and tests are one artifact - change both together. Every numbered step in the two persona guides is mirrored one to one by a Playwright test, and every "You see" is asserted as visible text. Run the mirror with:

```
pnpm test:guides
```

A green run rewrites the last line of each persona guide ("Verified by automated tests: date, commit"). A step you add to a guide without a matching test, or a test you change without changing the guide, fails `scripts/check-guide-coverage.ts`, which parses the guides' Tasks sections.
