// Step 12.2 — the three generation endpoints of docs/tech/07-api-spec.md §6, called as real
// `Request`s through the handlers `src/app/api/v1/**/route.ts` exports:
//
//   POST /package-versions/{versionId}/generation                                    startGeneration
//   GET  /package-versions/{versionId}/generation                              getGenerationStatus
//   POST /package-versions/{versionId}/elements/{elementType}/{elementId}/regenerate
//                                                                              regenerateElement
//
// Each gets its happy path, the error envelope of every code 07 §6 names for it, and the cells of
// 08-auth-authz.md §4 "Create package from seed; run generation" — including the one this step
// calls out by name: **a platform editor may start generation only through a `scenario_author`
// membership of the institution** (08 §5). The same seat is tried twice, once without the
// membership and once with it, so the row is proven by the difference rather than by a comment.
//
// Most seat rows are answered against a version with no seed record. That is deliberate: an allowed
// seat meets `SEED_MISSING` (409) — an allow, since 08 §4 is proven by refusal and 409 is not one —
// and no row starts a pipeline that the next row would then be answered `GENERATION_ALREADY_RUNNING`
// about. The one row that really generates has a package of its own.
//
// `asUser()` supplies the session cookie; non-GET requests carry `X-Requested-With: tassl`, the
// CSRF header `defineRoute` requires of cookie-authenticated mutations (08 §2.7).
// @db:truncate
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import { stopBoss } from '@/server/jobs/boss'
import { drain, setupAuthoringFixture, SEED, type AuthoringFixture } from '../authoring/fixture'

type GenerationRoute = typeof import('@/app/api/v1/package-versions/[versionId]/generation/route')
type RegenerateRoute =
  typeof import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/regenerate/route')
type Factories = typeof import('@tests/factories')

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

type Called = { status: number; body: Record<string, unknown> | null }

let generationRoute: GenerationRoute
let regenerateRoute: RegenerateRoute
let f: Factories

/** The seats 08 §4 decides this row for, plus the editor in both of its shapes. */
const SEATS = [
  'author',
  'instructor',
  'student',
  'ta',
  'program_lead',
  'editor_without_membership',
  'editor_with_membership',
  'outsider',
] as const
type Seat = (typeof SEATS)[number]

let fx: AuthoringFixture
/** A second version of the same package: no seed record, so an allowed seat meets SEED_MISSING. */
let seedlessVersionId = ''
let seedlessDocumentId = ''
let sessions: Record<Seat, Headers>

async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session?: Headers | null
    params?: Record<string, string>
    body?: unknown
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session ?? undefined)
  if (method !== 'GET') {
    headers.set('x-requested-with', 'tassl')
    headers.set('content-type', 'application/json')
  }
  const request = new Request(`http://localhost:3000/api/v1${options.path}`, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) })
  const text = await response.text()
  return { status: response.status, body: text === '' ? null : (JSON.parse(text) as never) }
}

const errorCode = (called: Called): string =>
  String((called.body?.['error'] as { code?: unknown } | undefined)?.code ?? '')

const startAs = (seat: Seat, versionId = seedlessVersionId): Promise<Called> =>
  call(generationRoute.POST, {
    method: 'POST',
    path: `/package-versions/${versionId}/generation`,
    session: sessions[seat],
    params: { versionId },
  })

const statusAs = (seat: Seat, versionId = seedlessVersionId): Promise<Called> =>
  call(generationRoute.GET, {
    path: `/package-versions/${versionId}/generation`,
    session: sessions[seat],
    params: { versionId },
  })

const regenerateAs = (
  seat: Seat,
  elementId = seedlessDocumentId,
  versionId = seedlessVersionId,
): Promise<Called> =>
  call(regenerateRoute.POST, {
    method: 'POST',
    path: `/package-versions/${versionId}/elements/document/${elementId}/regenerate`,
    session: sessions[seat],
    params: { versionId, elementType: 'document', elementId },
    body: {},
  })

