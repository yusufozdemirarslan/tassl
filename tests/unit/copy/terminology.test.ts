// Two words for one thing, on screens an instructor reads side by side, and the audit that found
// them: the thing being authored was "Package" in headings, "scenario" alone in prose, and the
// person under review was "Student" in one column and "Student seat" in the next. The glossary term
// is "scenario package", and the column is "Student"; this file pins both where they drifted.
import { describe, expect, it } from 'vitest'
import { packageConfirm } from '@/lib/i18n/messages/package-confirm'
import { packageNew } from '@/lib/i18n/messages/package-new'
import { packageVersion } from '@/lib/i18n/messages/package-version'
import { packages } from '@/lib/i18n/messages/packages'
import { review } from '@/lib/i18n/messages/review'

const NAMESPACES = { packages, packageNew, packageVersion, packageConfirm, review }

describe('terminology across the package and review screens', () => {
  it('calls the person under review "Student" in every column heading', () => {
    expect(review['review.assignmentExportsColumnStudent']).toBe('Student')
    expect(review['review.assignmentExportsColumnStudent']).toBe(
      review['review.queueColumnStudent'],
    )
    for (const [name, namespace] of Object.entries(NAMESPACES)) {
      for (const [key, value] of Object.entries(namespace)) {
        expect(value, `${name} ${key}`).not.toMatch(/Student seat/)
      }
    }
  })

  it('names the thing being authored "scenario package" where prose used "scenario" alone', () => {
    expect(packageNew['packageNew.description']).toMatch(/^A scenario package is built/)
    expect(packageVersion['packageVersion.claimsDescription']).toMatch(/in this scenario package,/)
    expect(packageVersion['packageVersion.restrictedBody']).toMatch(
      /author and teach the scenario package\.$/,
    )
    expect(review['review.voidReofferHint']).toMatch(/variant of this scenario package/)
    // The shelf's own sentences already used the glossary term; they must keep it.
    expect(packages['packages.description']).toMatch(/scenario packages/)
    expect(packages['packages.listCaption']).toMatch(/Scenario packages/)
    expect(packages['packages.emptyBody']).toMatch(/A scenario package holds/)
  })
})
