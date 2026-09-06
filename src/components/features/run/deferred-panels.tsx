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

/** The `working` screen's outside-tool declaration (FR-061, FR-062, FR-006). */
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
