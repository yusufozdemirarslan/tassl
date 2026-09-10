'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { CircleAlertIcon, Loader2Icon, RotateCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { LabelChip } from '@/components/layout/label-chip'
import { Panel } from '@/components/layout/panel'
import { Button, buttonVariants } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/package-generation'
import { startGenerationAction } from '@/server/modules/authoring/actions'
import type { GenerationStatusView, GenerationStepValue } from '@/server/modules/authoring/schema'
import { useRefresh } from '@/lib/hooks/use-refresh'

// UI-042 (FR-191, FR-198, AI-001). What the pipeline is doing to this version, step by step, and
// the one thing to do next.
//
// The screen answers three questions in the order they are asked. *Where has it got to?* — seven
// rows in pipeline order, each with the state it is in, the pass it is on, and what it cost.
// *Why did it stop?* — the rules the step could not satisfy, in the sentences `validatePackage`
// writes for them, with the control that starts it again. *What do I do now?* — the confirmation
// workspace, and, when the seven finished with rules still unmet, the elements to put right by
// hand.
//
// **The client only polls and displays.** Every timestamp, every state and every rule verdict is
// the server's; this component asks `GET /package-versions/{id}/generation` every five seconds
// *while a step is running* and stops the moment it is not — a finished pipeline polls nothing, and
// a screen left open overnight on a stopped run makes no requests at all. The one thing the poll
// decides for itself is when to ask the route to re-render: the package's rule report and its
// status are read on the server, so the transition out of `running` is followed by a
// `refresh()` rather than by a second endpoint.
//
// **The retry says what it does not do.** `startGeneration` is the only way to run the pipeline
// (07 §6), and it starts at step 1 — it does not resume where the run stopped. A control labelled
// "Retry step" would be a lie about both halves of that, so the label says what it does and the
// sentence beside it says what it leaves alone: an element an author has confirmed is never
// written over (10 §5), which is what makes the press safe to make (D-541).
//
// The rule text is passed in rather than kept here. `generation_runs.failed_rules` is an array of
// rule *codes* (DATA-027), and the sentence a code deserves is the one `validatePackage` composes
// for this package — with the element keys in it — so the server hands the codes it can still
// explain to this component and a code it cannot is said to have been settled since (D-540).

type GenerationStepRow = GenerationStatusView['steps'][number]

/** The two fields of the status the screen draws; the poll reads the same two off the route. */
export type GenerationStatusSummary = Pick<GenerationStatusView, 'state' | 'steps'>

/** One unmet package rule, with the elements it names resolved to the keys an author knows. */
export type GenerationRuleFailure = {
  code: string
  message: string
  elements: readonly { elementId: string; key: string }[]
}

export type GenerationProgressProps = {
  packageId: string
  versionId: string
  version: number
  /** The status as the server rendered it; the poll takes over from here. */
  status: GenerationStatusSummary
  /** Every rule the package breaks right now, by code, in the validator's own words. */
  ruleText: Readonly<Record<string, string>>
  /** The same failures as a list, for the report under the steps. */
  failures: readonly GenerationRuleFailure[]
  /** 08 §4 and 10 §5: a draft, and a seat that may author it. */
  canGenerate: boolean
  /** The version is confirmed; the pipeline refuses it and so does this screen. */
  frozen: boolean
  confirmHref: Route
}

/** Pipeline order (10 §5); the row index is the step number an author counts from 1. */
const STEP_ORDER: readonly GenerationStepValue[] = [
  'reskin_brief_stakeholders',
  'documents',
  'answer_space_fields',
  'claims_and_states',
  'turn_and_probe',
  'question_bank_and_counterfactual',
  'readiness_items',
]

const POLL_MS = 5_000

const integers = new Intl.NumberFormat('en-US')
const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

const stepName = (step: GenerationStepValue): string =>
  t(`generation.step.${step}` as 'generation.step.documents')

const stepNumber = (step: GenerationStepValue): number => STEP_ORDER.indexOf(step) + 1

