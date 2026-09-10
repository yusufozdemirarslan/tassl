// The instructor guide, task by task (docs/guides/instructor-guide.md; docs/prompts/02-qa-and-guides.md
// Part B).
//
// This spec and the guide are one artifact: every `### Task N` there is a `test()` here, every
// numbered step is a `test.step` titled `N.M` and the guide's own sentence, in the same order, and
// every step ends with the screenshot the guide embeds. `scripts/check-guide-coverage.ts`
// re-derives both sides on every run and fails on any drift, so a step is added, renamed or
// removed in the guide first and here second.
//
// What a step does is what the guide tells a person to do — the rail link, the button, the typed
// value — and what it asserts is the guide's own "You see" sentence, read off the screen with the
// locators a reader would use (a heading, a label, a link's name). Nothing here goes through the
// API that the guide says happens on screen. The API is used only for what the guide itself hands
// to "the automated test": the two student runs of Tasks 7 to 9, which are driven to `scored`
// through `../walkthrough/scored-run.ts` exactly as the walkthrough specs drive theirs.
//
// The twelve tasks run in order in one worker (`serial`): Task 2 makes the course Task 3 fills,
// Task 6 makes the assignment Tasks 7 to 10 review, Task 8 writes the notification Task 12 reads.
// Every row the tasks create is named "Guide …", which is how `resetGuideData` in
// ../global-setup.ts finds it again before the next engine starts.
import type { APIRequestContext, Locator, Page, PlaywrightWorkerArgs } from '@playwright/test'
import {
  SEED_PASSWORD,
  expect,
  runIdFromUrl,
  seatEmail,
  signInAs,
  test,
  type Seat,
} from './fixtures'
import { driveRunToScored, myAssignment, readJson } from '../walkthrough/scored-run'

/** The `playwright` worker fixture: what `request.newContext()` for a second seat comes from. */
type Playwright = PlaywrightWorkerArgs['playwright']

test.use({ persona: 'instructor' })
test.describe.configure({ mode: 'serial' })

// ---------------------------------------------------------------------------------------------
// What the guide types
// ---------------------------------------------------------------------------------------------

const INSTRUCTOR_EMAIL = 'instructor@tassl.local'
const COURSE_NAME = 'Guide course 2026'
const TERM = '2026-fall'
const SECTION_NAME = 'Guide section'
const ASSIGNMENT_NAME = 'Guide run'
const PACKAGE_TITLE = 'Guide package 2026'
const OVERRIDE_NOTE = 'Guide note. Check the memo date.'
const REJECTION_NOTE = 'Guide rejection. The dateline reads as an internal memo.'
const DOCUMENT_TITLE = 'Guide document title'
const SEED_SENTENCE = 'Guide seed case text for the walkthrough.'

/** The seven band names the screen uses, keyed the way the API reports them. */
const BAND_LABELS: Record<string, string> = {
  novice: 'Novice',
  developing: 'Developing',
  proficient: 'Proficient',
  professional: 'Professional',
}

/**
 * How long a decision may take to show in the counter, and how long the two recharts graphs may
 * take to arrive: a Server Action followed by `router.refresh()`, and a `next/dynamic` chunk, are
 * both past Playwright's five-second default on a loaded machine (D-188; see
 * ../walkthrough/12-faculty-replay.spec.ts for the reasoning).
 */
const ACTION_TIMEOUT_MS = 20_000
const GRAPH_TIMEOUT_MS = 20_000

/** The scripted assistant drafts a package in seconds; the real one takes minutes. Either passes. */
const GENERATION_TIMEOUT_MS = 120_000
const REWRITE_TIMEOUT_MS = 90_000

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const rail = (page: Page): Locator => page.getByRole('navigation', { name: 'Primary' })
const courseViews = (page: Page): Locator => page.getByRole('navigation', { name: 'Course views' })
const replayViews = (page: Page): Locator => page.getByRole('navigation', { name: 'Replay views' })

/**
 * Opens a dialog whose trigger is a client component.
 *
 * A production build paints the page before React has attached, so a click that lands in that gap
 * is swallowed. The click is retried until the dialog is open, which is what a person does too
 * (the same pattern as ../instructor/courses.spec.ts).
 */
async function openDialog(page: Page, trigger: string, title: string): Promise<Locator> {
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: title }) })
  await expect(async () => {
    await page.getByRole('button', { name: trigger }).click()
    await expect(dialog).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30_000 })
  return dialog
}

/** The header's account menu, whose popup is fetched on the first press (UI-008). */
async function openAccountMenu(page: Page): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: /^Account:/ }).click()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 30_000 })
}

/** An address out of RFC 2544's benchmarking range, as ../fixtures.ts gives every test its own. */
const syntheticClientIp = (): string => {
  const octet = (): number => Math.floor(Math.random() * 254) + 1
  return `198.18.${octet()}.${octet()}`
}

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'

/**
 * A student seat's own API session, apart from the instructor's browser.
 *
 * The guide hands the two student runs to "the automated test", and a run is the student's own
 * work: it is taken through the endpoints the student's screens call, in a request context that
 * holds that student's cookie and nobody else's. The `origin` header is what Better Auth requires
 * on a cookie-authenticated POST from a context that is not a browser (../instructor/api.ts).
 */
async function studentApi(playwright: Playwright, seat: Seat): Promise<APIRequestContext> {
  const api = await playwright.request.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: { 'x-forwarded-for': syntheticClientIp() },
  })
  const response = await api.post('/api/auth/sign-in/email', {
    data: { email: seatEmail(seat), password: SEED_PASSWORD, rememberMe: true },
    headers: { 'content-type': 'application/json', origin: BASE_URL },
  })
  expect(response.ok(), `sign-in as ${seat}: ${await response.text()}`).toBe(true)
  return api
}

/** The student's run on "Guide run", driven to `scored` through the documented endpoints. */
async function scoreGuideRun(playwright: Playwright, seat: Seat): Promise<void> {
  const api = await studentApi(playwright, seat)
  try {
    const mine = await myAssignment(api, ASSIGNMENT_NAME)
    await driveRunToScored(api, mine.assignmentId)
  } finally {
    await api.dispose()
  }
}

/** From the courses list to the course, the way every task after Task 2 begins. */
async function openGuideCourse(page: Page): Promise<void> {
  await page.getByRole('link', { name: `Open ${COURSE_NAME}` }).click()
  await expect(page.getByRole('heading', { level: 1, name: COURSE_NAME })).toBeVisible()
}

type ReplayView = {
  bands: { dimension: string; band: string | null }[]
}

// ---------------------------------------------------------------------------------------------
// Task 1
// ---------------------------------------------------------------------------------------------

