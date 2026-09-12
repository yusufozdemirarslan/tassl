# The Tassl user manual

Everything you need to operate Tassl, written for someone who has never seen it. Each file covers one
role from end to end: what you can do, every screen you can reach, every button on it, and what
happens after you press it.

Start with [What Tassl is](00-what-tassl-is.md), whatever your role. Then read your own file.

## Which file is for whom

| If you are … | Read | What it covers |
|---|---|---|
| Anyone, first | [What Tassl is](00-what-tassl-is.md) | What the app does, the six kinds of user, the journey from a blank assignment to a number in a gradebook, and what Tassl never does |
| Teaching a course | [The instructor manual](01-instructor.md) | Courses, sections, rosters, invitations, assignments, the course policy, the points mapping, exports, scenario packages, the review queue, the four graphs, the seven bands, corrections and voiding |
| Taking a run | [The learner manual](02-learner.md) | Your runs, the Readiness Check, the scenario and the Evidence Room, your frame, the assistant, claims and stances, checks, escalations, the decision brief, the lock, the Turn, the defense, your debrief and your Judgment Record |
| Running the platform | [The platform admin manual](03-admin.md) | The admin area, users and platform roles, deployment flags, the assistant mode switch, model usage, the audit log — and what an admin deliberately cannot reach |
| Writing scenarios | [The scenario author manual](04-scenario-author.md) | The package shelf, building a package from a seed case, generation, the version screen, claims, the confirmation workspace, confirming a version, export and import |
| Helping to mark | [The teaching assistant manual](05-teaching-assistant.md) | The review queue, reading a replay, the graphs, the trace, and exactly which band decisions a teaching-assistant seat may take |
| Running a programme | [The program lead manual](06-program-lead.md) | Courses across the programme, read-only sections and assignments, the course policy, the points mapping, exports, and institution membership |

## Guided practice runs

The manual explains every screen. The guides walk one path through them, step by step, with a
screenshot for every click. Read the manual to understand a screen; follow a guide to rehearse.

- [The student guide](../guides/learner-guide.md) — sixteen tasks, sign-in to a closed run.
- [The instructor guide](../guides/instructor-guide.md) — twelve tasks, creating a course to
  exporting results and authoring a package.
- [The demo runbook](../guides/demo-runbook.md) — the timed path through a live demonstration.
- [The guides index](../guides/README.md) — who reads what.

## Demo logins

A seeded installation carries five accounts. They all belong to the institution **Walkthrough
University**, which holds the course **Marketing Strategy Walkthrough**, its section **A** and the
scenario package **Meridian Roast (fixture)**.

| Email | Name on screen | What it is for |
|---|---|---|
| `instructor@tassl.local` | Instructor Seat | Teaches section A; owns the course; confirms package versions |
| `student1@tassl.local` | Student One | A student of section A, with no runs taken |
| `student2@tassl.local` | Student Two | A student of section A, with one finished run and one waiting to be reviewed |
| `editor@tassl.local` | Scenario Editor | Writes scenario packages; never confirms one |
| `admin@tassl.local` | Platform Admin | Runs the platform; belongs to no institution |

They share one password, set when the installation was seeded. On a local installation it is
`Walkthrough-Pass-2026`; ask whoever set your installation up for theirs.

Two of the seats this manual documents are not seeded, because in the product they are given to a
person rather than created ready-made:

- A **Teaching assistant** seat is handed out by an instructor, from a section's roster — see
  [Sections and the roster](01-instructor.md#sections-and-the-roster). The screenshots in
  [the teaching assistant manual](05-teaching-assistant.md) were taken on a seat added that way.
- A **Program lead** seat is written when the institution itself is created, and no screen in the app
  changes an existing seat afterwards. The screenshots in
  [the program lead manual](06-program-lead.md) were taken on a seat an administrator had added to
  the seeded institution.

If you are following this manual on a seeded installation and want either seat to try, ask whoever
administers your installation to add it.

## How to read this manual

- Bold type is exactly what you see on screen: **Lock the frame** is a button with those words on it.
- Quotation marks hold a sentence the app writes to you, word for word.
- Screenshots are the real screens of a seeded installation at 1440 × 900. Your own numbers and names
  will differ; the layout will not.
- Every role file has the same ten sections in the same order, so once you know your way around one,
  you know your way around all of them: who you are, signing in and your home screen, the navigation
  map, dashboards, features, the AI assistant, notifications and settings, common situations, error
  messages, and a glossary.

## What this manual does not cover

Installing, deploying, configuring or backing up Tassl. Those belong to whoever runs your
installation, not to any role inside the app.