/** The step a reader is being told about: the one running, or the one that stopped. */
function currentStep(status: GenerationStatusSummary): GenerationStepRow | null {
  return (
    status.steps.find((row) => row.status === 'running') ??
    status.steps.find((row) => row.status === 'failed') ??
    null
  )
}

/** What the live region says about a pipeline in this state; empty while nothing is happening. */
function announcement(status: GenerationStatusSummary): string {
  const step = currentStep(status)
  if (status.state === 'complete') return t('generation.liveComplete')
  if (status.state === 'failed' && step) {
    return t('generation.liveStopped', { number: stepNumber(step.step), step: stepName(step.step) })
  }
  if (status.state === 'running' && step?.status === 'running') {
    return t('generation.liveRunning', { number: stepNumber(step.step), step: stepName(step.step) })
  }
  return ''
}

const STATUS_CHIP = {
  queued: { kind: 'unreviewed', label: () => t('generation.status.queued') },
  running: { kind: 'provisional', label: () => t('generation.status.running') },
  succeeded: { kind: 'confirmed', label: () => t('generation.status.succeeded') },
  failed: { kind: 'warning', label: () => t('generation.status.failed') },
} as const

/** Seconds as an author reads them; the same shape UI-044 uses for the clock. */
function formatSeconds(seconds: number): string {
  if (seconds < 60) return t('generation.durationSeconds', { seconds })
  return t('generation.durationMinutes', {
    minutes: Math.floor(seconds / 60),
    seconds: seconds % 60,
  })
}

/** Milliseconds between a step's two timestamps, as an author reads them. */
function duration(row: GenerationStepRow): string | null {
  if (row.startedAt === null || row.finishedAt === null) return null
  const ms = new Date(row.finishedAt).getTime() - new Date(row.startedAt).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  return formatSeconds(Math.round(ms / 1000))
}

/** One labelled figure under a step row; the numbers are Mono and tabular (DESIGN.md). */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <dt className="text-ink-muted text-meta">{label}</dt>
      <dd className="text-ink text-mono-sm font-mono tabular-nums">{value}</dd>
    </div>
  )
}

/** The product's refusal shape: the sentence to act on in ink on the red wash, then the code. */
function Refusal({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-red bg-red-soft text-ink text-body max-w-measure flex w-full items-start gap-2 rounded-md border p-3">
      <CircleAlertIcon aria-hidden="true" className="text-red mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </div>
  )
}

