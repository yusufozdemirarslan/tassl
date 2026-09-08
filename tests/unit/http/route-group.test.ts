// @vitest-environment node
// The `route_group` tag the NFR-007 and NFR-008 alert rules are written against (13 §2.5, §7).
// `internal` matters most: /api/health and /api/ready are polled once a minute by the uptime
// monitor, and every latency and error rule excludes them by this tag.
import { describe, expect, it } from 'vitest'
import { routeGroup } from '@/server/http/route-group'

describe('routeGroup', () => {
  it.each([
    ['/api/v1/runs/[runId]', 'GET', 'api_read'],
    ['/api/v1/runs/[runId]/lock', 'POST', 'api_write'],
    ['/api/v1/runs/[runId]/stance', 'PATCH', 'api_write'],
    ['/api/auth/[...all]', 'POST', 'auth'],
    ['/api/health', 'GET', 'internal'],
    ['/api/ready', 'GET', 'internal'],
    ['/api/internal/jobs/drain', 'GET', 'internal'],
    ['/sentry-tunnel', 'POST', 'internal'],
    ['/runs/[runId]/work', 'GET', 'page'],
    ['/', 'GET', 'page'],
    ['lockDecision', 'ACTION', 'action'],
  ])('%s %s is %s', (pattern, method, expected) => {
    expect(routeGroup(pattern, method)).toBe(expected)
  })

  it('classifies a Server Action by its method, whatever its name looks like', () => {
    expect(routeGroup('/api/v1/anything', 'ACTION')).toBe('action')
  })
})
