// Step 2.9 (SYS-024 part 1, D-040, D-111): the seed is idempotent and creates the walkthrough seats.
import { testSql, truncateAll } from '@tests/setup/integration'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type Counts = {
  users: number
  members: number
  courses: number
  sections: number
  memberships: number
}

async function counts(): Promise<Counts> {
  const [row] = await testSql<Array<Record<keyof Counts, string>>>`
    select
      (select count(*) from "user") as users,
      (select count(*) from member) as members,
      (select count(*) from courses) as courses,
      (select count(*) from sections) as sections,
      (select count(*) from section_memberships) as memberships`
  return Object.fromEntries(Object.entries(row!).map(([k, v]) => [k, Number(v)])) as Counts
}

describe('seed', () => {
  let runSeed: () => Promise<unknown>
  let closeClient: () => Promise<void>

  beforeAll(async () => {
    await truncateAll()
    const seed = await import('@/server/db/seed')
    const { client } = await import('@/server/db/client')
    runSeed = seed.runSeed
    closeClient = () => client.end({ timeout: 5 })
  })

  afterAll(async () => {
    await closeClient()
    await truncateAll()
  })

  it('creates the institution, five seats, the course and section, and is idempotent', async () => {
    await runSeed()
    const first = await counts()
    expect(first).toEqual({ users: 5, members: 4, courses: 1, sections: 1, memberships: 3 })
    await runSeed()
    expect(await counts()).toEqual(first)
  })

  it('gives the seats their roles', async () => {
    const [instructor] = await testSql<{ role: string }[]>`
      select sm.role from section_memberships sm
      join "user" u on u.id = sm.user_id
      where u.email = 'instructor@tassl.local'`
    expect(instructor?.role).toBe('instructor')

    const [editor] = await testSql<{ platform_role: string; member_role: string }[]>`
      select u.platform_role, m.role as member_role from "user" u
      join member m on m.user_id = u.id
      where u.email = 'editor@tassl.local'`
    expect(editor).toEqual({
      platform_role: 'tassl_scenario_editor',
      member_role: 'scenario_author',
    })

    const [admin] = await testSql<{ platform_role: string; email_verified: boolean }[]>`
      select platform_role, email_verified from "user" where email = 'admin@tassl.local'`
    expect(admin).toEqual({ platform_role: 'admin', email_verified: true })

    const [account] = await testSql<{ n: string }[]>`
      select count(*) as n from account where provider_id = 'credential' and password is not null`
    expect(Number(account?.n)).toBe(5)
  })
})
