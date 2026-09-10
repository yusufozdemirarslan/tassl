// FR-210, 16 §8.3: **a whole run taken with the keyboard, and no pointer at all.**
//
// PRD §7.20 and §12 step 17 say every run screen is operated by keyboard alone. A spec that merely
// *prefers* the keyboard proves nothing — one `locator.click()` slipped in among two hundred lines
// and the claim quietly stops being true — so this one takes the pointer away first and then does
// the run:
//
//   * `page.mouse.{click,dblclick,down,up,move,wheel}` and `page.touchscreen.tap` are replaced with
//     functions that throw `PointerUsed`.
//   * so are the `Locator` methods that would move or act on an element without the keyboard:
//     `click`, `check`, `hover`, `tap`, `selectOption`, `dragTo`, and also `fill`, `focus`, `press`
//     and `type`, which each put focus or a value somewhere without anybody pressing a key to get
//     there. 16 §8.3 names only `page.mouse`, and `page.mouse` alone would not have caught an
//     accidental `locator.click()` — Playwright's locator actions do not go through it. The patch is
//     on the prototype and is undone in a `finally`, so the rest of the worker is unaffected.
//
// What is left is `page.keyboard`. Every control below is reached by pressing Tab until
// `document.activeElement` **is** the element a role-and-name query resolves to, which makes the
// navigation itself an assertion: it is the focus order, and the press cap is the keyboard-trap
// test. Nothing is focused by fiat.
//
// The run covers 16 §8.3's list: Begin, the sixteen readiness items, a document opened and closed,
// the frame fields and its lock, a delegation, a stance taken with Space and changed with an arrow
// key, a Source Trace through the actions menu, the escalation dialog, the outside-tool
// declaration, the brief fields including the named numeric one, the lock refusal and the lock, the
// addendum, the Turn response, every defense answer, and the two debrief questions.
//
// **The two link transitions.** WebKit's "Press Tab to highlight each item on a webpage" is off by
// default, so links are not in its tab order (the carve-out `tests/e2e/system/errors.spec.ts`
// already documents). Where the run moves on through a link — the readiness result to the
// workspace, the run status to the debrief — the link is tabbed to and pressed on the engines whose
// tab order holds links, and reached by address on the one whose does not. Typing an address is a
// keyboard act; clicking is the thing this spec has given up.
//
// THE DEFECT THIS SPEC FOUND, AND WHERE IT ACTUALLY WAS (step 11.5, then D-500)
//
// The spec was written red on webkit and green on chromium and firefox, and the trail it printed was
// twelve presses of `forward from body`: the caret had been dropped on `document.body`, and WebKit's
// sequential navigation has no starting point from there, so `Tab` moved nothing at all and "Lock
// the decision" was never reached. It was left failing rather than asserted around — a version that
// put the caret back by hand, on the skip link, was written and reverted, because it made the spec
// green on the engine that has the defect and broke the two that do not (D-498).
//
// Leaving it red is what found the defect, and the defect was not where D-498 guessed. It named the
// brief editor's autosave; the press the failure actually died on is the **second** "Lock the
// decision", and what took the caret away one act earlier was the outside-tool declaration: it
// records, closes its disclosure, and unmounts the `<form>` holding the "Record it" button the
// student is standing on. That is engine-independent — focus falls to `body` on all three — and only
// its consequence is not: Chromium and Firefox restart `Tab` at the top of the document, so a
// keyboard user walks the whole workspace again to get back, while WebKit strands them.
//
// Six acts on a run turned out to drop the caret, and every one of them now names where it goes
// (D-500): the declaration's disclosure, an escalation, a used mark in the log, the frame lock, the
// last defense answer, and the debrief's two questions. The brief editor's six fields were never
// among them — they are not replaced by an autosave and hold focus on every engine, and
// `saveBriefDraftAction` revalidates nothing, which is what `runs/actions.ts` says of it.
import type { Locator, Page } from '@playwright/test'
import { expect, seatEmail, signInAs, signOut, test, type Seat } from '../fixtures'
import { createStudentAssignment, signInAsInstructor } from '../instructor/api'
import { myAssignment, post, readJson } from '../walkthrough/scored-run'

/**
 * The seat this run is taken in.
 *
 * `student1`: this lane spends almost nothing against D-026 — one delegation, one action, one
 * escalation and a handful of writes over several minutes of key presses — so it sits beside the
 * seat's browser-driven specs rather than beside an endpoint-driven one.
 */
