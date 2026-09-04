// Step 3.5, UI-005 (SYS-005): an instructor invites an address into the walkthrough institution,
// the emailed link refuses the wrong account, and the invited account accepts and becomes a member.
//
// There is no invitation screen yet — institution administration arrives in Phase 13 — so the
// invitation is created through `POST /api/v1/institutions/{orgId}/invitations`, the endpoint that
// screen will call. Everything after that is the UI.
//
// The invited account is deleted at the end: deletion removes memberships (10 §1), so the
// walkthrough institution ends the run with exactly the five seats it was seeded with.
import {
  TEST_PASSWORD,
  axe,
  createVerifiedAccount,
  expect,
  signInAs,
  signOut,
  test,
  uniqueEmail,
  waitForEmailLink,
} from '../fixtures'

const INSTITUTION = 'Walkthrough University'

test('an instructor invites an address, the wrong account is refused, and the invitee joins', async ({
  page,
}) => {
  const invited = uniqueEmail('invitee')
  const sentAfter = Date.now()

  await signInAs(page, 'instructor')

  const me = await page.request.get('/api/v1/me')
  expect(me.status()).toBe(200)
  const memberships = (
    (await me.json()) as { memberships: { organizationId: string; name: string; role: string }[] }
  ).memberships
  const walkthrough = memberships.find((membership) => membership.name === INSTITUTION)
  expect(walkthrough, `instructor memberships: ${JSON.stringify(memberships)}`).toBeDefined()
  expect(walkthrough?.role).toBe('instructor')

  const created = await page.request.post(
    `/api/v1/institutions/${walkthrough?.organizationId}/invitations`,
    {
      data: { email: invited, role: 'student' },
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'tassl' },
    },
  )
  expect(created.status(), await created.text()).toBe(201)
  const invitation = (await created.json()) as { id: string; email: string; status: string }
  expect(invitation).toMatchObject({ email: invited, status: 'pending' })

  const link = await waitForEmailLink(page, invited, { since: sentAfter })
  expect(link).toContain(`/invitations/${invitation.id}`)

  // The instructor holds the link but is not who it was sent to: the screen says so, names the
  // account that is signed in, and describes nothing else about the invitation.
  await page.goto(link)
  await expect(page.getByRole('heading', { level: 1, name: 'Invitation' })).toBeVisible()
  await expect(
    page.getByRole('heading', { level: 2, name: 'This invitation is for another address' }),
  ).toBeVisible()
  await expect(page.getByText('You are signed in as instructor@tassl.local.')).toBeVisible()
  await expect(page.getByRole('heading', { name: `Join ${INSTITUTION}` })).toHaveCount(0)
  await axe(page)

  await page.getByRole('button', { name: 'Sign out and use another account' }).click()
  await page.waitForURL(/\/sign-in/)
  await signOut(page)

  // The invited address, now that it has an account.
  await createVerifiedAccount(page, {
    name: 'Priya Nandakumar',
    email: invited,
    password: TEST_PASSWORD,
  })
  try {
    await page.goto('/home')
    await expect(
      page.getByRole('heading', { level: 3, name: 'Waiting for an invitation' }),
    ).toBeVisible()

    await page.goto(link)
    await expect(page.getByRole('heading', { level: 2, name: `Join ${INSTITUTION}` })).toBeVisible()
    await expect(page.getByText('Your role')).toBeVisible()
    await expect(page.getByText('Student', { exact: true })).toBeVisible()
    await axe(page)

    await page.getByRole('button', { name: 'Accept the invitation' }).click()
    await page.waitForURL(/\/home$/)
    await expect(page.getByText(`You are now a member of ${INSTITUTION}.`)).toBeVisible()

    // UI-008: the membership is in the shell's institution switcher, and home is no longer the
    // "waiting for an invitation" state.
    await expect(page.getByRole('banner').getByText(INSTITUTION)).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'Nothing to do yet' })).toBeVisible()

    // The invitation is spent: opening the link again is the expired state, not a second join.
    await page.goto(link)
    await expect(
      page.getByRole('heading', { level: 2, name: 'This invitation no longer works' }),
    ).toBeVisible()
  } finally {
    // Closing the account removes the membership, so the institution is left as it was seeded.
    const deleted = await page.request.delete('/api/v1/me', {
      headers: { 'X-Requested-With': 'tassl' },
    })
    expect(deleted.status()).toBe(204)
    await page.context().clearCookies()
  }
})
