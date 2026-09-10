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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
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

/**
 * A well-formed uuid that names nothing.
 *
 * `updateDelegation` is addressed by a delegation id, and the matrix is about who may reach the
 * endpoint rather than about what is behind it: a row that had to create a delegation first would
 * make the allowed seat's answer depend on a delegation the denied seats never made.
 */
const MISSING_UUID = '00000000-0000-4000-8000-000000000000'

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
  // Step 7.3 (07 §7): the assistant, the Delegation Log, the declaration, the claim list, and the
  // resume. Every one of them is addressed by run id and decided by the run's own guard, so each
  // row is answered before the run's state is ever read — no row here depends on another.
  'delegate',
  'listDelegations',
  'updateDelegation',
  'declareOutsideTool',
  'listRunClaims',
  // Step 8.1 (07 §7): the three acts a student performs on a surfaced claim. Each is addressed by a
  // run id and a claim id, and the run's owner guard answers every denied row before the claim id
  // is looked up at all — so the ids below name nothing on this run and no row depends on another.
  'setStance',
  'runAction',
  'escalate',
  // Step 8.2 (07 §7): the brief, the Decision Lock and the addendum — 08 §4's "every in-run
  // capability … brief, lock, addendum" on the student's own run and nowhere else. `ownRun` is in
  // `assigned`, so the allowed row meets the transition table (409) long after the guard has
  // answered, and every denied row is refused by the owner guard before the state is read at all.
  'saveBriefDraft',
  'briefSignal',
  'lockDecision',
  'addAddendum',
  'resumeRun',
  // The mirror image, and the row this file exists for: 08 §4's "Force assistant failure (test
  // control)" is "—" for the student and "✓* section, flag on" for the instructor.
  'forceAssistantFailure',
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
  // Step 12.2 (07 §6): the generation pipeline. 08 §4's row "Create package from seed; run
  // generation" decides all three — an instructor or a `scenario_author` of the institution, and
  // the platform editor only through their `scenario_author` membership, which is the seat the
  // `editor` fixture holds. The status read is the same row rather than the package view's,
  // because it reports which rules the draft still breaks, which is where the defects are.
  //
  // The two version-scoped rows are answered against a version with no seed record, so an allowed
  // seat meets `SEED_MISSING` (409) and no row starts a pipeline the next row would be refused
  // about; `regenerateElement` is answered against a readiness item nothing else on this fixture
  // reads, so an allowed seat's regeneration cannot change what another row is answered.
  'startGeneration',
  'getGenerationStatus',
  'regenerateElement',
  // Step 11.1 (07 §8): the faculty seat. 08 §4 gives the replay and the band decisions to an
  // instructor and a TA of the run's section; void, re-offer and neutralize to the instructor
  // alone; the export history to both reviewers and to no student; and the Judgment Record to the
  // run's own student and nobody else. Every row below is answered by its guard before the run's
  // state is read, so no row here depends on another — except `voidRun`, which really does void a
  // run and so is given one of its own per seat.
  //
  // `getRunExport` and `flagDelegation` are absent, and for one reason: both are addressed by a
  // second id — a version number, a delegation — and answer NOT_FOUND when it names nothing, which
  // this file counts as a denial. Their seat rules are proven against real ids in
  // `tests/integration/api/review.test.ts`.
  'getReviewQueue',
  'listSectionRunsForReview',
  'getReplay',
  'decideBand',
  'confirmRemainingBands',
  'bandHeldRunManually',
  'neutralizeClaim',
  'voidRun',
  'listRunExports',
  'listAssignmentExports',
  'getRecord',
  // The record-form file is the one act on this surface 08 §4 gives to the owner *and* to the
  // section's reviewers, which is why it is a row of its own beside `getRecord`'s owner-only one
  // (D-519). It had no cell at all until the Phase-11 audit (D-520).
  'exportRecord',
  // Step 11.2 (07 §7, §5): the debrief and the mapping change. 08 §4 gives the debrief to the run's
  // own student *and* to the reviewers of its section — the one student-facing read on this surface
  // that a reviewer shares (FR-154) — while the two questions are the student's alone; and the
  // mapping change, preview and apply, is the course instructor's.
  'getDebrief',
  'answerDebrief',
  'previewMappingChange',
  'changeMapping',
  // Step 13.5 (07 §9): the four platform screens of UI-050. 08 §4 decides all four on one row —
  // "Platform roles, user list, flags view, audit log", which is "—" in every column but Admin — so
  // the eight cells of each are the same eight: the platform admin, and nobody else.
  //
  // The `editor` seat is the one worth naming. A platform `tassl_scenario_editor` is the only other
  // seat with a *platform* role at all, and 08 §4 gives it packages and nothing here;
  // `requirePlatformRole(actor, 'admin')` admits `admin` alone (08 §5), so the editor is refused
  // like every institution seat, with the same 403. And the student is refused by that same guard —
  // 08 §4's "—" — rather than by the not-found the `/admin` layout draws for them: the API says
  // FORBIDDEN because the endpoint is not a tenant-scoped resource whose existence could leak
  // (08 §5 "Cross-tenant"), and the screen's 404 is a courtesy on top of it.
  'adminListUsers',
  'adminSetPlatformRole',
  'adminGetFlags',
  // The runtime assistant switch (D-691): the same eight cells as the four above — a platform
  // setting, and 08 §4 gives platform settings to the admin and to nobody else.
  'adminSetAiMode',
  'adminListAuditLog',
  // The Sentry test event (D-708): a platform operation, so the same eight cells as the rows above.
  'adminSentryTest',
  // The run's own lifecycle (Phases 6 to 9). These predate this registry and sat in
  // `NOT_IN_THE_MATRIX` as named debt until the Phase-15 audit gave them cells. Every one is
  // `requireRunOwner` first and the run's state second, so each is answered on `lifecycleRun` — the
  // `student` seat's own run, in `assigned`, on a package that carries one document — where the
  // owner meets the state rule (409) or a write that changes nothing, and every other seat is
  // refused by the owner guard before the state is read. No row moves the run, and no row depends
  // on another.
  'getReadiness',
  'answerReadinessItem',
  'submitReadiness',
  'skipReadiness',
  'getRunWorkspace',
  'openDocument',
  'closeDocument',
  'lockFrame',
  'getTurn',
  'respondToTurn',
  'getDefense',
  'answerDefenseQuestion',
  'completeDefense',
  // The trace is the one read of the run's record 08 §4 gives to the owner *and* the section's
  // reviewers, like `listDelegations` and `getDebrief` above it (`trace.requireOwnerOrReviewer`).
  'listRunTrace',
  // The two test-only routes (D-109, D-707). Under this suite's `APP_ENV=test` both are live, and
  // the cells are what they are then: the clock shift is the run's owner's, the rate-limit reset
  // any session's. Outside a test process both answer 404 before a session is read, which no seat
  // here can be shown.
  'advanceRunClock',
  'resetTestRateLimits',
  // The actor's own notifications (SYS-010): every signed-in seat over their own rows and nobody
  // else's, which `tests/integration/api/notifications.test.ts` proves with a classmate's id.
  'listNotifications',
  'unreadNotificationCount',
  'markNotificationRead',
  'markAllNotificationsRead',
  // The two rows addressed by a second id — a version number, a delegation — which answer
  // NOT_FOUND when it names nothing and so could not be given cells against `MISSING_UUID`. They are
  // answered against real ones on `reviewedRun`: a filed course export, and a delegation.
  'getRunExport',
  'flagDelegation',
] as const

