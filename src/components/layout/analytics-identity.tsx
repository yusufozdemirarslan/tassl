'use client'
// Identifies the browser as the hashed account id and puts it in the `organization` group
// (17 §5.5). `distinctId` is computed on the server with `hashUserId` — a one-way sha256 truncated
// to 16 hex characters — so PostHog never receives the account id, the email, or the name.
// Rendered once by the (app) layout. Renders nothing.
import { useEffect } from 'react'
import { identifyClient } from '@/lib/analytics/client'

export function AnalyticsIdentity({
  distinctId,
  organizationId,
}: {
  distinctId: string
  organizationId: string | null
}) {
  useEffect(() => {
    void identifyClient(distinctId, organizationId)
  }, [distinctId, organizationId])
  return null
}
