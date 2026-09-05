// Step 3.6 — the authorization matrix. docs/tech/08-auth-authz.md §4 is the source of truth: every
// "—" cell is a denial that must be proven, and this file proves the ones whose endpoint exists
// today (07-api-spec.md §3 to §6). Later phases append rows for their endpoints; nothing here needs
// to change but the operation registry and the table.
//
// ---------------------------------------------------------------------------------------------
// The contract: tests/integration/auth/matrix.json
// ---------------------------------------------------------------------------------------------
//
// A flat JSON array. One row per cell of 08 §4 that an endpoint answers:
//
//   { "operationId": "listAgreements", "role": "instructor", "expected": "deny" }
//
//   operationId  the `openapi.operationId` of the route (src/server/modules/<name>/router.ts),
//                which must also be a key of OPERATIONS below.
//   role         one of the eight seats of the fixture, spelled exactly as SEATS:
//                student, instructor, ta, author, program_lead, editor, admin, outsider.
//                The first six belong to institution A; `admin` is the platform admin and holds no
//                institution seat; `outsider` is the program lead of institution B and is how every
//                cross-tenant "—" is proven.
//   expected     'allow'  the endpoint must not answer 401, 403 or 404;
//                'deny'   the endpoint must answer one of those three (which one is recorded in
//                         the summary below the run, so a change of shape stays visible; the
//                         403-versus-404 rule of 08 §4 "Cross-tenant" is asserted code by code in
//                         tests/integration/api/tenancy.test.ts).
//
// Every registered operation carries a row for all eight seats — the completeness test enforces it,
// so a new endpoint cannot be added to OPERATIONS without deciding all eight cells, and a row for
// an unregistered operationId fails rather than being skipped.
//
// ---------------------------------------------------------------------------------------------
// How a row is driven
// ---------------------------------------------------------------------------------------------
//
// Through the real route handler exported by `src/app/api/v1/**/route.ts`, with the session cookie
// `asUser()` mints and the `X-Requested-With: tassl` header `defineRoute` requires of every
// cookie-authenticated mutation (08 §2.7) — the same path a browser takes, so a permission check
// that lives only in the UI cannot make a row pass.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'
import type { OrganizationRole } from '@/server/auth/access-control-shared'
import matrixTable from './matrix.json'

type Outbox = Array<{ to: string; template: string; props: Record<string, string> }>

// `inviteMember` sends through the organization plugin's `sendInvitationEmail`; the matrix cares
// about the status code, not the delivery, and the real `sendEmail` would enqueue a job per row.
const outbox = vi.hoisted(() => [] as Outbox)

vi.mock('@/server/email/send', () => ({
  sendEmail: async (input: Outbox[number]) => {
    outbox.push(input)
  },
}))

// ---------------------------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------------------------

const SEATS = [
  'student',
  'instructor',
  'ta',
  'author',
  'program_lead',
  'editor',
  'admin',
  'outsider',
] as const

type Seat = (typeof SEATS)[number]
type Expected = 'allow' | 'deny'
type MatrixRow = { operationId: string; role: Seat; expected: Expected }

/** 08 §4 is proven by refusal, so these three statuses — and only these — count as a denial. */
const DENY_STATUSES = new Set([401, 403, 404])

const ROWS = matrixTable as MatrixRow[]

const rowsFor = (operationId: string): MatrixRow[] =>
  ROWS.filter((row) => row.operationId === operationId)

/** The operations the matrix covers today, in the order 07-api-spec.md lists them. */
const OPERATION_IDS = [
  'listInstitutions',
  'createInstitution',
  'getInstitution',
  'updateInstitutionSettings',
  'inviteMember',
  'acceptInvitation',
  'listAgreements',
  'createAgreement',
  'updateAgreement',
  'getMe',
  'updateMe',
  'deleteMe',
  'exportMe',
  'listMyAssignments',
  'listMyRuns',
  'listCourses',
  'createCourse',
  'getCourse',
  'updateCoursePolicy',
  'createSection',
  'listSectionMembers',
  'addSectionMember',
  'removeSectionMember',
  'createAssignment',
  'getAssignment',
  'updateAssignment',
  'getPolicyDisplay',
  'startRun',
  'listAssignmentRuns',
  'getRun',
  'acknowledgePolicy',
  'deleteWalkthroughRun',
  'listPackages',
  'createPackageFromSeed',
  'importPackage',
  'getPackage',
  'getPackageVersion',
  'exportPackageVersion',
  'getClaimObject',
  'updateElement',
  'decideElement',
  'confirmPackageVersion',
  'regeneratePackageVersion',
] as const

// ---------------------------------------------------------------------------------------------
// The fixture: two institutions, eight seats
// ---------------------------------------------------------------------------------------------