// ---------------------------------------------------------------------------------------------
// The gap, named (D-520) and closed
// ---------------------------------------------------------------------------------------------
//
// `OPERATION_IDS` above is hand-written, and until D-520 nothing compared it with the endpoints
// that actually exist: an operation added to a router and never added here was uncovered,
// silently, and twenty-one of them were. So this map names every registered operation that has
// **no row**, with the reason, and `registeredOperationIds()` reads the routers themselves — which
// makes the two lists together a closed statement about the whole API. A *new* endpoint cannot join
// the gap without a line here saying so.
//
// The twenty-one it named at D-520 — nineteen lifecycle and notification rows that predated this
// registry, and the two second-id rows — all have cells now (the Phase-15 authorization audit), so
// the map is empty and the test below pins it there: a new endpoint gets eight cells, and a line
// here is no longer a way to ship one without them.
const NOT_IN_THE_MATRIX: Readonly<Record<string, string>> = {}

/**
 * `delegate` is registered by hand rather than by `defineRoute`: it answers `text/event-stream`, so
 * `assistant/router.ts` exports a `RouteHandler` with no spec object and its openapi entry is
 * maintained by hand (D-273). It is the one id `REGISTERED_OPERATION_IDS` cannot read out of a
 * router, so it is named here rather than left to make the guard below permanently red.
 */
const HAND_WRITTEN_OPERATION_IDS = ['delegate'] as const

/**
 * Every `operationId` the module routers declare, read out of their source.
 *
 * The text rather than the modules: importing every route file to enumerate them would drag pg-boss
 * and the whole job runtime into this suite for a list of strings, and the literal is what a person
 * adding an endpoint types. `openapi:check` already proves these literals are the shipped API.
 */
function registeredOperationIds(): string[] {
  const root = 'src/server/modules'
  const ids = new Set<string>(HAND_WRITTEN_OPERATION_IDS)
  for (const moduleName of readdirSync(root)) {
    const file = join(root, moduleName, 'router.ts')
    if (!existsSync(file)) continue
    for (const match of readFileSync(file, 'utf8').matchAll(/operationId:\s*'([A-Za-z0-9_]+)'/g)) {
      if (match[1]) ids.add(match[1])
    }
  }
  return [...ids].sort()
}

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
/** One run per seat for `voidRun`, which is the one row here that really changes what it touches. */
let voidableRuns: Record<Seat, string>

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
/** The element `regenerateElement`'s row is answered about; nothing else on this fixture reads it. */
let authoredReadinessItemId: string

/**
 * The lifecycle rows' run: the `student` seat's own, in `assigned`, on a third assignment.
 *
 * A third one because `runs_assignment_id_student_id_live_uidx` allows one live run per student
 * per assignment, and `ownRun` and the run `startRun`'s allowed row creates hold the other two. Its
 * package carries the one element the rows look up before they read the run's state: a document,
 * because `openDocument` answers NOT_FOUND for one that is not in the room — which this file would
 * read as a denial of the owner. `lifecycleOpenId` is an open of that document, already closed, so
 * `closeDocument`'s allowed row returns without writing and the fixture is left as it was found.
 */
let lifecycleRun: string
let lifecycleDocumentId: string
let lifecycleOpenId: string

/**
 * The run the two second-id rows are answered about: a runner's own, in `working`, carrying one
 * delegation for `flagDelegation` and one filed course export for `getRunExport`. The `student`
 * seat holds a section row and is not its owner — a classmate — which is the reader 08 §4 gives no
 * read of it at all.
 */
let reviewedRun: string
let reviewedDelegationId: string

/** One unread notification per seat, so `markNotificationRead`'s row names the actor's own. */
let notifications: Record<Seat, string>

/**
 * The account `adminSetPlatformRole` is answered about (07 §9).
 *
 * An account of its own rather than one of the seats: the endpoint refuses the actor's own row with
 * `ROLE_INVALID` (D-571) — a 400, which this file would read as an *allow* — and every seat is
 * something a later row depends on. This account holds no institution seat and no session, and the
 * one row 08 §4 allows writes the role it already has, so the allowed cell proves the endpoint was
 * reached without changing a fact any other row is answered from.
 */
