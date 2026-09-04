// Step 3.5 — every endpoint of docs/tech/07-api-spec.md §4 with one allow and one deny case,
// called as a real `Request` through the handler each `src/app/api/v1/**/route.ts` exports. The
// deny cases are the "—" cells of 08-auth-authz.md §4 for these rows, plus the cross-tenant rule of
// 07 §1: an institution or an agreement in another tenant answers 404, never 403.
//
// `asUser()` supplies the session cookie; non-GET requests carry `X-Requested-With: tassl`, the
// CSRF header `defineRoute` requires of cookie-authenticated mutations (08 §2.7).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'

type Outbox = Array<{ to: string; template: string; props: Record<string, string> }>

const outbox = vi.hoisted(() => [] as Outbox)

vi.mock('@/server/email/send', () => ({
  sendEmail: async (input: Outbox[number]) => {
    outbox.push(input)
  },
}))

type Institutions = typeof import('@/app/api/v1/institutions/route')
type Institution = typeof import('@/app/api/v1/institutions/[orgId]/route')
type Settings = typeof import('@/app/api/v1/institutions/[orgId]/settings/route')
type Invitations = typeof import('@/app/api/v1/institutions/[orgId]/invitations/route')
type Agreements = typeof import('@/app/api/v1/institutions/[orgId]/agreements/route')
type Accept = typeof import('@/app/api/v1/invitations/[invitationId]/accept/route')
type Agreement = typeof import('@/app/api/v1/agreements/[agreementId]/route')
type Repository = typeof import('@/server/modules/tenancy/repository')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

let institutions: Institutions
let institution: Institution
let settings: Settings
let invitations: Invitations
let agreements: Agreements
let accept: Accept
let agreement: Agreement
let repo: Repository
let f: Factories

let orgA: string
let orgB: string
let lead: UserRow
let instructor: UserRow
let student: UserRow
let admin: UserRow
let editor: UserRow
let invitee: UserRow
let outsider: UserRow
let newLead: UserRow

const MAPPING = { novice: 1, developing: 2, proficient: 3, professional: 4 }

const AGREEMENT = {
  counterparty: 'Walkthrough University',
  permittedPlatformRoles: ['tassl_scenario_editor'],
  purposes: ['scoring_audit'],
  retentionDays: 365,
  documentReference: 'DSA-2026-01',
  signedAt: '2026-09-01T00:00:00.000Z',
}

type Called = { status: number; body: Record<string, unknown> }

/** Calls one route handler with a session, the CSRF header, and the matched path parameters. */
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
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

const errorCode = (called: Called): unknown => (called.body.error as { code?: unknown }).code