type SeatSpec = {
  platformRole: 'none' | 'tassl_scenario_editor' | 'admin'
  /** The institution the seat belongs to and the role held there; null = no institution seat. */
  membership: { institution: 'A' | 'B'; role: OrganizationRole } | null
}

/**
 * The seats of 08 §3. Two of them carry the weight of the cross-tenant and platform rules:
 *
 *   - `editor` is a platform `tassl_scenario_editor` who also holds a `scenario_author` membership
 *     in institution A, which is the only shape 08 §4 admits an editor in ("✓* any org where the
 *     editor has a `scenario_author` membership");
 *   - `outsider` is the *program lead* of institution B, so every cross-tenant denial is proven
 *     against the highest institution role there is rather than against a bare account.
 */
const SEAT_SPECS: Record<Seat, SeatSpec> = {
  student: { platformRole: 'none', membership: { institution: 'A', role: 'student' } },
  instructor: { platformRole: 'none', membership: { institution: 'A', role: 'instructor' } },
  ta: { platformRole: 'none', membership: { institution: 'A', role: 'teaching_assistant' } },
  author: { platformRole: 'none', membership: { institution: 'A', role: 'scenario_author' } },
  program_lead: { platformRole: 'none', membership: { institution: 'A', role: 'program_lead' } },
  editor: {
    platformRole: 'tassl_scenario_editor',
    membership: { institution: 'A', role: 'scenario_author' },
  },
  admin: { platformRole: 'admin', membership: null },
  outsider: { platformRole: 'none', membership: { institution: 'B', role: 'program_lead' } },
}

type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

type RouteHandler = (
  request: Request,
  context: { params: Promise<Record<string, string>> },
) => Promise<Response>

type Called = { status: number; code: string | null }

type Operation = {
  /** Method and path template, for the failure message. */
  route: string
  run: (seat: Seat) => Promise<Called>
}

let f: Factories
let orgA: string
let orgB: string
/** A third institution, used only for the invitations the `acceptInvitation` rows accept, so that
 *  accepting one cannot change any seat's standing in institution A or B. */
let orgInvites: string
let seats: Record<Seat, UserRow>
/** One throwaway account per seat, seeded identically, for the destructive `deleteMe` rows. */
let deletable: Record<Seat, UserRow>
let programLead: UserRow
let agreementId: string
let invitations: Record<Seat, string>
let operations: Record<string, Operation>

/**
 * The courses fixture (Step 4.1): one course of institution A created by the `instructor` seat,
 * with a section the three section seats hold a membership in, a confirmed package version, an
 * assignment, and a walkthrough assignment. The two destructive rows — `removeSectionMember` and
 * `deleteWalkthroughRun` — get one target per seat, so a row that is allowed cannot change what a
 * later row is answered.
 */
let course: string
let section: string
let assignment: string
let walkthroughAssignment: string
let packageVersionId: string
let soundVariantId: string
let defectiveVariantId: string
let addable: UserRow
let removable: Record<Seat, UserRow>
let walkthroughRuns: Record<Seat, string>
/** The `student` seat's own run, in `assigned`, for the two rows addressed by run id. */
let ownRun: string

/**
 * The packages fixture (Step 5.2): a *draft* package of institution A holding one claim. It is a
 * draft because every write row of 07 §6 refuses a confirmed version with `VERSION_FROZEN` before
 * it ever reaches the permission check, which would make an allowed seat indistinguishable from a
 * denied one; and it holds a claim because `getClaimObject` has nothing to answer about without
 * one. The two element rows address the version's `brief`, a singleton, so they need no element of
 * their own — `SINGLETON_ELEMENT_ID` is how a route names one (06 §3.3).
 */
let authoredPackageId: string
let authoredVersionId: string
let authoredClaimId: string

/** Stand-in `element_id` for a singleton element (`scenarios/schema.ts` `SINGLETON_ELEMENT_ID`). */
const SINGLETON_ELEMENT_ID = '00000000-0000-0000-0000-000000000000'

/** The smallest document `PackageExportSchema` accepts: everything else carries a default. */
const importDocument = (seat: Seat) => ({
  schemaVersion: 1,
  package: { title: `Matrix import by ${seat}`, familyKey: `matrix-import-${slugOf(seat)}` },
  version: {
    conceptSet: ['payback_period', 'segmentation', 'retention_cohorts', 'ai_verification'],
  },
})

/** The seed body of `POST /institutions/{orgId}/packages`; `seedText` has a 200-character floor. */
const seedBody = (seat: Seat) => ({
  title: `Matrix package by ${seat}`,
  familyKey: `matrix-seed-${slugOf(seat)}`,
  conceptSet: ['payback_period', 'segmentation', 'retention_cohorts', 'ai_verification'],
  seed: {
    caseTitle: 'Matrix licensed case',
    publisher: 'Tassl',
    licenseTerms: 'internal fixture',
    licensePermitsAdaptation: true,
    seedText:
      'A regional coffee roaster with a value subscription tier and a premium tier decides how ' +
      'much of next year’s marketing budget to move between them, and how fast, against a ' +
      'retention record that has been revised once since the positioning deck was written.',
  },
})

