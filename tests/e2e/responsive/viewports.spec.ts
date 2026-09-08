// Step 13.7's instrument (NFR-006, NFR-013; `/impeccable adapt`).
//
// **The four screens that carry the product's density, at the four widths the phase names.** The
// workspace, the debrief, the faculty replay and the confirmation workspace are where the data is
// dense and where a layout that only ever ran at 1280 goes wrong first: the stance matrix, the
// trace, the element tree, the two-column split. 360 is a small phone in portrait, 768 the width at
// which the app rail stops being a bottom bar, 1024 a laptop, 1440 a desktop.
//
// **Two assertions, and they are the two things a responsive layout owes a reader** — plus one the
// densest drawing in the product needs on its own.
//
//   * *No horizontal page scroll.* `documentElement.scrollWidth` never exceeds its `clientWidth`.
//     A page that scrolls sideways has lost a column off the edge, and on a phone it takes the
//     whole document with it — every vertical scroll drifts. Content wider than the viewport is
//     allowed and expected (the trace, a wide table, the matrix); it is allowed *inside its own
//     scroll container*, which is what the diagnostic below distinguishes. The failure message
//     names the elements that overflow with no scrollable ancestor, so a regression says which
//     element it is rather than that a number is bigger than another number.
//
//   * *Every primary action is visible and nothing covers it.* Visible in Playwright's sense — a
//     non-empty box, not `visibility: hidden`, not `display: none` — plus two checks the box alone
//     does not make: the box lies inside the viewport's width, so the control has not been pushed
//     off the edge by a neighbour that would not shrink; and a hit test at the control's centre
//     returns the control itself, so neither the sticky `RunFrame` band nor the fixed bottom rail
//     is sitting on top of it. A button that is technically in the DOM under the bottom bar is not
//     a button a student can press.
//
//   * *The stance matrix is never drawn below 1:1.* It is the one graph whose plot is text, and
//     `preserveAspectRatio` had been shrinking it to fit whatever box it was given (D-621), so its
//     own screen transform is read at every width the debrief and the replay are read at.
//
// **The runs are driven through the documented endpoints.** Every screen here is proven for what it
// *says* by its own spec — `06-working-period`, `11-scoring-debrief`, `12-faculty-replay`,
// `author/confirm-workspace` — and this spec is about geometry alone, so it spends its time
// resizing rather than re-proving. `../walkthrough/scored-run.ts` already holds the drive to
// `scored`; `reachWorking` is the same drive stopped at the frame lock.
//
// **Each screen is set up once and read at four widths**, in one test, because the setup is the
// expensive half: a run is not repeatable (D-041 allows one per student per assignment until it is
// voided), so four tests would need four assignments and four drives for four measurements of one
// page.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test } from '../fixtures'
import { suiteName } from '../fixture-package'
import {
  addSectionMember,
  createStudentAssignment,
  signInAsInstructor,
  walkthroughOrgId,
} from '../instructor/api'
import {
  confirmEveryBand,
  driveRunToScored,
  myAssignment,
  reachWorking,
  WRITE_HEADERS,
} from '../walkthrough/scored-run'

/** The four widths Step 13.7 names, each with a height a laptop or a phone actually has. */
const VIEWPORTS = [
  { width: 360, height: 780, label: '360 (phone)' },
  { width: 768, height: 1024, label: '768 (tablet)' },
  { width: 1024, height: 800, label: '1024 (laptop)' },
  { width: 1440, height: 900, label: '1440 (desktop)' },
] as const

type Viewport = (typeof VIEWPORTS)[number]

/** Sub-pixel rounding: a layout is not broken by a third of a device pixel. */
const SLACK = 1

/**
 * The document does not scroll sideways at this width.
 *
 * The diagnostic walks the tree for elements whose right edge is past the viewport and whose
 * ancestors do not clip or scroll horizontally — the elements that are actually pushing the
 * document out, rather than the ones legitimately inside a scroll region.
 */
