// Step 2.9: the factories build the walkthrough shape deterministically through the repositories.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { truncateAll } from '@tests/setup/integration'

describe('test factories', () => {
  let factories: typeof import('@tests/factories')

  beforeAll(async () => {
    await truncateAll()
    factories = await import('@tests/factories')
  })

  afterEach(async () => {
    await truncateAll()
  })

  it('builds the walkthrough fixture with stable ids and frozen time, twice', async () => {
    const first = await factories.buildWalkthroughFixture()
    expect(first.organization.id).toBe(factories.uuidFrom('org:walkthrough'))
    expect(first.assignment.id).toBe(factories.uuidFrom('assignment:decision-run-1'))
    expect(first.assignment.variantId).toBe(first.pkg.defective.id)
    expect(first.course.createdAt.toISOString()).toBe(factories.FROZEN_TIME.toISOString())
    expect(first.student1.email).toBe('student-1@example.test')

    await truncateAll()
    const second = await factories.buildWalkthroughFixture()
    expect(second.organization.id).toBe(first.organization.id)
    expect(second.assignment.id).toBe(first.assignment.id)
    expect(second.pkg.version.id).toBe(first.pkg.version.id)
  })

  it('keeps the org membership unique per user, and a membership carries no role (D-748)', async () => {
    const { organization } = await factories.createInstitution('other')
    const person = await factories.createUser('person')
    const a = await factories.addMember(organization.id, person.id)
    const b = await factories.addMember(organization.id, person.id)
    expect(b.id).toBe(a.id)
    expect(b.role).toBe('member')
    expect(person.platform_role).toBe('student')
  })
})
