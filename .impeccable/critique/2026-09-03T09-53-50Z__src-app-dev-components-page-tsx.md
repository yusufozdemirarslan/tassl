---
target: /dev/components
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 0
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\dev\\components\\page.tsx"
target_fingerprint: "sha256:e6c5d0642157b907d1af50e46deca4d73bc2945038c6ae2c56a22addb5627f0a"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\dev\\components\\page.tsx"
timestamp: 2026-09-03T09-53-50Z
slug: src-app-dev-components-page-tsx
---
⚠️ DEGRADED: single-context (perspective A re-score only, by orchestrator instruction; detector pass B not rerun) — Step 1.6 re-score after fix, polish and document, 2026-09-03, target src/app/dev/components/page.tsx (http://localhost:3000/dev/components). Evidence: Playwright 1.62 captures at 1440, 768 and 360 (`.impeccable/review/rescore-*.png`, metrics in `rescore-metrics.json` and `rescore-verify.json`); every overlay opened by keyboard; focus sampled on buttons, inputs, toggles, tabs, menu and select items; `document.documentElement.scrollWidth` read at each width; zero console errors or page errors.

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Jump row, inline errors, toast and progress all report; no current-section marker or way back up on a 5,437 px page (8,093 px at 360) |
| 2 | Match System / Real World | 3 | Spacing, radii and shadow now carry px captions; `--line-control` shows "—" for contrast with no note, and "md" / "UI-060" stay unexplained |
| 3 | User Control and Freedom | 4 | Esc closes every overlay and focus returns to its trigger; cancel, close and backdrop paths on each; hash links give browser Back a history |
| 4 | Consistency and Standards | 3 | One control height, one radius set, one focus recipe, one chip shape; the toast still leaks sonner's pure-gray description and pure-black shadow |
| 5 | Error Prevention | 3 | Group-safe menu label, `aria-disabled` with a reason, numeric inputMode, select for stance; still no per-demo boundary |
| 6 | Recognition Rather Than Recall | 3 | Source path per demo, hex and ratio per token, visible captions everywhere; demo anchors exist but nothing lists them |
| 7 | Flexibility and Efficiency | 3 | Three 40 px jump links, deep-link ids, keyboard-scrollable table regions, arrow keys in tabs and menus; still 47 Tab stops top-to-overlays, ~19 after the jump |
| 8 | Aesthetic and Minimalist Design | 3 | Calm single column with hairline dividers; at 360 the brace-expanded source paths wrap to three lines of mono under each caption |
| 9 | Error Recovery | 3 | FieldError names problem and fix with an icon at the source; ErrorState gives message, mono reference, retry; boundary copy no longer promises a missing reference |
| 10 | Help and Documentation | 3 | Captions name component and file; the contrast basis, the One-Layer rule and `aria-disabled` are explained in place; most specimens still do not cite the DESIGN.md rule they prove |
| **Total** | | **31/40** | **Good** |

#### Design Specificity Verdict

Content authored, frame now authored too. The specimen copy was already Tassl (Lock your decision?, Void this run?, Claim actions, the tabular trace excerpt, six label chips in product vocabulary); what changed is that the primitives beneath it now carry the system instead of shadcn's defaults. Measured on screen: inputs, selects, tab triggers, buttons and menu rows are 40 px with a 6 px radius on raised paper and a `--line-control` border; Badge is 24 px, 2 px radius, 13/20 weight 500 on the soft washes with the strong colour as text; the tooltip is ink on paper at 13/20 with a 2 px radius and `role="tooltip"` plus `aria-describedby`; every popup (dialog, alert dialog, sheet, popover, menu, select) casts `0 8px 24px rgb(20 26 38 / 0.12)` behind a hairline; the tab list is a sunken well with a raised active trigger; the settled focus ring is `2px solid #0F6E74` offset 2 px on buttons, inputs, links, toggles and tabs, inset in menu and select rows; the disabled state is 45 % on both buttons and inputs. Category-interchangeable remnants: the toast (sonner's `[data-styled=true]` rules beat the globals.css overrides, so its description is `#3F3F3F` and its shadow `rgba(0,0,0,.1) 0 4px 12px` at 13 px), the dialog footer's half-alpha `paper-sunken/50` wash, and the Badge default variant's 20 %-alpha teal border. Deterministic scan: not rerun in this pass (perspective A only, by instruction); the previous pass reported 0 open findings with the one documented `side-tab` waiver on label-chip.tsx. Browser overlays: not available in this harness; evidence came from the Playwright captures listed above.

#### Overall Impression

The gallery now does what a component gallery is for: every primitive on it can be checked against DESIGN.md by eye and by measurement, nothing crashes, nothing overflows, and the review surface reads as the same instrument panel the product will be. The remaining work is finish, not foundation: one third-party leak (the toast), a wayfinding layer that stops at three links on an eight-thousand-pixel page, and captions that name their file but not their rule.

#### What's Working

- The five previous priority issues are all resolved on screen: the "Actions" menu opens with `role="menu"`, arrow keys move the inset focus ring, Esc returns focus to the trigger, and no error boundary fires; `scrollWidth` is 360 at 360 with both tables scrolling inside named, focusable regions (ArrowRight moves them); inputs, selects, tabs and Badge match the DESIGN.md recipes to the pixel; a jump row and per-demo ids exist and captions carry the component name in ink with the source path in muted mono.
- Overlay behaviour is exemplary end to end: initial focus lands inside every dialog, sheet, popover, menu and select; Tab stays inside; Esc closes and restores focus to the exact trigger in all seven cases; at 360 the dialog keeps 16 px gutters and stacks its actions primary-first, the sheet is three quarters wide with a reachable close button, the menu fits at 178 px.
- The token table is now a checkable artifact: value, WCAG ratio against `--paper` and use for all 23 tokens, read from the DESIGN.md frontmatter at render time, with a one-line caption that no longer clips at 360 and a paragraph below that explains the sync.

