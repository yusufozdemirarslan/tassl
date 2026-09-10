import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GenerationProgress,
  type GenerationProgressProps,
  type GenerationStatusSummary,
} from '@/components/features/packages/generation-progress'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { Route } from 'next'

// UI-042 (step 12.3). Four things the generation screen owes an author, and they are the four this
// file holds:
//
//   1. **Seven rows, always.** The pipeline writes a `generation_runs` row per pass, so a step
//      nothing has run for has nothing to report — and a screen that drew only the rows it had
//      would say "two steps" on a run that is on step 2 of seven. Every step is drawn, in pipeline
//      order, and one that has not started says it is waiting.
//   2. **A step that stopped shows what it could not satisfy, in words.** `failed_rules` is an
//      array of rule codes (DATA-027); the sentence belongs to `validatePackage`, and the code the
//      package no longer breaks says so rather than being printed alone.
//   3. **The retry is where the stop is, and it says what it does not do.** It restarts the
//      pipeline at step 1 — that is the only thing `startGeneration` does (07 §6) — and the
//      sentence beside it says confirmed elements are kept. It is on the stopped row and on no
//      other row, and it is absent altogether for a seat that may not generate.
//   4. **The poll runs while a step is running and not otherwise.** The client only reads; a
//      finished pipeline and a stopped one make no requests at all.

const actions = vi.hoisted(() => ({ startGenerationAction: vi.fn() }))
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))

// A Server Action: importing the real module would pull the authoring service, the job queue and
// `server-only` into jsdom.
vi.mock('@/server/modules/authoring/actions', () => ({
  startGenerationAction: actions.startGenerationAction,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: router.push,
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
  usePathname: () => '/packages/pkg-1/versions/ver-1/generation',
}))

const STEPS = [
  'reskin_brief_stakeholders',
  'documents',
  'answer_space_fields',
  'claims_and_states',
  'turn_and_probe',
  'question_bank_and_counterfactual',
  'readiness_items',
] as const

type Step = GenerationStatusSummary['steps'][number]

const step = (over: Partial<Step> & Pick<Step, 'step'>): Step => ({
  status: 'queued',
  passNumber: 1,
  inputTokens: null,
  outputTokens: null,
  costEstimateUsd: null,
  failedRules: [],
  error: null,
  startedAt: null,
  finishedAt: null,
  ...over,
})

/** A pipeline where the first `done` steps succeeded and the rest have not started. */
function through(done: number, tail: Partial<Step> = {}): Step[] {
  return STEPS.map((name, at) =>
    at < done
      ? step({
          step: name,
          status: 'succeeded',
          inputTokens: 1200,
          outputTokens: 900,
          costEstimateUsd: 0,
          startedAt: '2026-09-07T10:00:00.000Z',
          finishedAt: '2026-09-07T10:00:12.000Z',
        })
      : at === done
        ? step({ step: name, ...tail })
        : step({ step: name }),
  )
}

const CONFIRM_HREF = '/packages/pkg-1/versions/ver-1/confirm' as Route

function renderProgress(over: Partial<GenerationProgressProps> = {}) {
  const props: GenerationProgressProps = {
    packageId: 'pkg-1',
    versionId: 'ver-1',
    version: 1,
    status: { state: 'running', steps: through(2, { status: 'running' }) },
    ruleText: {},
    failures: [],
    canGenerate: true,
    frozen: false,
    confirmHref: CONFIRM_HREF,
    ...over,
  }
  render(<GenerationProgress {...props} />)
  return props
}

/** The seven step rows: the list's own children, so a nested list of rules is not one of them. */
const rows = (): HTMLElement[] =>
  Array.from(
    screen.getByRole('list', { name: enUS['generation.stepsTitle'] }).children,
  ) as HTMLElement[]

const retryButton = () => screen.queryByRole('button', { name: enUS['generation.retry'] })

