// PUT /api/v1/admin/settings/ai-mode (07 §9, 11 §6, D-691): the runtime assistant switch — the
// `ai_mode` row and its `ai_mode.set` audit row, in one transaction, answered with the flags.
export { adminSetAiMode as PUT } from '@/server/modules/admin/router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
