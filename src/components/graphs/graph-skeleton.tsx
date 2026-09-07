import { Skeleton } from '@/components/ui/skeleton'

// The box a deferred chart arrives into (docs/tech/16-performance-a11y-budgets.md §3.3).
//
// It is the `loading` of the two `next/dynamic` graphs, and its only job is to be exactly as tall
// as the chart that replaces it so the swap moves nothing on the page (CLS ≤ 0.1, 16 §2). It
// carries no text: a placeholder that announced itself would be read out on every debrief, and the
// graph's own description is a moment away.
export function GraphSkeleton({ height = 320 }: { height?: number }) {
  return <Skeleton aria-hidden="true" className="w-full rounded-md" style={{ height }} />
}
