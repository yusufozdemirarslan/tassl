'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Route } from 'next'
import { FlaskConicalIcon } from 'lucide-react'
import { FormAlert, SubmitButton } from '@/components/features/account/form-feedback'
import { LabelChip } from '@/components/layout/label-chip'
import { Panel } from '@/components/layout/panel'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { courses } from '@/lib/i18n/messages/courses'
import { run } from '@/lib/i18n/messages/run'
import { scopedT } from '@/lib/i18n/scoped'
import { acknowledgePolicyAction } from '@/server/modules/runs/actions'
import type { Mapping, OutsideAiPolicy, RunTypeValue } from '@/server/modules/courses/schema'

// UI-021 (FR-201). Everything a student is owed before a run that counts begins, on one screen,
// with one control at the bottom of it.
//
// The screen is the student's, and the sentences are theirs: the course's own policy copy is
// written to the instructor setting it ("Students may use…"), so this namespace says the same rule
// in the second person. The two strings that are not re-written are the ones that must be the same
// words everywhere — the band names in the mapping table, and the counts statement, which is the
// sentence `acknowledgePolicy` records as having been made (`counts_statement: true`). It is read
// from the courses namespace for exactly that reason: one sentence, one place.
//
// Pressing Begin is what writes `policy_displayed` with these values and opens the Readiness Check
// (10 §6). It is a Server Action rather than a link because it is a write; the run's own
// `links.next` is where it sends the student afterwards, so the route that follows the state is
// decided by the state machine and not by this screen.
const t = scopedT(run, courses)

export type PolicyDisplayProps = {
  runId: string
  policy: {
    outsideAiPolicy: OutsideAiPolicy
    weight: number
    mapping: Mapping
    runType: RunTypeValue
    workingClockSeconds: number
    /** Always true in this build: no package version has field calibration (PRD §7.19). */
    uncalibrated: boolean
  }
}

const POLICY_TITLES: Record<OutsideAiPolicy, () => string> = {
  open: () => t('run.policyOpen'),
  declared: () => t('run.policyDeclared'),
  in_environment_only: () => t('run.policyInEnvironment'),
}

const POLICY_BODIES: Record<OutsideAiPolicy, () => string> = {
  open: () => t('run.policyOpenBody'),
  declared: () => t('run.policyDeclaredBody'),
  in_environment_only: () => t('run.policyInEnvironmentBody'),
}

const RUN_TYPES: Record<RunTypeValue, () => string> = {
  decision: () => t('run.runTypeDecision'),
  critique: () => t('run.runTypeCritique'),
}

/** The mapping in the fixed band order, with the names the course screens use for them. */
const BANDS: readonly { key: keyof Mapping; label: () => string }[] = [
  { key: 'novice', label: () => t('courses.mappingNovice') },
  { key: 'developing', label: () => t('courses.mappingDeveloping') },
  { key: 'proficient', label: () => t('courses.mappingProficient') },
  { key: 'professional', label: () => t('courses.mappingProfessional') },
]

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** Minutes, and the seconds only when there are some: "45 minutes", "7 minutes 30 seconds". */
function clockLength(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (seconds === 0) return t('run.clockLengthMinutes', { minutes })
  return t('run.clockLengthMinutesSeconds', { minutes, seconds })
}

export function PolicyDisplay({ runId, policy }: PolicyDisplayProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [failure, setFailure] = useState<string | null>(null)

  function begin(): void {
    if (pending) return
    setFailure(null)
    startTransition(async () => {
      const result = await acknowledgePolicyAction({ runId })
      if (result.ok) {
        router.push(result.data.links.next as Route)
        return
      }
      setFailure(result.error.message || t('run.beginFailed'))
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The counts statement is an h2 (09 §UI-021): it is the one thing on this screen that must
          not be read as small print, and a student skimming reads the headings. */}
      <Panel id="run-counts">
        <h2 className="text-h3 max-w-[52ch] text-balance">{t('courses.countsStatement')}</h2>
        <dl className="text-body mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted text-meta">{t('run.runTypeLabel')}</dt>
            <dd className="text-ink mt-0.5 font-medium">{RUN_TYPES[policy.runType]()}</dd>
          </div>
          <div>
            <dt className="text-ink-muted text-meta">{t('run.weightLabel')}</dt>
            <dd className="text-ink mt-0.5 font-medium">
              {t('run.weightValue', { weight: NUMBER.format(policy.weight) })}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel id="run-policy" title={t('run.policyTitle')} headingLevel={2}>
        <div className="flex max-w-[72ch] flex-col gap-3">
          <p className="text-ink text-reading font-medium">
            {POLICY_TITLES[policy.outsideAiPolicy]()}
          </p>
          <p className="text-ink-muted text-reading">{POLICY_BODIES[policy.outsideAiPolicy]()}</p>
          <p className="text-ink-muted text-body">{t('run.policyNoPenalty')}</p>
        </div>
      </Panel>

      <Panel id="run-mapping" title={t('run.mappingTitle')} headingLevel={2}>
        <div className="flex flex-col gap-4">
          <Table className="max-w-md">
            <TableCaption className="px-0">{t('run.mappingCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('run.mappingColumnBand')}</TableHead>
                <TableHead scope="col" className="text-right">
                  {t('run.mappingColumnPoints')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {BANDS.map((band) => (
                <TableRow key={band.key}>
                  <TableCell className="font-medium">{band.label()}</TableCell>
                  <TableCell className="text-mono tabular text-right font-mono">
                    {NUMBER.format(policy.mapping[band.key])}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-ink-muted text-body max-w-[72ch]">{t('run.mappingNote')}</p>
        </div>
      </Panel>

      <Panel
        id="run-clock-length"
        title={t('run.clockTitle')}
        headingLevel={2}
        actions={policy.uncalibrated ? <LabelChip kind="uncalibrated" /> : null}
      >
        <div className="flex max-w-[72ch] flex-col gap-3">
          <p className="text-ink text-h4 font-serif">{clockLength(policy.workingClockSeconds)}</p>
          <p className="text-ink-muted text-reading">{t('run.clockStartNote')}</p>
          {policy.uncalibrated && (
            <p className="text-ink-muted text-body flex items-start gap-2">
              <FlaskConicalIcon aria-hidden="true" className="text-amber mt-0.5 size-4 shrink-0" />
              {t('run.clockUncalibratedNote')}
            </p>
          )}
        </div>
      </Panel>

      <Panel id="run-begin" title={t('run.readinessTitle')} headingLevel={2}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            begin()
          }}
        >
          <p className="text-ink-muted text-reading max-w-[72ch]">{t('run.readinessBody')}</p>
          <FormAlert message={failure} />
          <SubmitButton pending={pending}>
            {pending ? t('run.beginPending') : t('run.beginReadiness')}
          </SubmitButton>
        </form>
      </Panel>
    </div>
  )
}