describe('tenancy endpoints (07 §4)', () => {
  beforeAll(async () => {
    await truncateAll()
    institutions = await import('@/app/api/v1/institutions/route')
    institution = await import('@/app/api/v1/institutions/[orgId]/route')
    settings = await import('@/app/api/v1/institutions/[orgId]/settings/route')
    invitations = await import('@/app/api/v1/institutions/[orgId]/invitations/route')
    agreements = await import('@/app/api/v1/institutions/[orgId]/agreements/route')
    accept = await import('@/app/api/v1/invitations/[invitationId]/accept/route')
    agreement = await import('@/app/api/v1/agreements/[agreementId]/route')
    repo = await import('@/server/modules/tenancy/repository')
    f = await import('@tests/factories')

    orgA = (await f.createInstitution('api-tenancy')).organization.id
    orgB = (await f.createInstitution('api-other')).organization.id

    lead = await f.createUser('api-lead')
    instructor = await f.createUser('api-instructor')
    student = await f.createUser('api-student')
    admin = await f.createUser('api-admin', { platformRole: 'admin' })
    editor = await f.createUser('api-editor', { platformRole: 'tassl_scenario_editor' })
    invitee = await f.createUser('api-invitee')
    outsider = await f.createUser('api-outsider')
    newLead = await f.createUser('api-new-lead')

    await f.addMember(orgA, lead.id, 'program_lead')
    await f.addMember(orgA, instructor.id, 'instructor')
    await f.addMember(orgA, student.id, 'student')
    await f.addMember(orgA, editor.id, 'scenario_author')
  })

  afterAll(async () => {
    await truncateAll()
  })

  const sessionFor = (user: UserRow, orgId?: string): Promise<Headers> =>
    asUser(user.id, { activeOrganizationId: orgId ?? null })

  describe('POST /institutions', () => {
    it('creates the institution, its settings, and the program lead member for an admin', async () => {
      const created = await call(institutions.POST, {
        method: 'POST',
        path: '/institutions',
        session: await sessionFor(admin),
        body: { name: 'Created University', slug: 'api-created', programLeadEmail: newLead.email },
      })

      expect(created.status).toBe(201)
      expect(created.body).toMatchObject({ name: 'Created University', slug: 'api-created' })

      const orgId = created.body.id as string
      const members = await testSql<{ role: string }[]>`
        select role from member where organization_id = ${orgId} and user_id = ${newLead.id}`
      expect(members).toEqual([{ role: 'program_lead' }])
      expect(await repo.findSettings(orgId)).not.toBeNull()
    })

    it('refuses a non-admin', async () => {
      const denied = await call(institutions.POST, {
        method: 'POST',
        path: '/institutions',
        session: await sessionFor(instructor, orgA),
        body: { name: 'Nope University', slug: 'api-nope', programLeadEmail: newLead.email },
      })

      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')
      const rows = await testSql<{ id: string }[]>`
        select id from organization where slug = 'api-nope'`
      expect(rows).toHaveLength(0)
    })
  })

  describe('GET /institutions', () => {
    it('lists the institutions the actor belongs to, with the role held', async () => {
      const listed = await call(institutions.GET, {
        path: '/institutions',
        session: await sessionFor(instructor, orgA),
      })

      expect(listed.status).toBe(200)
      expect(listed.body).toEqual([expect.objectContaining({ id: orgA, role: 'instructor' })])
    })

    it('refuses a request with no session', async () => {
      const denied = await call(institutions.GET, { path: '/institutions', session: null })

      expect(denied.status).toBe(401)
      expect(errorCode(denied)).toBe('UNAUTHENTICATED')
    })
  })

  describe('GET /institutions/{orgId}', () => {
    it('returns the institution with its settings for a member', async () => {
      const read = await call(institution.GET, {
        path: `/institutions/${orgA}`,
        session: await sessionFor(student, orgA),
        params: { orgId: orgA },
      })

      expect(read.status).toBe(200)
      expect(read.body).toMatchObject({
        id: orgA,
        settings: { plan: 'pilot', defaultMapping: MAPPING },
      })
    })

    it('answers 404 for an institution in another tenant', async () => {
      const denied = await call(institution.GET, {
        path: `/institutions/${orgB}`,
        session: await sessionFor(instructor, orgA),
        params: { orgId: orgB },
      })

      expect(denied.status).toBe(404)
      expect(errorCode(denied)).toBe('NOT_FOUND')
    })
  })

  describe('PATCH /institutions/{orgId}/settings', () => {
    it('lets the program lead set the plan and the default mapping', async () => {
      const updated = await call(settings.PATCH, {
        method: 'PATCH',
        path: `/institutions/${orgA}/settings`,
        session: await sessionFor(lead, orgA),
        params: { orgId: orgA },
        body: {
          plan: 'course_license',
          defaultMapping: { novice: 2, developing: 4, proficient: 6, professional: 8 },
        },
      })

      expect(updated.status).toBe(200)
      expect(updated.body).toMatchObject({
        settings: {
          plan: 'course_license',
          defaultMapping: { novice: 2, developing: 4, proficient: 6, professional: 8 },
        },
      })
    })

    it('refuses an instructor and refuses a mapping that is not four positive numbers', async () => {
      const denied = await call(settings.PATCH, {
        method: 'PATCH',
        path: `/institutions/${orgA}/settings`,
        session: await sessionFor(instructor, orgA),
        params: { orgId: orgA },
        body: { plan: 'pilot' },
      })
      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')

      const invalid = await call(settings.PATCH, {
        method: 'PATCH',
        path: `/institutions/${orgA}/settings`,
        session: await sessionFor(lead, orgA),
        params: { orgId: orgA },
        body: { defaultMapping: { novice: 0, developing: 2, proficient: 3, professional: 4 } },
      })
      expect(invalid.status).toBe(400)
      expect(errorCode(invalid)).toBe('MAPPING_INVALID')
    })
  })

  describe('POST /institutions/{orgId}/invitations', () => {
    it('lets an instructor invite by email', async () => {
      const created = await call(invitations.POST, {
        method: 'POST',
        path: `/institutions/${orgA}/invitations`,
        session: await sessionFor(instructor, orgA),
        params: { orgId: orgA },
        body: { email: invitee.email, role: 'student' },
      })

      expect(created.status).toBe(201)
      expect(created.body).toMatchObject({
        email: invitee.email,
        role: 'student',
        status: 'pending',
      })
    })

    it('refuses a student', async () => {
      const denied = await call(invitations.POST, {
        method: 'POST',
        path: `/institutions/${orgA}/invitations`,
        session: await sessionFor(student, orgA),
        params: { orgId: orgA },
        body: { email: outsider.email, role: 'student' },
      })

      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')
    })
  })

  describe('POST /invitations/{invitationId}/accept', () => {
    it('refuses an invitation addressed to a different email', async () => {
      const [pending] = await testSql<{ id: string }[]>`
        select id from invitation where email = ${invitee.email} and status = 'pending'`

      const denied = await call(accept.POST, {
        method: 'POST',
        path: `/invitations/${pending!.id}/accept`,
        session: await sessionFor(outsider),
        params: { invitationId: pending!.id },
      })

      expect(denied.status).toBe(409)
      expect(errorCode(denied)).toBe('INVITATION_EMAIL_MISMATCH')
    })

    it('accepts the invitation for the invited email and returns the membership', async () => {
      const [pending] = await testSql<{ id: string }[]>`
        select id from invitation where email = ${invitee.email} and status = 'pending'`

      const accepted = await call(accept.POST, {
        method: 'POST',
        path: `/invitations/${pending!.id}/accept`,
        session: await sessionFor(invitee),
        params: { invitationId: pending!.id },
      })

      expect(accepted.status).toBe(200)
      expect(accepted.body).toEqual({
        organizationId: orgA,
        name: 'api-tenancy University',
        role: 'student',
      })
    })
  })

  describe('GET and POST /institutions/{orgId}/agreements', () => {
    it('lets the program lead write an agreement and read it back', async () => {
      const created = await call(agreements.POST, {
        method: 'POST',
        path: `/institutions/${orgA}/agreements`,
        session: await sessionFor(lead, orgA),
        params: { orgId: orgA },
        body: AGREEMENT,
      })

      expect(created.status).toBe(201)
      expect(created.body).toMatchObject({
        organizationId: orgA,
        purposes: ['scoring_audit'],
        endsAt: null,
      })

      const listed = await call(agreements.GET, {
        path: `/institutions/${orgA}/agreements`,
        session: await sessionFor(lead, orgA),
        params: { orgId: orgA },
      })
      expect(listed.status).toBe(200)
      expect(listed.body).toHaveLength(1)

      // FR-234: the platform editor reads the rows of an institution they are a member of.
      const asEditor = await call(agreements.GET, {
        path: `/institutions/${orgA}/agreements`,
        session: await sessionFor(editor, orgA),
        params: { orgId: orgA },
      })
      expect(asEditor.status).toBe(200)

      // The audit row is written in the same transaction as the agreement (08 §5).
      const audits = await testSql<{ action: string }[]>`
        select action from audit_logs where action = 'agreement.upsert'`
      expect(audits).toHaveLength(1)
    })

    it('refuses an instructor, and refuses an agreement with no purposes', async () => {
      const denied = await call(agreements.GET, {
        path: `/institutions/${orgA}/agreements`,
        session: await sessionFor(instructor, orgA),
        params: { orgId: orgA },
      })
      expect(denied.status).toBe(403)
      expect(errorCode(denied)).toBe('FORBIDDEN')

      const invalid = await call(agreements.POST, {
        method: 'POST',
        path: `/institutions/${orgA}/agreements`,
        session: await sessionFor(lead, orgA),
        params: { orgId: orgA },
        body: { ...AGREEMENT, purposes: [] },
      })
      expect(invalid.status).toBe(400)
      expect(errorCode(invalid)).toBe('AGREEMENT_PURPOSES_INVALID')
    })
  })

  describe('PATCH /agreements/{agreementId}', () => {
    it('ends an agreement of the actor’s own institution', async () => {
      const rows = await repo.listAgreements(orgA)
      const target = rows[0]!

      const ended = await call(agreement.PATCH, {
        method: 'PATCH',
        path: `/agreements/${target.id}`,
        session: await sessionFor(lead, orgA),
        params: { agreementId: target.id },
        body: { endsAt: '2026-12-31T00:00:00.000Z' },
      })

      expect(ended.status).toBe(200)
      expect(ended.body).toMatchObject({
        id: target.id,
        endsAt: '2026-12-31T00:00:00.000Z',
        counterparty: target.counterparty,
      })
    })

    it('answers 404 for an agreement in another tenant', async () => {
      const elsewhere = await repo.upsertAgreement(orgB, {
        counterparty: 'Other University',
        permittedPlatformRoles: ['tassl_scenario_editor'],
        purposes: ['drift_review'],
        retentionDays: 90,
        documentReference: 'DSA-2026-99',
        signedAt: new Date('2026-09-01T00:00:00.000Z'),
      })

      const denied = await call(agreement.PATCH, {
        method: 'PATCH',
        path: `/agreements/${elsewhere!.id}`,
        session: await sessionFor(lead, orgA),
        params: { agreementId: elsewhere!.id },
        body: { retentionDays: 30 },
      })

      expect(denied.status).toBe(404)
      expect(errorCode(denied)).toBe('NOT_FOUND')
    })
  })
})
