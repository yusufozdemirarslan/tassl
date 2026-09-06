'use client'

import dynamic from 'next/dynamic'
import { GraphSkeleton } from './graph-skeleton'

// The graph loading contract (docs/tech/16-performance-a11y-budgets.md §3.3; D-074).
//
// **This module is the only door recharts comes through.** §3.2 forbids the library in a layout, in
// `src/components/ui`, and anywhere in the run workspace, and `entryJSFiles` — what
// `scripts/bundle-budget.ts` sums — is the *static* union of a page's client modules. A
// `next/dynamic` import is not in that union (D-282), so a route that draws a chart pays for it in
// a chunk fetched after the page rather than in the bytes that block the page.
//
// **The shim is a Client Component, because `ssr: false` requires one.** A Server Component that
// calls `dynamic(..., { ssr: false })` is a build error in Next 16, and a Server Component that
// dynamically imports a Client Component gets no code splitting at all — the same reason
// `features/run/deferred-panels.tsx` exists.
//
// **Only the two recharts graphs are deferred.** The stance matrix draws its five-by-five grid as
// hand-written SVG and the frame-beside-decision record draws prose, so neither carries a charting
// library and neither should pay a chunk fetch to appear (D-388). They are re-exported straight
// through, which also keeps their description and data table in the first HTML — the property §3.3
// wants and the skeleton can only approximate.
//
// `FrameBesideDecision` is deliberately **not** re-exported here: it is a Server Component and the
// Turn screen renders it inside the run workspace, where this module's own rule says recharts may
// never go. It is imported from `./frame-beside-decision` directly.

const loading = () => <GraphSkeleton />

export const ConfidenceLine = dynamic(
  () => import('./confidence-line').then((module) => module.ConfidenceLine),
  { ssr: false, loading },
)

export const ClockTimeline = dynamic(
  () => import('./clock-timeline').then((module) => module.ClockTimeline),
  { ssr: false, loading },
)

export { GraphFrame } from './graph-frame'
export { GraphSkeleton } from './graph-skeleton'
export { StanceMatrix } from './stance-matrix'
