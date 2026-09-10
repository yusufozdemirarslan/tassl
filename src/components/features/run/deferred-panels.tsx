'use client'

import dynamic from 'next/dynamic'

// B4 / NFR-013 (16 §3.2, D-282): the run workspace is one route drawing two screens, and a run is
// only ever on one of them.
//
// `/runs/[runId]/work` serves `framing`, `working` and `paused`. In `framing` the student writes
// their own position with no assistant in the room, so the screen is the Evidence Room and the
// frame form; from the frame lock the form is gone for good — the frame is immutable and never
// re-opened (FR-043) — and the screen becomes the assistant, the log and the declaration. Nothing
// draws both sets, ever.
//
// The bundle budget is a *static* measure, though: `entryJSFiles` in the route's client-reference
// manifest is the union of every client module the page can reach through a plain `import`, so a
// run in `framing` was being charged for `@ai-sdk`-shaped streaming state it cannot use and a run
// in `working` for `react-hook-form`, its resolver and a `zod/mini` schema it can no longer submit.
// 172,773 bytes against a 130,000 ceiling, and the excess was entirely the other screen.
//
// Reaching the state-specific panels through `next/dynamic` moves them out of the entry chunk group
// into async chunks of their own, and the page then fetches the set it actually rendered. The page
// stays a Server Component and its JSX is unchanged: these have the same names, the same props and
// the same markup as the components they stand for. Step 8.3 added the fifth, `BriefEditor`, and
// the route stands at 101,128.
//
// **`ssr` stays on, and that is the whole point of doing it here rather than with a click.** These
// panels are what the screen *is*, not something behind a control (`use-deferred-module.ts` is the
// on-press half of the same rule, and `frame-form.tsx` already uses it for its lock dialog). With
// the default `ssr: true` the panels are still rendered on the server into the first HTML, so the
// LCP element, the reading order and the a11y tree are exactly what they were (16 §2.2 forbids
// `ssr: false` above the fold) — only their hydration waits on the chunk. No `loading` fallback is
// given for the same reason: a fallback would introduce a Suspense boundary whose placeholder
// could only be an empty box of a guessed height, and 16 §2.4 does not allow that trade. Without
// one the server HTML simply stands until React hydrates it, and a client-side navigation holds
// the previous screen the extra moment instead of flashing a skeleton.
//
// **`PausedOverlay` is deliberately not here.** FR-001 requires a paused run to say so at once, and
// unlike these four the overlay is a Base UI `alertdialog` behind a portal, which renders nothing
// at all on the server — it exists only from hydration onward. Deferring it would therefore put a
// chunk fetch between the student and the news that their clock stopped, and Turbopack writes no
// `react-loadable-manifest.json`, so `next/dynamic`'s `PreloadChunks` cannot hoist that fetch into
// the initial HTML the way it does under webpack. It keeps its static import and its cost.

/** The `framing` screen's right column (FR-040 to FR-043). Carries react-hook-form and its resolver. */
export const FrameForm = dynamic(() => import('./frame-form').then((m) => m.FrameForm))

/** The `working` screen's middle column (FR-050 to FR-053). Carries the delegation stream reader. */
export const AssistantPanel = dynamic(() =>
  import('./assistant-panel').then((m) => m.AssistantPanel),
)

/** The `working` screen's log (FR-060, FR-063, FR-084). Carries the claim and stance controls. */
export const DelegationLog = dynamic(() => import('./delegation-log').then((m) => m.DelegationLog))

/** The outside-tool declaration (FR-061, FR-062, FR-006), on the `working` screen and the Turn window. */
export const DeclarationControl = dynamic(() =>
  import('./declaration-control').then((m) => m.DeclarationControl),
)

/**
 * The `working` screen's right column: the Decision Brief and the Decision Lock (FR-100 to FR-103).
 *
 * It is the largest of the five and the clearest case for being here. A run in `framing` cannot
 * write a brief at all — `capabilities.canWriteBrief` is true in `working` alone — so a static
 * import would charge the framing period for six fields, an autosave and a lock it is not allowed
 * to use, on the screen where the first paint is the whole point. Its own confirmation goes one
 * step further and is fetched on the first focus inside the editor (`brief-editor.tsx`), for the
 * reason `frame-lock-dialog.tsx` sets out: writing a brief takes minutes, and the press should
 * wait for nothing.
 */
export const BriefEditor = dynamic(() => import('./brief-editor').then((m) => m.BriefEditor))

// The two screens the Turn opens onto (Step 9.3). Both live under `/runs/[runId]`, which is one
// budget line in `scripts/bundle-budget.ts`, but they are separate *routes* — so each is charged
// for its own `entryJSFiles` and neither is charged for the other. What they are here for is the
// same reason the five above are: the Turn screen reaches the assistant, the Evidence Room and the
// claim controls through this module already, and the form and the interview are the parts of each
// screen that are pure hydration weight. `ssr` stays on, so the markup, the reading order and the
// a11y tree are exactly what a static import would give (16 §2.2).

/** UI-025's response form (FR-112). Carries the radio group, the counter and the refusal binding. */
export const TurnPanel = dynamic(() => import('./turn-panel').then((m) => m.TurnPanel))

// The claim object and its instrument (FR-051, FR-070 to FR-073, FR-080, FR-090 to FR-092).
//
// On `/runs/[runId]/work` these arrive inside `AssistantPanel` and `DelegationLog`, which are
// already async chunks — so the workspace has never paid for the Base UI sheet, dropdown menu and
// dialog behind a claim card in its entry chunk. The Turn screen draws claim cards *directly*, and
// importing them statically charged the route 147,792 bytes against B4's 130,000 ceiling: the
// excess was the claim card's tree, arriving twice over — once here and once through the assistant
// beside it. Reaching them through this module puts both call sites on the same async chunk, which
// is what the workspace already gets, and the route falls back under the ceiling. `ssr` stays on,
// so the cards are still in the first HTML with their headings, their radio groups and their
// `data-claim-id` anchors (16 §2.2); only their hydration waits.
export const ClaimCard = dynamic(() => import('./claim-card').then((m) => m.ClaimCard))
export const ClaimControls = dynamic(() => import('./claim-card').then((m) => m.ClaimControls))

/**
 * UI-026's interview (FR-120 to FR-126). Carries the answer boxes, the follow-up tree and the
 * confirm dialog — and the alert dialog is the only popup on the defense screen, exactly the shape
 * `frame-lock-dialog.tsx` argued about. It stays inside this chunk rather than behind a second
 * press-time import because the defense is under no clock: nothing is spent while a chunk arrives.
 */
export const DefenseInterview = dynamic(() =>
  import('./defense-question').then((m) => m.DefenseInterview),
)