beforeAll(async () => {
  await truncateAll()
  generationRoute = await import('@/app/api/v1/package-versions/[versionId]/generation/route')
  regenerateRoute =
    await import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/regenerate/route')
  f = await import('@tests/factories')
  fx = await setupAuthoringFixture('api')

  const scenariosRepo = await import('@/server/modules/scenarios/repository')
  const other = await f.createInstitution('authoring-api-other')

  const seats: Record<Seat, { userId: string; org: string }> = {
    author: { userId: fx.authorId, org: fx.orgId },
    instructor: { userId: (await f.createUser('authoring-api-instructor')).id, org: fx.orgId },
    student: { userId: (await f.createUser('authoring-api-student')).id, org: fx.orgId },
    ta: { userId: (await f.createUser('authoring-api-ta')).id, org: fx.orgId },
    program_lead: { userId: (await f.createUser('authoring-api-lead')).id, org: fx.orgId },
    editor_without_membership: {
      userId: (
        await f.createUser('authoring-api-editor-out', { platformRole: 'tassl_scenario_editor' })
      ).id,
      org: fx.orgId,
    },
    editor_with_membership: {
      userId: (
        await f.createUser('authoring-api-editor-in', { platformRole: 'tassl_scenario_editor' })
      ).id,
      org: fx.orgId,
    },
    outsider: {
      userId: (await f.createUser('authoring-api-outsider')).id,
      org: other.organization.id,
    },
  }
  await f.addMember(fx.orgId, seats.instructor.userId, 'instructor')
  await f.addMember(fx.orgId, seats.student.userId, 'student')
  await f.addMember(fx.orgId, seats.ta.userId, 'teaching_assistant')
  await f.addMember(fx.orgId, seats.program_lead.userId, 'program_lead')
  // The whole of 08 §5's editor rule: the platform role alone is not a seat in an institution.
  await f.addMember(fx.orgId, seats.editor_with_membership.userId, 'scenario_author')
  await f.addMember(other.organization.id, seats.outsider.userId, 'program_lead')

  const built: Partial<Record<Seat, Headers>> = {}
  for (const seat of SEATS) {
    built[seat] = await asUser(seats[seat].userId, { activeOrganizationId: seats[seat].org })
  }
  sessions = built as Record<Seat, Headers>

  // Version 2 of the same package: a draft with elements and no seed record.
  const version = await scenariosRepo.insertVersion(fx.orgId, {
    packageId: fx.packageId,
    version: 2,
    status: 'draft',
    conceptSet: ['payback_period', 'contribution_margin', 'cohort_retention', 'evidence_recency'],
  })
  seedlessVersionId = version.id
  const document = await scenariosRepo.upsertElement(fx.orgId, version.id, 'document', {
    key: 'D1',
    title: 'Premium tier positioning review',
    author: 'Ingrid Halden, Founder',
    datedOn: '2026-01-05',
    body: 'The premium cohort cost 320 dollars each.',
    wordCount: 7,
    role: 'supporting',
    position: 0,
  })
  seedlessDocumentId = document.id
}, 180_000)