/** Seat labels reach slugs and emails; `program_lead` has to lose its underscore to pass z.email(). */
const slugOf = (seat: Seat): string => seat.replace(/_/g, '-')

const AGREEMENT = {
  counterparty: 'Matrix University',
  permittedPlatformRoles: ['tassl_scenario_editor'],
  purposes: ['scoring_audit'],
  retentionDays: 365,
  documentReference: 'DSA-2026-MATRIX',
  signedAt: '2026-09-01T00:00:00.000Z',
}

/**
 * The institution a seat's session points at. Institution A for everyone but the outsider — the
 * platform admin included: `PATCH /agreements/{agreementId}` addresses an agreement without naming
 * its institution and reads the tenant from the session (10 §2), so an admin session with no active
 * institution could only ever answer 404. It buys the admin nothing else — they hold no `member`
 * row, which is what every other admin denial below rests on.
 */
const activeOrgOf = (seat: Seat): string =>
  SEAT_SPECS[seat].membership?.institution === 'B' ? orgB : orgA

const sessionFor = (seat: Seat): Promise<Headers> =>
  asUser(seats[seat].id, { activeOrganizationId: activeOrgOf(seat) })

const deletableSessionFor = (seat: Seat): Promise<Headers> =>
  asUser(deletable[seat].id, { activeOrganizationId: activeOrgOf(seat) })

/** Calls one route handler the way the browser does, and answers only what the matrix judges. */
async function call(
  handler: RouteHandler,
  options: {
    method?: string
    path: string
    session: Headers
    params?: Record<string, string>
    body?: unknown
  },
): Promise<Called> {
  const method = options.method ?? 'GET'
  const headers = new Headers(options.session)
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
  // `DELETE /me` answers 204 with no body (07 §3); everything else carries JSON.
  const text = await response.text()
  const parsed = text === '' ? null : (JSON.parse(text) as { error?: { code?: string } })
  return { status: response.status, code: parsed?.error?.code ?? null }
}

/** Creates the seat's account and its `member` row; returns the user. */
async function seatUser(seat: Seat, label: string): Promise<UserRow> {
  const spec = SEAT_SPECS[seat]
  const user = await f.createUser(label, { platformRole: spec.platformRole })
  if (spec.membership) {
    const orgId = spec.membership.institution === 'A' ? orgA : orgB
    await f.addMember(orgId, user.id, spec.membership.role)
  }
  return user
}

/** A pending invitation to `orgInvites` addressed to `email`, written the way the plugin writes it. */
async function pendingInvitation(email: string, inviterId: string): Promise<string> {
  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await testSql`
    insert into invitation (id, organization_id, email, role, status, expires_at, created_at, inviter_id)
    values (${id}, ${orgInvites}, ${email}, 'student', 'pending', ${expiresAt}, now(), ${inviterId})`
  return id
}

/** Every outcome the run produced, printed once at the end so a change of shape is visible. */
const observed: Array<{ operationId: string; role: Seat; expected: Expected } & Called> = []