test('Task 1: Sign in and find your way around', async ({ page, shot }) => {
  test.setTimeout(180_000)

  await test.step('1.1 Open /sign-in in your browser.', async () => {
    await page.goto('/sign-in')
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()
    await expect(page.getByLabel('Email address')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await shot(1, 1)
  })

  await test.step('1.2 Type instructor@tassl.local in Email address.', async () => {
    await page.getByLabel('Email address').fill(INSTRUCTOR_EMAIL)
    await expect(page.getByLabel('Email address')).toHaveValue(INSTRUCTOR_EMAIL)
    await shot(1, 2)
  })

  await test.step('1.3 Type the seed password (see Getting started) in Password.', async () => {
    await page.getByLabel('Password').fill(SEED_PASSWORD)
    await expect(page.getByRole('checkbox', { name: 'Keep me signed in' })).toBeChecked()
    await shot(1, 3)
  })

  await test.step('1.4 Click Sign in.', async () => {
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.waitForURL(/\/home$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible()
    // The eyebrow above the heading; the header names the institution too, so the page's own
    // copy is the one read.
    await expect(page.locator('main').getByText('Walkthrough University')).toBeVisible()
    await shot(1, 4)
  })

  await test.step('1.5 Read the rail under Tassl on the left.', async () => {
    for (const item of ['Home', 'Courses', 'Review', 'Packages']) {
      await expect(rail(page).getByRole('link', { name: item, exact: true })).toBeVisible()
    }
    await shot(1, 5)
  })

  await test.step('1.6 Read the panels on Home.', async () => {
    // An instructor seat with no student role has no Your runs panel (QA-026).
    for (const panel of ['Review', 'Packages', 'Courses']) {
      await expect(page.getByRole('heading', { level: 2, name: panel, exact: true })).toBeVisible()
    }
    // The third panel is below the fold; the shot scrolls to it so all three are in frame.
    await shot(1, 6, page.locator('#home-courses'))
  })

  await test.step('1.7 Click Courses in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible()
    await expect(
      page.getByRole('row').filter({ hasText: 'Marketing Strategy Walkthrough' }),
    ).toBeVisible()
    await shot(1, 7)
  })

  await test.step('1.8 Click Review in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Review', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Review' })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Runs waiting for you' }),
    ).toBeVisible()
    const nothingWaiting = page.getByRole('heading', { level: 3, name: 'Nothing waiting' })
    await expect(nothingWaiting).toBeVisible()
    await shot(1, 8, nothingWaiting)
  })

  await test.step('1.9 Click Packages in the rail on the left.', async () => {
    await rail(page).getByRole('link', { name: 'Packages', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Packages' })).toBeVisible()
    await expect(
      page.getByRole('row').filter({ hasText: 'Meridian Roast (fixture)' }),
    ).toBeVisible()
    await shot(1, 9)
  })

  await test.step('1.10 Click Home in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Home', exact: true }).click()
    await expect(page.getByText('What needs your attention, and what is coming up.')).toBeVisible()
    await shot(1, 10)
  })

  await test.step('1.11 Click the bell icon at the top right (named Notifications).', async () => {
    await page.getByRole('link', { name: /^Notifications:/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
    await expect(page.getByText('What Tassl has told you, newest first.')).toBeVisible()
    await shot(1, 11)
  })

  await test.step('1.12 Click the person icon at the top right (named Account).', async () => {
    await openAccountMenu(page)
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Privacy' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Terms' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await shot(1, 12)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 2
// ---------------------------------------------------------------------------------------------

test('Task 2: Create a course', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'instructor')

  await test.step('2.1 Click Courses in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Courses' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New course' })).toBeVisible()
    await shot(2, 1)
  })

  const dialog = await test.step('2.2 Click New course.', async () => {
    const opened = await openDialog(page, 'New course', 'New course')
    await expect(
      opened.getByText(
        'Name it and give it a term. Policy, weight, and the band mapping are set on the course once it exists.',
      ),
    ).toBeVisible()
    await shot(2, 2)
    return opened
  })

  await test.step('2.3 Type Guide course 2026 in Course name.', async () => {
    await dialog.getByLabel('Course name').fill(COURSE_NAME)
    await expect(dialog.getByLabel('Course name')).toHaveValue(COURSE_NAME)
    await shot(2, 3)
  })

  await test.step('2.4 Type 2026-fall in Term.', async () => {
    await dialog.getByLabel('Term').fill(TERM)
    await expect(dialog.getByLabel('Term')).toHaveValue(TERM)
    await shot(2, 4)
  })

  await test.step('2.5 Click Create course.', async () => {
    await dialog.getByRole('button', { name: 'Create course' }).click()
    await expect(page.getByText(`${COURSE_NAME} is ready.`)).toBeVisible()
    await page.waitForURL(/\/courses\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { level: 1, name: COURSE_NAME })).toBeVisible()
    await shot(2, 5)
  })

  await test.step('2.6 Read the line under the heading Guide course 2026.', async () => {
    await expect(page.getByText(`Term ${TERM}`)).toBeVisible()
    await shot(2, 6)
  })

  await test.step('2.7 Read the row of tabs under the heading.', async () => {
    for (const view of ['Sections', 'Assignments', 'Policy', 'Mapping']) {
      await expect(courseViews(page).getByRole('link', { name: view, exact: true })).toBeVisible()
    }
    await shot(2, 7)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 3
// ---------------------------------------------------------------------------------------------

test('Task 3: Add a section and its students', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'instructor')

  const addForm = page.locator('#roster-add')
  const email = addForm.getByLabel('Email address')
  const role = page.locator('#roster-add-role')
  const addToSection = addForm.getByRole('button', { name: 'Add to section' })

  await test.step('3.1 Click Courses in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: COURSE_NAME })).toBeVisible()
    await shot(3, 1)
  })

  await test.step('3.2 Click Guide course 2026 on its row.', async () => {
    await openGuideCourse(page)
    await expect(page.getByRole('heading', { level: 2, name: 'Sections' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'No sections yet' })).toBeVisible()
    await shot(3, 2)
  })

  const dialog = await test.step('3.3 Click New section.', async () => {
    const opened = await openDialog(page, 'New section', 'New section')
    await expect(
      opened.getByText(
        'Sections divide one course into rosters. An assignment is configured on a section.',
      ),
    ).toBeVisible()
    await shot(3, 3)
    return opened
  })

  await test.step('3.4 Type Guide section in Section name.', async () => {
    await dialog.getByLabel('Section name').fill(SECTION_NAME)
    await expect(dialog.getByLabel('Section name')).toHaveValue(SECTION_NAME)
    await shot(3, 4)
  })

  await test.step('3.5 Click Add section.', async () => {
    await dialog.getByRole('button', { name: 'Add section' }).click()
    await expect(page.getByText(`Section ${SECTION_NAME} added.`)).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: SECTION_NAME })).toBeVisible()
    await shot(3, 5)
  })

  await test.step('3.6 Click Roster on the Guide section row.', async () => {
    await page.getByRole('link', { name: `Open the roster for ${SECTION_NAME}` }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Section roster' })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 3, name: 'Nobody is in this section yet' }),
    ).toBeVisible()
    await shot(3, 6)
  })

  await test.step('3.7 Type student2@tassl.local in Email address under Add member.', async () => {
    await email.fill(seatEmail('student2'))
    await expect(email).toHaveValue(seatEmail('student2'))
    await expect(role).toContainText('Student')
    await shot(3, 7)
  })

  await test.step('3.8 Click Add to section.', async () => {
    await addToSection.click()
    await expect(page.getByText(`${seatEmail('student2')} is now in this section.`)).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'Student Two' })
    await expect(row).toBeVisible()
    await expect(row.getByRole('cell').nth(2)).toHaveText('Student')
    await shot(3, 8)
  })

  await test.step('3.9 Type student1@tassl.local in Email address.', async () => {
    await email.fill(seatEmail('student1'))
    await expect(email).toHaveValue(seatEmail('student1'))
    await shot(3, 9)
  })

  await test.step('3.10 Click Add to section.', async () => {
    await addToSection.click()
    await expect(page.getByText(`${seatEmail('student1')} is now in this section.`)).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Student One' })).toBeVisible()
    await shot(3, 10)
  })

  await test.step('3.11 Type instructor@tassl.local in Email address.', async () => {
    await email.fill(INSTRUCTOR_EMAIL)
    await expect(email).toHaveValue(INSTRUCTOR_EMAIL)
    await shot(3, 11)
  })

  await test.step('3.12 Choose Instructor in Role in this section.', async () => {
    await role.click()
    await page.getByRole('option', { name: 'Instructor', exact: true }).click()
    await expect(role).toContainText('Instructor')
    await shot(3, 12)
  })

  await test.step('3.13 Click Add to section.', async () => {
    await addToSection.click()
    await expect(page.getByText(`${INSTRUCTOR_EMAIL} is now in this section.`)).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'Instructor Seat' })
    await expect(row).toBeVisible()
    await expect(row.getByRole('cell').nth(2)).toHaveText('Instructor')
    await shot(3, 13)
  })

  await test.step('3.14 Click Back to the course.', async () => {
    await page.getByRole('link', { name: 'Back to the course' }).click()
    await expect(page.getByRole('heading', { level: 1, name: COURSE_NAME })).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: SECTION_NAME })
    await expect(row.getByRole('cell').nth(1)).toHaveText('3')
    await shot(3, 14)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 4