let roleTarget: UserRow

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

    // The address `adminSetPlatformRole` names: no institution seat, no session, nothing else here
    // reads it.
    roleTarget = await f.createUser('matrix-role-target')

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

    // `voidRun` is the one operation here whose allowed row changes the world: it voids the run it
    // is given. So each seat gets its own, on its own student, exactly as `deleteWalkthroughRun`
    // does — a row that is allowed cannot then change what a later row is answered.
    const voidableBuilt: Partial<Record<Seat, string>> = {}
    for (const seat of SEATS) {
      const runner = await f.createUser(`matrix-voidable-${slugOf(seat)}`)
      await f.addMember(orgA, runner.id, 'student')
      await f.addSectionMember(orgA, section, runner.id, 'student')
      voidableBuilt[seat] = (
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
    voidableRuns = voidableBuilt as Record<Seat, string>

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
    authoredReadinessItemId = (
      await scenariosRepository.upsertElement(orgA, authoredVersionId, 'readiness_item', {
        key: 'R1',
        category: 'foundation',
        conceptKey: 'payback_period',
        stem: 'A supplier quote is dated before the contract it is used to price. What follows?',
        options: [
          { key: 'a', text: 'The quote settles the price.' },
          { key: 'b', text: 'The quote may have been superseded and needs checking.' },
          { key: 'c', text: 'The contract is invalid.' },
          { key: 'd', text: 'Nothing follows from a date.' },
        ],
        answerKey: 'b',
        position: 0,
      })
    ).id

    // The lifecycle package, built the way `minimalConfirmedVersion` builds one — the element first,
    // then the status change, because the `package_frozen` triggers (drizzle/0004) refuse every
    // element write once `confirmed_at` is set — and confirmed because `createAssignment` requires
    // it.
    const lifecycle = await f.createPackageVersion(orgA, 'matrix-lifecycle', {
      createdBy: seats.instructor.id,
    })
    lifecycleDocumentId = (
      await scenariosRepository.upsertElement(orgA, lifecycle.version.id, 'document', {
        key: 'D1',
        title: 'Cohort retention table',
        author: 'Finance',
        datedOn: '2026-01-15',
        body: 'Premium retention for the pilot cohort held at 78 percent through month six.',
        wordCount: 13,
        role: 'supporting',
        supersededByDocumentId: null,
        stakeholderId: null,
        position: 0,
      })
    ).id
    await scenariosRepository.updateVersionStatus(orgA, lifecycle.version.id, {
      status: 'confirmed',
      confirmedAt: f.FROZEN_TIME,
      confirmedBy: seats.instructor.id,
      teachingNoteChecked: true,
    })
    const lifecycleAssignment = (
      await f.createAssignment(orgA, section, 'matrix-lifecycle', {
        packageVersionId: lifecycle.version.id,
        variantId: lifecycle.sound.id,
        isWalkthrough: true,
      })
    ).id
    lifecycleRun = (
      await runsRepository.insertRun(orgA, {
        assignmentId: lifecycleAssignment,
        studentId: seats.student.id,
        packageVersionId: lifecycle.version.id,
        variantId: lifecycle.sound.id,
        state: 'assigned',
        workingClockSeconds: 1500,
        turnDelaySeconds: 90,
      })
    ).id
    const openedAt = new Date()
    lifecycleOpenId = (
      await runsRepository.insertDocumentOpen(lifecycleRun, {
        documentId: lifecycleDocumentId,
        openedAt,
        closedAt: openedAt,
        durationMs: 0,
        beforeFirstDelegation: true,
        inTurnWindow: false,
      })
    ).id

    // `reviewedRun`: the delegation is written the way a completed stream writes one, and the export
    // the way a band confirmation files one (`records.writeCourseExport`), so what the allowed seats
    // are handed is a document `CourseTraceExportSchema` accepts rather than a stand-in.
    const reviewedRunner = await f.createUser('matrix-reviewed-runner')
    await f.addMember(orgA, reviewedRunner.id, 'student')
    await f.addSectionMember(orgA, section, reviewedRunner.id, 'student')
    reviewedRun = (
      await runsRepository.insertRun(orgA, {
        assignmentId: walkthroughAssignment,
        studentId: reviewedRunner.id,
        packageVersionId,
        variantId: soundVariantId,
        state: 'working',
        workingClockSeconds: 1500,
        turnDelaySeconds: 90,
      })
    ).id
    const assistantRepository = await import('@/server/modules/assistant/repository')
    reviewedDelegationId = (
      await assistantRepository.insertDelegation(reviewedRun, {
        requestText: 'What is the premium payback?',
      })
    ).id
    const { withTransaction } = await import('@/server/db/tx')
    const records = await import('@/server/modules/records')
    await withTransaction((tx) =>
      records.writeCourseExport(
        tx,
        { id: reviewedRun, organizationId: orgA, assignmentId: walkthroughAssignment },
        'initial',
      ),
    )

    // One notification per seat, written straight to the table the way
    // `tests/integration/api/notifications.test.ts` writes them: the writers are the jobs'.
    const notificationsBuilt: Partial<Record<Seat, string>> = {}
    for (const seat of SEATS) {
      const [row] = await testSql<{ id: string }[]>`
        insert into notifications (user_id, organization_id, type, title, body, link, payload)
        values (${seats[seat].id}, ${activeOrgOf(seat)}, 'run_scored', 'Matrix notification',
                'One row of the actor’s own, for the read mark.', '/notifications', '{}'::jsonb)
        returning id`
      notificationsBuilt[seat] = row!.id
    }
    notifications = notificationsBuilt as Record<Seat, string>

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
    const delegationsRoute = await import('@/app/api/v1/runs/[runId]/delegations/route')
    const delegationRoute =
      await import('@/app/api/v1/runs/[runId]/delegations/[delegationId]/route')
    const declarationRoute =
      await import('@/app/api/v1/runs/[runId]/outside-tool-declaration/route')
    const runClaimsRoute = await import('@/app/api/v1/runs/[runId]/claims/route')
    const stanceRoute = await import('@/app/api/v1/runs/[runId]/claims/[claimId]/stance/route')
    const claimActionsRoute =
      await import('@/app/api/v1/runs/[runId]/claims/[claimId]/actions/route')
    const escalationRoute =
      await import('@/app/api/v1/runs/[runId]/claims/[claimId]/escalation/route')
    const briefRoute = await import('@/app/api/v1/runs/[runId]/brief/route')
    const briefSignalsRoute = await import('@/app/api/v1/runs/[runId]/brief/signals/route')
    const lockRoute = await import('@/app/api/v1/runs/[runId]/lock/route')
    const addendumRoute = await import('@/app/api/v1/runs/[runId]/addendum/route')
    const forceFailureRoute =
      await import('@/app/api/v1/review/runs/[runId]/test-controls/force-assistant-failure/route')
    const resumeRoute = await import('@/app/api/v1/runs/[runId]/resume/route')
    const reviewQueueRoute = await import('@/app/api/v1/review/queue/route')
    const sectionRunsRoute = await import('@/app/api/v1/review/sections/[sectionId]/runs/route')
    const replayRoute = await import('@/app/api/v1/review/runs/[runId]/route')
    const bandRoute = await import('@/app/api/v1/review/runs/[runId]/bands/[dimension]/route')
    const confirmRemainingRoute =
      await import('@/app/api/v1/review/runs/[runId]/confirm-remaining/route')
    const manualBandsRoute = await import('@/app/api/v1/review/runs/[runId]/manual-bands/route')
    const neutralizeRoute =
      await import('@/app/api/v1/review/runs/[runId]/claims/[claimId]/neutralize/route')
    const voidRoute = await import('@/app/api/v1/review/runs/[runId]/void/route')
    const runExportsRoute = await import('@/app/api/v1/runs/[runId]/exports/route')
    const assignmentExportsRoute =
      await import('@/app/api/v1/assignments/[assignmentId]/exports/route')
    const recordRoute = await import('@/app/api/v1/runs/[runId]/record/route')
    const recordExportRoute = await import('@/app/api/v1/runs/[runId]/record/export/route')
    const debriefRoute = await import('@/app/api/v1/runs/[runId]/debrief/route')
    const debriefAnswersRoute = await import('@/app/api/v1/runs/[runId]/debrief/answers/route')
    const mappingPreviewRoute =
      await import('@/app/api/v1/courses/[courseId]/mapping/preview/route')
    const mappingRoute = await import('@/app/api/v1/courses/[courseId]/mapping/route')
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
    const generation = await import('@/app/api/v1/package-versions/[versionId]/generation/route')
    const elementRegenerate =
      await import('@/app/api/v1/package-versions/[versionId]/elements/[elementType]/[elementId]/regenerate/route')
    const adminUsersRoute = await import('@/app/api/v1/admin/users/route')
    const adminPlatformRoleRoute =
      await import('@/app/api/v1/admin/users/[userId]/platform-role/route')
    const adminFlagsRoute = await import('@/app/api/v1/admin/flags/route')
    const adminAiModeRoute = await import('@/app/api/v1/admin/settings/ai-mode/route')
    const adminAuditLogRoute = await import('@/app/api/v1/admin/audit-log/route')
    const adminSentryTestRoute = await import('@/app/api/v1/admin/sentry-test/route')
    const readinessRoute = await import('@/app/api/v1/runs/[runId]/readiness/route')
    const readinessAnswerRoute =
      await import('@/app/api/v1/runs/[runId]/readiness/answers/[itemId]/route')
    const readinessSubmitRoute = await import('@/app/api/v1/runs/[runId]/readiness/submit/route')
    const readinessSkipRoute = await import('@/app/api/v1/runs/[runId]/readiness/skip/route')
    const workspaceRoute = await import('@/app/api/v1/runs/[runId]/workspace/route')
    const documentOpenRoute =
      await import('@/app/api/v1/runs/[runId]/documents/[documentId]/open/route')
    const documentCloseRoute =
      await import('@/app/api/v1/runs/[runId]/document-opens/[openId]/close/route')
    const frameRoute = await import('@/app/api/v1/runs/[runId]/frame/route')
    const turnRoute = await import('@/app/api/v1/runs/[runId]/turn/route')
    const turnResponseRoute = await import('@/app/api/v1/runs/[runId]/turn/response/route')
    const defenseRoute = await import('@/app/api/v1/runs/[runId]/defense/route')
    const defenseAnswerRoute =
      await import('@/app/api/v1/runs/[runId]/defense/questions/[runQuestionId]/answer/route')
    const defenseCompleteRoute = await import('@/app/api/v1/runs/[runId]/defense/complete/route')
    const traceRoute = await import('@/app/api/v1/runs/[runId]/trace/route')
    const advanceClockRoute = await import('@/app/api/v1/test/runs/[runId]/advance-clock/route')
    const resetRateLimitsRoute = await import('@/app/api/v1/test/rate-limits/reset/route')
    const notificationsRoute = await import('@/app/api/v1/notifications/route')
    const unreadCountRoute = await import('@/app/api/v1/notifications/unread-count/route')
    const notificationReadRoute = await import('@/app/api/v1/notifications/[id]/read/route')
    const notificationsReadAllRoute = await import('@/app/api/v1/notifications/read-all/route')
    const runExportVersionRoute = await import('@/app/api/v1/runs/[runId]/exports/[version]/route')
    const flagDelegationRoute =
      await import('@/app/api/v1/review/runs/[runId]/delegations/[delegationId]/flag/route')

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
      delegate: {
        route: 'POST /runs/{runId}/delegations',
        // `ownRun` sits in `assigned`, so the allowed row meets `ASSISTANT_LOCKED` (409) rather than
        // an answer — which is an allow: 08 §4 gives the run's own student every in-run capability,
        // and the state is the assistant's rule, not a permission. Every denied row is refused by
        // the owner guard before the state is read.
        run: async (seat) =>
          call(delegationsRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/delegations`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
            body: { request: 'What is the premium payback?' },
          }),
      },
      listDelegations: {
        route: 'GET /runs/{runId}/delegations',
        // Stu, Rev (07 §7): the run's own student and the instructor and TA of its section.
        run: async (seat) =>
          call(delegationsRoute.GET, {
            path: `/runs/${ownRun}/delegations`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      updateDelegation: {
        route: 'PATCH /runs/{runId}/delegations/{delegationId}',
        // The id names no delegation on this run; the allowed row is refused for the state it is in
        // long before that is looked up, and every other row by the owner guard before either.
        run: async (seat) =>
          call(delegationRoute.PATCH, {
            method: 'PATCH',
            path: `/runs/${ownRun}/delegations/${MISSING_UUID}`,
            session: await sessionFor(seat),
            params: { runId: ownRun, delegationId: MISSING_UUID },
            body: { why: 'A note about a delegation.' },
          }),
      },
      declareOutsideTool: {
        route: 'POST /runs/{runId}/outside-tool-declaration',
        run: async (seat) =>
          call(declarationRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/outside-tool-declaration`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
            body: { purpose: 'Used a spreadsheet to recompute payback.' },
          }),
      },
      listRunClaims: {
        route: 'GET /runs/{runId}/claims',
        // The owner alone: a reviewer replays a scored run (FR-180), never a running one.
        run: async (seat) =>
          call(runClaimsRoute.GET, {
            path: `/runs/${ownRun}/claims`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      setStance: {
        route: 'PUT /runs/{runId}/claims/{claimId}/stance',
        // The claim id names no claim on this run, so the allowed row meets `CLAIM_NOT_SURFACED`
        // (409) — which is an allow: 08 §4 gives the run's own student every in-run capability, and
        // what the claim is is the module's rule, not a permission. Every denied row is refused by
        // the owner guard before either is read.
        run: async (seat) =>
          call(stanceRoute.PUT, {
            method: 'PUT',
            path: `/runs/${ownRun}/claims/${MISSING_UUID}/stance`,
            session: await sessionFor(seat),
            params: { runId: ownRun, claimId: MISSING_UUID },
            body: { stance: 'accept' },
          }),
      },
      runAction: {
        route: 'POST /runs/{runId}/claims/{claimId}/actions',
        run: async (seat) =>
          call(claimActionsRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/claims/${MISSING_UUID}/actions`,
            session: await sessionFor(seat),
            params: { runId: ownRun, claimId: MISSING_UUID },
            body: { type: 'source_trace' },
          }),
      },
      escalate: {
        route: 'POST /runs/{runId}/claims/{claimId}/escalation',
        run: async (seat) =>
          call(escalationRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/claims/${MISSING_UUID}/escalation`,
            session: await sessionFor(seat),
            params: { runId: ownRun, claimId: MISSING_UUID },
            body: { statement: 'I cannot evaluate this claim from here.' },
          }),
      },
      saveBriefDraft: {
        route: 'PUT /runs/{runId}/brief',
        run: async (seat) =>
          call(briefRoute.PUT, {
            method: 'PUT',
            path: `/runs/${ownRun}/brief`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
            body: { recommendation: 'Hold the spend in the value tier.' },
          }),
      },
      briefSignal: {
        route: 'POST /runs/{runId}/brief/signals',
        run: async (seat) =>
          call(briefSignalsRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/brief/signals`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
            body: { opened: true },
          }),
      },
      lockDecision: {
        route: 'POST /runs/{runId}/lock',
        // The brief is well-formed, so the allowed row gets past the wire schema and meets the
        // transition table on a run in `assigned` — an allow, and one that leaves `ownRun` exactly
        // where every other row expects to find it.
        run: async (seat) =>
          call(lockRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/lock`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
            body: {
              recommendation: 'Hold the spend in the value tier.',
              rationale: 'The payback figure has not been traced to the cohort table.',
              assumptions: ['Retention holds', 'Payback stays near four months', 'Cost is stable'],
              changeMyMind: 'A cohort table showing a shorter payback.',
              confidence: 45,
              namedValues: {},
            },
          }),
      },
      addAddendum: {
        route: 'POST /runs/{runId}/addendum',
        run: async (seat) =>
          call(addendumRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/addendum`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
            body: { text: 'A note added after the decision was filed.' },
          }),
      },
      forceAssistantFailure: {
        route: 'POST /review/runs/{runId}/test-controls/force-assistant-failure',
        // The one row here whose allowed seat is the instructor and whose denied seats include the
        // run's own student (08 §4). It arms a flag on `ownRun`; the assistant rows above have
        // already run, and a run in `assigned` answers `ASSISTANT_LOCKED` before the flag is ever
        // consumed, so nothing downstream depends on it.
        run: async (seat) =>
          call(forceFailureRoute.POST, {
            method: 'POST',
            path: `/review/runs/${ownRun}/test-controls/force-assistant-failure`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      resumeRun: {
        route: 'POST /runs/{runId}/resume',
        // The run is not paused, so the allowed row meets `ILLEGAL_TRANSITION` (409) — an allow,
        // and one that leaves the run exactly where every other row expects to find it.
        run: async (seat) =>
          call(resumeRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/resume`,
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
      startGeneration: {
        route: 'POST /package-versions/{versionId}/generation',
        // `authoredVersionId` has no seed record, so the allowed seats are answered `SEED_MISSING`
        // (409, which is not a denial) and nothing is enqueued. The row is about the seat.
        run: async (seat) =>
          call(generation.POST, {
            method: 'POST',
            path: `/package-versions/${authoredVersionId}/generation`,
            session: await sessionFor(seat),
            params: { versionId: authoredVersionId },
          }),
      },
      getGenerationStatus: {
        route: 'GET /package-versions/{versionId}/generation',
        run: async (seat) =>
          call(generation.GET, {
            path: `/package-versions/${authoredVersionId}/generation`,
            session: await sessionFor(seat),
            params: { versionId: authoredVersionId },
          }),
      },
      regenerateElement: {
        route: 'POST /package-versions/{versionId}/elements/{elementType}/{elementId}/regenerate',
        // A readiness item, and one no other row on this fixture reads: an allowed seat really does
        // queue the step that writes them, and the row must not change what another row is told.
        run: async (seat) =>
          call(elementRegenerate.POST, {
            method: 'POST',
            path: `/package-versions/${authoredVersionId}/elements/readiness_item/${authoredReadinessItemId}/regenerate`,
            session: await sessionFor(seat),
            params: {
              versionId: authoredVersionId,
              elementType: 'readiness_item',
              elementId: authoredReadinessItemId,
            },
            body: {},
          }),
      },
      getReviewQueue: {
        route: 'GET /review/queue',
        // No id at all: the queue is whatever sections this actor reviews, and an actor who reviews
        // none is refused rather than handed an empty one — the rows are about reading other
        // people's runs (D-096).
        run: async (seat) =>
          call(reviewQueueRoute.GET, { path: '/review/queue', session: await sessionFor(seat) }),
      },
      listSectionRunsForReview: {
        route: 'GET /review/sections/{sectionId}/runs',
        run: async (seat) =>
          call(sectionRunsRoute.GET, {
            path: `/review/sections/${section}/runs`,
            session: await sessionFor(seat),
            params: { sectionId: section },
          }),
      },
      getReplay: {
        route: 'GET /review/runs/{runId}',
        // The row this file exists for on the faculty side: the replay carries warranted stances,
        // evidence status, failure families, the probe and the expected-answer notes, and the run's
        // own student is refused it as flatly as an outsider (12 §8.1).
        run: async (seat) =>
          call(replayRoute.GET, {
            path: `/review/runs/${ownRun}`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      decideBand: {
        route: 'PUT /review/runs/{runId}/bands/{dimension}',
        // `ownRun` sits in `assigned`, so the allowed seats meet `RUN_NOT_SCORED` (409) — which is
        // an allow: the state is the review module's rule, not a permission.
        run: async (seat) =>
          call(bandRoute.PUT, {
            method: 'PUT',
            path: `/review/runs/${ownRun}/bands/framing`,
            session: await sessionFor(seat),
            params: { runId: ownRun, dimension: 'framing' },
            body: { decision: 'confirmed' },
          }),
      },
      confirmRemainingBands: {
        route: 'POST /review/runs/{runId}/confirm-remaining',
        run: async (seat) =>
          call(confirmRemainingRoute.POST, {
            method: 'POST',
            path: `/review/runs/${ownRun}/confirm-remaining`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      bandHeldRunManually: {
        route: 'POST /review/runs/{runId}/manual-bands',
        // Nothing is holding `ownRun`, so the allowed seats meet `RUN_NOT_SCORABLE` (409).
        run: async (seat) =>
          call(manualBandsRoute.POST, {
            method: 'POST',
            path: `/review/runs/${ownRun}/manual-bands`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
            body: {
              bands: {
                framing: 'proficient',
                delegation: 'proficient',
                verification: 'proficient',
                calibration: 'proficient',
                decision_quality: 'proficient',
                adaptation: 'proficient',
                ownership: 'unassessed',
              },
            },
          }),
      },
      neutralizeClaim: {
        route: 'POST /review/runs/{runId}/claims/{claimId}/neutralize',
        // 08 §4: "Void, re-offer, neutralize (from replay)" is the instructor's row and the TA's is
        // "—". The claim id names nothing, and it does not have to: the run's state is asked for
        // first, so the instructor meets `RUN_NOT_SCORED` (409) rather than a missing claim.
        run: async (seat) =>
          call(neutralizeRoute.POST, {
            method: 'POST',
            path: `/review/runs/${ownRun}/claims/${MISSING_UUID}/neutralize`,
            session: await sessionFor(seat),
            params: { runId: ownRun, claimId: MISSING_UUID },
            body: { reason: 'other', creditChallenge: false, note: '' },
          }),
      },
      voidRun: {
        route: 'POST /review/runs/{runId}/void',
        // The allowed row really voids its run, which is why each seat gets its own.
        run: async (seat) =>
          call(voidRoute.POST, {
            method: 'POST',
            path: `/review/runs/${voidableRuns[seat]}/void`,
            session: await sessionFor(seat),
            params: { runId: voidableRuns[seat] },
            body: { reason: 'other', reoffer: false },
          }),
      },
      listRunExports: {
        route: 'GET /runs/{runId}/exports',
        // No export exists on `ownRun`, so the allowed seats meet `RUN_NOT_CONFIRMED` (409).
        run: async (seat) =>
          call(runExportsRoute.GET, {
            path: `/runs/${ownRun}/exports`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      listAssignmentExports: {
        route: 'GET /assignments/{assignmentId}/exports',
        run: async (seat) =>
          call(assignmentExportsRoute.GET, {
            path: `/assignments/${assignment}/exports`,
            session: await sessionFor(seat),
            params: { assignmentId: assignment },
          }),
      },
      exportRecord: {
        route: 'GET /runs/{runId}/record/export',
        // The record-form file: the run's own student, or a reviewer of its section (08 §4,
        // `records.requireRecordReader`). `ownRun` is not confirmed, so every admitted seat meets
        // `RECORD_NOT_AVAILABLE` (409) and every refused one meets the guard first — which is what
        // this table asks. It is the mirror of `getRecord` a row below, and the pair is the whole
        // reason 08 §4's old single row had to be split.
        run: async (seat) =>
          call(recordExportRoute.GET, {
            path: `/runs/${ownRun}/record/export`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      getRecord: {
        route: 'GET /runs/{runId}/record',
        // The mirror image of the replay: 08 §4 gives the Judgment Record to the run's own student,
        // and the reviewers who may read everything else about the run are refused this one — they
        // read it through the replay and the course export. `ownRun` is not confirmed, so the owner
        // meets `RECORD_NOT_AVAILABLE` (409).
        run: async (seat) =>
          call(recordRoute.GET, {
            path: `/runs/${ownRun}/record`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      getDebrief: {
        route: 'GET /runs/{runId}/debrief',
        // The one read on this surface two seats share (FR-154): the run's own student and the
        // reviewers of its section read one document. `ownRun` is in `assigned`, so every allowed
        // seat meets `DEBRIEF_NOT_AVAILABLE` (409) long after the guard has answered.
        run: async (seat) =>
          call(debriefRoute.GET, {
            path: `/runs/${ownRun}/debrief`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      answerDebrief: {
        route: 'POST /runs/{runId}/debrief/answers',
        // The mirror image of the row above: the two questions ask what *this student* would change,
        // so a reviewer who may read the whole page has no form on it.
        run: async (seat) =>
          call(debriefAnswersRoute.POST, {
            method: 'POST',
            path: `/runs/${ownRun}/debrief/answers`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
            body: { stanceToChange: 'C3, to verify.', doDifferently: 'Read the room first.' },
          }),
      },
      previewMappingChange: {
        route: 'POST /courses/{courseId}/mapping/preview',
        run: async (seat) =>
          call(mappingPreviewRoute.POST, {
            method: 'POST',
            path: `/courses/${course}/mapping/preview`,
            session: await sessionFor(seat),
            params: { courseId: course },
            body: { mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 } },
          }),
      },
      changeMapping: {
        route: 'POST /courses/{courseId}/mapping',
        // `confirm: false`, so the allowed seat meets `MAPPING_CHANGE_UNCONFIRMED` (409) and this
        // row changes nothing for the rows after it — the guard runs first either way.
        run: async (seat) =>
          call(mappingRoute.POST, {
            method: 'POST',
            path: `/courses/${course}/mapping`,
            session: await sessionFor(seat),
            params: { courseId: course },
            body: {
              mapping: { novice: 1, developing: 2, proficient: 3, professional: 4 },
              confirm: false,
            },
          }),
      },
      // 07 §9, the platform screens of UI-050. Each is `requirePlatformRole(actor, 'admin')` as the
      // first statement of its service function, so every denied row is answered before the input
      // is used for anything and no row here depends on another.
      adminListUsers: {
        route: 'GET /admin/users',
        run: async (seat) =>
          call(adminUsersRoute.GET, { path: '/admin/users', session: await sessionFor(seat) }),
      },
      adminSetPlatformRole: {
        route: 'PUT /admin/users/{userId}/platform-role',
        // `none` is the role `roleTarget` already holds: the allowed seat proves it reached the
        // endpoint, and the row leaves the fixture exactly as it found it.
        run: async (seat) =>
          call(adminPlatformRoleRoute.PUT, {
            method: 'PUT',
            path: `/admin/users/${roleTarget.id}/platform-role`,
            session: await sessionFor(seat),
            params: { userId: roleTarget.id },
            body: { role: 'none' },
          }),
      },
      adminGetFlags: {
        route: 'GET /admin/flags',
        run: async (seat) =>
          call(adminFlagsRoute.GET, { path: '/admin/flags', session: await sessionFor(seat) }),
      },
      adminSetAiMode: {
        route: 'PUT /admin/settings/ai-mode',
        // `live` is what no row means, so the allowed seat leaves the fixture exactly as it found
        // it. Under this suite's `FEATURE_AI=false` the service answers `CONFLICT` — a 409, which
        // this file reads as the endpoint having been reached, which is all a cell asks (D-691).
        run: async (seat) =>
          call(adminAiModeRoute.PUT, {
            method: 'PUT',
            path: '/admin/settings/ai-mode',
            session: await sessionFor(seat),
            body: { mode: 'live' },
          }),
      },
      adminListAuditLog: {
        route: 'GET /admin/audit-log',
        run: async (seat) =>
          call(adminAuditLogRoute.GET, {
            path: '/admin/audit-log',
            session: await sessionFor(seat),
          }),
      },
      adminSentryTest: {
        route: 'POST /admin/sentry-test',
        // `requirePlatformRole(actor, 'admin')` first; under this suite no DSN is set, so the
        // admin's event goes nowhere and the row proves the seat and nothing else.
        run: async (seat) =>
          call(adminSentryTestRoute.POST, {
            method: 'POST',
            path: '/admin/sentry-test',
            session: await sessionFor(seat),
          }),
      },
      // The run's own lifecycle, on `lifecycleRun` in `assigned` (07 §7, 08 §4 "every in-run
      // capability"). The owner is the one seat admitted, and what admits them is answered before
      // the state is: a 409 from the transition table is an allow, exactly as it is for
      // `lockDecision` and `resumeRun` above.
      getReadiness: {
        route: 'GET /runs/{runId}/readiness',
        // The check is not open on a run in `assigned` (`ILLEGAL_TRANSITION`).
        run: async (seat) =>
          call(readinessRoute.GET, {
            path: `/runs/${lifecycleRun}/readiness`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
          }),
      },
      answerReadinessItem: {
        route: 'PUT /runs/{runId}/readiness/answers/{itemId}',
        // The state is asked for before the item is looked up, so the id can name nothing, as
        // `updateDelegation`'s does: the owner meets `CLOCK_EXPIRED` (409), never a missing item.
        run: async (seat) =>
          call(readinessAnswerRoute.PUT, {
            method: 'PUT',
            path: `/runs/${lifecycleRun}/readiness/answers/${MISSING_UUID}`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun, itemId: MISSING_UUID },
            body: { answerKey: 'b' },
          }),
      },
      submitReadiness: {
        route: 'POST /runs/{runId}/readiness/submit',
        run: async (seat) =>
          call(readinessSubmitRoute.POST, {
            method: 'POST',
            path: `/runs/${lifecycleRun}/readiness/submit`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
          }),
      },
      skipReadiness: {
        route: 'POST /runs/{runId}/readiness/skip',
        run: async (seat) =>
          call(readinessSkipRoute.POST, {
            method: 'POST',
            path: `/runs/${lifecycleRun}/readiness/skip`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
          }),
      },
      getRunWorkspace: {
        route: 'GET /runs/{runId}/workspace',
        run: async (seat) =>
          call(workspaceRoute.GET, {
            path: `/runs/${lifecycleRun}/workspace`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
          }),
      },
      openDocument: {
        route: 'POST /runs/{runId}/documents/{documentId}/open',
        // A real document, because the room looks it up before it asks the run's state and a
        // missing one is NOT_FOUND; the state then refuses the owner (`ILLEGAL_TRANSITION`) and no
        // open is written.
        run: async (seat) =>
          call(documentOpenRoute.POST, {
            method: 'POST',
            path: `/runs/${lifecycleRun}/documents/${lifecycleDocumentId}/open`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun, documentId: lifecycleDocumentId },
          }),
      },
      closeDocument: {
        route: 'POST /runs/{runId}/document-opens/{openId}/close',
        // The open is already closed, so the owner's call answers 204 and writes nothing.
        run: async (seat) =>
          call(documentCloseRoute.POST, {
            method: 'POST',
            path: `/runs/${lifecycleRun}/document-opens/${lifecycleOpenId}/close`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun, openId: lifecycleOpenId },
          }),
      },
      lockFrame: {
        route: 'POST /runs/{runId}/frame',
        // A frame FR-040 accepts, so the owner gets past the rule and meets the transition table.
        run: async (seat) =>
          call(frameRoute.POST, {
            method: 'POST',
            path: `/runs/${lifecycleRun}/frame`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
            body: {
              decision: 'Whether to move acquisition spend to the premium tier this quarter',
              assumptions: ['Retention holds', 'Payback stays near four months', 'Cost is stable'],
              position: 'Hold the spend in the value tier until the payback is rechecked',
              confidence: 40,
            },
          }),
      },
      getTurn: {
        route: 'GET /runs/{runId}/turn',
        // Nothing has been delivered: the owner meets `TURN_NOT_OPEN` (409).
        run: async (seat) =>
          call(turnRoute.GET, {
            path: `/runs/${lifecycleRun}/turn`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
          }),
      },
      respondToTurn: {
        route: 'POST /runs/{runId}/turn/response',
        run: async (seat) =>
          call(turnResponseRoute.POST, {
            method: 'POST',
            path: `/runs/${lifecycleRun}/turn/response`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
            body: {
              response: 'hold',
              justification: 'The figure the Turn names was already traced and does not move it.',
              confidence: 45,
            },
          }),
      },
      getDefense: {
        route: 'GET /runs/{runId}/defense',
        // No decision is locked: the owner meets `DEFENSE_NOT_OPEN` (409).
        run: async (seat) =>
          call(defenseRoute.GET, {
            path: `/runs/${lifecycleRun}/defense`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
          }),
      },
      answerDefenseQuestion: {
        route: 'POST /runs/{runId}/defense/questions/{runQuestionId}/answer',
        // The state is asked for before the question is looked up, so the id names nothing.
        run: async (seat) =>
          call(defenseAnswerRoute.POST, {
            method: 'POST',
            path: `/runs/${lifecycleRun}/defense/questions/${MISSING_UUID}/answer`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun, runQuestionId: MISSING_UUID },
            body: { text: 'From the cohort table, dated 15 July 2026.', durationMs: 1000 },
          }),
      },
      completeDefense: {
        route: 'POST /runs/{runId}/defense/complete',
        run: async (seat) =>
          call(defenseCompleteRoute.POST, {
            method: 'POST',
            path: `/runs/${lifecycleRun}/defense/complete`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
          }),
      },
      listRunTrace: {
        route: 'GET /runs/{runId}/trace',
        // Stu, Rev (07 §7): `ownRun` is before the Decision Lock, which is the owner's `open` tier
        // (`trace/owner-view.ts`), so the owner reads their own events and the section's reviewers
        // read the record; the seats with no read of the run are NOT_FOUND.
        run: async (seat) =>
          call(traceRoute.GET, {
            path: `/runs/${ownRun}/trace`,
            session: await sessionFor(seat),
            params: { runId: ownRun },
          }),
      },
      advanceRunClock: {
        route: 'POST /test/runs/{runId}/advance-clock',
        // The owner's, like every other act on the run; a millisecond on a run in `assigned` fires
        // no timer. Last of the lifecycle rows, so the shift cannot reach the rows above it.
        run: async (seat) =>
          call(advanceClockRoute.POST, {
            method: 'POST',
            path: `/test/runs/${lifecycleRun}/advance-clock`,
            session: await sessionFor(seat),
            params: { runId: lifecycleRun },
            body: { ms: 1 },
          }),
      },
      resetTestRateLimits: {
        route: 'POST /test/rate-limits/reset',
        // Any session: the route is closed by the environment, not by a seat (D-707).
        run: async (seat) =>
          call(resetRateLimitsRoute.POST, {
            method: 'POST',
            path: '/test/rate-limits/reset',
            session: await sessionFor(seat),
          }),
      },
      listNotifications: {
        route: 'GET /notifications',
        run: async (seat) =>
          call(notificationsRoute.GET, { path: '/notifications', session: await sessionFor(seat) }),
      },
      unreadNotificationCount: {
        route: 'GET /notifications/unread-count',
        run: async (seat) =>
          call(unreadCountRoute.GET, {
            path: '/notifications/unread-count',
            session: await sessionFor(seat),
          }),
      },
      markNotificationRead: {
        route: 'POST /notifications/{id}/read',
        // The seat's own row: the endpoint answers NOT_FOUND for anybody else's id (SYS-010).
        run: async (seat) =>
          call(notificationReadRoute.POST, {
            method: 'POST',
            path: `/notifications/${notifications[seat]}/read`,
            session: await sessionFor(seat),
            params: { id: notifications[seat] },
          }),
      },
      markAllNotificationsRead: {
        route: 'POST /notifications/read-all',
        run: async (seat) =>
          call(notificationsReadAllRoute.POST, {
            method: 'POST',
            path: '/notifications/read-all',
            session: await sessionFor(seat),
          }),
      },
      getRunExport: {
        route: 'GET /runs/{runId}/exports/{version}',
        // 08 §4 "Download a filed course export": the section's reviewers, through
        // `requireCourseExportReader` (D-483). The `student` seat is a classmate of the run's owner
        // and is answered NOT_FOUND, the same as a stranger.
        run: async (seat) =>
          call(runExportVersionRoute.GET, {
            path: `/runs/${reviewedRun}/exports/latest`,
            session: await sessionFor(seat),
            params: { runId: reviewedRun, version: 'latest' },
          }),
      },
      flagDelegation: {
        route: 'POST /review/runs/{runId}/delegations/{delegationId}/flag',
        // Rev (07 §8, FR-055): `requireRunReviewer`. The flag is set once and kept, so the second
        // admitted seat finds it already there and the row is answered without a write.
        run: async (seat) =>
          call(flagDelegationRoute.POST, {
            method: 'POST',
            path: `/review/runs/${reviewedRun}/delegations/${reviewedDelegationId}/flag`,
            session: await sessionFor(seat),
            params: { runId: reviewedRun, delegationId: reviewedDelegationId },
            body: { flag: 'out_of_scenario' },
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

    it('accounts for every operation the routers declare, covered or named (D-520)', () => {
      // The guard the file did not have: `OPERATION_IDS` was hand-written and compared only with
      // this file's own `operations` map, so an endpoint added to a router and never added here was
      // uncovered and nothing said so — twenty-one of them were. Every registered id must now be
      // either in the matrix or in `NOT_IN_THE_MATRIX` with a reason beside it.
      const registered = registeredOperationIds()
      const accounted = new Set<string>([...OPERATION_IDS, ...Object.keys(NOT_IN_THE_MATRIX)])
      expect(
        registered.filter((id) => !accounted.has(id)),
        'a new endpoint needs a row in matrix.json or a named reason in NOT_IN_THE_MATRIX',
      ).toEqual([])

      // And in the other direction, so the two lists cannot rot: nothing may be excused or covered
      // that no router declares any more.
      const declared = new Set(registered)
      expect(
        [...accounted].filter((id) => !declared.has(id)).sort(),
        'OPERATION_IDS and NOT_IN_THE_MATRIX may only name endpoints that exist',
      ).toEqual([])

      // The gap was debt, not a design; it has been paid and it may not reopen.
      expect(
        Object.keys(NOT_IN_THE_MATRIX),
        'every registered operation carries eight cells; nothing is excused',
      ).toEqual([])
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