const STUDENT_SEAT: Seat = 'student1'

/** Past the longest Turn delay a run can draw (FR-110: 60 to 120 seconds after the lock). */
const PAST_THE_TURN_MS = 130_000

/** Raises C3 on D-030's phrase rule, and no other claim in the package. */
const REQUEST = 'What is the premium payback?'
const CLAIM_KEY = 'C3'

/** FR-101: the figure the recommendation rests on, which is also what makes the claim relied on. */
const PAYBACK_FIGURE = '11'

const FRAME = {
  decision: 'Hold the premium share until the payback figure has been checked.',
  assumptions: [
    'The payback figure has not been revised since the board deck.',
    'Value tier acquisition keeps performing at its current rate.',
    'Roastery capacity absorbs the current premium volume.',
  ],
  position: 'I lean towards holding the split until the payback number is checked.',
  confidence: '55',
} as const

const BRIEF = {
  recommendation: 'Hold the premium share at its current level for one more quarter.',
  rationale: 'The payback figure was computed before premium fulfillment was quoted.',
  assumptions: [
    'Value acquisition holds at its current blended cost.',
    'Roastery capacity absorbs current premium volume.',
    'No competitor repositions inside the quarter.',
  ],
  changeMyMind: 'A payback figure recomputed with fulfillment in it.',
  confidence: '62',
} as const

const STATEMENT = 'I cannot tell from the room whether the payback figure was ever recomputed.'
const PURPOSE = 'A spreadsheet, to recompute the payback myself.'
const ADDENDUM = 'The capacity assumption comes from the operations note.'
const TURN_JUSTIFICATION = 'The retention figure the payback rests on has been corrected downward.'
const TURN_CONFIDENCE = '48'
const DEFENSE_ANSWER =
  'I priced this on the payback figure of 11 months, because it is the only number in the room that speaks to the premium tier.'
const DEBRIEF_ANSWERS = {
  stanceToChange: 'I would challenge the payback figure, because nothing dates it after the deck.',
  doDifferently: 'I would run a Source Trace on every figure the recommendation rests on.',
}

type DefenseQuestionRow = { runQuestionId: string; text: string; answered: boolean }

/** Playwright's default is not a measurement of anything on a loaded machine (D-188). */
const SLOW_MS = 20_000

// ---------------------------------------------------------------------------------------------
// Taking the pointer away
// ---------------------------------------------------------------------------------------------

/** Locator methods that move focus or act on an element without a key being pressed. */
const FORBIDDEN_LOCATOR_METHODS = [
  'click',
  'dblclick',
  'tap',
  'hover',
  'check',
  'uncheck',
  'setChecked',
  'selectOption',
  'selectText',
  'dragTo',
  'fill',
  'clear',
  'focus',
  'press',
  'pressSequentially',
  'type',
] as const

const FORBIDDEN_MOUSE_METHODS = ['click', 'dblclick', 'down', 'up', 'move', 'wheel'] as const

/**
 * Replaces every pointer path with a throw, and returns the undo.
 *
 * The `Locator` patch is on the prototype because locators are created one per query; a worker runs
 * one test at a time, and the undo runs in a `finally`, so nothing else in the worker sees it.
 */
function takeThePointerAway(page: Page): () => void {
  const prototype = Object.getPrototypeOf(page.locator('html')) as Record<string, unknown>
  const savedLocator = new Map<string, unknown>()
  for (const name of FORBIDDEN_LOCATOR_METHODS) {
    if (typeof prototype[name] !== 'function') continue
    savedLocator.set(name, prototype[name])
    prototype[name] = () => {
      throw new Error(
        `PointerUsed: locator.${name}() is not available in the keyboard-only run. ` +
          'Reach the control with tabTo() and act on it with page.keyboard.',
      )
    }
  }

  const mouse = page.mouse as unknown as Record<string, unknown>
  for (const name of FORBIDDEN_MOUSE_METHODS) {
    mouse[name] = () => {
      throw new Error(
        `PointerUsed: page.mouse.${name}() is not available in the keyboard-only run.`,
      )
    }
  }
  const touchscreen = page.touchscreen as unknown as Record<string, unknown>
  touchscreen.tap = () => {
    throw new Error(
      'PointerUsed: page.touchscreen.tap() is not available in the keyboard-only run.',
    )
  }

  return () => {
    for (const [name, method] of savedLocator) prototype[name] = method
    for (const name of FORBIDDEN_MOUSE_METHODS) delete mouse[name]
    delete touchscreen.tap
  }
}

