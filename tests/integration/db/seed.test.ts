// Step 2.9 (SYS-024 part 1, D-040, D-111) and Step 5.3 (06 §5 items 4 and 5): the seed is
// idempotent, creates the walkthrough seats, and loads the Meridian Roast fixture confirmed with the
// three assignments the walkthrough is run from.
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

  it('imports the fixture package confirmed, and signs for every element', async () => {
    await runSeed()

    const [version] = await testSql<
      { id: string; status: string; version: number; family_key: string; title: string }[]
    >`
      select v.id, v.status, v.version, p.family_key, p.title
      from scenario_package_versions v
      join scenario_packages p on p.id = v.package_id
      where p.family_key = 'meridian-roast'`
    expect(version?.status).toBe('confirmed')
    expect(version?.version).toBe(1)

    // A confirmed version is frozen and carries the document it was confirmed as (10 §4).
    const [snapshot] = await testSql<{ present: boolean }[]>`
      select snapshot is not null as present
      from scenario_package_versions where id = ${version!.id}`
    expect(snapshot?.present).toBe(true)

    // One confirmation per element: the fixture has well over sixty of them (06 §5 item 4).
    const [confirmations] = await testSql<{ count: string; decisions: string }[]>`
      select count(*) as count, count(distinct decision) as decisions
      from element_confirmations where package_version_id = ${version!.id}`
    expect(Number(confirmations?.count)).toBeGreaterThanOrEqual(60)
    expect(Number(confirmations?.decisions)).toBe(1)

    const [variants] = await testSql<{ count: string }[]>`
      select count(*) as count from scenario_variants where package_version_id = ${version!.id}`
    expect(Number(variants?.count)).toBe(2)
  })

  it('creates the three walkthrough assignments on the seeded version', async () => {
    await runSeed()

    const rows = await testSql<
      {
        label: string
        variant: string
        is_walkthrough: boolean
        working_clock_seconds: number | null
      }[]
    >`
      select a.label, v.key as variant, a.is_walkthrough, a.working_clock_seconds
      from assignments a
      join scenario_variants v on v.id = a.variant_id
      order by a.label`
    expect(rows.map((row) => row.label)).toEqual([
      'Auto-lock test run',
      'Decision Run 1 (sound)',
      'Decision Run 1 (walkthrough)',
    ])
    expect(rows.find((row) => row.label === 'Decision Run 1 (walkthrough)')).toMatchObject({
      variant: 'defective',
      is_walkthrough: true,
      working_clock_seconds: null,
    })
    expect(rows.find((row) => row.label === 'Decision Run 1 (sound)')?.variant).toBe('sound')
    // The short clock is the point of this one: it is how a lock is watched happening.
    expect(rows.find((row) => row.label === 'Auto-lock test run')).toMatchObject({
      variant: 'defective',
      working_clock_seconds: 120,
    })
  })

  it('re-running writes no second package and no second assignment', async () => {
    await runSeed()
    await runSeed()

    const [row] = await testSql<{ packages: string; versions: string; assignments: string }[]>`
      select
        (select count(*) from scenario_packages) as packages,
        (select count(*) from scenario_package_versions) as versions,
        (select count(*) from assignments) as assignments`
    expect(row).toEqual({ packages: '1', versions: '1', assignments: '3' })
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