beforeEach(() => {
  vi.clearAllMocks()
  actions.startGenerationAction.mockResolvedValue({ ok: true, data: { started: true } })
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ state: 'running', steps: through(2, { status: 'running' }) }),
          {
            headers: { 'content-type': 'application/json' },
          },
        ),
      ),
    ),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GenerationProgress — the seven rows (UI-042)', () => {
  it('draws every step in pipeline order, including the ones nothing has run for', () => {
    renderProgress()

    const drawn = rows()
    expect(drawn).toHaveLength(7)
    expect(drawn[0]).toHaveTextContent(enUS['generation.step.reskin_brief_stakeholders'])
    expect(drawn[6]).toHaveTextContent(enUS['generation.step.readiness_items'])
    // Two done, one running, four not started yet — and each says which it is.
    expect(drawn[0]).toHaveTextContent(enUS['generation.status.succeeded'])
    expect(drawn[2]).toHaveTextContent(enUS['generation.status.running'])
    expect(drawn[6]).toHaveTextContent(enUS['generation.status.queued'])
  })

  it('reports what a step that has run cost, and totals the run once at the foot', () => {
    renderProgress()

    const done = rows()[0] as HTMLElement
    expect(done).toHaveTextContent(t('generation.tokensValue', { input: '1,200', output: '900' }))
    expect(done).toHaveTextContent(t('generation.costValue', { amount: '0.00' }))
    // A step nothing has run has nothing to report, and reports nothing: no invented pass number,
    // no three lines of "Not asked yet".
    expect(rows()[6]).not.toHaveTextContent(enUS['generation.notAsked'])
    expect(rows()[6]).not.toHaveTextContent(enUS['generation.passLabel'])
    // Two steps have answered, so the footer says what the run has cost so far, once.
    expect(screen.getByText(enUS['generation.totalTokens'])).toBeInTheDocument()
    expect(
      screen.getByText(t('generation.tokensValue', { input: '2,400', output: '1,800' })),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['generation.costFree'])).toBeInTheDocument()
  })

  it('announces the step that is running, once, in a polite region', () => {
    renderProgress()

    expect(screen.getByRole('status')).toHaveTextContent(
      t('generation.liveRunning', {
        number: 3,
        step: enUS['generation.step.answer_space_fields'],
      }),
    )
  })
})

describe('GenerationProgress — a step that did not finish (UI-042)', () => {
  const stopped = (over: Partial<GenerationProgressProps> = {}) =>
    renderProgress({
      status: {
        state: 'failed',
        steps: through(1, {
          status: 'failed',
          passNumber: 2,
          failedRules: ['STAKEHOLDER_NO_DOCUMENT', 'DOCUMENT_ROLES_MISSING'],
          startedAt: '2026-09-07T10:00:00.000Z',
          finishedAt: '2026-09-07T10:00:40.000Z',
        }),
      },
      ruleText: {
        STAKEHOLDER_NO_DOCUMENT:
          'Stakeholders S2 and S3 have no document in the Evidence Room; every stakeholder needs at least one.',
      },
      ...over,
    })

  it('shows the rule text for a rule the package still breaks, and the code beside it', () => {
    stopped()

    const row = rows()[1] as HTMLElement
    expect(row).toHaveTextContent(enUS['generation.stepRulesTitle'])
    expect(row).toHaveTextContent(
      'Stakeholders S2 and S3 have no document in the Evidence Room; every stakeholder needs at least one.',
    )
    expect(row).toHaveTextContent('STAKEHOLDER_NO_DOCUMENT')
  })

  it('says a rule the package no longer breaks was settled rather than printing a bare code', () => {
    stopped()

    const row = rows()[1] as HTMLElement
    expect(row).toHaveTextContent('DOCUMENT_ROLES_MISSING')
    expect(row).toHaveTextContent(enUS['generation.ruleSettled'])
  })

  it('puts the retry on the step that stopped and on no other row, and says what it keeps', () => {
    stopped()

    const retry = retryButton()
    expect(retry).not.toBeNull()
    expect(rows()[1]).toContainElement(retry)
    expect(rows()[0]).not.toContainElement(retry)
    expect(screen.getByText(enUS['generation.retryNote'])).toBeInTheDocument()
    // `startGeneration` resumes at the first step that has not succeeded (D-683); the sentence
    // beside the button has to say that, not that the pipeline starts again at step 1.
    expect(enUS['generation.retryNote']).toMatch(/resumes at the first step/)
    expect(enUS['generation.retryNote']).not.toMatch(/step 1/)
  })

  it('starts the pipeline again from the row, and asks the route to render what changed', async () => {
    const user = userEvent.setup()
    const props = stopped()

    await user.click(retryButton() as HTMLElement)

    await waitFor(() => expect(actions.startGenerationAction).toHaveBeenCalled())
    expect(actions.startGenerationAction.mock.calls[0]?.[0]).toEqual({
      packageId: props.packageId,
      versionId: props.versionId,
    })
    expect(router.refresh).toHaveBeenCalled()
  })

  it('says why the pipeline stopped when the step answered with no rule to name', () => {
    renderProgress({
      status: {
        state: 'failed',
        steps: through(3, { status: 'failed', passNumber: 2, error: 'LLM_OUTPUT_INVALID' }),
      },
    })

    expect(screen.getByText(enUS['generation.stepErrorTitle'])).toBeInTheDocument()
    expect(screen.getByText('LLM_OUTPUT_INVALID')).toBeInTheDocument()
  })

  it('draws no control at all for a seat that may not generate', () => {
    stopped({ canGenerate: false })

    expect(retryButton()).toBeNull()
    expect(screen.queryByText(enUS['generation.retryNote'])).not.toBeInTheDocument()
  })

  it('draws no control on a version that is already confirmed', () => {
    stopped({ frozen: true })

    expect(retryButton()).toBeNull()
  })
})