#### Priority Issues

- **[P2] The toast is the one primitive still wearing sonner's clothes** — measured description colour `rgb(63,63,63)` (pure gray, which DESIGN.md forbids anywhere), box-shadow `rgba(0,0,0,.1) 0 4px 12px` (pure black, not `--shadow-float`), body at 13 px rather than 14/22. Cause: sonner's injected `[data-sonner-toast][data-styled=true] …` rules tie or beat the two `[data-sonner-toaster] [data-sonner-toast]` overrides in globals.css and the `text-ink-muted` class on the description. Fix: raise the override specificity (`[data-sonner-toaster] [data-sonner-toast][data-styled=true] [data-description]`) or render `unstyled` toasts with the product classes, then assert in the gallery e2e that the description computes to `--ink-muted` and the shadow to `--shadow-float`. Suggested command: /impeccable polish.
- **[P2] Wayfinding stops at three links** — the jump row lists sections only, scrolls away with the page, marks no current section and offers no way back up; the 19 demo anchors (`#badges`, `#label-chips`, `#overlays-…`) exist but nothing on the page links to them. Linear keyboard order is 47 Tab stops from the top to the overlay row and about 19 after the "UI primitives" jump. Fix: a two-level jump list (section link with its demos beneath, collapsed under `md`), sticky at `md` and up, plus a "Back to top" at the end of each group; the row already has 40 px targets so the pattern extends cleanly. Suggested command: /impeccable layout.
- **[P2] At 360 the source paths become the loudest element** — brace-expanded paths such as `src/components/ui/{field,input,textarea,select,checkbox,radio-group,switch,tabs}.tsx` wrap to three lines of 12 px mono directly under a two-line caption, so every primitive demo opens with five lines of metadata before the specimen. Fix: under `md` show the folder and a count (`src/components/ui · 8 files`) with the full list in a `<details>`, or break only at the commas and cap the path at two lines. Suggested command: /impeccable adapt.
- **[P3] Menu group labels are presentational** — `DropdownMenuLabel` is a `role="presentation"` div (the correct fix for the Base UI #31 crash), but the `DropdownMenuGroup` around "Claim actions" and around the account name carries no `aria-labelledby`, so the menu's group is unnamed to a screen reader while `SelectLabel` is a real GroupLabel. Fix: give the label an id and point the group at it. Suggested command: /impeccable audit.
- **[P3] Three loose ends from the token and chrome rows** — `--line-control` shows "—" for contrast with no note that its 3.8:1 is composited (it is the boundary whose ratio matters most); the Badge default variant's `border-primary/20` is the only half-alpha edge on the page; the institution switcher still truncates "Georgetown University" at 16ch at 1440 with the full name only in `title`. Suggested command: /impeccable polish.

#### Persona Red Flags

- **Alex (builder reviewing a component):** one click reaches a section and `#badges`-style deep links work, but he has to guess they exist; from "UI primitives" it is still ~19 Tabs to the overlays; the token table gives him the hex to copy but not the Tailwind name he actually types (`bg-paper-sunken`); the Buttons row is now three labelled groups (variants, sizes, states) instead of one nine-item line; no sticky nav or back-to-top on 5,437 px.
- **Sam (screen reader, keyboard):** the first Tab lands on the jump row, which serves as the skip link, and the `main` landmark is present; every focus ring is 2 px solid teal once settled (it fades in from 50 % alpha over 150 ms because `transition-colors` includes `outline-color` and the base layer paints `outline-ring/50`; instant under reduced motion); table regions are named by their caption and scroll with the arrow keys; two `role="alert"` specimens (ErrorState, FieldError) still announce on page load; 25 headings, 20 of them h3, with the 13 px captions and the specimens' own headings interleaved; menu groups are unnamed.
- **Noor (Tassl scenario editor):** Badge and LabelChip now agree on shape, so the rule she enforces has one exemplar; the token ratios she can check against DESIGN.md are on screen; the toast she will see most is in Plex Sans now but its second line is a gray the rules forbid; the stance chip and the clock — the two components that define the product — are still absent until the Phase 10 fixtures land, so the five stance colours appear only as swatches.

#### Minor Observations

The "DESIGN.md v1" badge sits alone in the header's action slot at 1440, bottom-aligned to the description, reading as an orphaned control rather than a version label; the separator specimen is an unlabelled hairline between the progress bar and the skeleton, indistinguishable from a divider; the dialog footer's `bg-paper-sunken/50` is a fourth, half-alpha tint the token table does not name; the Rail frames still pin their layouts with `!important` arbitrary variants (invisible on screen, fragile in code); the ErrorState message "The run could not be loaded" names no cause; the checkbox and radio are 16 px marks whose 40 px hit area comes from a `::after` box, correct but invisible to a reviewer counting targets; the trace ScrollArea is the only specimen whose accessible name ("Trace excerpt") does not appear as visible text.

#### Questions to Consider

- What if each demo declared the DESIGN.md rule it proves as a one-line "Proves:" note, turning the captions into an executable style guide the detector could cross-check?
- Should the stance chip and the clock exist here now as fixture-driven placeholders, so the two signature components are designed before their feature phases rather than inheriting whatever the phase builder reaches for?
- Could the gallery render hover, focus and open states statically (a second row per interactive specimen) so a single screenshot review needs no interaction?
