// The runtime assistant switch against Postgres (docs/tech/11-llm-integration.md §6, 07 §9;
// D-691) — the half of the story that needs a deployment naming a network provider.
//
// `tests/integration/admin/service.test.ts` runs under the suite's own `FEATURE_AI=false` and
// proves the refusal: the environment has already forced the scripted assistant, and the service
// will not record a switch it cannot honour. This file sets the flag *on* — in `vi.hoisted`, because
// `src/server/config` parses `process.env` once, at import — and proves the switch itself:
//
//   * an admin's write lands as the row and the `ai_mode.set` audit row, together;
//   * `readAiMode`, `effectiveAssistantMode`, the flags and `/api/ready` all read the same answer;
//   * the registry hands out the network provider's name and answers the next call from the mock,
//     with an `llm_calls` row that says so and prices it at nothing (D-651);
//   * anybody but a platform admin is refused before anything is read, through the service and
//     through `PUT /api/v1/admin/settings/ai-mode` alike.
//
// Nothing here reaches a network: the one model call is made with the row at `mock`, and the key
// below is a string that must never be used.
// @db:truncate
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { isAppError } from '@/lib/errors'
import type { PlatformRole, SessionUser } from '@/server/auth/types'

vi.hoisted(() => {
  process.env.FEATURE_AI = 'true'
  process.env.LLM_PROVIDER = 'openai-compatible'
  process.env.LLM_API_KEY = 'a-key-that-must-never-be-used'
  process.env.LLM_FALLBACK_PROVIDER = 'none'
})

type Factories = typeof import('@tests/factories')
type Admin = typeof import('@/server/modules/admin')
type AiModeModule = typeof import('@/server/llm/ai-mode')
type Registry = typeof import('@/server/llm/registry')
type AiModeRoute = typeof import('@/app/api/v1/admin/settings/ai-mode/route')
type ReadyRoute = typeof import('@/app/api/ready/route')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let f: Factories
let admin: Admin
let aiMode: AiModeModule
let registry: Registry
let route: AiModeRoute
let ready: ReadyRoute

let adminUser: UserRow
let student: UserRow
let editor: UserRow

function actorOf(row: UserRow): SessionUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    emailVerified: row.emailVerified,
    activeOrganizationId: null,
    platformRole: row.platform_role as PlatformRole,
  }
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    if (isAppError(error)) return error.code
    throw error
  }
  throw new Error('expected a refusal, and the call returned')
}

type AuditRow = {
  action: string
  actor_id: string
  target_id: string
  metadata: Record<string, unknown>
}

const auditRows = () =>
  testSql<
    AuditRow[]
  >`select action, actor_id, target_id, metadata from audit_logs order by created_at`

const settingRows = () =>
  testSql<{ key: string; value: string; updated_by: string | null }[]>`
    select key, value, updated_by from app_settings`

/** `PUT /api/v1/admin/settings/ai-mode` the way the browser sends it (08 §2.7). */
async function put(headers: Headers, body: unknown): Promise<Response> {
  const request = new Request('http://localhost:3000/api/v1/admin/settings/ai-mode', {
    method: 'PUT',
    headers: new Headers({
      ...Object.fromEntries(headers.entries()),
      'x-requested-with': 'tassl',
      'content-type': 'application/json',
    }),
    body: JSON.stringify(body),
  })
  return route.PUT(request, { params: Promise.resolve({}) })
}

const request = () => ({
  feature: 'assistant' as const,
  promptName: 'assistant-reply',
  promptVersion: 1,
  messages: [
    { role: 'system' as const, content: 'You are the assistant inside a scenario.' },
    { role: 'user' as const, content: 'What is the premium payback?' },
  ],
  promptInput: {
    worldSummary: 'Halden Roastworks is choosing its acquisition mix.',
    request: 'What is the premium payback?',
    claims: [{ id: 'C3', text: 'Premium payback is about 11 months.' }],
  },
  context: { requestId: 'req-ai-mode-integration' },
})

