---
target: /home
total_score: 22
max_score: 32
na_heuristics: 5,9
p0_count: 0
p1_count: 1
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(app)\\home\\page.tsx"
target_fingerprint: "sha256:670d15be4fff35fbfcc0e85a53cc0d0f42cd7ec5f2722eb72a6cf3cad396a34e"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(app)\\home\\page.tsx"
timestamp: 2026-09-03T08-49-57Z
slug: src-app-app-home-page-tsx
closed: true
---
Method: dual-agent (A: critique-A:home · B: critique-B:evidence) — Step 1.6, 2026-09-03, target src/app/(app)/home/page.tsx (http://localhost:3000/home, Phase 1 state: zero memberships, signed out)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Active rail item, page title, skip link; no live region on the header statuses |
| 2 | Match System / Real World | 3 | "packages" and "runs" appear before a first-timer knows what a run is |
| 3 | User Control and Freedom | 3 | Skip link, keyboard-reachable everything; the bell leads to a 404 until Phase 3 |
| 4 | Consistency and Standards | 3 | On-token throughout; two measures for secondary paragraphs (72ch vs 60ch) |
| 5 | Error Prevention | n/a | No inputs on this surface |
| 6 | Recognition Rather Than Recall | 3 | Labelled rail and bell; panel has no name |
| 7 | Flexibility and Efficiency | 2 | Single item, single action; no shortcuts (acceptable in Phase 1) |
| 8 | Aesthetic and Minimalist Design | 3 | Calm; the lone unnamed white rectangle at 1440 has no proportion |
| 9 | Error Recovery | n/a | No error path on this surface |
| 10 | Help and Documentation | 2 | Nothing tells a first-timer what happens next or who sends the invitation |
| **Total** | | **22/32** | **Good (69 %)** |

#### Design Specificity Verdict

On-system but compositionally interchangeable. Every pixel resolves to DESIGN.md (Plex Serif wordmark, 36/44 h1, 14/22 body, cool paper, raised hairline panel, one teal voice, 6 px radii; no zinc leaks). Strip the word "run" and it is any admin shell's empty dashboard. That is acceptable for a Phase 1 placeholder and becomes a defect only if the Phase 6 role panels keep the generic card grammar. Deterministic scan: 0 findings. Browser evidence: clean console except the `/notifications` prefetch 404; at 360 both header placeholders wrap to two lines inside the 56 px header.

#### Overall Impression

A correct, accessible, empty shell whose copy says "nothing here" three times and never says what happens next.

#### What's Working

- Token discipline is complete and the fonts are self-hosted with no layout shift.
- The accessibility scaffolding is real: skip link first, labelled nav with aria-current, focus moves to the h1 on navigation, the bottom bar never obscures focus.
- The responsive shell holds at 768 and 360 with 40 px targets.

#### Priority Issues

- **[P1] Heading hierarchy skips h2** — Panel and EmptyState hard-code h3 under the page h1. Fix: `headingLevel` props; "Title / h3" is a style, not an element.
- **[P2] Zero-membership home is a dead end with the wrong string** — the shell says "No institution yet" while the panel talks about assignments. Fix: render the zero-membership state (title "No institution yet", body naming the invitation email) when there are no institutions.
- **[P2] Header placeholders wrap at 360 with no overflow guard** — Fix: `min-w-0 truncate whitespace-nowrap` on every switcher and account branch, `shrink-0` on the bell.
- **[P2] Orientation copy repeats itself and leaks role jargon** — Fix: a role-neutral description, one empty-state sentence.
- **[P3] The single panel has no proportion and no name** — Fix: title the panel "Your runs" so the section gains its accessible name.

#### Persona Red Flags

- **Jordan (first-timer, no institution):** "Not signed in" beside "No institution yet" reads as two failures; the empty state gives no agent, channel, or timeframe; no help entry point anywhere.
- **Sam (screen reader):** h1 → h3 outline; the panel section has no accessible name; the h1 focus target has `outline-none`; header statuses are plain spans with no role for when they change.
- **Casey (one-handed at 360):** both header labels wrap; the bottom bar renders a lone full-width teal pill that looks like a primary button; the only tap target besides Home is the bell in the top-right corner.

#### Minor Observations

Wordmark is a span (convention: a link home); two paragraph measures; the bell prefetches a 404; `home.emptyAction` is an unused string; header statuses read as disabled captions; PageHeader's `<header>` inside `<main>` is announced as a header by NVDA.

#### Questions to Consider

- What would the first five seconds tell a student who just accepted an invitation?
- Should the wordmark be the home affordance so the bottom bar can carry fewer items?
- Can the empty state say who is acting and when, instead of that nothing is happening?