describe('GenerationProgress — what to do next (UI-042)', () => {
  it('offers the confirmation workspace when the seven finished and every rule is met', () => {
    renderProgress({ status: { state: 'complete', steps: through(7) }, failures: [] })

    expect(screen.getByRole('link', { name: enUS['generation.openWorkspace'] })).toHaveAttribute(
      'href',
      CONFIRM_HREF,
    )
    expect(screen.getByRole('status')).toHaveTextContent(enUS['generation.liveComplete'])
  })

  it('links a rule failure to the element it names in the confirmation workspace', () => {
    renderProgress({
      status: { state: 'complete', steps: through(7) },
      failures: [
        {
          code: 'DOCUMENT_TOO_LONG',
          message: 'Document D4 exceeds the 2000-word limit; shorten the body.',
          elements: [{ elementId: '33333333-3333-4333-8333-333333333333', key: 'D4' }],
        },
      ],
    })

    expect(
      screen.getByText('Document D4 exceeds the 2000-word limit; shorten the body.'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: t('generation.openElement', { key: 'D4' }) }),
    ).toHaveAttribute('href', `${CONFIRM_HREF}?element=33333333-3333-4333-8333-333333333333`)
  })

  it('offers to start the pipeline on a version nothing has been generated into', async () => {
    const user = userEvent.setup()
    renderProgress({ status: { state: 'not_started', steps: through(0) } })

    const start = screen.getByRole('button', { name: enUS['generation.start'] })
    expect(screen.getByText(enUS['generation.startNote'])).toBeInTheDocument()

    await user.click(start)
    await waitFor(() => expect(actions.startGenerationAction).toHaveBeenCalled())
  })

  it('says what the server refused rather than leaving the press unanswered', async () => {
    const user = userEvent.setup()
    actions.startGenerationAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'SEED_MISSING',
        message: 'This version has no seed case to generate from.',
        requestId: 'req_1',
      },
    })
    renderProgress({ status: { state: 'not_started', steps: through(0) } })

    await user.click(screen.getByRole('button', { name: enUS['generation.start'] }))

    expect(
      await screen.findByText('This version has no seed case to generate from.'),
    ).toBeInTheDocument()
    expect(router.refresh).not.toHaveBeenCalled()
  })
})

describe('GenerationProgress — the poll (UI-042: every 5 s while running)', () => {
  it('asks the server for the status every five seconds while a step is running', async () => {
    vi.useFakeTimers()
    renderProgress()

    expect(fetch).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(fetch).toHaveBeenCalledWith('/api/v1/package-versions/ver-1/generation', {
      cache: 'no-store',
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('asks nothing at all once the pipeline is not running', async () => {
    vi.useFakeTimers()
    renderProgress({ status: { state: 'complete', steps: through(7) } })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops polling and refreshes the route the moment a poll finds the pipeline finished', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ state: 'complete', steps: through(7) }), {
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    )
    renderProgress()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(router.refresh).toHaveBeenCalledTimes(1)
    // The screen has moved on to what the poll found, and asks for nothing more.
    expect(screen.getByRole('status')).toHaveTextContent(enUS['generation.liveComplete'])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
