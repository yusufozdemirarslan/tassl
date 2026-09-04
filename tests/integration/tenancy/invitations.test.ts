// Step 3.5 — institution invitations end to end (docs/tech/10-backend-spec-modules.md §2,
// 08-auth-authz.md §2.5, SYS-005): an instructor invites an email, the invitee accepts with the
// matching address and becomes a member, a different address is refused with
// INVITATION_EMAIL_MISMATCH, and an expired invitation is refused.
//
// The service is exercised directly (not through the route) so the assertions are about the rules,
// not the wrapper; `asUser()` supplies the real session cookie Better Auth resolves the inviter and
// the invitee from.
//
// `sendEmail` is mocked to prove the second half of the rule the organization plugin owns: Better
// Auth sends the invitation email itself, so `inviteMember` must not send a second copy.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { asUser, testSql, truncateAll } from '@tests/setup/integration'

type Outbox = Array<{ to: string; template: string; props: Record<string, string> }>

const outbox = vi.hoisted(() => [] as Outbox)

vi.mock('@/server/email/send', () => ({
  sendEmail: async (input: Outbox[number]) => {
    outbox.push(input)
  },
}))

type Tenancy = typeof import('@/server/modules/tenancy')
type Session = typeof import('@/server/auth/session')
type Factories = typeof import('@tests/factories')
type UserRow = Awaited<ReturnType<Factories['createUser']>>

let tenancy: Tenancy
let requireSession: Session['requireSession']
let f: Factories

let orgId: string
let instructor: UserRow
let student: UserRow

/** The signed-in actor behind `headers`, resolved the way a route or an action resolves it. */
async function actorFor(
  user: UserRow,
): Promise<{ actor: Awaited<ReturnType<Session['requireSession']>>; headers: Headers }> {
  const headers = await asUser(user.id, { activeOrganizationId: orgId })
  return { actor: await requireSession(headers), headers }
}

const invitationEmailsTo = (email: string): Outbox =>
  outbox.filter((sent) => sent.template === 'invitation' && sent.to === email)

describe('institution invitations (SYS-005)', () => {
  beforeAll(async () => {
    await truncateAll()
    tenancy = await import('@/server/modules/tenancy')
    requireSession = (await import('@/server/auth/session')).requireSession
    f = await import('@tests/factories')

    const institution = await f.createInstitution('invitations')
    orgId = institution.organization.id
    instructor = await f.createUser('invitations-instructor')
    student = await f.createUser('invitations-student')
    await f.addMember(orgId, instructor.id, 'instructor')
    await f.addMember(orgId, student.id, 'student')
  })

  afterAll(async () => {
    await truncateAll()
  })

  it('invites an email, sends exactly one invitation email, and audits the invitation', async () => {
    const invitee = await f.createUser('invitations-accepts')
    const { actor, headers } = await actorFor(instructor)

    const invitation = await tenancy.inviteMember(
      actor,
      orgId,
      { email: invitee.email, role: 'student' },
      headers,
    )

    expect(invitation).toMatchObject({
      organizationId: orgId,
      email: invitee.email,
      role: 'student',
      status: 'pending',
    })
    // 08 §2.5: seven days, not Better Auth's 48 hours.
    const days = (new Date(invitation.expiresAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.5)
    expect(days).toBeLessThan(7.5)

    expect(invitationEmailsTo(invitee.email)).toHaveLength(1)

    const audits = await testSql<{ target_id: string; actor_id: string }[]>`
      select target_id, actor_id from audit_logs where action = 'invitation.create'`
    expect(audits).toEqual([{ target_id: invitation.id, actor_id: instructor.id }])
  })

  it('accepts the invitation with the matching email and writes the member row', async () => {
    const invitee = await f.createUser('invitations-accepts')
    const [pending] = await testSql<{ id: string }[]>`
      select id from invitation where email = ${invitee.email} and status = 'pending'`
    expect(pending).toBeDefined()

    const { actor, headers } = await actorFor(invitee)
    const membership = await tenancy.acceptInvitation(actor, pending!.id, headers)

    expect(membership).toEqual({
      organizationId: orgId,
      name: 'invitations University',
      role: 'student',
    })

    const rows = await testSql<{ role: string }[]>`
      select role from member where organization_id = ${orgId} and user_id = ${invitee.id}`
    expect(rows).toEqual([{ role: 'student' }])
  })

  it('refuses an invitation addressed to a different email', async () => {
    const other = await f.createUser('invitations-other')
    const wrongSeat = await f.createUser('invitations-wrong-seat')
    const inviter = await actorFor(instructor)

    const invitation = await tenancy.inviteMember(
      inviter.actor,
      orgId,
      { email: other.email, role: 'student' },
      inviter.headers,
    )

    const { actor, headers } = await actorFor(wrongSeat)
    await expect(tenancy.acceptInvitation(actor, invitation.id, headers)).rejects.toMatchObject({
      code: 'INVITATION_EMAIL_MISMATCH',
      status: 409,
    })

    const rows = await testSql<{ id: string }[]>`
      select id from member where organization_id = ${orgId} and user_id = ${wrongSeat.id}`
    expect(rows).toHaveLength(0)
  })

  it('refuses an expired invitation', async () => {
    const late = await f.createUser('invitations-late')
    const inviter = await actorFor(instructor)

    const invitation = await tenancy.inviteMember(
      inviter.actor,
      orgId,
      { email: late.email, role: 'student' },
      inviter.headers,
    )
    await testSql`update invitation set expires_at = now() - interval '1 day' where id = ${invitation.id}`

    const { actor, headers } = await actorFor(late)
    await expect(tenancy.acceptInvitation(actor, invitation.id, headers)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    const rows = await testSql<{ id: string }[]>`
      select id from member where organization_id = ${orgId} and user_id = ${late.id}`
    expect(rows).toHaveLength(0)
  })

  it('refuses to invite from a seat that may not invite, and sends nothing', async () => {
    const target = await f.createUser('invitations-not-sent')
    const { actor, headers } = await actorFor(student)

    await expect(
      tenancy.inviteMember(actor, orgId, { email: target.email, role: 'student' }, headers),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })

    expect(invitationEmailsTo(target.email)).toHaveLength(0)
  })

  it('refuses to invite into an institution the actor does not belong to', async () => {
    const other = await f.createInstitution('invitations-elsewhere')
    const target = await f.createUser('invitations-elsewhere-target')
    const { actor, headers } = await actorFor(instructor)

    await expect(
      tenancy.inviteMember(
        actor,
        other.organization.id,
        { email: target.email, role: 'student' },
        headers,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
