# The Tassl user manual

Everything you need to operate Tassl, written for someone who has never seen it. Each file covers one
role from end to end: what you can do, every screen you can reach, every button on it, and what
happens after you press it.

Start with [What Tassl is](00-what-tassl-is.md), whatever your role. Then read your own file.

## Which file is for whom

| If you are … | Read | What it covers |
|---|---|---|
| Anyone, first | [What Tassl is](00-what-tassl-is.md) | What the app does, the four roles, the journey from a blank assignment to a number in a gradebook, and what Tassl never does |
| Teaching a course | [The instructor manual](01-instructor.md) | Courses, sections, rosters, invitations, assignments, the course policy, the points mapping, exports, reading scenario packages, the review queue, the four graphs, the seven bands, corrections and voiding |
| Taking a run | [The learner manual](02-learner.md) | Your runs, the Readiness Check, the scenario and the Evidence Room, your frame, the assistant, claims and stances, checks, escalations, the decision brief, the lock, the Turn, the defense, your debrief and your Judgment Record |
| Running the platform | [The platform admin manual](03-admin.md) | The admin area, users and the one platform role each account holds, deployment flags, the assistant mode switch, model usage, the audit log, and the full access a Platform Admin has everywhere else |
| Writing and publishing scenarios | [The scenario editor manual](04-scenario-author.md) | The package shelf, building a package from a seed case, generation, the version screen, claims, the confirmation workspace, confirming (publishing) a version, export and import |

## Guided practice runs

The manual explains every screen. The guides walk one path through them, step by step, with a
screenshot for every click. Read the manual to understand a screen; follow a guide to rehearse.

- [The student guide](../guides/learner-guide.md) — sixteen tasks, sign-in to a closed run.
- [The instructor guide](../guides/instructor-guide.md) — eleven tasks, creating a course to
  exporting results.
- [The demo runbook](../guides/demo-runbook.md) — the timed path through a live demonstration.
- [The guides index](../guides/README.md) — who reads what.

## Demo logins

A seeded installation carries five accounts, one for each role and a second student. Four of them
belong to the institution **Walkthrough University**, which holds the course **Marketing Strategy
Walkthrough**, its section **A** and the scenario package **Meridian Roast (fixture)**; the Platform
Admin belongs to no institution and needs no membership to reach it.

| Email | Name on screen | Role | What it is for |
|---|---|---|---|
| `instructor@tassl.local` | Instructor Seat | Instructor | Teaches section A; owns the course |
| `student1@tassl.local` | Student One | Student | A student of section A, with no runs taken |
| `student2@tassl.local` | Student Two | Student | A student of section A, with one finished run and one waiting to be reviewed |
| `editor@tassl.local` | Scenario Editor | Scenario Editor | Writes scenario packages and confirmed the seeded one |
| `admin@tassl.local` | Platform Admin | Platform Admin | Runs the platform, with full access to every institution |

They share one password, set when the installation was seeded. On a local installation it is
`Walkthrough-Pass-2026`; ask whoever set your installation up for theirs.

Every account holds exactly one of the four roles, and only a Platform Admin changes it, on the
**Users** screen — see [the platform admin manual](03-admin.md).

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
