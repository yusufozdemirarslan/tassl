import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

// t('some.key') and t("some.key") anywhere in src/**.
const KEY_CALL = /\bt\(\s*(['"])([A-Za-z0-9_.-]+)\1/g

describe('i18n catalogue', () => {
  it('every t() key used in src/** exists in en-US', () => {
    const used = new Map<string, string>()
    for (const file of walk('src')) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(KEY_CALL)) used.set(match[2]!, file)
    }
    expect(used.size).toBeGreaterThan(0)
    const missing = [...used]
      .filter(([key]) => !(key in enUS))
      .map(([key, file]) => `${key} (${file})`)
    expect(missing).toEqual([])
  })

  it('interpolates named parameters', () => {
    expect(t('landing.title')).toBe(enUS['landing.title'])
  })
})
