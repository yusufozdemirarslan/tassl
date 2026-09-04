// Playwright global teardown: the other half of ./global-setup.ts.
//
// It takes back out every course, section, membership, assignment and invitation the instructor
// specs created, whatever happened to them — a spec that failed halfway leaves its rows to this
// file rather than to the next run. The fixture package version stays: it is frozen once confirmed
// (migration 0004) and the next run reuses it.
import 'dotenv/config'
import { client, purgeSuiteData, walkthroughOrganizationId } from './global-setup'

export default async function globalTeardown(): Promise<void> {
  try {
    await purgeSuiteData(await walkthroughOrganizationId())
  } finally {
    await client.end({ timeout: 5 })
  }
}
