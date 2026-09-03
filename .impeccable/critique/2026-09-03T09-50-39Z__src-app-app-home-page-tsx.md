---
target: /home
total_score: 24
max_score: 32
na_heuristics: 5,9
p0_count: 0
p1_count: 0
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(app)\\home\\page.tsx"
target_fingerprint: "sha256:36a09e99a167c5bb6b9505122652ea6303b4ab58677bb41e2296899dc31862ec"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\(app)\\home\\page.tsx"
timestamp: 2026-09-03T09-50-39Z
slug: src-app-app-home-page-tsx
---
⚠️ DEGRADED: single-context (orchestrator requested perspective A only; browser probe and detector run inline, detector after scoring)
Method: single-agent re-score (A: critique-A:home-rescore) — Step 1.6 re-score after the fix, polish and document pass, 2026-09-03, target src/app/(app)/home/page.tsx (http://localhost:3000/home, Phase 1 state: zero memberships, signed out; inspected at 1440, 768 and 360)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Active rail item, document title, skip link, focus ring on every focusable; "Not signed in" still sits inside an authenticated shell and the bell reports "No unread" for a destination that 404s until Phase 3 |
| 2 | Match System / Real World | 3 | "runs" is named before a first-timer knows what one is; the empty state now explains who invites and how |
| 3 | User Control and Freedom | 3 | Skip link lands focus on `main`, wordmark is a link home; the bell leads to a 404 until Phase 3 |
| 4 | Consistency and Standards | 3 | Fully on-token; two measures for secondary paragraphs (72ch vs 60ch) and the same 24/32 serif style on the h2 and the h3 stacked inside one panel |
| 5 | Error Prevention | n/a | No inputs on this surface |
| 6 | Recognition Rather Than Recall | 4 | Labelled rail, labelled bell, panel named "Your runs" (aria-labelledby resolves); nothing to memorise |
| 7 | Flexibility and Efficiency | 2 | Single item, single destination; no accelerators (acceptable in Phase 1) |
| 8 | Aesthetic and Minimalist Design | 3 | Calm and clean; the same fact is stated three times in one viewport and two equal serif headings sit 68 px apart |
| 9 | Error Recovery | n/a | No error path on this surface |
| 10 | Help and Documentation | 3 | The empty state now says who acts (instructor), through what (email invitation) and what follows; no help entry point or recourse if nothing arrives |
| **Total** | | **24/32** | **Good (75 %)** |

#### Design Specificity Verdict

On-system and now structurally honest, still compositionally interchangeable. Every measured value resolves to DESIGN.md: Plex Serif 600 36/44 h1, Serif 500 24/32 panel and state headings, Sans 14/22 body in `--ink-muted`, cool paper ground, raised hairline panel, `--primary-soft` active rail, 6 px radii, 40 px targets. The serif wordmark and the word "runs" are the only product-specific marks; strip them and this is any admin shell's empty dashboard, which is still acceptable for a Phase 1 container and becomes a defect only if the Phase 6 role panels keep the generic card grammar. Deterministic scan (run after scoring): 0 findings across `home/page.tsx` and the nine shell components. Browser evidence: console clean and no failed requests at 1440, 768 or 360 (the bell no longer prefetches its 404); `document.documentElement.scrollWidth` equals `innerWidth` at every width (360/768/1440); the header holds at 56 px on one line at 360 with "No institution yet" untruncated and "Not signed in" hidden under `sm` with one sr-only copy. Keyboard walk: skip link, wordmark, bell and rail Home each show a 2 px solid `--focus` ring at 2 px offset; the h1 shows the same ring on keyboard-driven programmatic focus. No overlays exist in this state (0 buttons, 0 inputs, 0 popup triggers, 0 menus): the institution radio menu and the account menu render only with a session and several memberships, so their keyboard behaviour could not be exercised on this target.

#### Overall Impression

Every issue from the last run is closed on screen: the outline is h1 → h2 → h3, the zero-membership state is the one shown, the header holds at 360, and the panel has a name. What remains is copy and proportion: the first screen says "no institution" three times in three type styles, and the panel's title and the state's heading are visually the same heading twice.

#### What's Working

- The heading outline is real, not cosmetic: h1 "Home" → h2 "Your runs" (`id="home-runs-title"`, the section's accessible name) → h3 "No institution yet"; a screen-reader heading list reads the page correctly.
- The zero-membership state finally answers the first-timer's question: who (your instructor), through what (an invitation by email), what follows (courses and runs appear here).
- The shell is responsive and keyboard-clean: 56 px header on one line at 360, no horizontal scroll, `pb-20` clears the fixed bottom bar, the skip link moves focus to `main`, and every focusable shows the full-strength teal ring; the fixes did not regress anything.

#### Priority Issues

- **[P2] Panel title and state heading are the same heading twice** — "Your runs" (h2) and "No institution yet" (h3) are both Serif 500 24/32, 68 px apart, inside one panel; sighted users read two sibling headings, and the panel is titled for content ("runs") that the state says cannot exist yet. Why it matters: the outline fix served screen readers but gave sighted users no hierarchy between section and state, and the title sets an expectation the next line contradicts. Fix: in the zero-membership branch render the EmptyState without its own title (the panel h2 becomes the state heading) or give the panel a state-appropriate title; when both headings must coexist, the inner one takes the h4 "Subtitle" style (20/28). Suggested command: /impeccable layout.
- **[P2] The same fact is stated three times in one viewport** — header placeholder "No institution yet" (13 px muted), panel heading "No institution yet" (24 px serif), body "Your account is not part of an institution yet." The body is two sentences where DESIGN.md's empty-state rule says one, and "Your instructor sends an invitation" assumes the student role for an account that has no role yet. Why it matters: a first-timer's first five seconds are three negative statements before the one useful one. Fix: heading names the next event ("Waiting for an invitation"), body is one role-neutral sentence ("Invitations arrive by email from your institution; once you accept one, your courses and runs appear here."), header keeps the status. Suggested command: /impeccable clarify.
- **[P3] The focus ring fades in on the bell and the rail item** — Tailwind 4's `transition-colors` includes `outline-color`, so on the two elements that carry it (`notifications-bell.tsx`, `rail.tsx`) the ring cross-fades over 150 ms from the base-layer rest colour (`* { outline-ring/50 }`, ≈2.2:1 on white) to `--focus` (6:1); the skip link, wordmark and h1 snap instantly. Reduced motion removes it. Why it matters: DESIGN.md's focus recipe forbids half-alpha rings, and for the first frames the ring is below 3:1. Fix: transition only `color` and `background-color` on those two, or set the base `*` outline colour to `--focus` so there is nothing to fade from. Suggested command: /impeccable polish.
- **[P3] Under `md` the bottom bar is a lone 344 × 48 teal pill** — with one rail item the active `--primary-soft` fill spans the whole bar and reads as a primary button. Why it matters: Casey's thumb zone holds one giant non-action; it resolves itself when Phase 3 adds rail items. Fix: cap the item width (`max-w-40`) and centre the list while there are fewer than three items. Suggested command: /impeccable adapt.

#### Persona Red Flags

- **Jordan (first-timer, no institution):** reads "No institution yet" twice and "not part of an institution yet" once before reaching the sentence that helps; "Not signed in" beside it still looks like a second failure; nothing says how long to wait or whom to contact if no email arrives; no help entry point anywhere.
- **Sam (screen reader / keyboard):** outline h1 → h2 → h3 is correct and the section is named; the skip link works; the h1 shows its ring on keyboard-driven focus; the bell and rail Home ring is at half strength for the first 150 ms; navigating by headings hears "Your runs" followed immediately by "No institution yet", a small contradiction; the bell announces "No unread notifications" for a page that returns 404.
- **Casey (one-handed at 360):** the header now holds on one line with no horizontal scroll; the account glyph is icon-only under `sm` and looks tappable but is a static caption; the bottom bar's single item is a full-width teal pill; the bell in the top-right corner is the only other target.

#### Minor Observations

Two paragraph measures (72ch description, 60ch state body); the h1 description is a single 317 px line at every width while the state body wraps at 504 px; the panel spans the full 1168 px main column at 1440 with its text in the left 43 % (acceptable for a list container, but empty it has no proportion); the wordmark is now a link (resolved); the h1 focus recipe no longer sits on `outline-none` (resolved); `home.emptyAction` is gone (resolved); `PageHeader`'s `<header>` inside `<main>` is still announced as a banner-like region by NVDA; the sonner region is the only live region on the page.

#### Questions to Consider

- Should a panel that can only ever say "nothing yet" carry a section title at all, or should the state be the title?
- Could the zero-membership heading name the next event instead of the absence?
- When Phase 3 adds rail items and the account menu, does the bottom bar keep 48 px cells or move to 40 px to match the desktop rail?
