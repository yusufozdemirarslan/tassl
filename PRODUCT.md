# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

delegated: Next.js 16 App Router, already scaffolded (TypeScript strict, Tailwind 4, shadcn/ui, Postgres via Drizzle, Better Auth). Pinned versions live in `docs/tech/04-repo-structure.md` §8.

## Users

Primary user: students in professional degree programs (third- and fourth-year undergraduates and MBA students in marketing and strategy courses) taking a Decision Run as coursework. They sit at a laptop, under a working clock, with an AI assistant in the room, and must reach a consequential business decision they will have to defend without help.

Second user: the course instructor who assigns runs, replays a run the way a flight instructor reads a simulator trace, confirms or changes the seven draft bands, and maps confirmed bands to course points. Also present in the build: the scenario author (faculty or Tassl scenario editor) who turns one seed case into a confirmed, versioned, two-variant scenario package, and a Tassl operations admin.

## Product Purpose

Tassl is a practice environment for making consequential decisions with an AI assistant in the room while remaining accountable for them. A student states the decision before AI enters, chooses what to delegate, takes a position on every consequential claim (accept, verify, challenge, reject, escalate), locks an irreversible decision under a clock, responds when conditions shift (the Turn), and defends the result unaided. Tassl assesses the decision process, not the deliverable: the run is recorded as a trace, plotted as four graphs against an authored standard, read into seven draft bands, and handed to the instructor who debriefs from the evidence and confirms the bands.

Success for the build is one working vertical slice of one Decision Run, walked through end to end on synthetic records, on both scenario variants (defective and sound), by the builder and the editor. After the build comes a controlled pilot.

## Positioning

Controlled-reliability claims plus an irreversible Decision Lock plus a simulator-style trace readout. The assistant is useful but not uniformly reliable by design; every claim it surfaces has a warranted stance the student cannot see until the run is scored; the lock cannot be undone; and what is assessed is the evidence-linked process (framing, delegation, verification, calibration, decision quality, adaptation, ownership), never a composite score, rank, or percentile. A general chatbot or an essay grader cannot truthfully claim any of this.

## Operating Context

- A run happens inside a course assignment with a policy the instructor configured; the student sees the policy, completes a readiness check, opens the scenario brief and an Evidence Room of documents, writes a frame, works with the assistant, records stances, locks, answers the Turn, then answers defense questions with AI unavailable.
- The instructor works from a replay: the event trace with a clock column, four graphs (confidence line, clock timeline, stance matrix, frame beside decision), draft bands with the events behind them, then a debrief the student reads.
- Authors work from a seed case through AI generation and a confirmation workspace where every generated element is confirmed, edited, or rejected before a package version can be assigned.
- Everything is text: the brief, documents, claims, the student's frame, brief, Turn response, and defense answers. No file uploads, no artifact polish is rewarded.
- Timers are server timestamps; the browser only polls and displays. Runs are synchronous, single-player, and bounded by the clock.

## Capabilities and Constraints

- Roles: student, instructor, teaching assistant, scenario author, program lead, Tassl scenario editor, admin. Institutions are organizations; every record is tenant-scoped.
- Text-only runs; en-US only; WCAG 2.2 AA; keyboard-operable everywhere; reduced motion respected; web only (desktop-first, usable at 360 px).
- Invariants: students never see warranted stances, evidence status, failure families, planted flags, verification results, the question bank, expected-answer notes, the seed record, or other students' runs before their run is scored; nothing Tassl observes is treated as misconduct; no composite score, rank, or percentile anywhere; the assistant never reveals a claim's defect status; declaring outside-tool use never affects scoring.
- The AI provider is behind a `FEATURE_AI` switch with a deterministic mock; the product must be fully usable with no API key.
- Terminology: Decision Run, Decision Lock, the Turn, claim, stance, warranted stance, Evidence Room, frame, brief, band (novice, developing, proficient, professional, unassessed), Judgment Record, scenario package and version, variant (defective, sound), walkthrough run.
- Undecided: pricing tiers, Practice Pass for individuals, program-lead reporting, and teaching-assistant workflows are future-state and not designed in the build.

## Brand Commitments

- Name: Tassl. Tagline in use: "Make the call."
- Voice: plain, declarative, never accusatory, never "cheating"; the product describes what happened and what it warranted, not who the person is.
- No logo, illustration set, or marketing site exists in this repository; there is no marketing surface in the build.

## Evidence on Hand

- The product requirements document at `Tassl PRD.md` and the technical documentation under `docs/tech/` (requirements register, screen specs, data model, API, design tokens).
- Synthetic scenario packages and seed accounts for the walkthrough are produced during the build; there are no real student records.
- No customers, testimonials, case studies, benchmarks, or press exist; nothing of that kind may be invented.

## Product Principles

1. Ownership stays with the student: the decision is stated before AI enters and locked irreversibly under a clock.
2. Assess the process, not the deliverable: every judgment is linked to trace evidence the student and instructor can both see.
3. The assistant is a room-mate, not an oracle: usefulness and reliability are decoupled on purpose, and the product never says which is which mid-run.
4. Nothing observed is an accusation: no misconduct framing, no composite scores, no ranks.
5. Instructors confirm, machines draft: bands are drafts until a person confirms them; points are the course's mapping, not Tassl's verdict.

## Accessibility & Inclusion

WCAG 2.2 AA is a hard requirement (axe in E2E, Lighthouse accessibility gate, contrast tests on the token palette). Every action is reachable by keyboard and by tap with 40 px minimum targets; every graph carries a description and a data table; the clock is announced through a live region at 5:00 and 1:00; `prefers-reduced-motion` removes all transitions.