describe('authorization matrix (08 §4)', () => {
  beforeAll(async () => {
    await truncateAll()
    f = await import('@tests/factories')

    orgA = (await f.createInstitution('matrix-a')).organization.id
    orgB = (await f.createInstitution('matrix-b')).organization.id
    orgInvites = (await f.createInstitution('matrix-invites')).organization.id

    const built: Partial<Record<Seat, UserRow>> = {}
    const builtDeletable: Partial<Record<Seat, UserRow>> = {}
    for (const seat of SEATS) {
      built[seat] = await seatUser(seat, `matrix-${slugOf(seat)}`)
      builtDeletable[seat] = await seatUser(seat, `matrix-deletable-${slugOf(seat)}`)
    }
    seats = built as Record<Seat, UserRow>
    deletable = builtDeletable as Record<Seat, UserRow>

    // The program lead every `createInstitution` row names; the institution is only created by the
    // one row 08 §4 allows, so the others cannot collide with it.
    programLead = await f.createUser('matrix-new-lead')

    const invited: Partial<Record<Seat, string>> = {}
    for (const seat of SEATS) {
      invited[seat] = await pendingInvitation(seats[seat].email, programLead.id)
    }
    invitations = invited as Record<Seat, string>

    const repo = await import('@/server/modules/tenancy/repository')
    const row = await repo.upsertAgreement(orgA, {
      counterparty: AGREEMENT.counterparty,
      permittedPlatformRoles: [...AGREEMENT.permittedPlatformRoles],
      purposes: ['scoring_audit'],
      retentionDays: AGREEMENT.retentionDays,
      documentReference: AGREEMENT.documentReference,
      signedAt: new Date(AGREEMENT.signedAt),
      endsAt: null,
    })
    agreementId = row!.id

    const pkg = await f.minimalConfirmedVersion(orgA, 'matrix-package', {
      createdBy: seats.instructor.id,
    })
    packageVersionId = pkg.version.id
    soundVariantId = pkg.sound.id
    defectiveVariantId = pkg.defective.id

    const courseRow = await f.createCourse(orgA, 'matrix', { createdBy: seats.instructor.id })
    course = courseRow.id
    const sectionRow = await f.createSection(orgA, courseRow.id, 'matrix-a')
    section = sectionRow.id
    await f.addSectionMember(orgA, section, seats.instructor.id, 'instructor')
    await f.addSectionMember(orgA, section, seats.student.id, 'student')
    await f.addSectionMember(orgA, section, seats.ta.id, 'ta')

    assignment = (
      await f.createAssignment(orgA, section, 'matrix-assignment', {
        packageVersionId,
        variantId: defectiveVariantId,
        isWalkthrough: false,
      })
    ).id
    walkthroughAssignment = (
      await f.createAssignment(orgA, section, 'matrix-walkthrough', {
        packageVersionId,
        variantId: soundVariantId,
        isWalkthrough: true,
      })
    ).id

    // The address `addSectionMember` names: a member of institution A who is not yet in the section.
    addable = await f.createUser('matrix-addable')
    await f.addMember(orgA, addable.id, 'student')

    const runsRepository = await import('@/server/modules/runs/repository')
    const removableBuilt: Partial<Record<Seat, UserRow>> = {}
    const runsBuilt: Partial<Record<Seat, string>> = {}
    for (const seat of SEATS) {
      const person = await f.createUser(`matrix-removable-${slugOf(seat)}`)
      await f.addMember(orgA, person.id, 'student')
      await f.addSectionMember(orgA, section, person.id, 'student')
      removableBuilt[seat] = person

      // The run each `deleteWalkthroughRun` row targets belongs to its own student, so no row is a
      // `MEMBER_HAS_RUNS` refusal of the row above it.
      const runner = await f.createUser(`matrix-runner-${slugOf(seat)}`)
      await f.addMember(orgA, runner.id, 'student')
      await f.addSectionMember(orgA, section, runner.id, 'student')
      runsBuilt[seat] = (
        await runsRepository.insertRun(orgA, {
          assignmentId: walkthroughAssignment,
          studentId: runner.id,
          packageVersionId,
          variantId: soundVariantId,
          state: 'working',
          workingClockSeconds: 1500,
          turnDelaySeconds: 90,
        })
      ).id
    }
    removable = removableBuilt as Record<Seat, UserRow>
    walkthroughRuns = runsBuilt as Record<Seat, string>

    // `getRun` and `acknowledgePolicy` are addressed by run id, and the only seat 08 §4 allows
    // either to is the run's owner, so the run belongs to the `student` seat. It sits in
    // `assigned`, which is the one state `acknowledgePolicy` moves out of — the allowed row does
    // the moving, and every other row is refused before the state is ever read.
    ownRun = (
      await runsRepository.insertRun(orgA, {
        assignmentId: walkthroughAssignment,
        studentId: seats.student.id,
        packageVersionId,
        variantId: soundVariantId,
        state: 'assigned',
        workingClockSeconds: 1500,
        turnDelaySeconds: 90,
      })
    ).id

    const scenariosRepository = await import('@/server/modules/scenarios/repository')
    const authored = await f.createPackageVersion(orgA, 'matrix-authored', {
      createdBy: seats.instructor.id,
    })
    authoredPackageId = authored.pkg.id
    authoredVersionId = authored.version.id
    authoredClaimId = (
      await scenariosRepository.upsertElement(orgA, authoredVersionId, 'claim', {
        key: 'C1',
        text: 'Premium payback lands at eleven months on the pilot cohort.',
        sourceKind: 'assistant',
        importance: 'load_bearing',
        consequenceLevel: 'high',
        verificationCost: 'cheap',
        conceptKey: 'payback_period',
        position: 0,
      })
    ).id

    const institutions = await import('@/app/api/v1/institutions/route')
    const institution = await import('@/app/api/v1/institutions/[orgId]/route')
    const settings = await import('@/app/api/v1/institutions/[orgId]/settings/route')
    const invitationsRoute = await import('@/app/api/v1/institutions/[orgId]/invitations/route')
    const agreements = await import('@/app/api/v1/institutions/[orgId]/agreements/route')
    const acceptRoute = await import('@/app/api/v1/invitations/[invitationId]/accept/route')
    const agreement = await import('@/app/api/v1/agreements/[agreementId]/route')
    const me = await import('@/app/api/v1/me/route')
    const exportRoute = await import('@/app/api/v1/me/export/route')
    const assignments = await import('@/app/api/v1/me/assignments/route')
    const runs = await import('@/app/api/v1/me/runs/route')
    const orgCourses = await import('@/app/api/v1/institutions/[orgId]/courses/route')
    const courseDetail = await import('@/app/api/v1/courses/[courseId]/route')
    const courseSections = await import('@/app/api/v1/courses/[courseId]/sections/route')
    const sectionMembers = await import('@/app/api/v1/sections/[sectionId]/members/route')
    const sectionMember = await import('@/app/api/v1/sections/[sectionId]/members/[userId]/route')
    const sectionAssignments = await import('@/app/api/v1/sections/[sectionId]/assignments/route')
    const assignmentDetail = await import('@/app/api/v1/assignments/[assignmentId]/route')
    const policyDisplay =
      await import('@/app/api/v1/assignments/[assignmentId]/policy-display/route')
    const runDetail = await import('@/app/api/v1/runs/[runId]/route')
    const assignmentRunsRoute = await import('@/app/api/v1/assignments/[assignmentId]/runs/route')
    const policyAckRoute = await import('@/app/api/v1/runs/[runId]/policy-ack/route')
    const orgPackages = await import('@/app/api/v1/institutions/[orgId]/packages/route')
    const packagesImport = await import('@/app/api/v1/institutions/[orgId]/packages/import/route')
    const packageDetail = await import('@/app/api/v1/packages/[packageId]/route')
    const versionDetail = await import('@/app/api/v1/package-versions/[versionId]/route')
    const versionExport = await import('@/app/api/v1/package-versions/[versionId]/export/route')
    const claimObject =
      await import('@/app/api/v1/package-versions/[versionId]/claims/[claimId]/route')
    const element =
      await import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/route')
    const elementDecision =
      await import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/decision/route')
    const versionConfirm = await import('@/app/api/v1/package-versions/[versionId]/confirm/route')
    const versionRegenerate =
      await import('@/app/api/v1/package-versions/[versionId]/regenerate/route')

    operations = {
      listInstitutions: {
        route: 'GET /institutions',
        run: async (seat) =>
          call(institutions.GET, { path: '/institutions', session: await sessionFor(seat) }),
      },
      createInstitution: {
        route: 'POST /institutions',
        run: async (seat) =>
          call(institutions.POST, {
            method: 'POST',
            path: '/institutions',
            session: await sessionFor(seat),
            body: {
              name: `Matrix ${seat} University`,
              slug: `matrix-new-${slugOf(seat)}`,
              programLeadEmail: programLead.email,
            },
          }),
      },
      getInstitution: {
        route: 'GET /institutions/{orgId}',
        run: async (seat) =>
          call(institution.GET, {
            path: `/institutions/${orgA}`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
          }),
      },
      updateInstitutionSettings: {
        route: 'PATCH /institutions/{orgId}/settings',
        run: async (seat) =>
          call(settings.PATCH, {
            method: 'PATCH',
            path: `/institutions/${orgA}/settings`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
            body: { plan: 'pilot' },
          }),
      },
      inviteMember: {
        route: 'POST /institutions/{orgId}/invitations',
        run: async (seat) =>
          call(invitationsRoute.POST, {
            method: 'POST',
            path: `/institutions/${orgA}/invitations`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
            body: { email: `matrix-invited-by-${slugOf(seat)}@tassl.local`, role: 'student' },
          }),
      },
      acceptInvitation: {
        route: 'POST /invitations/{invitationId}/accept',
        run: async (seat) =>
          call(acceptRoute.POST, {
            method: 'POST',
            path: `/invitations/${invitations[seat]}/accept`,
            session: await sessionFor(seat),
            params: { invitationId: invitations[seat] },
          }),
      },
      listAgreements: {
        route: 'GET /institutions/{orgId}/agreements',
        run: async (seat) =>
          call(agreements.GET, {
            path: `/institutions/${orgA}/agreements`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
          }),
      },
      createAgreement: {
        route: 'POST /institutions/{orgId}/agreements',
        run: async (seat) =>
          call(agreements.POST, {
            method: 'POST',
            path: `/institutions/${orgA}/agreements`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
            body: AGREEMENT,
          }),
      },
      updateAgreement: {
        route: 'PATCH /agreements/{agreementId}',
        run: async (seat) =>
          call(agreement.PATCH, {
            method: 'PATCH',
            path: `/agreements/${agreementId}`,
            session: await sessionFor(seat),
            params: { agreementId },
            body: { retentionDays: 180 },
          }),
      },
      getMe: {
        route: 'GET /me',
        run: async (seat) => call(me.GET, { path: '/me', session: await sessionFor(seat) }),
      },
      updateMe: {
        route: 'PATCH /me',
        run: async (seat) =>
          call(me.PATCH, {
            method: 'PATCH',
            path: '/me',
            session: await sessionFor(seat),
            body: { name: `Matrix ${seat}` },
          }),
      },
      deleteMe: {
        route: 'DELETE /me',
        // The one destructive row: it runs against the seat's throwaway twin (same platform role,
        // same institution membership), so the eight seats survive to answer the other rows.
        run: async (seat) =>
          call(me.DELETE, {
            method: 'DELETE',
            path: '/me',
            session: await deletableSessionFor(seat),
          }),
      },
      exportMe: {
        route: 'POST /me/export',
        run: async (seat) =>
          call(exportRoute.POST, {
            method: 'POST',
            path: '/me/export',
            session: await sessionFor(seat),
          }),
      },
      listMyAssignments: {
        route: 'GET /me/assignments',
        run: async (seat) =>
          call(assignments.GET, { path: '/me/assignments', session: await sessionFor(seat) }),
      },
      listMyRuns: {
        route: 'GET /me/runs',
        run: async (seat) => call(runs.GET, { path: '/me/runs', session: await sessionFor(seat) }),
      },
      listCourses: {
        route: 'GET /institutions/{orgId}/courses',
        run: async (seat) =>
          call(orgCourses.GET, {
            path: `/institutions/${orgA}/courses`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
          }),
      },
      createCourse: {
        route: 'POST /institutions/{orgId}/courses',
        run: async (seat) =>
          call(orgCourses.POST, {
            method: 'POST',
            path: `/institutions/${orgA}/courses`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
            body: { name: `Matrix course by ${seat}`, term: '2026-fall' },
          }),
      },
      getCourse: {
        route: 'GET /courses/{courseId}',
        run: async (seat) =>
          call(courseDetail.GET, {
            path: `/courses/${course}`,
            session: await sessionFor(seat),
            params: { courseId: course },
          }),
      },
      updateCoursePolicy: {
        route: 'PATCH /courses/{courseId}',
        run: async (seat) =>
          call(courseDetail.PATCH, {
            method: 'PATCH',
            path: `/courses/${course}`,
            session: await sessionFor(seat),
            params: { courseId: course },
            body: { outsideAiPolicy: 'declared' },
          }),
      },
      createSection: {
        route: 'POST /courses/{courseId}/sections',
        run: async (seat) =>
          call(courseSections.POST, {
            method: 'POST',
            path: `/courses/${course}/sections`,
            session: await sessionFor(seat),
            params: { courseId: course },
            body: { name: `Matrix ${seat}` },
          }),
      },
      listSectionMembers: {
        route: 'GET /sections/{sectionId}/members',
        run: async (seat) =>
          call(sectionMembers.GET, {
            path: `/sections/${section}/members`,
            session: await sessionFor(seat),
            params: { sectionId: section },
          }),
      },
      addSectionMember: {
        route: 'POST /sections/{sectionId}/members',
        run: async (seat) =>
          call(sectionMembers.POST, {
            method: 'POST',
            path: `/sections/${section}/members`,
            session: await sessionFor(seat),
            params: { sectionId: section },
            body: { email: addable.email, role: 'student' },
          }),
      },
      removeSectionMember: {
        route: 'DELETE /sections/{sectionId}/members/{userId}',
        // One target per seat: the allowed row deletes its own, so no row depends on another.
        run: async (seat) =>
          call(sectionMember.DELETE, {
            method: 'DELETE',
            path: `/sections/${section}/members/${removable[seat].id}`,
            session: await sessionFor(seat),
            params: { sectionId: section, userId: removable[seat].id },
          }),
      },
      createAssignment: {
        route: 'POST /sections/{sectionId}/assignments',
        run: async (seat) =>
          call(sectionAssignments.POST, {
            method: 'POST',
            path: `/sections/${section}/assignments`,
            session: await sessionFor(seat),
            params: { sectionId: section },
            body: {
              label: `Matrix run by ${seat}`,
              packageVersionId,
              variantId: soundVariantId,
            },
          }),
      },
      getAssignment: {
        route: 'GET /assignments/{assignmentId}',
        run: async (seat) =>
          call(assignmentDetail.GET, {
            path: `/assignments/${assignment}`,
            session: await sessionFor(seat),
            params: { assignmentId: assignment },
          }),
      },
      updateAssignment: {
        route: 'PATCH /assignments/{assignmentId}',
        run: async (seat) =>
          call(assignmentDetail.PATCH, {
            method: 'PATCH',
            path: `/assignments/${assignment}`,
            session: await sessionFor(seat),
            params: { assignmentId: assignment },
            body: { label: `Matrix label by ${seat}` },
          }),
      },
      getPolicyDisplay: {
        route: 'GET /assignments/{assignmentId}/policy-display',
        run: async (seat) =>
          call(policyDisplay.GET, {
            path: `/assignments/${assignment}/policy-display`,
            session: await sessionFor(seat),
            params: { assignmentId: assignment },
          }),
      },
      startRun: {
        route: 'POST /assignments/{assignmentId}/runs',
        // On the assignment that counts, where `ownRun` is not: the one allowed row really creates
        // a run (201) rather than meeting RUN_ACTIVE_EXISTS, so the cell is proven by the act.
        run: async (seat) =>
          call(assignmentRunsRoute.POST, {
            method: 'POST',
            path: `/assignments/${assignment}/runs`,
            session: await sessionFor(seat),
            params: { assignmentId: assignment },
          }),
      },
      listAssignmentRuns: {
        route: 'GET /assignments/{assignmentId}/runs',
        run: async (seat) =>
          call(assignmentRunsRoute.GET, {
            path: `/assignments/${assignment}/runs`,
            session: await sessionFor(seat),
            params: { assignmentId: assignment },
          }),
      },
      getRun: {
        route: 'GET /runs/{runId}',
        run: async (seat) =>
          call(runDetail.GET, {
            path: `/runs/${ownRun}`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      acknowledgePolicy: {
        route: 'POST /runs/{runId}/policy-ack',
        // The one allowed row moves the run to `readiness`; every denied row is refused by the
        // owner check long before the state matters, so no row depends on another.
        run: async (seat) =>
          call(policyAckRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/policy-ack`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      deleteWalkthroughRun: {
        route: 'DELETE /runs/{runId}',
        // One run per seat, as above: the allowed row deletes its own.
        run: async (seat) =>
          call(runDetail.DELETE, {
            method: 'DELETE',
            path: `/runs/${walkthroughRuns[seat]}`,
            session: await sessionFor(seat),
            params: { runId: walkthroughRuns[seat] },
          }),
      },
      listPackages: {
        route: 'GET /institutions/{orgId}/packages',
        run: async (seat) =>
          call(orgPackages.GET, {
            path: `/institutions/${orgA}/packages`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
          }),
      },
      createPackageFromSeed: {
        route: 'POST /institutions/{orgId}/packages',
        // One family key per seat: `(organization_id, family_key)` is unique, so an allowed row
        // must not be the CONFLICT that answers the next one.
        run: async (seat) =>
          call(orgPackages.POST, {
            method: 'POST',
            path: `/institutions/${orgA}/packages`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
            body: seedBody(seat),
          }),
      },
      importPackage: {
        route: 'POST /institutions/{orgId}/packages/import',
        run: async (seat) =>
          call(packagesImport.POST, {
            method: 'POST',
            path: `/institutions/${orgA}/packages/import`,
            session: await sessionFor(seat),
            params: { orgId: orgA },
            body: importDocument(seat),
          }),
      },
      getPackage: {
        route: 'GET /packages/{packageId}',
        run: async (seat) =>
          call(packageDetail.GET, {
            path: `/packages/${authoredPackageId}`,
            session: await sessionFor(seat),
            params: { packageId: authoredPackageId },
          }),
      },
      getPackageVersion: {
        route: 'GET /package-versions/{versionId}',
        run: async (seat) =>
          call(versionDetail.GET, {
            path: `/package-versions/${authoredVersionId}`,
            session: await sessionFor(seat),
            params: { versionId: authoredVersionId },
          }),
      },
      exportPackageVersion: {
        route: 'GET /package-versions/{versionId}/export',
        run: async (seat) =>
          call(versionExport.GET, {
            path: `/package-versions/${authoredVersionId}/export`,
            session: await sessionFor(seat),
            params: { versionId: authoredVersionId },
          }),
      },
      getClaimObject: {
        route: 'GET /package-versions/{versionId}/claims/{claimId}',
        run: async (seat) =>
          call(claimObject.GET, {
            path: `/package-versions/${authoredVersionId}/claims/${authoredClaimId}`,
            session: await sessionFor(seat),
            params: { versionId: authoredVersionId, claimId: authoredClaimId },
          }),
      },
      updateElement: {
        route: 'PATCH /package-versions/{versionId}/elements/{elementType}/{elementId}',
        run: async (seat) =>
          call(element.PATCH, {
            method: 'PATCH',
            path: `/package-versions/${authoredVersionId}/elements/brief/${SINGLETON_ELEMENT_ID}`,
            session: await sessionFor(seat),
            params: {
              versionId: authoredVersionId,
              elementType: 'brief',
              elementId: SINGLETON_ELEMENT_ID,
            },
            body: { brief: `Matrix brief by ${seat}.` },
          }),
      },
      decideElement: {
        route: 'POST /package-versions/{versionId}/elements/{elementType}/{elementId}/decision',
        run: async (seat) =>
          call(elementDecision.POST, {
            method: 'POST',
            path: `/package-versions/${authoredVersionId}/elements/brief/${SINGLETON_ELEMENT_ID}/decision`,
            session: await sessionFor(seat),
            params: {
              versionId: authoredVersionId,
              elementType: 'brief',
              elementId: SINGLETON_ELEMENT_ID,
            },
            body: { decision: 'confirmed', openedAt: '2026-09-02T10:00:00.000Z' },
          }),
      },
      confirmPackageVersion: {
        route: 'POST /package-versions/{versionId}/confirm',
        // The version cannot actually freeze — it breaks every package rule there is — so an
        // allowed seat is answered `ELEMENTS_UNCONFIRMED` or `PACKAGE_INVALID`, and the version
        // stays a draft for the rows below it.
        run: async (seat) =>
          call(versionConfirm.POST, {
            method: 'POST',
            path: `/package-versions/${authoredVersionId}/confirm`,
            session: await sessionFor(seat),
            params: { versionId: authoredVersionId },
            body: { teachingNoteChecked: true },
          }),
      },
      regeneratePackageVersion: {
        route: 'POST /package-versions/{versionId}/regenerate',
        run: async (seat) =>
          call(versionRegenerate.POST, {
            method: 'POST',
            path: `/package-versions/${authoredVersionId}/regenerate`,
            session: await sessionFor(seat),
            params: { versionId: authoredVersionId },
            body: { reason: `Matrix copy by ${seat}.` },
          }),
      },
    }
  })

  afterAll(async () => {
    if (observed.length > 0) {
      const lines = OPERATION_IDS.map((operationId) => {
        const seen = observed.filter((entry) => entry.operationId === operationId)
        const render = (expected: Expected): string =>
          seen
            .filter((entry) => entry.expected === expected)
            .map((entry) => `${entry.role} ${entry.status}${entry.code ? ` ${entry.code}` : ''}`)
            .join(', ') || '—'
        return `  ${operationId.padEnd(25)} allow: ${render('allow')}\n  ${' '.repeat(25)} deny:  ${render('deny')}`
      })
      // Written straight to stderr: the reporter keeps `console.*` from a passing file to itself,
      // and the point of the summary is that the status behind every allow and every denial stays
      // readable when nothing failed — a 403 that turns into a 404 changes this table, not the
      // verdict (the code-by-code assertions live in tests/integration/api/tenancy.test.ts).
      process.stderr.write(`\nauthorization matrix (08 §4), as answered:\n${lines.join('\n')}\n\n`)
    }
    await truncateAll()
  })

  describe('the table', () => {
    it('names a registered operation, a known seat, and a decision in every row', () => {
      const registered = new Set<string>(OPERATION_IDS)
      const unknownOperations = [
        ...new Set(
          ROWS.filter((row) => !registered.has(row.operationId)).map((r) => r.operationId),
        ),
      ]
      expect(
        unknownOperations,
        'every operationId in matrix.json must be a key of OPERATION_IDS',
      ).toEqual([])

      const malformed = ROWS.filter(
        (row) => !SEATS.includes(row.role) || (row.expected !== 'allow' && row.expected !== 'deny'),
      )
      expect(malformed, 'role must be one of SEATS and expected one of allow | deny').toEqual([])
    })

    it('decides all eight seats for every operation, exactly once each', () => {
      const missing: string[] = []
      const duplicated: string[] = []
      for (const operationId of OPERATION_IDS) {
        for (const seat of SEATS) {
          const matches = rowsFor(operationId).filter((row) => row.role === seat)
          if (matches.length === 0) missing.push(`${operationId} / ${seat}`)
          if (matches.length > 1) duplicated.push(`${operationId} / ${seat}`)
        }
      }
      expect(missing, 'matrix.json must decide every seat of every registered operation').toEqual(
        [],
      )
      expect(duplicated, 'matrix.json must decide each cell exactly once').toEqual([])
    })

    it('registers a runnable operation for every id', () => {
      expect(Object.keys(operations).sort()).toEqual([...OPERATION_IDS].sort())
    })
  })

  for (const operationId of OPERATION_IDS) {
    describe(operationId, () => {
      for (const row of rowsFor(operationId)) {
        it(`${row.role} → ${row.expected}`, async () => {
          const operation = operations[operationId]
          if (!operation) throw new Error(`no operation registered for ${operationId}`)

          const called = await operation.run(row.role)
          observed.push({ ...row, ...called })

          // A crash proves nothing either way, so it fails the row before the verdict is read.
          expect(
            called.status,
            `${operationId} (${operation.route}) as ${row.role} failed with ` +
              `${called.status}${called.code ? ` ${called.code}` : ''}`,
          ).toBeLessThan(500)

          const answered = DENY_STATUSES.has(called.status) ? 'deny' : 'allow'
          expect(
            answered,
            `${operationId} (${operation.route}) as ${row.role} answered ${called.status}` +
              `${called.code ? ` ${called.code}` : ''}; 08 §4 says ${row.expected}`,
          ).toBe(row.expected)
        })
      }
    })
  }
})
