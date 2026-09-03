// Step 2.8 (D-006): every exported repository function that touches a tenant-scoped table takes
// `tenantId` as its first parameter and filters on `organizationId`. The check is static: it reads
// src/server/modules/*/repository.ts so a missing guard fails the unit suite, not a code review.
import { readFileSync } from 'node:fs'
import { globSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Tables marked **T** in docs/tech/06-data-model.md, by their schema export names.
const TENANT_TABLES = [
  'institutionSettings',
  'dataAgreements',
  'courses',
  'sections',
  'sectionMemberships',
  'assignments',
  'courseMappingChanges',
  'scenarioPackages',
  'scenarioPackageVersions',
  'runs',
  'courseExports',
]

const files = globSync('src/server/modules/*/repository.ts')

type Fn = { name: string; params: string; body: string }

/** Splits a module into its exported top-level functions (async or not, arrow or declaration). */
function exportedFunctions(source: string): Fn[] {
  const out: Fn[] = []
  const pattern =
    /export\s+(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)|export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::[^=]*)?=>/g
  const matches = [...source.matchAll(pattern)]
  matches.forEach((m, i) => {
    const start = m.index ?? 0
    const end = matches[i + 1]?.index ?? source.length
    out.push({
      name: m[1] ?? m[3] ?? '',
      params: m[2] ?? m[4] ?? '',
      body: source.slice(start, end),
    })
  })
  return out
}

const touchesTenantTable = (body: string): boolean =>
  TENANT_TABLES.some((t) => new RegExp(`\\b${t}\\b`).test(body))

describe('repository tenant guard (D-006)', () => {
  it('finds the repositories once Step 2.8 lands', () => {
    // Before 2.8 there is nothing to check; afterwards every module must have one.
    expect(files.length === 0 || files.length >= 16).toBe(true)
  })

  it.each(files.length ? files : ['(none yet)'])(
    '%s scopes every tenant-table function by organizationId',
    (file) => {
      if (file === '(none yet)') return
      const source = readFileSync(file, 'utf8')
      const offenders: string[] = []
      for (const fn of exportedFunctions(source)) {
        if (!touchesTenantTable(fn.body)) continue
        const firstParam = fn.params.split(',')[0]?.trim() ?? ''
        // Convention (CLAUDE.md, 10 §6): tenantId first; the DbOrTx handle is the last parameter.
        const takesTenant = /^tenantId\b/.test(firstParam)
        const filtersTenant = /organizationId/.test(fn.body)
        if (!takesTenant || !filtersTenant) offenders.push(fn.name)
      }
      expect(offenders, offenders.join(', ')).toEqual([])
    },
  )
})