async function expectNoHorizontalScroll(page: Page, where: string): Promise<void> {
  const report = await page.evaluate((slack: number) => {
    const root = document.documentElement
    const width = root.clientWidth
    const overflows = root.scrollWidth > width + slack
    const culprits: string[] = []
    if (overflows) {
      for (const element of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
        const box = element.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) continue
        if (box.right <= width + slack && box.left >= -slack) continue
        let clipped = false
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const overflowX = getComputedStyle(parent).overflowX
          if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') {
            clipped = true
            break
          }
        }
        if (clipped) continue
        const id = element.id ? `#${element.id}` : ''
        const classes = element.className
          ? `.${String(element.className).trim().split(/\s+/).slice(0, 4).join('.')}`
          : ''
        culprits.push(
          `${element.tagName.toLowerCase()}${id}${classes} ` +
            `[${String(Math.round(box.left))}…${String(Math.round(box.right))}]`,
        )
      }
    }
    return { scrollWidth: root.scrollWidth, width, culprits: culprits.slice(0, 8) }
  }, SLACK)

  expect(
    report.scrollWidth,
    `${where}: the document scrolls sideways (${String(report.scrollWidth)} px of content in ` +
      `${String(report.width)} px of viewport). Overflowing outside any scroll container:\n  ` +
      (report.culprits.length > 0 ? report.culprits.join('\n  ') : '(none found — check a margin)'),
  ).toBeLessThanOrEqual(report.width + SLACK)
}

/**
 * A primary action is on the screen, inside it, and nothing is on top of it.
 *
 * The hit test is the part a bounding box cannot make: the fixed bottom rail under `md` and the
 * sticky `RunFrame` band above are both in the layout's own stacking context, and a control they
 * cover is a control that cannot be pressed however visible it is.
 */
async function expectActionUsable(
  action: Locator,
  viewport: Viewport,
  what: string,
): Promise<void> {
  await expect(action, `${what} at ${viewport.label} is not on the screen`).toBeVisible()
  await action.scrollIntoViewIfNeeded()

  const box = await action.boundingBox()
  expect(box, `${what} at ${viewport.label} has no box`).not.toBeNull()
  const { x, width } = box as { x: number; width: number }
  expect(
    x >= -SLACK && x + width <= viewport.width + SLACK,
    `${what} at ${viewport.label} is outside the viewport: ` +
      `[${String(Math.round(x))}…${String(Math.round(x + width))}] in ${String(viewport.width)} px`,
  ).toBe(true)

  const covering = await action.evaluate((element: Element) => {
    const rect = element.getBoundingClientRect()
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (top === null) return 'nothing (the point is outside the viewport)'
    if (top === element || element.contains(top) || top.contains(element)) return null
    const id = top.id ? `#${top.id}` : ''
    return `${top.tagName.toLowerCase()}${id}`
  })
  expect(covering, `${what} at ${viewport.label} is covered by ${String(covering)}`).toBeNull()
}

/**
 * The stance matrix is drawn at its own size or larger, never smaller.
 *
 * The one graph in the product whose plot *is* text (16 §9.2: matrix cells carry text), so a scale
 * below 1 is not a smaller graph but an unreadable one — at 360 px it used to draw at 0.61 and set
 * its stance labels at seven pixels. The reading is the SVG's own screen transform, which is the
 * number `preserveAspectRatio` computes, rather than a measured font size that the browser's own
 * hinting would make noisy (D-621).
 */
async function expectMatrixAtFullSize(page: Page, where: string): Promise<void> {
  const scale = await page
    .locator('[data-graph="stance_matrix"] svg')
    .evaluate((svg: SVGSVGElement) => svg.getScreenCTM()?.a ?? 0)
  expect(
    scale,
    `${where}: the stance matrix is drawn at ${scale.toFixed(2)}×`,
  ).toBeGreaterThanOrEqual(1)
}

/** One screen, read at all four widths: the page is loaded once per width so layout is fresh. */
async function atEveryViewport(
  page: Page,
  url: string,
  where: string,
  check: (viewport: Viewport) => Promise<void>,
): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(url)
    await check(viewport)
    await expectNoHorizontalScroll(page, `${where} at ${viewport.label}`)
  }
}