// ---------------------------------------------------------------------------------------------

test('Task 4: Set the course policy and the grade mapping', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'instructor')

  await test.step('4.1 Click Courses in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: COURSE_NAME })).toBeVisible()
    await shot(4, 1)
  })

  await test.step('4.2 Click Guide course 2026.', async () => {
    await openGuideCourse(page)
    for (const view of ['Sections', 'Assignments', 'Policy', 'Mapping']) {
      await expect(courseViews(page).getByRole('link', { name: view, exact: true })).toBeVisible()
    }
    await shot(4, 2)
  })

  await test.step('4.3 Click the Policy tab.', async () => {
    await courseViews(page).getByRole('link', { name: 'Policy', exact: true }).click()
    await page.waitForURL(/\?tab=policy$/)
    await expect(page.getByRole('heading', { level: 2, name: 'Policy and weight' })).toBeVisible()
    await expect(page.getByRole('group', { name: 'Outside-AI policy' })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Declared' })).toBeChecked()
    await shot(4, 3)
  })

  await test.step('4.4 Choose In-Environment Only.', async () => {
    await page.getByRole('radio', { name: 'In-Environment Only' }).check()
    await expect(page.getByRole('radio', { name: 'In-Environment Only' })).toBeChecked()
    await expect(
      page.getByText(
        'The course asks students to work only with the assistant inside Tassl. A declaration of outside use is still recorded and shown to you, with no scoring effect; what follows is your call.',
      ),
    ).toBeVisible()
    await shot(4, 4)
  })

  await test.step('4.5 Type 3 in Default run weight.', async () => {
    await page.getByLabel('Default run weight').fill('3')
    await expect(page.getByLabel('Default run weight')).toHaveValue('3')
    await shot(4, 5)
  })

  await test.step('4.6 Type payback period in Taught concepts.', async () => {
    await page.getByLabel('Taught concepts').fill('payback period')
    await expect(page.getByLabel('Taught concepts')).toHaveValue('payback period')
    await shot(4, 6)
  })

  await test.step('4.7 Click Save policy.', async () => {
    await page.getByRole('button', { name: 'Save policy' }).click()
    await expect(page.getByText('Policy saved.')).toBeVisible()
    await shot(4, 7)
  })

  await test.step('4.8 Click the Mapping tab under the course heading.', async () => {
    await courseViews(page).getByRole('link', { name: 'Mapping', exact: true }).click()
    await page.waitForURL(/\?tab=mapping$/)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Band-to-points mapping' }),
    ).toBeVisible()
    for (const band of ['Novice', 'Developing', 'Proficient', 'Professional']) {
      await expect(page.getByLabel(band, { exact: true })).toBeVisible()
    }
    await shot(4, 8)
  })

  await test.step('4.9 Type 5 in Professional.', async () => {
    await page.getByLabel('Professional', { exact: true }).fill('5')
    await expect(page.getByLabel('Professional', { exact: true })).toHaveValue('5')
    await shot(4, 9)
  })

  await test.step('4.10 Click Preview changes.', async () => {
    await page.getByRole('button', { name: 'Preview changes' }).click()
    await expect(page.getByRole('heading', { name: 'What would change' })).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(
      page.getByText(
        'No run in this course is confirmed yet, so nothing is re-exported. Applying sets the mapping for the runs that follow.',
      ),
    ).toBeVisible()
    await shot(4, 10)
  })

  await test.step('4.11 Tick I understand every confirmed run will be re-exported.', async () => {
    const acknowledge = page.getByRole('checkbox', {
      name: 'I understand every confirmed run will be re-exported.',
    })
    await acknowledge.check()
    await expect(acknowledge).toBeChecked()
    await expect(page.getByRole('button', { name: 'Apply the new mapping' })).toBeVisible()
    await shot(4, 11)
  })

  await test.step('4.12 Click Apply the new mapping.', async () => {
    await page.getByRole('button', { name: 'Apply the new mapping' }).click()
    await expect(page.getByText('The mapping is saved. 0 runs were re-exported.')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await shot(4, 12)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 5
// ---------------------------------------------------------------------------------------------

test('Task 5: Read a scenario package', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'instructor')

  await test.step('5.1 Click Packages in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Packages', exact: true }).click()
    const row = page.getByRole('row').filter({ hasText: 'Meridian Roast (fixture)' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Confirmed')
    await expect(row).toContainText('Uncalibrated')
    await shot(5, 1)
  })

  await test.step('5.2 Click Meridian Roast (fixture) on its row.', async () => {
    await page.getByRole('link', { name: 'Open Meridian Roast (fixture), version 1' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'Meridian Roast (fixture)' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'This version' })).toBeVisible()
    await shot(5, 2)
  })

  await test.step('5.3 Read This version.', async () => {
    const identity = page.locator('#version-identity')
    await expect(identity).toContainText('Status')
    await expect(identity).toContainText('Confirmed')
    await expect(identity).toContainText('Working clock')
    await expect(identity).toContainText('25 min')
    await expect(identity).toContainText('Turn delay')
    await expect(identity).toContainText('1 min 30 s')
    await shot(5, 3)
  })

  await test.step('5.4 Read Confirmation record.', async () => {
    const record = page.locator('#confirmation-record')
    await expect(record.getByText('Decisions by element type')).toBeVisible()
    for (const column of ['Element type', 'Decisions', 'By', 'Latest decision']) {
      await expect(record.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }
    await shot(5, 4, record.getByRole('columnheader', { name: 'Latest decision', exact: true }))
  })

  await test.step('5.5 Read Authoring record.', async () => {
    const record = page.locator('#authoring-record')
    await expect(record.getByText('Generating model')).toBeVisible()
    await expect(record.getByRole('heading', { name: 'The seed case' })).toBeVisible()
    await expect(record.getByRole('heading', { name: 'Re-skin log' })).toBeVisible()
    await shot(5, 5, record.getByRole('heading', { name: 'Re-skin log' }))
  })

  await test.step('5.6 Read Authoring measures.', async () => {
    const measures = page.locator('#authoring-measures')
    for (const measure of [
      'Seed to confirmed',
      'Edit rate',
      'Rejected share',
      'Generation passes',
      'Review time per element',
    ]) {
      await expect(measures.getByText(measure, { exact: true })).toBeVisible()
    }
    await shot(5, 6, measures.getByText('Review time per element', { exact: true }))
  })

  await test.step('5.7 Read Claims.', async () => {
    const claims = page.locator('#claims')
    await expect(claims.getByText('Claims and their per-variant states')).toBeVisible()
    await expect(claims.getByRole('columnheader', { name: 'Defective variant' })).toBeVisible()
    await expect(claims.getByRole('columnheader', { name: 'Sound variant' })).toBeVisible()
    await shot(5, 7, claims.getByRole('columnheader', { name: 'Sound variant' }))
  })

  await test.step('5.8 Click C3 in the Claims table.', async () => {
    await page.getByRole('link', { name: /^Open claim\s*C3\b/ }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Claim C3' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Where it comes from' })).toBeVisible()
    const deserved = page.getByRole('heading', { name: 'What it deserved, and why' })
    await expect(deserved).toBeVisible()
    await shot(5, 8, deserved)
  })

  await test.step('5.9 Click All claims at the top of the Claims panel.', async () => {
    await page.getByRole('link', { name: 'All claims' }).click()
    // The caption sits under the table, so scrolling to it puts the table's last rows in frame.
    const caption = page.getByText('Claims and their per-variant states')
    await expect(caption).toBeVisible()
    await shot(5, 9, caption)
  })

  await test.step('5.10 Click Export package JSON at the top right, beside the package title.', async () => {
    const exportLink = page.getByRole('link', { name: 'Export package JSON' })
    const [download] = await Promise.all([page.waitForEvent('download'), exportLink.click()])
    expect(download.suggestedFilename()).toBe('tassl-package-meridian-roast.json')
    // A download leaves the page as it was; the shot shows the link that started it.
    await expect(exportLink).toBeVisible()
    await shot(5, 10, exportLink)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 6
// ---------------------------------------------------------------------------------------------

test('Task 6: Create an assignment', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'instructor')

  await test.step('6.1 Click Courses in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: COURSE_NAME })).toBeVisible()
    await shot(6, 1)
  })

  await test.step('6.2 Click Guide course 2026.', async () => {
    await openGuideCourse(page)
    await shot(6, 2)
  })

  await test.step('6.3 Click the Assignments tab.', async () => {
    await courseViews(page).getByRole('link', { name: 'Assignments', exact: true }).click()
    await page.waitForURL(/\?tab=assignments$/)
    await expect(page.getByRole('heading', { level: 2, name: 'Assignments' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'No assignments yet' })).toBeVisible()
    await shot(6, 3)
  })

  const dialog = await test.step('6.4 Click New assignment.', async () => {
    const opened = await openDialog(page, 'New assignment', 'New assignment')
    // The dialog is taller than the viewport and scrolls inside itself, so every step of it
    // shoots the field it fills, and the last one the footer button the next step presses.
    const sectionLine = opened.getByText(
      `This assignment goes to ${SECTION_NAME}, the only section of this course.`,
    )
    await expect(sectionLine).toBeVisible()
    await shot(6, 4, sectionLine)
    return opened
  })

  await test.step('6.5 Type Guide run in Assignment name.', async () => {
    await dialog.getByLabel('Assignment name').fill(ASSIGNMENT_NAME)
    await expect(dialog.getByLabel('Assignment name')).toHaveValue(ASSIGNMENT_NAME)
    await shot(6, 5, dialog.getByLabel('Assignment name'))
  })

  await test.step('6.6 Choose Meridian Roast (fixture) · version 1 in Scenario package version.', async () => {
    const select = dialog.locator('#assignment-package')
    await select.click()
    await page.getByRole('option', { name: /^Meridian Roast \(fixture\) · version 1/ }).click()
    await expect(select).toContainText('Meridian Roast (fixture) · version 1')
    await expect(select).toContainText('Uncalibrated')
    await shot(6, 6, select)
  })

  await test.step('6.7 Choose Defective under Variant.', async () => {
    await dialog.getByRole('radio', { name: 'Defective' }).check()
    await expect(dialog.getByRole('radio', { name: 'Defective' })).toBeChecked()
    const variantLine = dialog.getByText(
      'The assistant states one consequential claim that does not hold up.',
    )
    await expect(variantLine).toBeVisible()
    await shot(6, 7, variantLine)
  })

  await test.step('6.8 Type 600 in Working clock (seconds).', async () => {
    await dialog.getByLabel('Working clock (seconds)').fill('600')
    await expect(dialog.getByLabel('Working clock (seconds)')).toHaveValue('600')
    const clockHint = dialog.getByText(
      'The package sets 1500 seconds. Leave this empty to follow it.',
    )
    await expect(clockHint).toBeVisible()
    await shot(6, 8, clockHint)
  })

  await test.step('6.9 Type 2 in Weight.', async () => {
    await dialog.getByLabel('Weight').fill('2')
    await expect(dialog.getByLabel('Weight')).toHaveValue('2')
    const weightHint = dialog.getByText('The course sets 3. Leave this empty to follow it.')
    await expect(weightHint).toBeVisible()
    await shot(6, 9, weightHint)
  })

  await test.step('6.10 Turn on the Walkthrough switch.', async () => {
    const walkthrough = dialog.getByRole('switch', { name: 'Walkthrough' })
    await walkthrough.click()
    await expect(walkthrough).toBeChecked()
    await expect(
      dialog.getByText(
        'A practice assignment. A run on it can be deleted; a run that counts is voided instead.',
      ),
    ).toBeVisible()
    const create = dialog.getByRole('button', { name: 'Create assignment' })
    await expect(create).toBeVisible()
    await shot(6, 10, create)
  })

  await test.step('6.11 Click Create assignment.', async () => {
    await dialog.getByRole('button', { name: 'Create assignment' }).click()
    await expect(page.getByText(`${ASSIGNMENT_NAME} is ready.`)).toBeVisible()
    await page.waitForURL(/\/assignments\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('heading', { level: 1, name: ASSIGNMENT_NAME })).toBeVisible()
    await expect(page.locator('[data-kind="walkthrough"]')).toHaveText('Walkthrough')
    await shot(6, 11)
  })

  await test.step('6.12 Read Configuration.', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Configuration' })).toBeVisible()
    await expect(page.getByText('What every run on this assignment is taken under.')).toBeVisible()
    const save = page.getByRole('button', { name: 'Save configuration' })
    await expect(save).toBeVisible()
    await shot(6, 12, save)
  })

  await test.step('6.13 Read Runs.', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Runs' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'No runs yet' })).toBeVisible()
    const emptyLine = page.getByText(
      'Once a student starts this assignment, their run appears here with its state and its replay.',
    )
    await expect(emptyLine).toBeVisible()
    await shot(6, 13, emptyLine)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 7
// ---------------------------------------------------------------------------------------------

test('Task 7: Follow your students’ runs', async ({ page, playwright, shot }) => {
  test.setTimeout(300_000)

  // The guide's precondition: Student Two has finished a run on Guide run and Tassl has scored it.
  await scoreGuideRun(playwright, 'student2')
  await signInAs(page, 'instructor')

  await test.step('7.1 Click Courses in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: COURSE_NAME })).toBeVisible()
    await shot(7, 1)
  })

  await test.step('7.2 Click Guide course 2026.', async () => {
    await openGuideCourse(page)
    await shot(7, 2)
  })

  await test.step('7.3 Click the Assignments tab.', async () => {
    await courseViews(page).getByRole('link', { name: 'Assignments', exact: true }).click()
    await page.waitForURL(/\?tab=assignments$/)
    const row = page.getByRole('row').filter({ hasText: ASSIGNMENT_NAME })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Decision run')
    await expect(row).toContainText('Open now')
    await shot(7, 3)
  })

  await test.step('7.4 Click Guide run on its row.', async () => {
    await page.getByRole('link', { name: `Configure ${ASSIGNMENT_NAME}` }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Runs' })).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'Student Two' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Scored')
    await expect(row).toContainText('0 of 7')
    await expect(row).toContainText('None yet')
    await shot(7, 4, row)
  })

  await test.step('7.5 Click Review in the rail on the left.', async () => {
    await rail(page).getByRole('link', { name: 'Review', exact: true }).click()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Runs waiting for you' }),
    ).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'Student Two' })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Scored')
    await expect(row).toContainText('0 of 7')
    await expect(row.getByRole('link', { name: 'Open the replay for Student Two' })).toBeVisible()
    await shot(7, 5, row)
  })

  await test.step('7.6 Read the note under the Runs waiting for you table.', async () => {
    const note = page.getByText(
      'Which variant a student drew is on the replay rather than in this list, so this screen can be shown to a room.',
    )
    await expect(note).toBeVisible()
    await shot(7, 6, note)
  })

  await test.step('7.7 Click Home in the rail on the left.', async () => {
    await rail(page).getByRole('link', { name: 'Home', exact: true }).click()
    const review = page.locator('#home-review')
    await expect(review).toContainText('Student Two')
    await expect(review).toContainText('0 of 7 decided')
    await expect(
      review.getByRole('link', { name: 'Open the replay for Student Two' }),
    ).toBeVisible()
    await shot(7, 7)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 8
// ---------------------------------------------------------------------------------------------

test('Task 8: Review a scored run', async ({ page, shot }) => {
  test.setTimeout(600_000)
  await signInAs(page, 'instructor')

  /** One dimension's card on the Bands view; every control on it is scoped through this. */
  const card = (dimension: string): Locator => page.locator(`#band-${dimension}`)
  let overrideTo = 'professional'

  await test.step('8.1 Click Review in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Review', exact: true }).click()
    const open = page.getByRole('link', { name: 'Open the replay for Student Two' })
    await expect(open).toBeVisible()
    await shot(8, 1, open)
  })

  await test.step('8.2 Click Open the replay for Student Two.', async () => {
    await page.getByRole('link', { name: 'Open the replay for Student Two' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Student Two' })).toBeVisible()
    await expect(page.getByText('Attempt 1 · Defective variant')).toBeVisible()
    for (const view of ['Overview', 'Bands', 'Trace', 'Package', 'Actions']) {
      await expect(replayViews(page).getByRole('link', { name: view, exact: true })).toBeVisible()
    }
    // The graphs arrive in a later chunk; the shot waits for the first one to have rendered so
    // the panel in frame is the drawn graph and not its loading state.
    await expect(page.getByRole('button', { name: 'Show data table' }).first()).toBeVisible({
      timeout: GRAPH_TIMEOUT_MS,
    })
    await shot(8, 2)
  })

  await test.step('8.3 Read The four graphs.', async () => {
    for (const title of [
      'Confidence line',
      'Clock timeline',
      'Stance matrix',
      'Frame beside decision',
    ]) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible({
        timeout: GRAPH_TIMEOUT_MS,
      })
    }
    await shot(8, 3, page.getByRole('heading', { name: 'Frame beside decision' }))
  })

  await test.step('8.4 Click the first Show data table.', async () => {
    await page.getByRole('button', { name: 'Show data table' }).first().click()
    await expect(page.getByRole('button', { name: 'Show graph' })).toBeVisible()
    await shot(8, 4)
  })

  await test.step('8.5 Read Defense transcript.', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Defense transcript' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3, name: 'Question 1' })).toBeVisible()
    const notes = page.locator('#replay-defense').getByText('Expected-answer notes').first()
    await expect(notes).toBeVisible()
    await shot(8, 5, notes)
  })

  await test.step('8.6 Read Delegation log.', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Delegation log' })).toBeVisible()
    const description = page.getByText(
      'Every request the student made of the assistant, and what came back.',
    )
    await expect(description).toBeVisible()
    await shot(8, 6, description)
  })

  await test.step('8.7 Read Readiness Check.', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Readiness Check' })).toBeVisible()
    const description = page.getByText('The concept map the Readiness Check closed with.')
    await expect(description).toBeVisible()
    await shot(8, 7, description)
  })

  await test.step('8.8 Click Trace in the row of views under the student’s name.', async () => {
    await replayViews(page).getByRole('link', { name: 'Trace', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'The run’s trace' })).toBeVisible()
    for (const column of ['No.', 'Clock left', 'Event', 'What it says', 'Record']) {
      await expect(page.getByRole('columnheader', { name: column, exact: true })).toBeVisible()
    }
    await shot(8, 8)
  })

  await test.step('8.9 Click Bands.', async () => {
    await replayViews(page).getByRole('link', { name: 'Bands', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'The seven bands' })).toBeVisible()
    await expect(page.getByText('0 of 7 decided')).toBeVisible()
    await shot(8, 9)
  })

  await test.step('8.10 On Framing, the first of the seven cards, click the button under its note field that begins Confirm the draft.', async () => {
    await card('framing')
      .getByRole('button', { name: /^Confirm the draft: / })
      .click()
    await expect(page.getByText('The decision is on the record.')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    // The counter re-renders with the page after the action; it is what proves the decision took.
    const counter = page.getByText('1 of 7 decided')
    await expect(counter).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await shot(8, 10, counter)
  })

  await test.step('8.11 On Verification, choose Professional (or Proficient when the draft is already Professional).', async () => {
    // Which of the two depends on the draft, which the screen shows and the API states; the API
    // is read so the choice is not parsed out of a sentence.
    const replay = await readJson<ReplayView>(
      page.request,
      `/api/v1/review/runs/${runIdFromUrl(page.url())}`,
    )
    const draft = replay.bands.find((band) => band.dimension === 'verification')?.band
    overrideTo = draft === 'professional' ? 'proficient' : 'professional'
    const label = BAND_LABELS[overrideTo] ?? overrideTo
    await card('verification').getByRole('radio', { name: label }).check()
    await expect(
      card('verification').getByRole('button', { name: `Record ${label} instead` }),
    ).toBeVisible()
    await shot(8, 11)
  })

  await test.step('8.12 Type Guide note. Check the memo date. in Note for the student (optional) on Verification.', async () => {
    const note = card('verification').getByLabel('Note for the student (optional)')
    await note.fill(OVERRIDE_NOTE)
    await expect(note).toHaveValue(OVERRIDE_NOTE)
    await shot(8, 12)
  })

  await test.step('8.13 Click Record Professional instead (or Record Proficient instead).', async () => {
    const label = BAND_LABELS[overrideTo] ?? overrideTo
    await card('verification')
      .getByRole('button', { name: `Record ${label} instead` })
      .click()
    const counter = page.getByText('2 of 7 decided')
    await expect(counter).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await expect(
      card('verification').getByText(`Note to the student: ${OVERRIDE_NOTE}`),
    ).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await shot(8, 13, counter)
  })

  const remaining = page.getByRole('alertdialog')

  await test.step('8.14 Click Confirm the remaining drafts.', async () => {
    await page.getByRole('button', { name: 'Confirm the remaining drafts' }).click()
    await expect(
      remaining.getByRole('heading', { name: 'Confirm the remaining drafts?' }),
    ).toBeVisible()
    await expect(
      remaining.getByText('Confirming these writes course export version 1.'),
    ).toBeVisible()
    await shot(8, 14)
  })

  await test.step('8.15 Click Put the remaining drafts on the record.', async () => {
    await remaining.getByRole('button', { name: 'Put the remaining drafts on the record' }).click()
    await expect(page.getByText('7 of 7 decided')).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    // The run's own chip in the header, not a band card's: the run is confirmed as a whole.
    await expect(page.locator('span[data-state="confirmed"]')).toHaveText('Confirmed', {
      timeout: ACTION_TIMEOUT_MS,
    })
    await shot(8, 15)
  })

  await test.step('8.16 Read Points under this course’s mapping, below the seven cards.', async () => {
    const points = page.locator('#replay-points')
    await expect(points.getByText('From the seven bands on the record')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(points.getByText('Total over the assessed dimensions (7)')).toBeVisible()
    const gradebookLine = points.getByText(
      'Enter the bands, the mapping and the points in the gradebook of record. Tassl holds no grade.',
    )
    await expect(gradebookLine).toBeVisible()
    await shot(8, 16, gradebookLine)
  })

  await test.step('8.17 Read Course exports on the same view.', async () => {
    const exports = page.locator('#replay-exports')
    await expect(exports.getByText('The bands were confirmed')).toBeVisible()
    const download = exports.getByRole('link', { name: 'Download version 1' })
    await expect(download).toBeVisible()
    await shot(8, 17, download)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 9
// ---------------------------------------------------------------------------------------------

test('Task 9: Correct a claim, arm the outage control, and void a run', async ({
  page,
  playwright,
  shot,
}) => {
  test.setTimeout(600_000)

  // The guide's second precondition: Student One's run on Guide run, scored, which this task voids.
  await scoreGuideRun(playwright, 'student1')
  await signInAs(page, 'instructor')

  await test.step('9.1 Click Courses in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: COURSE_NAME })).toBeVisible()
    await shot(9, 1)
  })

  await test.step('9.2 Click Guide course 2026.', async () => {
    await openGuideCourse(page)
    await shot(9, 2)
  })

  await test.step('9.3 Click the Assignments tab.', async () => {
    await courseViews(page).getByRole('link', { name: 'Assignments', exact: true }).click()
    await page.waitForURL(/\?tab=assignments$/)
    await expect(page.getByRole('row').filter({ hasText: ASSIGNMENT_NAME })).toBeVisible()
    await shot(9, 3)
  })

  await test.step('9.4 Click Guide run.', async () => {
    await page.getByRole('link', { name: `Configure ${ASSIGNMENT_NAME}` }).click()
    await expect(page.getByRole('heading', { level: 1, name: ASSIGNMENT_NAME })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Runs' })).toBeVisible()
    const row = page.getByRole('row').filter({ hasText: 'Student Two' })
    await expect(row).toBeVisible()
    await expect(row.getByRole('link', { name: 'Open the replay for Student Two' })).toHaveText(
      'Open the replay',
    )
    await shot(9, 4, row)
  })

  await test.step('9.5 Click Open the replay on the Student Two row.', async () => {
    await page.getByRole('link', { name: 'Open the replay for Student Two' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Student Two' })).toBeVisible()
    await shot(9, 5)
  })

  await test.step('9.6 Click Actions.', async () => {
    await replayViews(page).getByRole('link', { name: 'Actions', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Corrections' })).toBeVisible()
    await expect(page.getByText('No correction has been entered on this run.')).toBeVisible()
    await shot(9, 6)
  })

  const correction = page.getByRole('dialog')

  await test.step('9.7 Click Enter a correction on C3…, under C3 in the Claims list.', async () => {
    await page.getByRole('button', { name: 'Enter a correction on C3…' }).click()
    await expect(
      correction.getByRole('heading', { name: 'Enter a correction on claim C3?' }),
    ).toBeVisible()
    await expect(correction.getByText('What went wrong?')).toBeVisible()
    await expect(
      correction.getByRole('radio', { name: 'The claim carried a defect nobody placed' }),
    ).toBeChecked()
    await shot(9, 7)
  })

  await test.step('9.8 Tick Credit the student’s challenge as correct.', async () => {
    const credit = correction.getByRole('checkbox', {
      name: 'Credit the student’s challenge as correct',
    })
    await credit.check()
    await expect(credit).toBeChecked()
    await shot(9, 8)
  })

  await test.step('9.9 Click Enter the correction.', async () => {
    await correction.getByRole('button', { name: 'Enter the correction' }).click()
    await expect(
      correction.getByRole('heading', { name: 'What the correction moved' }),
    ).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await expect(
      correction.getByText('A correction can raise a band and never lowers one.'),
    ).toBeVisible()
    await expect(correction.getByText('Export version 2 was written.')).toBeVisible()
    await shot(9, 9)
  })

  await test.step('9.10 Click Close.', async () => {
    // `.first()`: the dialog primitive draws its own icon-only close beside the footer's (D-316).
    await correction.getByRole('button', { name: 'Close' }).first().click()
    const corrections = page.getByRole('heading', { name: 'Corrections on this run' })
    await expect(corrections).toBeVisible()
    await expect(page.getByText('The student’s challenge was credited.')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(page.getByRole('link', { name: 'C3', exact: true })).toBeVisible()
    await shot(9, 10, corrections)
  })

  await test.step('9.11 Read Test controls.', async () => {
    await expect(page.getByRole('heading', { level: 2, name: 'Test controls' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Arm one assistant outage' })).toBeVisible()
    const purpose = page.getByText(
      'It exists for step 7 of the walkthrough, where the run has to meet an outage the student did not ask for and carry on without the assistant.',
    )
    await expect(purpose).toBeVisible()
    await shot(9, 11, purpose)
  })

  await test.step('9.12 Read the button Arm the outage and the line under it.', async () => {
    await expect(page.getByRole('button', { name: 'Arm the outage' })).toBeVisible()
    const stateLine = page.getByText(
      'This run is not in a state that can take an outage. One can be armed while the student is working, answering the Turn, or paused.',
    )
    await expect(stateLine).toBeVisible()
    await shot(9, 12, stateLine)
  })

  await test.step('9.13 Click Review in the rail on the left.', async () => {
    await rail(page).getByRole('link', { name: 'Review', exact: true }).click()
    const open = page.getByRole('link', { name: 'Open the replay for Student One' })
    await expect(open).toBeVisible()
    await shot(9, 13, open)
  })

  await test.step('9.14 Click Open the replay for Student One.', async () => {
    await page.getByRole('link', { name: 'Open the replay for Student One' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Student One' })).toBeVisible()
    await shot(9, 14)
  })

  await test.step('9.15 Click Actions.', async () => {
    await replayViews(page).getByRole('link', { name: 'Actions', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Void this run' })).toBeVisible()
    const voidLine = page.getByText(
      'A voided run carries no partial result, and no export written afterwards names it. Offer another run in its place when the student should still take one.',
    )
    await expect(voidLine).toBeVisible()
    await shot(9, 15, voidLine)
  })

  const voidDialog = page.getByRole('dialog')

  await test.step('9.16 Click Void this run….', async () => {
    await page.getByRole('button', { name: 'Void this run…' }).click()
    await expect(voidDialog.getByRole('heading', { name: 'Void this run?' })).toBeVisible()
    await expect(voidDialog.getByText('Why is the run being voided?')).toBeVisible()
    await shot(9, 16)
  })

  await test.step('9.17 Choose It was a walkthrough run.', async () => {
    const reason = voidDialog.getByRole('radio', { name: 'It was a walkthrough run' })
    await reason.check()
    await expect(reason).toBeChecked()
    await shot(9, 17)
  })

  await test.step('9.18 Tick Offer the student another run.', async () => {
    const reoffer = voidDialog.getByRole('checkbox', { name: 'Offer the student another run' })
    await reoffer.check()
    await expect(reoffer).toBeChecked()
    const variant = voidDialog.getByLabel('Variant for the new run')
    await expect(variant).toBeVisible()
    await expect(variant.locator('option:checked')).toHaveText('The other variant')
    await shot(9, 18)
  })

  await test.step('9.19 Click Void the run.', async () => {
    await voidDialog.getByRole('button', { name: 'Void the run' }).click()
    await expect(page.getByText('The run is voided and another has been offered.')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(
      page.getByText(
        'This run is voided. It carries no partial result, and no export written afterwards names it.',
      ),
    ).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    await shot(9, 19)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 10
// ---------------------------------------------------------------------------------------------

test('Task 10: Export results to the gradebook', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'instructor')

  await test.step('10.1 Click Courses in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Courses', exact: true }).click()
    await expect(page.getByRole('row').filter({ hasText: COURSE_NAME })).toBeVisible()
    await shot(10, 1)
  })

  await test.step('10.2 Click Guide course 2026.', async () => {
    await openGuideCourse(page)
    await shot(10, 2)
  })

  await test.step('10.3 Click the Assignments tab.', async () => {
    await courseViews(page).getByRole('link', { name: 'Assignments', exact: true }).click()
    await page.waitForURL(/\?tab=assignments$/)
    await expect(page.getByRole('row').filter({ hasText: ASSIGNMENT_NAME })).toBeVisible()
    await shot(10, 3)
  })

  await test.step('10.4 Click Guide run.', async () => {
    await page.getByRole('link', { name: `Configure ${ASSIGNMENT_NAME}` }).click()
    await expect(page.getByRole('heading', { level: 1, name: ASSIGNMENT_NAME })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Course exports' })).toBeVisible()
    await shot(10, 4)
  })

  await test.step('10.5 Click Course exports.', async () => {
    await page.getByRole('link', { name: 'Course exports' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Course exports' })).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Every version written' }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'Enter bands, mapping, and points in the gradebook of record; Tassl holds no grade.',
      ),
    ).toBeVisible()
    await shot(10, 5)
  })

  await test.step('10.6 Read the Every version written table.', async () => {
    const table = page.locator('#assignment-exports')
    // The header reads exactly "Student" (QA-030 retired "Student seat"); `exact` so a longer
    // header does not pass as a substring.
    const studentColumn = table.getByRole('columnheader', { name: 'Student', exact: true })
    await expect(studentColumn).toBeVisible()
    await expect(studentColumn).toHaveText('Student')
    const corrected = table.getByRole('row').filter({ hasText: 'A correction was entered' })
    await expect(corrected).toContainText('Student Two')
    await expect(corrected.getByRole('cell').nth(1)).toHaveText('2')
    const confirmed = table.getByRole('row').filter({ hasText: 'The bands were confirmed' })
    await expect(confirmed).toContainText('Student Two')
    await expect(confirmed.getByRole('cell').nth(1)).toHaveText('1')
    await shot(10, 6)
  })

  await test.step('10.7 Click Download version 2.', async () => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Download version 2' }).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/^tassl-course-export-.+-v2\.json$/)
    // A download leaves the page as it was; the shot shows the table the link sits in.
    await expect(page.locator('#assignment-exports')).toBeVisible()
    await shot(10, 7)
  })

  await test.step('10.8 Click Back to the assignment.', async () => {
    await page.getByRole('link', { name: 'Back to the assignment' }).click()
    await expect(page.getByRole('heading', { level: 1, name: ASSIGNMENT_NAME })).toBeVisible()
    await shot(10, 8)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 11
// ---------------------------------------------------------------------------------------------

test('Task 11: Author a new scenario package from a seed case', async ({ page, shot }) => {
  test.setTimeout(600_000)
  await signInAs(page, 'instructor')

  const tree = page.getByRole('tree', { name: 'Elements of this version' })
  const progress = page.locator('[data-slot="progress-value"]')
  const editor = page.locator('#element-editor')
  /** A row is named by what it says and its decision, so the key is matched as a word inside. */
  const treeItem = (key: string): Locator =>
    tree.getByRole('treeitem', { name: new RegExp(`\\b${key}\\b`) }).first()

  await test.step('11.1 Click Packages in the rail.', async () => {
    await rail(page).getByRole('link', { name: 'Packages', exact: true }).click()
    await expect(page.getByRole('link', { name: 'New package from a seed case' })).toBeVisible()
    await shot(11, 1)
  })

  await test.step('11.2 Click New package from a seed case.', async () => {
    await page.getByRole('link', { name: 'New package from a seed case' }).click()
    await expect(
      page.getByRole('heading', { level: 1, name: 'New package from a seed case' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'The package' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'The seed case' })).toBeVisible()
    await shot(11, 2)
  })

  await test.step('11.3 Type Guide package 2026 in Title.', async () => {
    await page.getByLabel('Title', { exact: true }).fill(PACKAGE_TITLE)
    await expect(page.getByLabel('Family key')).toHaveValue('guide-package-2026')
    await shot(11, 3)
  })

  await test.step('11.4 Type payback, retention, acquisition, pricing in Concepts.', async () => {
    await page.getByLabel('Concepts').fill('payback, retention, acquisition, pricing')
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible()
    await shot(11, 4)
  })

  await test.step('11.5 Click Add.', async () => {
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('4 added. Four is the minimum.')).toBeVisible()
    await shot(11, 5)
  })

  await test.step('11.6 Type Guide seed case in Case title.', async () => {
    await page.getByLabel('Case title').fill('Guide seed case')
    await expect(page.getByLabel('Case title')).toHaveValue('Guide seed case')
    await shot(11, 6)
  })

  await test.step('11.7 Type Guide Press in Publisher.', async () => {
    await page.getByLabel('Publisher').fill('Guide Press')
    await expect(page.getByLabel('Publisher')).toHaveValue('Guide Press')
    await shot(11, 7)
  })

  await test.step('11.8 Type Guide license terms permit adaptation. in License terms.', async () => {
    await page.getByLabel('License terms').fill('Guide license terms permit adaptation.')
    await expect(page.getByLabel('License terms')).toHaveValue(
      'Guide license terms permit adaptation.',
    )
    await shot(11, 8)
  })

  await test.step('11.9 Tick The license permits adaptation.', async () => {
    const license = page.getByRole('checkbox', { name: 'The license permits adaptation' })
    await license.check()
    await expect(license).toBeChecked()
    await expect(
      page.getByText(
        'Tassl records this confirmation against your name and keeps it in the seed record. It will not build a package from a case without it.',
      ),
    ).toBeVisible()
    await shot(11, 9)
  })

  await test.step('11.10 Type Guide seed case text for the walkthrough. five times in Seed case text.', async () => {
    await page.getByLabel('Seed case text').fill(Array(5).fill(SEED_SENTENCE).join(' '))
    const counter = page.getByText(/ of 200,000 characters$/)
    await expect(counter).toBeVisible()
    await shot(11, 10, counter)
  })

  await test.step('11.11 Click Create and generate.', async () => {
    await page.getByRole('button', { name: 'Create and generate' }).click()
    await page.waitForURL(/\/packages\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/generation$/, {
      timeout: 60_000,
    })
    await expect(page.getByRole('heading', { level: 1, name: PACKAGE_TITLE })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'The seven steps' })).toBeVisible()
    await shot(11, 11)
  })

  await test.step('11.12 Wait for every row of The seven steps to finish.', async () => {
    await expect(
      page.getByRole('heading', { level: 2, name: 'Every package rule is met' }),
    ).toBeVisible({ timeout: GENERATION_TIMEOUT_MS })
    const steps = page.getByRole('list', { name: 'The seven steps' })
    await expect(steps.getByText('Done', { exact: true })).toHaveCount(7)
    await expect(page.getByRole('link', { name: 'Open confirmation workspace' })).toBeVisible()
    // The seventh row is the lowest thing the step names; with it in frame the rows above are too.
    await shot(11, 12, steps.getByText('Done', { exact: true }).last())
  })

  await test.step('11.13 Click Open confirmation workspace.', async () => {
    await page.getByRole('link', { name: 'Open confirmation workspace' }).click()
    await page.waitForURL(/\/confirm$/)
    await expect(
      page.getByRole('heading', { level: 2, name: 'Confirming version 1' }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Elements' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Brief' })).toBeVisible()
    await shot(11, 13)
  })

  await test.step('11.14 Open Documents in Elements and click D1.', async () => {
    const documents = tree.getByRole('treeitem', { name: /^Documents/ })
    await expect(documents).toBeVisible()
    if ((await documents.getAttribute('aria-expanded')) === 'false') await documents.click()
    await treeItem('D1').click()
    await expect(page.getByRole('heading', { level: 2, name: 'Document · D1' })).toBeVisible()
    await shot(11, 14)
  })

  await test.step('11.15 Click Reject.', async () => {
    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    // The panel is named after the editor's heading; its name is what a screen reader announces
    // and nothing a sighted reader sees, so the guide names the sentence and the field instead.
    const panel = page.getByRole('group', { name: 'Reject Document · D1' })
    await expect(panel).toBeVisible()
    await expect(
      panel.getByText(
        'Say what is wrong with it. The note is kept with the decision, and the element stays in the version until it is re-authored.',
      ),
    ).toBeVisible()
    const note = panel.getByLabel('Why this element is rejected')
    await expect(note).toBeVisible()
    await shot(11, 15, note)
  })

  await test.step('11.16 Type Guide rejection. The dateline reads as an internal memo. in Why this element is rejected.', async () => {
    const note = page.getByLabel('Why this element is rejected')
    await note.fill(REJECTION_NOTE)
    await expect(note).toHaveValue(REJECTION_NOTE)
    await shot(11, 16, note)
  })

  await test.step('11.17 Click Reject element.', async () => {
    await page.getByRole('button', { name: 'Reject element' }).click()
    await expect(page.getByText('D1 rejected.')).toBeVisible()
    const progress = page.locator('#confirm-progress')
    await expect(progress).toContainText('1 rejected')
    await shot(11, 17, progress.getByText(/1 rejected/))
  })

  await test.step('11.18 Click D1 in Elements again.', async () => {
    await treeItem('D1').click()
    const rejected = page.getByText('Rejected, and waiting to be re-authored')
    await expect(rejected).toBeVisible()
    await shot(11, 18, rejected)
  })

  await test.step('11.19 Click Rewrite.', async () => {
    await page.getByRole('button', { name: 'Rewrite', exact: true }).click()
    // Named the same way as the reject panel: the group's name is for a screen reader, and the
    // guide names the sentence and the button a sighted reader sees.
    const panel = page.getByRole('group', { name: 'Rewrite Document · D1' })
    await expect(panel).toBeVisible()
    await expect(
      panel.getByText(
        'A new draft is written for every document in this version, this one included.',
      ),
    ).toBeVisible()
    const rewrite = panel.getByRole('button', { name: 'Rewrite every document in this version' })
    await expect(rewrite).toBeVisible()
    await shot(11, 19, rewrite)
  })

  await test.step('11.20 Click Rewrite every document in this version.', async () => {
    await page.getByRole('button', { name: 'Rewrite every document in this version' }).click()
    await expect(page.getByText('A new draft of D1 was asked for.')).toBeVisible()
    const progress = page.locator('#confirm-progress')
    await expect(progress).toContainText('Writing a new draft')
    await shot(11, 20, progress.getByText('Writing a new draft'))
  })

  await test.step('11.21 Wait for Writing a new draft to finish.', async () => {
    await expect(page.getByText('The new draft of D1 is on the screen.')).toBeVisible({
      timeout: REWRITE_TIMEOUT_MS,
    })
    await expect(page.locator('#confirm-progress')).not.toContainText('Writing a new draft')
    await shot(11, 21)
  })

  await test.step('11.22 Click D2 in Elements.', async () => {
    await treeItem('D2').click()
    const heading = page.getByRole('heading', { level: 2, name: 'Document · D2' })
    await expect(heading).toBeVisible()
    await shot(11, 22, heading)
  })

  await test.step('11.23 Type Guide document title in Title.', async () => {
    await page.getByLabel('Title', { exact: true }).fill(DOCUMENT_TITLE)
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(DOCUMENT_TITLE)
    await shot(11, 23)
  })

  await test.step('11.24 Click Save edits.', async () => {
    await page.getByRole('button', { name: 'Save edits' }).click()
    await expect(page.getByText('D2 saved. The edit is recorded as its decision.')).toBeVisible()
    const edited = editor.getByText('Edited', { exact: true })
    await expect(edited).toBeVisible()
    await shot(11, 24, edited)
  })

  await test.step('11.25 Click Next undecided element.', async () => {
    await page.getByRole('button', { name: 'Next undecided element' }).click()
    await expect(editor).toContainText('Undecided')
    await shot(11, 25)
  })

  await test.step('11.26 Click Confirm on each element in turn until Every element has a decision. appears.', async () => {
    // The element count is the mock's, not this spec's: it is read off the progress line so a
    // package that grows a document is still confirmed to the last element.
    const opening = (await progress.textContent()) ?? ''
    const match = /^(\d+) of (\d+) confirmed$/.exec(opening.trim())
    expect(match, `the progress line reads "${opening}"`).not.toBeNull()
    let decided = Number(match?.[1])
    const total = Number(match?.[2])
    const confirm = page.getByRole('button', { name: 'Confirm', exact: true })
    while (decided < total) {
      await confirm.click()
      decided += 1
      await expect(progress).toHaveText(`${String(decided)} of ${String(total)} confirmed`)
    }
    const complete = page.getByText('Every element has a decision.')
    await expect(complete).toBeVisible()
    await shot(11, 26, complete)
  })

  await test.step('11.27 Tick Teaching note checked against the answer space and claims.', async () => {
    const teachingNote = page.getByRole('checkbox', {
      name: 'Teaching note checked against the answer space and claims',
    })
    await teachingNote.check()
    await expect(teachingNote).toBeChecked()
    await shot(11, 27)
  })

  const confirmDialog = page.getByRole('alertdialog')

  await test.step('11.28 Click Confirm version.', async () => {
    await page.getByRole('button', { name: 'Confirm version' }).click()
    await expect(confirmDialog.getByRole('heading', { name: 'Confirm version 1?' })).toBeVisible()
    await expect(confirmDialog.getByText('All met')).toBeVisible()
    await expect(
      confirmDialog.getByText(
        'Checked against the answer space and the claims, and kept with the confirmation',
      ),
    ).toBeVisible()
    await shot(11, 28)
  })

  await test.step('11.29 Click Confirm and freeze.', async () => {
    await confirmDialog.getByRole('button', { name: 'Confirm and freeze' }).click()
    await expect(page.getByText('Version 1 is confirmed and frozen.')).toBeVisible({
      timeout: ACTION_TIMEOUT_MS,
    })
    await expect(
      page.locator('#confirm-progress').getByRole('link', { name: 'Back to version 1' }),
    ).toBeVisible()
    await shot(11, 29)
  })

  await test.step('11.30 Click Back to version 1.', async () => {
    await page.locator('#confirm-progress').getByRole('link', { name: 'Back to version 1' }).click()
    await page.waitForURL(/\/versions\/[0-9a-f-]{36}$/)
    const identity = page.locator('#version-identity')
    await expect(identity).toContainText('Status')
    await expect(identity).toContainText('Confirmed')
    await expect(page.getByText(/^Version 1 was confirmed on /)).toBeVisible()
    await shot(11, 30)
  })
})

// ---------------------------------------------------------------------------------------------
// Task 12
// ---------------------------------------------------------------------------------------------

test('Task 12: Manage notifications, your account, and sign out', async ({ page, shot }) => {
  test.setTimeout(180_000)
  await signInAs(page, 'instructor')

  const settingsNav = page.getByRole('navigation', { name: 'Account settings sections' })

  await test.step('12.1 Click the Notifications bell in the header.', async () => {
    await page.getByRole('link', { name: /^Notifications:/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible()
    await expect(
      page.getByRole('listitem').filter({ hasText: 'A run is ready to review' }).first(),
    ).toBeVisible()
    await shot(12, 1)
  })

  await test.step('12.2 Click Mark all read.', async () => {
    await page.getByRole('button', { name: 'Mark all read' }).click()
    await expect(page.getByText('Everything is marked read.')).toBeVisible()
    await shot(12, 2)
  })

  await test.step('12.3 Click the Account button in the header.', async () => {
    await openAccountMenu(page)
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Privacy' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Terms' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await shot(12, 3)
  })

  await test.step('12.4 Click Settings.', async () => {
    await page.getByRole('menuitem', { name: 'Settings' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Profile' })).toBeVisible()
    await expect(page.getByLabel('Your name')).toHaveValue('Instructor Seat')
    await shot(12, 4)
  })

  await test.step('12.5 Click Save changes.', async () => {
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Your name is saved.')).toBeVisible()
    await shot(12, 5)
  })

  await test.step('12.6 Click Security.', async () => {
    await settingsNav.getByRole('link', { name: 'Security', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Password' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Signed-in devices' })).toBeVisible()
    // The device list is fetched after the page paints.
    const thisDevice = page.getByText('This device')
    await expect(thisDevice).toBeVisible({ timeout: ACTION_TIMEOUT_MS })
    // Step 5's toast sits over the badge until it times out; the shot waits for it to go.
    await expect(page.getByText('Your name is saved.')).toBeHidden({ timeout: ACTION_TIMEOUT_MS })
    await shot(12, 6, thisDevice)
  })

  await test.step('12.7 Click Data.', async () => {
    await settingsNav.getByRole('link', { name: 'Data', exact: true }).click()
    await expect(page.getByRole('heading', { level: 2, name: 'Download my data' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Delete account' })).toBeVisible()
    await shot(12, 7)
  })

  const deletion = page.getByRole('alertdialog')

  await test.step('12.8 Click Delete my account.', async () => {
    await page.getByRole('button', { name: 'Delete my account' }).click()
    await expect(deletion.getByText('Delete your account?')).toBeVisible()
    await expect(deletion.getByLabel(`Type ${INSTRUCTOR_EMAIL} to confirm`)).toBeVisible()
    await shot(12, 8)
  })

  await test.step('12.9 Click Keep my account.', async () => {
    await deletion.getByRole('button', { name: 'Keep my account' }).click()
    await expect(deletion).toBeHidden()
    await expect(page.getByRole('heading', { level: 2, name: 'Delete account' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await shot(12, 9)
  })

  await test.step('12.10 Click the Account button in the header.', async () => {
    await openAccountMenu(page)
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Privacy' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Terms' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await shot(12, 10)
  })

  await test.step('12.11 Click Sign out.', async () => {
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.waitForURL(/\/sign-in/)
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Tassl' })).toBeVisible()
    await shot(12, 11)
  })
})