afterAll(async () => {
  await stopBoss()
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// The permission matrix rows (08 §4 "Create package from seed; run generation")
// ---------------------------------------------------------------------------------------------

describe('who may run generation', () => {
  it.each([
    ['author', 409, 'SEED_MISSING'],
    ['instructor', 409, 'SEED_MISSING'],
    ['editor_with_membership', 409, 'SEED_MISSING'],
    ['student', 403, 'FORBIDDEN'],
    ['ta', 403, 'FORBIDDEN'],
    ['program_lead', 403, 'FORBIDDEN'],
    ['editor_without_membership', 404, 'NOT_FOUND'],
    ['outsider', 404, 'NOT_FOUND'],
  ] as const)('POST /generation as %s answers %i', async (seat, status, code) => {
    const called = await startAs(seat)
    expect(called.status).toBe(status)
    expect(errorCode(called)).toBe(code)
  })

  it.each([
    ['author', 200],
    ['instructor', 200],
    ['editor_with_membership', 200],
    ['student', 403],
    ['ta', 403],
    ['program_lead', 403],
    ['editor_without_membership', 404],
    ['outsider', 404],
  ] as const)('GET /generation as %s answers %i', async (seat, status) => {
    expect((await statusAs(seat)).status).toBe(status)
  })

  it.each([
    ['author', 202],
    ['instructor', 202],
    ['editor_with_membership', 202],
    ['student', 403],
    ['ta', 403],
    ['program_lead', 403],
    ['editor_without_membership', 404],
    ['outsider', 404],
  ] as const)(
    'POST /elements/.../regenerate as %s answers %i',
    async (seat, status) => {
      const called = await regenerateAs(seat)
      expect(called.status).toBe(status)
      if (status === 202) {
        expect(called.body).toMatchObject({ step: 'documents' })
        // The queued work is drained before the next row, so no row meets a pipeline the last one
        // left running.
        await drain()
      }
    },
    60_000,
  )

  it('is refused to an anonymous request, and to a cookie without the CSRF header', async () => {
    expect((await startAs('author' as Seat, seedlessVersionId)).status).toBe(409)
    const anonymous = await call(generationRoute.POST, {
      method: 'POST',
      path: `/package-versions/${seedlessVersionId}/generation`,
      params: { versionId: seedlessVersionId },
    })
    expect(anonymous.status).toBe(401)

    const noCsrf = new Request(
      `http://localhost:3000/api/v1/package-versions/${seedlessVersionId}/generation`,
      { method: 'POST', headers: new Headers(sessions.author) },
    )
    const response = await generationRoute.POST(noCsrf, {
      params: Promise.resolve({ versionId: seedlessVersionId }),
    })
    expect(response.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------------------------
// The endpoints themselves (07 §6)
// ---------------------------------------------------------------------------------------------

describe('the generation endpoints', () => {
  it('starts the pipeline, reports its status, and refuses a second start while it runs', async () => {
    const started = await startAs('author', fx.versionId)
    expect(started.status).toBe(202)
    expect(started.body).toEqual({ started: true })
    await drain()

    const status = await statusAs('author', fx.versionId)
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      packageVersionId: fx.versionId,
      packageId: fx.packageId,
      state: 'complete',
      validation: { ok: true, failures: [] },
    })
    expect((status.body?.['steps'] as unknown[]).length).toBe(7)

    // A start taken while a step of this version is still queued is `GENERATION_ALREADY_RUNNING`
    // (07 §6). The queued row is written by hand rather than by racing the drain, because the
    // refusal is about the row, not about the timing (D-400).
    await testSql`
      insert into generation_runs (package_version_id, step, pass_number, status)
      values (${fx.versionId}, 'documents', 1, 'queued')`
    const second = await startAs('author', fx.versionId)
    expect(second.status).toBe(409)
    expect(errorCode(second)).toBe('GENERATION_ALREADY_RUNNING')
    await testSql`delete from generation_runs where package_version_id = ${fx.versionId} and status = 'queued'`
  }, 120_000)

  it('refuses every generation write once the version is confirmed', async () => {
    // A version of its own, frozen and left frozen: the `package_version_frozen` trigger refuses to
    // un-confirm one, which is the invariant this test is about seen from the other side (NFR-004).
    const scenariosRepo = await import('@/server/modules/scenarios/repository')
    const version = await scenariosRepo.insertVersion(fx.orgId, {
      packageId: fx.packageId,
      version: 3,
      status: 'draft',
      conceptSet: ['payback_period', 'contribution_margin', 'cohort_retention', 'evidence_recency'],
    })
    const document = await scenariosRepo.upsertElement(fx.orgId, version.id, 'document', {
      key: 'D1',
      title: 'Premium tier positioning review',
      author: 'Ingrid Halden, Founder',
      datedOn: '2026-01-05',
      body: 'The premium cohort cost 320 dollars each.',
      wordCount: 7,
      role: 'supporting',
      position: 0,
    })
    await testSql`
      update scenario_package_versions
         set status = 'confirmed', confirmed_at = now(), confirmed_by = ${fx.authorId}
       where id = ${version.id}`

    const started = await startAs('author', version.id)
    expect(started.status).toBe(409)
    expect(errorCode(started)).toBe('VERSION_FROZEN')

    const regenerated = await regenerateAs('author', document.id, version.id)
    expect(regenerated.status).toBe(409)
    expect(errorCode(regenerated)).toBe('VERSION_FROZEN')

    // Nothing was queued behind either refusal.
    const runs = await testSql<{ count: number }[]>`
      select count(*)::int as count from generation_runs where package_version_id = ${version.id}`
    expect(runs[0]?.count).toBe(0)
  })

  it('answers NOT_FOUND for a version id that names nothing, whatever the seat', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await startAs('author', missing)).status).toBe(404)
    expect((await statusAs('author', missing)).status).toBe(404)
  })

  it('validates the regenerate body against the module schema', async () => {
    const called = await call(regenerateRoute.POST, {
      method: 'POST',
      path: `/package-versions/${seedlessVersionId}/elements/document/${seedlessDocumentId}/regenerate`,
      session: sessions.author,
      params: {
        versionId: seedlessVersionId,
        elementType: 'document',
        elementId: seedlessDocumentId,
      },
      body: { restatedRule: '' },
    })
    expect(called.status).toBe(400)
    expect(errorCode(called)).toBe('VALIDATION_ERROR')
  })

  it('carries the seed case nowhere near the wire', async () => {
    // FR-028 and 12 §8: the status is about the pipeline, never about the licensed case behind it.
    const status = await statusAs('author', fx.versionId)
    expect(JSON.stringify(status.body)).not.toContain(SEED.seedText.slice(0, 40))
    expect(JSON.stringify(status.body)).not.toContain(SEED.caseTitle)
  })
})