export function GenerationProgress(props: GenerationProgressProps) {
  const { packageId, versionId, version, ruleText, failures, canGenerate, frozen, confirmHref } =
    props
  const router = useRouter()
  const refresh = useRefresh()

  const [polled, setPolled] = useState<GenerationStatusSummary | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)

  const status = polled ?? props.status
  const running = status.state === 'running'

  // What the run has cost so far, across every step that has answered. The screen reports it once
  // rather than leaving an author to add seven rows up, and it is the same question FR-198's
  // measures answer on the version view.
  const totals = useMemo(() => {
    const answered = status.steps.filter((row) => row.inputTokens !== null)
    if (answered.length === 0) return null
    return {
      inputTokens: answered.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
      outputTokens: answered.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
      costUsd: answered.reduce((sum, row) => sum + (row.costEstimateUsd ?? 0), 0),
      passes: status.steps.reduce(
        (sum, row) => sum + (row.startedAt === null ? 0 : row.passNumber),
        0,
      ),
    }
  }, [status.steps])

  const attention = useMemo(() => currentStep(status), [status])

  // The one thing on this screen that moves while a step is running: how long the step has been
  // going, measured from the server's own `startedAt` and ticked once a second by the browser.
  //
  // `now` starts null and is first written by the interval, so `Date.now()` never reaches the
  // server HTML or the paint that has to match it — the rule `run-frame.tsx` states for the run
  // clock, for the same reason: a reading taken during the render is a different number on the
  // server and in the browser, and React calls that a hydration mismatch. The line therefore
  // appears a second after the page paints, which is a second of a wait that lasts minutes.
  const runningSince = attention?.status === 'running' ? attention.startedAt : null
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    if (!running || runningSince === null) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [running, runningSince])
  const elapsed =
    now === null || runningSince === null
      ? null
      : formatSeconds(Math.max(0, Math.round((now - new Date(runningSince).getTime()) / 1000)))

  // The server render is the record; a poll only moves the screen forward from it. When the props
  // arrive newer than the last answer — the refresh below, or a navigation — the poll's copy is
  // dropped rather than merged, so there is never a render showing the older of the two.
  const server = useRef(props.status)
  useEffect(() => {
    if (server.current !== props.status) {
      server.current = props.status
      setPolled(null)
    }
  }, [props.status])

  // The route re-renders when the pipeline leaves `running`: the rule report, the package's status
  // and its measures are server reads, and this is the only moment they change.
  const refreshOnStop = useRef(props.status.state)
  useEffect(() => {
    if (status.state === refreshOnStop.current) return
    const wasRunning = refreshOnStop.current === 'running'
    refreshOnStop.current = status.state
    if (wasRunning) refresh()
  }, [status.state, router, refresh])

  useEffect(() => {
    if (!running) return undefined
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = (): void => {
      if (stopped) return
      timer = setTimeout(() => void poll(), POLL_MS)
    }

    const poll = async (): Promise<void> => {
      if (stopped) return
      // A hidden tab is not being read and the pipeline does not need watching to advance; the
      // listener below asks the moment it comes back.
      if (document.hidden) {
        schedule()
        return
      }
      try {
        const response = await fetch(`/api/v1/package-versions/${versionId}/generation`, {
          cache: 'no-store',
        })
        if (stopped) return
        if (response.ok) {
          const body = (await response.json()) as GenerationStatusSummary
          setPolled({ state: body.state, steps: body.steps })
          if (body.state !== 'running') return
        }
        // A refusal or a network error changes nothing on the screen: the server render still says
        // what this author is allowed to know, and the next tick asks again.
      } catch {
        // Offline, or the request was cut off.
      }
      schedule()
    }

    const onVisible = (): void => {
      if (document.hidden || stopped) return
      if (timer !== undefined) clearTimeout(timer)
      void poll()
    }

    schedule()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running, versionId])

  const start = useCallback(async (): Promise<void> => {
    setStarting(true)
    setStartError(null)
    const result = await startGenerationAction({ packageId, versionId })
    setStarting(false)
    if (!result.ok) {
      setStartError(result.error.message)
      return
    }
    // The steps come from the server, and the first of them is queued by the press itself. The
    // control that was pressed unmounts with the state it belonged to, so the focus goes with the
    // screen rather than falling to the document.
    setPolled(null)
    toast.success(t('generation.startedToast'))
    refresh()
    // Panel renders the id on its section and takes the focus recipe with tabIndex -1.
    document.getElementById('generation-steps')?.focus()
  }, [packageId, versionId, refresh])

  const canPress = canGenerate && !frozen && !running && !starting

  const startControl = (label: string, pending: string, note: string) => (
    <div className="flex flex-col items-start gap-3">
      <Button
        type="button"
        aria-disabled={canPress ? undefined : true}
        aria-busy={starting}
        onClick={() => {
          if (canPress) void start()
        }}
      >
        {starting ? (
          <Loader2Icon aria-hidden="true" className="animate-spin" />
        ) : (
          <RotateCwIcon aria-hidden="true" />
        )}
        {starting ? pending : label}
      </Button>
      <p className="text-ink-muted text-body max-w-measure">{note}</p>
      {startError !== null && (
        <p role="alert" className="text-red text-body max-w-measure">
          {startError}
        </p>
      )}
    </div>
  )

  /**
   * What to do next, above the log that explains it.
   *
   * Every terminal state puts its one control first: on a screen whose evidence is seven rows deep,
   * an author who has just watched a pipeline finish should not scroll past the seven to reach the
   * door. While a step is running there is nothing to press, and the rows are the whole screen.
   */
  const outcome = frozen ? null : status.state === 'not_started' ? (
    <Panel
      id="generation-outcome"
      title={canGenerate ? t('generation.startTitle') : t('generation.readOnlyTitle')}
      headingLevel={2}
    >
      {canGenerate ? (
        startControl(t('generation.start'), t('generation.startPending'), t('generation.startNote'))
      ) : (
        <p className="text-ink-muted text-body max-w-measure">{t('generation.readOnlyBody')}</p>
      )}
    </Panel>
  ) : status.state === 'failed' ? (
    // A stopped pipeline says what is missing and where to put it right. The rules the step could
    // not satisfy belong to the step's own row: they are what *it* was refused for, and repeating
    // them here under a second title made the author match two lists by reading (D-540).
    <Panel id="generation-outcome" title={t('generation.stoppedTitle')} headingLevel={2}>
      <div className="flex flex-col items-start gap-4">
        <p className="text-ink-muted text-body max-w-measure">
          {t('generation.openWorkspaceNote')}
        </p>
        <Link
          href={confirmHref}
          className={buttonVariants({ variant: 'secondary', className: 'w-fit' })}
        >
          {t('generation.openWorkspace')}
        </Link>
      </div>
    </Panel>
  ) : status.state === 'complete' && failures.length === 0 ? (
    <Panel id="generation-outcome" title={t('generation.rulesOkTitle')} headingLevel={2}>
      <div className="flex flex-col items-start gap-4">
        <p className="text-ink-muted text-body max-w-measure">
          {t('generation.rulesOkBody', { version })}
        </p>
        <Link href={confirmHref} className={buttonVariants({ className: 'w-fit' })}>
          {t('generation.openWorkspace')}
        </Link>
      </div>
    </Panel>
  ) : status.state === 'complete' ? (
    <Panel id="generation-outcome" title={t('generation.rulesTitle')} headingLevel={2}>
      <div className="flex flex-col items-start gap-4">
        <p className="text-ink-muted text-body max-w-measure">{t('generation.rulesBody')}</p>
        <ul className="flex w-full flex-col gap-4">
          {failures.map((failure) => (
            <li key={failure.code} className="flex flex-col items-start gap-2">
              <p className="text-ink text-body max-w-measure">{failure.message}</p>
              <p className="text-ink-muted text-mono-sm font-mono break-words">
                {failure.elements.length === 0
                  ? failure.code
                  : `${failure.code} · ${t('generation.ruleElements', {
                      keys: failure.elements.map((element) => element.key).join(', '),
                    })}`}
              </p>
              {failure.elements.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {failure.elements.map((element) => (
                    <li key={element.elementId}>
                      <Link
                        href={`${confirmHref}?element=${element.elementId}` as Route}
                        className={buttonVariants({ variant: 'secondary' })}
                      >
                        {t('generation.openElement', { key: element.key })}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <Link href={confirmHref} className={buttonVariants({ className: 'w-fit' })}>
          {t('generation.openWorkspace')}
        </Link>
      </div>
    </Panel>
  ) : null

  return (
    <div className="flex flex-col gap-6">
      {outcome}

      <Panel
        id="generation-steps"
        tabIndex={-1}
        title={t('generation.stepsTitle')}
        description={t('generation.stepsDescription')}
        headingLevel={2}
      >
        {/* One screen-level live region: what the poll finds, said once, politely. It is never
            `empty:hidden` — a region that is not in the tree when the page loads may miss the
            first transition it exists to announce. */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement(status)}
        </p>

        {/* The same sentence, where a person watching the wait can see it, with the elapsed time
            beside it. The poll delivers a new reading every five seconds and nothing else on this
            screen moves between them; a wait with no clock reads as a hung page. Mono, tabular,
            once a second, no animation (DESIGN.md §The clock). */}
        {running && (
          <p
            // The live region above already carries this sentence; a reader working down the panel
            // should meet it once, not twice.
            aria-hidden="true"
            className="border-line text-ink text-body mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b pb-4"
          >
            <span>{announcement(status)}</span>
            {elapsed !== null && (
              <span className="text-ink-muted text-mono-sm font-mono tabular-nums">
                {t('generation.elapsed', { duration: elapsed })}
              </span>
            )}
          </p>
        )}

        <ol aria-labelledby="generation-steps-title" className="flex flex-col">
          {STEP_ORDER.map((step) => {
            const row = status.steps.find((entry) => entry.step === step)
            const state = row?.status ?? 'queued'
            const chip = STATUS_CHIP[state]
            const took = row ? duration(row) : null
            const rules = row?.failedRules ?? []
            return (
              <li
                key={step}
                className="border-line flex flex-col gap-3 border-b py-4 first:pt-0 last:border-b-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span className="text-ink-muted text-mono-sm shrink-0 font-mono whitespace-nowrap tabular-nums">
                    {t('generation.stepPosition', { number: stepNumber(step) })}
                  </span>
                  <h3 className="text-h4 min-w-0 flex-1 basis-64">{stepName(step)}</h3>
                  <LabelChip kind={chip.kind} label={chip.label()} />
                </div>

                {/* A step nothing has run has nothing to report, and a row of "Not asked yet"
                    three times over is noise that outweighs the seven names it sits under.
                    `getGenerationStatus` answers a row per step whatever has happened to it, so
                    the test is the state, not the presence of the row. */}
                {row !== undefined && row.status !== 'queued' && (
                  <dl className="flex flex-wrap gap-x-6 gap-y-1">
                    <Fact label={t('generation.passLabel')} value={String(row.passNumber)} />
                    <Fact
                      label={t('generation.tokensLabel')}
                      value={
                        row.inputTokens !== null && row.outputTokens !== null
                          ? t('generation.tokensValue', {
                              input: integers.format(row.inputTokens),
                              output: integers.format(row.outputTokens),
                            })
                          : t('generation.notAsked')
                      }
                    />
                    <Fact
                      label={t('generation.costLabel')}
                      value={
                        row.costEstimateUsd === null
                          ? t('generation.notAsked')
                          : t('generation.costValue', { amount: usd.format(row.costEstimateUsd) })
                      }
                    />
                    {took !== null && <Fact label={t('generation.durationLabel')} value={took} />}
                  </dl>
                )}

                {row !== undefined && row.passNumber > 1 && (
                  <p className="text-ink-muted text-meta">{t('generation.passSecond')}</p>
                )}

                {state === 'failed' && (
                  <div className="flex flex-col items-start gap-4">
                    {rules.length > 0 && (
                      <Refusal title={t('generation.stepRulesTitle')}>
                        <ul className="flex flex-col gap-2">
                          {rules.map((code) => (
                            <li key={code} className="flex flex-col gap-0.5">
                              <span>{ruleText[code] ?? t('generation.ruleSettled')}</span>
                              <span className="text-mono-sm font-mono break-words">{code}</span>
                            </li>
                          ))}
                        </ul>
                      </Refusal>
                    )}
                    {row?.error != null && row.error.length > 0 && (
                      <Refusal title={t('generation.stepErrorTitle')}>
                        <p className="break-words">{row.error}</p>
                      </Refusal>
                    )}
                    {canGenerate &&
                      !frozen &&
                      startControl(
                        t('generation.retry'),
                        t('generation.retryPending'),
                        t('generation.retryNote'),
                      )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>

        {/* What the whole run cost, once, instead of seven rows an author adds up by hand. The
            shape is UI-044's counts block: a hairline, then the figures in Mono. */}
        {totals !== null && (
          <dl className="border-line mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t pt-3">
            <Fact
              label={t('generation.totalTokens')}
              value={t('generation.tokensValue', {
                input: integers.format(totals.inputTokens),
                output: integers.format(totals.outputTokens),
              })}
            />
            <Fact
              label={t('generation.totalCost')}
              value={
                totals.costUsd === 0
                  ? t('generation.costFree')
                  : t('generation.costValue', { amount: usd.format(totals.costUsd) })
              }
            />
            <Fact label={t('generation.totalPasses')} value={String(totals.passes)} />
          </dl>
        )}
      </Panel>
    </div>
  )
}