test.describe('every screen adapts from 360 px to 1440 px', () => {
  test('the run workspace, at 360, 768, 1024 and 1440', async ({ page, request }) => {
    test.setTimeout(300_000)

    await signInAsInstructor(request)
    const { label } = await createStudentAssignment(request, {
      what: 'Responsive workspace',
      studentEmail: seatEmail('student1'),
      variant: 'defective',
    })

    await signInAs(page, 'student1')
    const assignment = await myAssignment(page.request, label)
    const runId = await reachWorking(page.request, assignment.assignmentId)

    await atEveryViewport(page, `/runs/${runId}/work`, 'the run workspace', async (viewport) => {
      await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()
      // The lock is the act the whole screen exists to reach (FR-080); the assistant is how the
      // student gets there. Both are the primary actions of this room.
      await expectActionUsable(
        page.getByRole('button', { name: 'Lock the decision' }),
        viewport,
        'the workspace lock',
      )
      await expectActionUsable(
        page.getByRole('button', { name: 'Ask the assistant' }),
        viewport,
        'the assistant request',
      )
    })
  })

  test('the debrief and the faculty replay, at 360, 768, 1024 and 1440', async ({
    page,
    request,
  }) => {
    test.setTimeout(600_000)

    await signInAsInstructor(request)
    const { section, label } = await createStudentAssignment(request, {
      what: 'Responsive debrief',
      studentEmail: seatEmail('student2'),
      variant: 'defective',
    })
    await addSectionMember(request, section.id, {
      email: seatEmail('instructor'),
      role: 'instructor',
    })

    await signInAs(page, 'student2')
    const assignment = await myAssignment(page.request, label)
    const runId = await driveRunToScored(page.request, assignment.assignmentId)

    // The student's own debrief, with the two reflection questions still open (FR-152).
    await atEveryViewport(page, `/runs/${runId}/debrief`, 'the debrief', async (viewport) => {
      await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()
      await expectActionUsable(
        page.getByRole('button', { name: 'File both answers' }),
        viewport,
        'the debrief reflection submit',
      )
      await expectActionUsable(
        page.getByRole('link', { name: 'Back to the run' }),
        viewport,
        'the way back to the run',
      )
      await expectMatrixAtFullSize(page, `the debrief at ${viewport.label}`)
    })

    // The same run in the reviewer's seat: the replay, with seven drafted bands and nothing decided.
    await signOut(page)
    await signInAs(page, 'instructor')

    // The replay is five views under one address (UI-033), and the three that carry width are
    // separate measurements: the four graphs, the seven band decisions, and the trace.
    //
    // The replay's own h1 is the student's name, so each view is anchored on the panel that only
    // it has rather than on a title this spec would have to keep in step with a fixture.
    await atEveryViewport(page, `/review/runs/${runId}`, 'the replay graphs', async (viewport) => {
      await expect(page.locator('#replay-graphs')).toBeVisible()
      await expectMatrixAtFullSize(page, `the replay graphs at ${viewport.label}`)
    })

    await atEveryViewport(
      page,
      `/review/runs/${runId}?tab=bands`,
      'the replay bands',
      async (viewport) => {
        await expectActionUsable(
          page.getByRole('button', { name: 'Confirm the remaining drafts' }),
          viewport,
          'the replay bulk confirmation',
        )
      },
    )

    await atEveryViewport(page, `/review/runs/${runId}?tab=trace`, 'the replay trace', async () => {
      await expect(page.locator('#replay-trace')).toBeVisible()
    })

    // And the confirmed debrief, which is the same page with the instructor's decisions on it
    // (FR-150): a band that has been decided draws a note the drafted one does not.
    await confirmEveryBand(page.request, runId)
    await atEveryViewport(page, `/runs/${runId}/debrief`, 'the confirmed debrief', async () => {
      await expect(page.getByRole('heading', { level: 1, name: 'Run debrief' })).toBeVisible()
    })
  })

  test('the confirmation workspace, at 360, 768, 1024 and 1440', async ({ page }) => {
    test.setTimeout(300_000)

    await signInAs(page, 'instructor')
    const title = suiteName('Responsive confirm package')
    const orgId = await walkthroughOrgId(page)
    const document = JSON.parse(
      readFileSync(
        join(process.cwd(), 'src', 'server', 'db', 'fixtures', 'meridian-roast.package.json'),
        'utf8',
      ),
    ) as { package: { title: string; familyKey: string } }
    const response = await page.request.post(`/api/v1/institutions/${orgId}/packages/import`, {
      data: {
        ...document,
        package: {
          ...document.package,
          familyKey: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title,
        },
      },
      headers: WRITE_HEADERS,
    })
    expect(response.status(), await response.text()).toBe(201)
    const imported = (await response.json()) as { packageId: string; versionId: string }

    await atEveryViewport(
      page,
      `/packages/${imported.packageId}/versions/${imported.versionId}/confirm`,
      'the confirmation workspace',
      async (viewport) => {
        await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
        await expectActionUsable(
          page.getByRole('button', { name: 'Confirm version' }),
          viewport,
          'the version confirmation',
        )
        // The way into the ninety-three decisions, which is a different control at each end of
        // the range: the tree from `xl`, where the workspace's two columns start (D-628), and
        // under it the one select the tree collapses to. A workspace with neither on the screen
        // has no way into it.
        await expectActionUsable(
          viewport.width >= 1280
            ? page.getByRole('tree', { name: 'Elements of this version' })
            : page.getByRole('combobox', { name: 'Element to review' }),
          viewport,
          'the way into the elements',
        )
      },
    )
  })
})