// ---------------------------------------------------------------------------------------------
// Moving by keyboard
// ---------------------------------------------------------------------------------------------

/** 16 §8.3's cap, and the keyboard-trap test: a control focus never reaches fails, by name. */
const TAB_CAP = 200

/** True when `locator` resolves to the element that currently has focus. */
async function isFocused(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((element) => element === document.activeElement)
  } catch {
    return false
  }
}

type Step = { where: 'here' | 'forward' | 'backward' | 'stale'; active: string; atRoot: boolean }

/**
 * Where the target sits relative to the caret, asked of one already-resolved element.
 *
 * `stale` is the case a server action creates: an act on this screen ends in `router.refresh()`, the
 * re-rendered tree replaces the node, and the handle still answers — about an element no longer in
 * the document. Detecting it is what keeps a re-render from sending the walk the wrong way forever.
 */
const WHERE = (element: Element): Step => {
  const active = document.activeElement
  const describe = (node: Element | null): string =>
    node === null
      ? 'none'
      : `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}:${(node.getAttribute('aria-label') ?? node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 28)}`
  const atRoot = active === null || active === document.body || active === document.documentElement
  if (element === active) return { where: 'here', active: describe(active), atRoot }
  if (!element.isConnected) return { where: 'stale', active: describe(active), atRoot }
  if (atRoot) return { where: 'forward', active: describe(active), atRoot }
  // The mask describes where `active` sits relative to `element`: preceding it means the target is
  // still ahead. `CONTAINED_BY` arrives with `FOLLOWING`, so the two bits below cover the ancestor
  // and descendant cases as well.
  const mask = element.compareDocumentPosition(active)
  return {
    where: (mask & Node.DOCUMENT_POSITION_PRECEDING) !== 0 ? 'forward' : 'backward',
    active: describe(active),
    atRoot,
  }
}

/**
 * Tab — or Shift+Tab — until the control has focus.
 *
 * The direction is decided by document order rather than always going forward, which is both what a
 * person does and what keeps this spec finishing: the workspace in `working` carries well over a
 * hundred tab stops across its three columns, and reaching a field *behind* the cursor by going all
 * the way round cost a wrap of the whole document per field. `compareDocumentPosition` answers
 * "is the target ahead of where I am" in the same round trip that asks "am I there yet".
 *
 * The element is resolved once and then asked directly. `locator.evaluate` re-runs the whole
 * selector on every call, and these are role-and-name chains whose accessible names are computed in
 * the page: at one resolution per Tab press, across a run of several hundred, that alone was most of
 * this spec's clock.
 *
 * A failure names the last dozen stops, because "it is out of the tab order" and "something before
 * it holds focus" are different defects and the trail is what tells them apart.
 */
async function tabTo(page: Page, locator: Locator, what: string): Promise<void> {
  await expect(locator, `${what} should be on screen before it can be reached`).toBeVisible({
    timeout: SLOW_MS,
  })
  let handle = await locator.elementHandle({ timeout: SLOW_MS })
  const trail: string[] = []

  for (let press = 0; press <= TAB_CAP; press += 1) {
    let step = await handle?.evaluate(WHERE).catch(() => null)
    if (step === null || step === undefined || step.where === 'stale') {
      // The tree was replaced under the walk; find the control again and ask where it is now.
      handle = await locator.elementHandle({ timeout: SLOW_MS })
      step = (await handle?.evaluate(WHERE)) ?? null
      if (step === null || step.where === 'stale') {
        throw new Error(`${what} could not be resolved: it left the page while Tab was walking.`)
      }
    }
    if (step.where === 'here') return
    trail.push(`${step.where} from ${step.active}`)

    await page.keyboard.press(step.where === 'forward' ? 'Tab' : 'Shift+Tab')
  }

  throw new Error(
    `Tab never reached ${what} in ${String(TAB_CAP)} presses: it is out of the tab order, or something before it traps focus. Last stops: ${trail.slice(-12).join(' | ')}`,
  )
}

/** Milestones, so a slow run says which part of it was slow rather than only that it was. */
function milestone(started: number, what: string): void {
  test.info().annotations.push({
    type: 'keyboard',
    description: `${what}: ${String(Date.now() - started)}ms`,
  })
}

