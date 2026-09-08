// The `route` property of `error_shown` (docs/tech/17-analytics-events.md §3.6).
//
// The catalogue asks for the route *template* — `/runs/[runId]/work` — and never the concrete
// path, because a concrete path is a list of ids and `/verify-email?token=…` is a credential. The
// server rebuilds the template in `routePattern` (`src/server/http/define-route.ts`); the browser
// has the same two pieces, `usePathname()` and `useParams()`, so it rebuilds it the same way.

const TEMPLATE = /^\/[A-Za-z0-9[\]/-]*$/

/**
 * Replaces every path segment that equals a dynamic param's value with `[param]`. Anything that
 * still does not look like a template — an unexpected character, a segment that was never a param —
 * becomes `/`, because a half-substituted path is exactly the leak this function exists to prevent.
 */
export function toRouteTemplate(
  pathname: string,
  params: Record<string, string | string[] | undefined>,
): string {
  const segments = pathname.split('/')
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string') continue
    const index = segments.indexOf(value)
    if (index > 0) segments[index] = `[${name}]`
  }
  const template = segments.join('/') || '/'
  return TEMPLATE.test(template) ? template : '/'
}
