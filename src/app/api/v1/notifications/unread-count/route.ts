// GET /api/v1/notifications/unread-count (07-api-spec.md §9, SYS-010, D-470): the number behind the
// shell bell's badge. One integer, polled once a minute by the bell on every route of the product.
export { unreadCountRoute as GET } from '@/server/modules/notifications/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