/** Presses an arrow key until the control has focus — how a menu and a radio group are walked. */
async function arrowTo(page: Page, locator: Locator, key: string, what: string): Promise<void> {
  for (let press = 0; press <= 12; press += 1) {
    if (await isFocused(locator)) return
    await page.keyboard.press(key)
  }
  throw new Error(`${key} never reached ${what}.`)
}

/**
 * Tab to a field, select whatever is in it, and write.
 *
 * `insertText` rather than `type`: it is the same `page.keyboard`, it reaches the same focused
 * element, and it is one round trip instead of three per character — this spec writes about fifteen
 * hundred characters, and at a keystroke each that was minutes of its clock. What the spec is for is
 * *reaching* the field without a pointer, which the `tabTo` above is, and pressing the controls,
 * which every `Tab`, `Space`, `Enter` and arrow below still does one key at a time.
 */
async function typeInto(page: Page, locator: Locator, text: string, what: string): Promise<void> {
  await tabTo(page, locator, what)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
}

/** Tab to a control and press it. */
async function pressButton(page: Page, locator: Locator, what: string): Promise<void> {
  await tabTo(page, locator, what)
  await page.keyboard.press('Enter')
}

test('FR-210: a whole run, from the runs list to the debrief answers, with the pointer taken away', async ({
  page,
  request,
  browserName,
}) => {
  test.setTimeout(900_000)

  // WebKit's default keyboard-navigation preference keeps links out of the tab order. It is a
  // browser preference and not a property of the page (tests/e2e/system/errors.spec.ts).
  const linksTabbable = browserName !== 'webkit'

  await signInAsInstructor(request)
  const assignment = await createStudentAssignment(request, {
    what: 'Keyboard only',
    studentEmail: seatEmail(STUDENT_SEAT),
    variant: 'defective',
  })

  await signInAs(page, STUDENT_SEAT)
  const mine = await myAssignment(page.request, assignment.label)
  expect(mine.latestRun, 'the run below is started from the list, by keyboard').toBeNull()

  const started = Date.now()
  const restorePointer = takeThePointerAway(page)
  try {
    // =========================================================================================
    // The runs list, and the policy display (UI-020, UI-021)
    // =========================================================================================

    await page.goto('/runs')
    await expect(page.getByRole('heading', { level: 1, name: 'Runs' })).toBeVisible()
    await pressButton(
      page,
      page.getByRole('button', { name: `Start ${assignment.label}` }),
      'the Start button on this run’s row',
    )

    await page.waitForURL(/\/runs\/[0-9a-f-]{36}\/start$/)
    const runId = new URL(page.url()).pathname.split('/')[2] as string
    await expect(page.getByRole('heading', { level: 1, name: 'Before you begin' })).toBeVisible()

    await pressButton(
      page,
      page.getByRole('button', { name: 'Begin the Readiness Check' }),
      'Begin the Readiness Check',
    )
    await page.waitForURL(new RegExp(`/runs/${runId}/readiness$`))

    milestone(started, 'runs list and policy display')

    // =========================================================================================
    // The sixteen readiness items (UI-022, FR-010)
    // =========================================================================================

    await expect(page.getByRole('heading', { level: 1, name: 'Readiness Check' })).toBeVisible()
    const navigator = page.getByRole('toolbar', { name: 'Items' })
    await expect(navigator.getByRole('button')).toHaveCount(16)

    for (let position = 1; position <= 16; position += 1) {
      await expect(page.getByText(`Item ${String(position)} of 16`)).toBeVisible()
      const options = page.getByRole('radiogroup').getByRole('radio')
      await expect(options).toHaveCount(4)
      // Tab lands on the group's one tab stop; Space answers it. The choice is arbitrary and must
      // be: correctness is computed server-side and no response carries it (FR-012).
      await tabTo(page, options.first(), `the answer group on item ${String(position)}`)
      await page.keyboard.press('Space')
      await expect(
        navigator.getByRole('button', { name: `Item ${String(position)}, answered` }),
      ).toBeVisible({ timeout: SLOW_MS })
      if (position < 16) {
        await pressButton(page, page.getByRole('button', { name: 'Next item' }), 'Next item')
      }
    }

    await pressButton(page, page.getByRole('button', { name: 'Submit the check' }), 'Submit')
    const submitConfirm = page.getByRole('alertdialog')
    await expect(submitConfirm).toContainText('Submit the Readiness Check?')
    await pressButton(
      page,
      submitConfirm.getByRole('button', { name: 'Submit', exact: true }),
      'the confirmation’s Submit',
    )

    await page.waitForURL(new RegExp(`/runs/${runId}/readiness/result$`))
    await expect(page.getByRole('heading', { level: 1, name: 'What the check read' })).toBeVisible()

    milestone(started, 'the sixteen readiness items')

    // =========================================================================================
    // The Evidence Room and the frame (UI-023, FR-020 to FR-043)
    // =========================================================================================

    const openScenario = page.getByRole('link', { name: 'Open the scenario' })
    if (linksTabbable) {
      await pressButton(page, openScenario, 'Open the scenario')
    } else {
      await expect(
        openScenario,
        'the way on is a link, whether or not Tab reaches it',
      ).toBeVisible()
      await page.goto(`/runs/${runId}/work`)
    }
    await page.waitForURL(new RegExp(`/runs/${runId}/work$`))
    await expect(page.getByRole('heading', { level: 1, name: 'The scenario' })).toBeVisible()

    const room = page.locator('#evidence-room')
    const firstTitle = (
      await room.getByRole('listitem').first().getByRole('heading', { level: 3 }).innerText()
    ).trim()
    await pressButton(page, room.getByRole('button', { name: `Open ${firstTitle}` }), 'Open a doc')
    await expect(page.getByRole('article', { name: firstTitle })).toBeVisible()
    await pressButton(page, room.getByRole('button', { name: `Close ${firstTitle}` }), 'Close it')
    await expect(page.getByRole('article', { name: firstTitle })).toHaveCount(0)

    await typeInto(page, page.getByLabel('The decision'), FRAME.decision, 'The decision')
    for (const [index, assumption] of FRAME.assumptions.entries()) {
      const label = `Assumption ${String(index + 1)}`
      await typeInto(page, page.getByLabel(label), assumption, label)
    }
    await typeInto(page, page.getByLabel('Your position now'), FRAME.position, 'Your position now')
    await typeInto(
      page,
      page.getByRole('spinbutton', { name: 'Confidence as a number' }),
      FRAME.confidence,
      'the frame’s confidence',
    )

    await pressButton(page, page.getByRole('button', { name: 'Lock the frame' }), 'Lock the frame')
    const frameConfirm = page.getByRole('alertdialog')
    await expect(frameConfirm).toContainText('Lock the frame permanently?')
    await pressButton(page, frameConfirm.getByRole('button', { name: 'Lock it' }), 'Lock it')

    await expect(page.locator('[data-state="working"]')).toBeVisible({ timeout: SLOW_MS })
    await expect(page.locator('#locked-frame')).toContainText(FRAME.decision)

    milestone(started, 'the Evidence Room and the frame')

    // =========================================================================================
    // The working period: delegate, be refused the lock, take a stance, check, escalate, declare
    // =========================================================================================

    const assistant = page.locator('#assistant-panel')
    const editor = page.locator('#brief-editor-panel')

    await typeInto(page, assistant.getByLabel('Your request'), REQUEST, 'the request box')
    await pressButton(
      page,
      assistant.getByRole('button', { name: 'Ask the assistant' }),
      'Ask the assistant',
    )
    await expect(assistant.locator('#assistant-reply-status')).toContainText('Reply complete', {
      timeout: SLOW_MS,
    })
    const card = assistant.getByRole('article', { name: `Claim ${CLAIM_KEY}` })
    await expect(card).toBeVisible()

    // The whole brief, written by keyboard. It is filled *before* the first lock attempt because the
    // brief's own rules are checked first: an empty recommendation is refused as an invalid brief,
    // and the refusal FR-084 is about — a claim leaned on with no stance — is the one this run wants
    // to meet. FR-101: typing the claim's figure into a named numeric field is the student saying
    // they leaned on it.
    await typeInto(
      page,
      editor.getByLabel('Your recommendation'),
      BRIEF.recommendation,
      'the recommendation',
    )
    await typeInto(
      page,
      editor.getByLabel('Why', { exact: true }),
      BRIEF.rationale,
      'the rationale',
    )
    for (const [index, assumption] of BRIEF.assumptions.entries()) {
      const label = `Assumption ${String(index + 1)}`
      await typeInto(page, editor.getByLabel(label), assumption, `the brief’s ${label}`)
    }
    await typeInto(
      page,
      editor.getByLabel('What would change your mind'),
      BRIEF.changeMyMind,
      'what would change your mind',
    )
    await typeInto(
      page,
      editor.getByLabel('Confidence as a number'),
      BRIEF.confidence,
      'the brief’s confidence',
    )
    await typeInto(
      page,
      editor.getByLabel('Premium payback you are betting on, in months'),
      PAYBACK_FIGURE,
      'the named numeric field',
    )

    await pressButton(
      page,
      editor.getByRole('button', { name: 'Lock the decision' }),
      'Lock the decision',
    )
    const lockConfirm = page.getByRole('alertdialog')
    await expect(lockConfirm).toContainText('File this decision?')
    await pressButton(page, lockConfirm.getByRole('button', { name: 'File it' }), 'File it')
    await expect(lockConfirm).toContainText('A claim you leaned on has no stance', {
      timeout: SLOW_MS,
    })

    // The refusal offers the way back to the claim, and puts the focus in it.
    await pressButton(
      page,
      lockConfirm.getByRole('button', { name: 'Go to the claim' }),
      'Go to the claim',
    )
    await expect(lockConfirm).toBeHidden()

    // The stance: Space answers the group, an arrow key moves it (FR-080, 16 §8.3).
    //
    // The announcer is waited on between the two presses rather than the chip's own `aria-checked`,
    // and the difference is real: the chip fills optimistically while the write is in flight, and
    // `StanceControl` refuses a second stance until the first has landed. An arrow pressed inside
    // that window moves focus and records nothing — which is the control being careful with the
    // student's record, not a defect — so this waits for the run announcer to say the first one is
    // on the record before pressing the second.
    const announcer = page.locator('#run-announcer')
    const stances = card.getByRole('radiogroup', { name: `Your stance on claim ${CLAIM_KEY}` })
    await tabTo(page, stances.getByRole('radio').first(), 'the stance group')
    await page.keyboard.press('Space')
    await expect(stances.getByRole('radio', { name: 'Accept' })).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: SLOW_MS },
    )
    await expect(announcer).toHaveText(`Stance on claim ${CLAIM_KEY}: Accept.`, {
      timeout: SLOW_MS,
    })

    await arrowTo(
      page,
      stances.getByRole('radio', { name: 'Verify' }),
      'ArrowDown',
      'the Verify stance',
    )
    await expect(stances.getByRole('radio', { name: 'Verify' })).toHaveAttribute(
      'aria-checked',
      'true',
      { timeout: SLOW_MS },
    )
    await expect(announcer).toHaveText(`Stance on claim ${CLAIM_KEY}: Verify.`, {
      timeout: SLOW_MS,
    })

    // A Source Trace, through the actions menu — which is walked with arrow keys, not with Tab.
    await pressButton(
      page,
      card.getByRole('button', { name: `Check claim ${CLAIM_KEY}` }),
      'the actions menu',
    )
    const sourceTrace = page.getByRole('menuitem', { name: /Source Trace/ })
    await expect(sourceTrace).toBeVisible({ timeout: SLOW_MS })
    await arrowTo(page, sourceTrace, 'ArrowDown', 'the Source Trace item')
    await page.keyboard.press('Enter')

    const result = page.getByRole('dialog')
    await expect(result).toContainText(`Source Trace on claim ${CLAIM_KEY}`, { timeout: SLOW_MS })
    await page.keyboard.press('Escape')
    await expect(result).toBeHidden()

    // The escalation dialog.
    await pressButton(
      page,
      card.getByRole('button', { name: `Escalate claim ${CLAIM_KEY}` }),
      'Escalate',
    )
    const escalation = page.getByRole('dialog')
    await expect(escalation).toContainText('Escalate to a colleague')
    await typeInto(
      page,
      escalation.getByLabel('What you cannot settle'),
      STATEMENT,
      'the escalation statement',
    )
    await pressButton(page, escalation.getByRole('button', { name: 'Send it' }), 'Send it')
    await expect(escalation).toBeHidden({ timeout: SLOW_MS })

    // The outside-tool declaration (FR-061).
    const declaration = page.locator('#declaration-control')
    await pressButton(
      page,
      declaration.getByRole('button', { name: 'Declare outside-tool use' }),
      'Declare outside-tool use',
    )
    await typeInto(
      page,
      declaration.getByLabel('What you used, and what for'),
      PURPOSE,
      'the declaration',
    )
    await pressButton(page, declaration.getByRole('button', { name: 'Record it' }), 'Record it')
    await expect(declaration.getByRole('status')).toContainText('Recorded.', { timeout: SLOW_MS })

    milestone(started, 'the working period')

    // =========================================================================================
    // The lock, now that the claim it rests on carries a stance (UI-024, FR-102)
    // =========================================================================================

    await pressButton(
      page,
      editor.getByRole('button', { name: 'Lock the decision' }),
      'Lock the decision',
    )
    await expect(lockConfirm).toContainText('File this decision?')
    await pressButton(page, lockConfirm.getByRole('button', { name: 'File it' }), 'File it')

    await page.waitForURL(new RegExp(`/runs/${runId}/locked$`), { timeout: SLOW_MS })
    await expect(page.getByRole('heading', { level: 1, name: 'Decision locked' })).toBeVisible()

    // The one addendum FR-107 allows.
    const addendum = page.locator('#addendum')
    await pressButton(
      page,
      addendum.getByRole('button', { name: 'Add an addendum' }),
      'Add an addendum',
    )
    const addendumDialog = page.getByRole('dialog')
    await typeInto(page, addendumDialog.getByLabel('Your addendum'), ADDENDUM, 'the addendum')
    await pressButton(page, addendumDialog.getByRole('button', { name: 'Add it' }), 'Add it')
    await expect(addendum).toContainText(ADDENDUM, { timeout: SLOW_MS })

    milestone(started, 'the lock and the addendum')

    // =========================================================================================
    // The Turn (UI-025, FR-110 to FR-115)
    //
    // `advance-clock` is the test control D-109 exists for; it moves the run's own timestamps and
    // decides nothing. It is not a pointer, and no keyboard reaches a clock.
    // =========================================================================================

    await post(page.request, `/api/v1/test/runs/${runId}/advance-clock`, { ms: PAST_THE_TURN_MS })
    await page.reload()
    await page.waitForURL(new RegExp(`/runs/${runId}/turn$`), { timeout: SLOW_MS })
    await expect(page.getByRole('heading', { level: 1, name: 'The Turn' })).toBeVisible()

    const windowClaims = (
      await readJson<{ id: string; key: string; inTurnWindow: boolean }[]>(
        page.request,
        `/api/v1/runs/${runId}/claims`,
      )
    ).filter((claim) => claim.inTurnWindow)
    expect(windowClaims.length, 'the Turn should have raised claims').toBeGreaterThan(0)

    const turnCards = page.locator('#turn-claims')
    for (const claim of windowClaims) {
      const turnCard = turnCards.getByRole('article', { name: `Claim ${claim.key}` })
      const group = turnCard.getByRole('radiogroup', {
        name: `Your stance on claim ${claim.key}`,
      })
      // The group is a roving-tabindex radio group: one chip is in the tab order, and which one
      // depends on the stance the claim already carries. A claim raised into the window keeps the
      // stance it took during the working period (D-705), so the tabbable chip is that stance —
      // Escalate, for the claim this spec escalated — not the first chip. Tab reaches whichever chip
      // is tabbable; the arrows do the choosing.
      const tabbable = group.locator('[role="radio"][tabindex="0"]')
      await tabTo(page, tabbable, `the stance group on ${claim.key}`)
      if ((await group.getByRole('radio', { checked: true }).count()) === 0) {
        await page.keyboard.press('Space')
        // One write at a time, as above: the arrow that follows records nothing until this one lands.
        await expect(page.locator('#run-announcer')).toHaveText(
          `Stance on claim ${claim.key}: Accept.`,
          { timeout: SLOW_MS },
        )
      }
      await arrowTo(
        page,
        group.getByRole('radio', { name: 'Verify' }),
        'ArrowDown',
        `Verify on ${claim.key}`,
      )
      await expect(group.getByRole('radio', { name: 'Verify' })).toHaveAttribute(
        'aria-checked',
        'true',
        { timeout: SLOW_MS },
      )
    }

    const form = page.locator('#turn-response')
    await tabTo(page, form.getByRole('radio').first(), 'the response group')
    await page.keyboard.press('Space')
    await arrowTo(page, form.getByRole('radio', { name: 'Revise' }), 'ArrowDown', 'Revise')
    await typeInto(
      page,
      form.getByLabel('Why', { exact: true }),
      TURN_JUSTIFICATION,
      'the justification',
    )
    await typeInto(
      page,
      form.getByLabel('Confidence as a number'),
      TURN_CONFIDENCE,
      'the response confidence',
    )
    await pressButton(
      page,
      form.getByRole('button', { name: 'File the response' }),
      'File the response',
    )

    await page.waitForURL(new RegExp(`/runs/${runId}/defense$`), { timeout: SLOW_MS })

    milestone(started, 'the Turn')

    // =========================================================================================
    // The defense (UI-026, FR-120 to FR-126): every question, answered by keyboard
    // =========================================================================================

    await expect(page.getByRole('heading', { level: 1, name: 'The defense' })).toBeVisible()
    const questions = page.locator('#defense-questions')

    // Which question is next, and whether the answer landed, are both asked of the **run** rather
    // than of the screen, and the box is reached inside the item that carries that question's own
    // words. Every one of the three is the same lesson: an answer ends in a `router.refresh()`, and
    // "is there a box", "is the sentence on the page" and "is the sentence there N times" were each
    // true one render too early — so the walk typed into the box the refresh was about to replace
    // and pressed Submit on the question that had just been answered.
    let answered = 0
    for (let pass = 0; pass < 12; pass += 1) {
      const defense = await readJson<{ questions: DefenseQuestionRow[] }>(
        page.request,
        `/api/v1/runs/${runId}/defense`,
      )
      const next = defense.questions.find((question) => !question.answered)
      if (next === undefined) break

      // `.last()`: a follow-up is a list item nested inside the item of the question that earned it,
      // so filtering by the follow-up's own words matches both, and the inner one is the question.
      const item = questions.getByRole('listitem').filter({ hasText: next.text }).last()
      const box = item.getByLabel('Your answer')
      await expect(box, 'the next question offers exactly one box (FR-126)').toHaveCount(1, {
        timeout: SLOW_MS,
      })
      await typeInto(page, box, DEFENSE_ANSWER, `defense answer ${String(answered + 1)}`)
      await pressButton(page, item.getByRole('button', { name: 'Submit answer' }), 'Submit answer')
      answered += 1

      await expect
        .poll(
          async () =>
            (
              await readJson<{ questions: DefenseQuestionRow[] }>(
                page.request,
                `/api/v1/runs/${runId}/defense`,
              )
            ).questions.find((question) => question.runQuestionId === next.runQuestionId)?.answered,
          { timeout: SLOW_MS, message: `answer ${String(answered)} reaches the record` },
        )
        .toBe(true)
    }
    expect(answered, 'FR-121: six to nine questions, plus any follow-up').toBeGreaterThanOrEqual(6)

    await pressButton(
      page,
      questions.getByRole('button', { name: 'Finish the defense' }),
      'Finish the defense',
    )
    const finish = page.getByRole('alertdialog')
    await expect(finish).toContainText('Finish the defense?')
    await pressButton(page, finish.getByRole('button', { name: 'Finish it' }), 'Finish it')

    milestone(started, 'the defense')

    // =========================================================================================
    // The debrief's two questions, which record the run (UI-027, UI-028, FR-152)
    // =========================================================================================

    await page.waitForURL(new RegExp(`/runs/${runId}$`), { timeout: SLOW_MS })
    const debriefLink = page.getByRole('link', { name: 'Read the debrief' })
    await expect(debriefLink).toBeVisible({ timeout: SLOW_MS })
    if (linksTabbable) {
      await pressButton(page, debriefLink, 'Read the debrief')
    } else {
      await page.goto(`/runs/${runId}/debrief`)
    }

    await page.waitForURL(new RegExp(`/runs/${runId}/debrief$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Run Debrief' })).toBeVisible()

    const debriefQuestions = page.locator('#debrief-questions')
    await typeInto(
      page,
      debriefQuestions.getByLabel('Which single stance would you change, and to what?'),
      DEBRIEF_ANSWERS.stanceToChange,
      'the first debrief question',
    )
    await typeInto(
      page,
      debriefQuestions.getByLabel('What will you do differently in the next run like this?'),
      DEBRIEF_ANSWERS.doDifferently,
      'the second debrief question',
    )
    await pressButton(
      page,
      debriefQuestions.getByRole('button', { name: 'File both answers' }),
      'File both answers',
    )
    await expect(debriefQuestions.getByText(DEBRIEF_ANSWERS.stanceToChange)).toBeVisible({
      timeout: SLOW_MS,
    })

    milestone(started, 'the debrief answers')

    // The run is where a keyboard alone put it: everything a student can do, done without a pointer.
    const run = await readJson<{ state: string }>(page.request, `/api/v1/runs/${runId}`)
    expect(
      ['scored', 'confirmed', 'recorded'],
      'the run reached scoring under the keyboard alone',
    ).toContain(run.state)
  } finally {
    restorePointer()
  }

  await signOut(page)
})
