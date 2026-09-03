---
target: /dev/components
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\dev\\components\\page.tsx"
target_fingerprint: "sha256:2c7c46c780d236c28ae597cf31537ab43fc07911137c4d06ef80bc261816590c"
target_path: "C:\\Users\\yusuf\\Desktop\\Tassl\\src\\app\\dev\\components\\page.tsx"
timestamp: 2026-09-03T08-49-56Z
slug: src-app-dev-components-page-tsx
closed: true
---
Method: dual-agent (A: critique-A:gallery · B: critique-B:evidence) — Step 1.6, 2026-09-03, target src/app/dev/components/page.tsx (http://localhost:3000/dev/components)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | No in-page location on a 4,892 px page; the "Actions" menu crashes the route into the error boundary with no reference shown |
| 2 | Match System / Real World | 3 | Spacing steps labelled 1–8 without px; radius and shadow samples unnamed |
| 3 | User Control and Freedom | 3 | Esc and focus return work on every overlay; the dropdown crash is the one trap |
| 4 | Consistency and Standards | 2 | Two chip systems (Badge vs LabelChip), two control heights and radii, two focus languages, toast in a system font |
| 5 | Error Prevention | 2 | DropdownMenuLabel outside a group throws; no per-demo boundary |
| 6 | Recognition Rather Than Recall | 2 | No source path per demo, no hex or contrast in the token table, hover-only titles |
| 7 | Flexibility and Efficiency | 1 | No jump nav or demo anchors; 32 Tab stops to the overlay row; no skip link on /dev |
| 8 | Aesthetic and Minimalist Design | 3 | Clean single column; captions are the weakest type on the page |
| 9 | Error Recovery | 2 | Error boundary copy promises a reference that client render errors never carry |
| 10 | Help and Documentation | 2 | Captions do not say what each specimen proves or which rule it embodies |
| **Total** | | **22/40** | **Acceptable** |

#### Design Specificity Verdict

Content authored, frame interchangeable. Specimen copy is unmistakably Tassl (Lock your decision?, Void this run?, Claim actions, tabular trace excerpt, six label chips in product vocabulary) in the Plex trio on cool paper. The gallery's own chrome and roughly a third of the primitives could be lifted from any shadcn project: an un-themed Badge pill, 32 px inputs with 10 px radii and a half-alpha glow focus, 25 px tab pills, a text-xs tooltip, a toast in ui-sans-serif with a pure-black shadow. Deterministic scan (`detect.mjs --json src/app src/components`): 0 open findings; the one `side-tab` hit on label-chip.tsx is a documented waiver. Browser overlays: not available in this harness; evidence came from Playwright captures at 1440, 768, and 360.

#### Overall Impression

The product layer (LabelChip, IllustrativeSample, Panel, EmptyState, buttons) is right and reads as an instrument panel; the shadcn layer beneath it was recoloured but not re-shaped, and one primitive crashes the page.

#### What's Working

- Specimens carry product content, not lorem, so the page teaches Tassl's vocabulary while it demonstrates the system.
- LabelChip and IllustrativeSample embody the Amber-Is-Not-Text and One-Layer rules exactly.
- Overlay behaviour is exemplary where it works: Esc closes every overlay and focus returns to the trigger.

#### Priority Issues

- **[P0] "Actions" dropdown crashes the entire gallery** — DropdownMenuLabel rendered directly in DropdownMenuContent throws Base UI error #31 (MenuGroupContext missing) and the root error boundary replaces the page. Fix: group-safe DropdownMenuLabel in dropdown-menu.tsx and DropdownMenuGroup at both call sites; add an e2e that opens the menu.
- **[P1] The gallery misrepresents 360 px** — document scrollWidth 549 because the Group grid track is minmax(auto,1fr) and the nowrap tables propagate min-content. Fix: `grid-cols-[minmax(0,1fr)]` and `min-w-0` on Demo, keyboard-reachable table scrollers.
- **[P1] Form primitives are un-themed shadcn defaults** — 32 px tall, 10 px radius, transparent fill, `outline: none` with a 3 px half-alpha glow. Fix: 40 px, 6 px radius, raised-paper fill, the 2 px solid focus recipe, 45 % disabled.
- **[P1] Badge is a second, contradictory chip system** — 15.6 px pill radius, 12 px text, glow focus, `--red` at 10 % rather than `--red-soft`. Fix: theme Badge to the chip spec.
- **[P2] No wayfinding on a 4,892 px review surface; captions are the weakest element** — Fix: jump row under the header, ids on demos, captions that carry the component name, source path, and the rule each specimen proves.

#### Persona Red Flags

- **Alex (builder reviewing a component):** no jump links or anchors; 32 Tab stops to the overlays; no `main` landmark on /dev; the token table has no hex to copy; the Buttons row mixes variant, size, and state in one nine-item line.
- **Sam (screen reader, keyboard):** no skip link or main on the gallery; two `role="alert"` specimens announce on load; 24 sibling h3s mix captions with specimen headings; toggle rows are 19 px tall; input focus is a half-alpha glow.
- **Noor (Tassl scenario editor):** the stance chip and the clock — the components that define the product — are absent; the token table cannot be checked against DESIGN.md's ratios; Badge, inputs, tabs, and tooltip contradict the rules she is asked to enforce; the toast she will see most is in a system font.

#### Minor Observations

Toast in ui-sans-serif with an rgba(0,0,0,.1) shadow; PopoverTitle inherits the 30 px serif h2; the tab title reads "Component gallery · Tassl · Tassl"; institution switcher truncates at 16ch even at 1440; FieldError lacks the icon and 13/20 size; Badge destructive wash is `--red` at 10 %; the Separator specimen is unlabelled; the Rail demo relies on arbitrary-important overrides; table rows carry a hover wash with nothing to click; tooltip is text-xs; input disabled is opacity-50 vs 45 on buttons; toggles duplicate their label in aria-label.

#### Questions to Consider

- What if the gallery rendered every state statically (hover, focus, open) so a screenshot review needed no interaction?
- Should the stance chip and the clock exist here as placeholders now, so the two signature components are designed before their feature phases?
- Could each demo declare the DESIGN.md rule it proves, turning the gallery into an executable style guide?