describe('the runtime assistant switch (FEATURE_AI=true)', () => {
  beforeEach(async () => {
    await truncateAll()
    f = await import('@tests/factories')
    admin = await import('@/server/modules/admin')
    aiMode = await import('@/server/llm/ai-mode')
    registry = await import('@/server/llm/registry')
    route = await import('@/app/api/v1/admin/settings/ai-mode/route')
    ready = await import('@/app/api/ready/route')
    registry.resetProviderRegistry()

    adminUser = await f.createUser('ai-mode-admin', {
      platformRole: 'admin',
      email: 'aa-admin@tassl.local',
    })
    editor = await f.createUser('ai-mode-editor', {
      platformRole: 'tassl_scenario_editor',
      email: 'bb-editor@tassl.local',
    })
    student = await f.createUser('ai-mode-student', { email: 'cc-student@tassl.local' })
  })

  afterAll(async () => {
    await truncateAll()
  })

  it('starts live with no row, and the flags say so', async () => {
    const config = await import('@/server/config')
    expect(config.effectiveLlmProvider()).toBe('openai-compatible')
    expect(await aiMode.readAiMode()).toBe('live')
    expect(await aiMode.effectiveAssistantMode()).toBe('live')

    const flags = await admin.getFlags(actorOf(adminUser))
    expect(flags).toMatchObject({
      ai: true,
      effectiveLlmProvider: 'openai-compatible',
      aiMode: 'live',
      assistantMode: 'live',
    })
  })

  it('an admin sets mock: the row, the audit row, and every reader agree', async () => {
    const flags = await admin.setAiMode(actorOf(adminUser), { mode: 'mock' })
    expect(flags.aiMode).toBe('mock')
    expect(flags.assistantMode).toBe('scripted')

    expect(await aiMode.readAiMode()).toBe('mock')
    expect(await aiMode.effectiveAssistantMode()).toBe('scripted')

    expect(await settingRows()).toEqual([
      { key: 'ai_mode', value: 'mock', updated_by: adminUser.id },
    ])

    const audit = await auditRows()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      action: 'ai_mode.set',
      actor_id: adminUser.id,
      target_id: 'ai_mode',
      metadata: { from: 'live', to: 'mock' },
    })

    // Back again: one row upserted, a second audit row with the reverse transition.
    const restored = await admin.setAiMode(actorOf(adminUser), { mode: 'live' })
    expect(restored.aiMode).toBe('live')
    expect(restored.assistantMode).toBe('live')
    expect(await settingRows()).toEqual([
      { key: 'ai_mode', value: 'live', updated_by: adminUser.id },
    ])
    const after = await auditRows()
    expect(after).toHaveLength(2)
    expect(after[1]?.metadata).toEqual({ from: 'mock', to: 'live' })
  })

  it('the registry keeps the network provider’s name and answers the next call from the mock', async () => {
    const provider = registry.getProvider()
    expect(provider.name).toBe('openai-compatible')
    expect(registry.getProvider()).toBe(provider)

    await admin.setAiMode(actorOf(adminUser), { mode: 'mock' })

    // The same instance, the call after the switch: the mock answers, and the row says so.
    const result = await provider.complete(request())
    expect(result.provider).toBe('mock')

    const calls = await testSql<{ provider: string; cost_estimate_usd: string }[]>`
      select provider, cost_estimate_usd from llm_calls`
    expect(calls).toHaveLength(1)
    expect(calls[0]?.provider).toBe('mock')
    expect(Number(calls[0]?.cost_estimate_usd)).toBe(0)
  })

  it('/api/ready reports the effective mode, before and after the switch', async () => {
    const before = await (await ready.GET()).json()
    expect(before).toMatchObject({ status: 'ready', assistantMode: 'live' })

    await admin.setAiMode(actorOf(adminUser), { mode: 'mock' })
    const after = await (await ready.GET()).json()
    expect(after).toMatchObject({ status: 'ready', assistantMode: 'scripted' })
  })

  it('refuses anybody but a platform admin, and writes nothing on the way', async () => {
    for (const seat of [student, editor]) {
      expect(await codeOf(() => admin.setAiMode(actorOf(seat), { mode: 'mock' }))).toBe('FORBIDDEN')
    }
    expect(await settingRows()).toEqual([])
    expect(await auditRows()).toEqual([])
    expect(await aiMode.readAiMode()).toBe('live')
  })

  it('PUT /admin/settings/ai-mode: the admin’s write lands, a student is refused, a bad body is 400', async () => {
    const asAdmin = await asUser(adminUser.id)
    const ok = await put(asAdmin, { mode: 'mock' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ aiMode: 'mock', assistantMode: 'scripted' })
    expect(await aiMode.readAiMode()).toBe('mock')

    const asStudent = await asUser(student.id)
    const refused = await put(asStudent, { mode: 'live' })
    expect(refused.status).toBe(403)
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    // The student's attempt changed nothing.
    expect(await aiMode.readAiMode()).toBe('mock')

    const invalid = await put(asAdmin, { mode: 'off' })
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_ERROR',
    )
    expect(await aiMode.readAiMode()).toBe('mock')
  })
})
