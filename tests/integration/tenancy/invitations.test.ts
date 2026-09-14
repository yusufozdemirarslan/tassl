// Step 3.5 — institution invitations end to end (docs/tech/10-backend-spec-modules.md §2,
// 08-auth-authz.md §2.5, SYS-005): an instructor invites an email, the invitee accepts with the
// matching address and becomes a member, a different address is refused with
// INVITATION_EMAIL_MISMATCH, and an expired invitation is refused.
//
// D-748: an invitation names a person, never a role — the member row it writes holds the plugin's
// one membership role, and what the person may do is the platform role on their account. Who may
// invite is an Instructor of the institution, or the Platform Admin, who needs no member row.
//
// The service is exercised directly (not through the route) so the assertions are about the rules,
// not the wrapper; `asUser()` supplies the real session cookie Better Auth resolves the inviter and
// the invitee from.
//
// `sendEmail` is mocked to prove the second half of the rule the organization plugin owns: Better
// Auth sends the invitation email itself, so `inviteMember` must not send a second copy — and the
// admin's path, which the plugin cannot take, sends exactly the one it would have.
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
let editor: UserRow
let admin: UserRow

/** The signed-in actor behind `headers`, resolved the way a route or an action resolves it. */
async function actorFor(
  user: UserRow,
  activeOrganizationId: string | null = orgId,
): Promise<{ actor: Awaited<ReturnType<Session['requireSession']>>; headers: Headers }> {
  const headers = await asUser(user.id, { activeOrganizationId })
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
    instructor = await f.createUser('invitations-instructor', { platformRole: 'instructor' })
    student = await f.createUser('invitations-student')
    editor = await f.createUser('invitations-editor', { platformRole: 'tassl_scenario_editor' })
    // The admin holds no member row anywhere (D-748).
    admin = await f.createUser('invitations-admin', { platformRole: 'admin' })
    await f.addMember(orgId, instructor.id)
    await f.addMember(orgId, student.id)
    await f.addMember(orgId, editor.id)
  })

  afterAll(async () => {
    await truncateAll()
  })

  it('invites an email, sends exactly one invitation email, and audits the invitation', async () => {
    const invitee = await f.createUser('invitations-accepts')
    const { actor, headers } = await actorFor(instructor)

    const invitation = await tenancy.inviteMember(actor, orgId, { email: invitee.email }, headers)

    expect(invitation).toMatchObject({
      organizationId: orgId,
      email: invitee.email,
      status: 'pending',
    })
    expect(invitation).not.toHaveProperty('role')
    // 08 §2.5: seven days, not Better Auth's 48 hours.
    const days = (new Date(invitation.expiresAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.5)
    expect(days).toBeLessThan(7.5)

    expect(invitationEmailsTo(invitee.email)).toHaveLength(1)
    const [row] = await testSql<{ role: string | null }[]>`
      select role from invitation where id = ${invitation.id}`
    expect(row?.role).toBe('member')

    const audits = await testSql<{ target_id: string; actor_id: string }[]>`
      select target_id, actor_id from audit_logs where action = 'invitation.create'`
    expect(audits).toEqual([{ target_id: invitation.id, actor_id: instructor.id }])
  })

  it('accepts the invitation with the matching email and writes a member row with no role', async () => {
    const invitee = await f.createUser('invitations-accepts')
    const [pending] = await testSql<{ id: string }[]>`
      select id from invitation where email = ${invitee.email} and status = 'pending'`
    expect(pending).toBeDefined()

    const { actor, headers } = await actorFor(invitee)
    const membership = await tenancy.acceptInvitation(actor, pending!.id, headers)

    expect(membership).toEqual({ organizationId: orgId, name: 'invitations University' })

    const rows = await testSql<{ role: string }[]>`
      select role from member where organization_id = ${orgId} and user_id = ${invitee.id}`
    expect(rows).toEqual([{ role: 'member' }])
  })

  it('refuses an invitation addressed to a different email', async () => {
    const other = await f.createUser('invitations-other')
    const wrongSeat = await f.createUser('invitations-wrong-seat')
    const inviter = await actorFor(instructor)

    const invitation = await tenancy.inviteMember(
      inviter.actor,
      orgId,
      { email: other.email },
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
      { email: late.email },
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

  it('refuses a Student and a Scenario Editor of the institution, and sends nothing', async () => {
    const target = await f.createUser('invitations-not-sent')
    for (const seat of [student, editor]) {
      const { actor, headers } = await actorFor(seat)
      await expect(
        tenancy.inviteMember(actor, orgId, { email: target.email }, headers),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(tenancy.listInvitations(actor, orgId)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      })
    }

    expect(invitationEmailsTo(target.email)).toHaveLength(0)
  })

  it('refuses to invite into an institution the actor does not belong to', async () => {
    const other = await f.createInstitution('invitations-elsewhere')
    const target = await f.createUser('invitations-elsewhere-target')
    const { actor, headers } = await actorFor(instructor)

    await expect(
      tenancy.inviteMember(actor, other.organization.id, { email: target.email }, headers),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  describe('the Platform Admin, who holds no member row (D-748)', () => {
    it('invites, sends the one invitation email, audits, and the invitee accepts', async () => {
      const invitee = await f.createUser('invitations-admin-invitee')
      const { actor, headers } = await actorFor(admin, null)

      const invitation = await tenancy.inviteMember(actor, orgId, { email: invitee.email }, headers)
      expect(invitation).toMatchObject({ organizationId: orgId, email: invitee.email })
      const days = (new Date(invitation.expiresAt).getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(6.5)
      expect(days).toBeLessThan(7.5)

      const sent = invitationEmailsTo(invitee.email)
      expect(sent).toHaveLength(1)
      expect(sent[0]?.props).toEqual({
        url: expect.stringMatching(new RegExp(`/invitations/${invitation.id}$`)) as unknown,
        organizationName: 'invitations University',
        inviterName: admin.name,
      })

      const [row] = await testSql<{ role: string; inviter_id: string; status: string }[]>`
        select role, inviter_id, status from invitation where id = ${invitation.id}`
      expect(row).toEqual({ role: 'member', inviter_id: admin.id, status: 'pending' })
      const audits = await testSql<{ actor_id: string }[]>`
        select actor_id from audit_logs where action = 'invitation.create' and target_id = ${invitation.id}`
      expect(audits).toEqual([{ actor_id: admin.id }])
      // The admin still holds no member row.
      expect(
        await testSql`select 1 from member where organization_id = ${orgId} and user_id = ${admin.id}`,
      ).toHaveLength(0)

      const accepted = await actorFor(invitee, null)
      await expect(
        tenancy.acceptInvitation(accepted.actor, invitation.id, accepted.headers),
      ).resolves.toEqual({ organizationId: orgId, name: 'invitations University' })
    })

    it('renews a pending invitation rather than writing a second, and sends it again', async () => {
      const invitee = await f.createUser('invitations-admin-again')
      const { actor, headers } = await actorFor(admin, null)

      const first = await tenancy.inviteMember(actor, orgId, { email: invitee.email }, headers)
      await testSql`update invitation set expires_at = now() + interval '1 day' where id = ${first.id}`
      const second = await tenancy.inviteMember(actor, orgId, { email: invitee.email }, headers)

      expect(second.id).toBe(first.id)
      expect(new Date(second.expiresAt).getTime() - Date.now()).toBeGreaterThan(6 * 86_400_000)
      expect(invitationEmailsTo(invitee.email)).toHaveLength(2)
      expect(await testSql`select 1 from invitation where email = ${invitee.email}`).toHaveLength(1)
    })

    it('refuses an existing member and an unknown institution, and lists the invitations', async () => {
      const { actor, headers } = await actorFor(admin, null)
      await expect(
        tenancy.inviteMember(actor, orgId, { email: student.email }, headers),
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      await expect(
        tenancy.inviteMember(actor, 'no-such-institution', { email: 'x@example.test' }, headers),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })

      const listed = await tenancy.listInvitations(actor, orgId)
      expect(listed.length).toBeGreaterThan(0)
      for (const row of listed) expect(row).not.toHaveProperty('role')
    })

    it('lists every institution and switches into one without a member row', async () => {
      const other = await f.createInstitution('invitations-admin-other')
      const { actor, headers } = await actorFor(admin, null)

      const institutions = await tenancy.listMyInstitutions(actor)
      expect(institutions.map((row) => row.id)).toEqual(
        expect.arrayContaining([orgId, other.organization.id]),
      )
      for (const row of institutions) expect(row).not.toHaveProperty('role')

      await expect(
        tenancy.setActiveInstitution(actor, other.organization.id, headers),
      ).resolves.toMatchObject({ id: other.organization.id })
      expect((await requireSession(headers)).activeOrganizationId).toBe(other.organization.id)

      await expect(
        tenancy.setActiveInstitution(actor, 'no-such-institution', headers),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })
})
