import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { CircleAlertIcon } from 'lucide-react'
import { LabelChip } from '@/components/layout/label-chip'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/t'
import type {
  CalibrationStatusValue,
  ElementCounts,
  PackageStatusValue,
  PackageVersionView,
  PackageWarningValue,
  ValidationFailure,
} from '@/server/modules/scenarios/schema'

// UI-044, the top of the screen: which version this is, how far it has got, what it teaches, what
// it holds, and everything still standing between it and a confirmation.
//
// The status chip is the one the shelf uses (UI-040), so a version reads the same in both places.
// Amber is spent on state that is still moving — a draft, a warning to act on — and calibration
// takes the neutral wash in both places: every version in this build is uncalibrated, so an amber
// chip there marks nothing and only makes the two amber facts that do mean something harder to see
// (DESIGN.md §Chips allows `--paper-sunken` as a label-chip fill). The calibration sentence
// 09-frontend-spec-screens.md §UI-044 gives verbatim carries the meaning either way: nothing here
// has been in front of a cohort, so the difficulty line is an estimate and says so (FR-196).
//
// The rule failures are rendered here rather than pointed at, in the shape a refusal takes
// everywhere in the product: the sentence to act on, then the rule code and the elements at fault
// in mono, because that is what the author searches the export for.
//
// Everything here is a server component. The export is an ordinary GET on the API route, so it is a
// link rather than a button: no JavaScript is downloaded for it, and it works from the keyboard,
// from a middle-click, and from a browser with scripting off.

export type VersionHeaderProps = {
  version: PackageVersionView
  /** Where the confirmation workspace lives for this version (Step 5.5 builds it). */
  confirmHref: Route
}

type CountEntry = readonly [keyof ElementCounts, () => string]

/**
 * Claims and variants are what a version is: the claims a student takes a stance on, and the two
 * readings of the scenario they are taken against. The other six are inventory — worth reading,
 * not worth reading first — so they are set at body size under the pair.
 */
const LEAD_COUNTS = [
  ['claims', () => t('packageVersion.countClaims')],
  ['variants', () => t('packageVersion.countVariants')],
] as const satisfies readonly CountEntry[]

/** The rest, in the order the confirmation workspace lists the elements. */
const OTHER_COUNTS = [
  ['documents', () => t('packageVersion.countDocuments')],
  ['stakeholders', () => t('packageVersion.countStakeholders')],
  ['answerSpacePositions', () => t('packageVersion.countPositions')],
  ['namedFields', () => t('packageVersion.countNamedFields')],
  ['defenseQuestions', () => t('packageVersion.countQuestions')],
  ['readinessItems', () => t('packageVersion.countReadinessItems')],
] as const satisfies readonly CountEntry[]

const WARNINGS: Record<PackageWarningValue, { label: () => string; help: () => string }> = {
  FAMILY_LACKS_ETHICAL_DEFECT: {
    label: () => t('packages.warningEthicalShortcut'),
    help: () => t('packages.warningEthicalShortcutHelp'),
  },
}

/**
 * Draft and confirmed are the two states this build writes, and both are label chips already.
 * Retired is in the enum and nothing sets it yet, so it takes the neutral badge rather than a wash
 * that would claim a meaning the state does not have.
 */
function StatusChip({ status }: { status: PackageStatusValue }) {
  if (status === 'draft') return <LabelChip kind="draft" />
  if (status === 'confirmed') return <LabelChip kind="confirmed" />
  return <Badge variant="secondary">{t('packages.statusRetired')}</Badge>
}

function CalibrationChip({ status }: { status: CalibrationStatusValue }) {
  if (status === 'uncalibrated') {
    return (
      <LabelChip
        kind="uncalibrated"
        className="bg-paper-sunken border-line-strong [&_svg]:text-ink-muted"
      />
    )
  }
  return <Badge variant="secondary">{t('packages.calibrated')}</Badge>
}

/** One labelled fact in the version's identity list. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-ink-muted text-meta">{label}</dt>
      <dd className="text-ink text-body break-words">{children}</dd>
    </div>
  )
}

/**
 * An id you paste into a URL or a support thread. It keeps its label and its mono figures and
 * gives up the weight: at the size of Version and Status, two uuids were the loudest thing in the
 * identity list and the only two facts in it nobody reads.
 */
function Identifier({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink-muted text-mono-sm font-mono break-all">{value}</dd>
    </div>
  )
}

/** Seconds as an author reads them: 1500 is twenty-five minutes, not a number to divide. */
function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return t('packageVersion.durationSeconds', { seconds })
  if (seconds === 0) return t('packageVersion.durationMinutes', { minutes })
  return t('packageVersion.durationMinutesSeconds', { minutes, seconds })
}

/** The one sentence that says what state this version is in and what follows from it. */
function statusSentence(version: PackageVersionView): string {
  if (version.status === 'retired') {
    return t('packageVersion.retiredDescription', { version: version.version })
  }
  if (version.status === 'confirmed') {
    return version.confirmedAt === null
      ? t('packageVersion.confirmedDescriptionNoDate', { version: version.version })
      : t('packageVersion.confirmedDescription', {
          version: version.version,
          date: formatDateTime(version.confirmedAt),
        })
  }
  return t('packageVersion.draftDescription', { version: version.version })
}

/** A second level of grouping inside the panel: a heading and a hairline, never another panel. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-line flex flex-col items-start gap-3 border-t pt-5">
      <h3 className="text-h4">{title}</h3>
      {children}
    </section>
  )
}

/** The concepts a course matches its own against: short keys, so they read as keys (FR-180). */
function ConceptSet({ concepts }: { concepts: readonly string[] }) {
  return (
    <Section title={t('packageVersion.conceptsTitle')}>
      <p className="text-ink-muted text-body max-w-[72ch]">
        {t('packageVersion.conceptsDescription')}
      </p>
      <ul className="flex flex-wrap gap-2">
        {concepts.map((concept) => (
          <li
            key={concept}
            className="bg-paper-sunken text-ink text-mono-sm rounded-sm px-2 py-1 font-mono"
          >
            {concept}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Counts({ counts }: { counts: ElementCounts }) {
  return (
    <Section title={t('packageVersion.countsTitle')}>
      <dl className="grid w-full max-w-sm grid-cols-2 gap-4">
        {LEAD_COUNTS.map(([key, label]) => (
          <div key={key} className="flex min-w-0 flex-col gap-1">
            <dt className="text-ink-muted text-meta">{label()}</dt>
            <dd className="text-ink text-h3 font-mono tabular-nums">{counts[key]}</dd>
          </div>
        ))}
      </dl>
      <dl className="border-line grid w-full grid-cols-1 gap-x-8 gap-y-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-3">
        {OTHER_COUNTS.map(([key, label]) => (
          <div key={key} className="flex min-w-0 items-baseline justify-between gap-3">
            <dt className="text-ink-muted text-meta">{label()}</dt>
            <dd className="text-ink text-body font-mono tabular-nums">{counts[key]}</dd>
          </div>
        ))}
      </dl>
    </Section>
  )
}

/**
 * Something to put right before this package is used (FR-190, D-083). A warning never blocks a
 * confirmation, so it is amber rather than red — but it is on the version's own screen, because
 * the shelf is where an author sees it and this is where they came to act on it.
 */
function Warnings({ warnings }: { warnings: readonly PackageWarningValue[] }) {
  return (
    <Section title={t('packageVersion.warningsTitle')}>
      <ul className="flex flex-col gap-4">
        {warnings.map((warning) => (
          <li key={warning} className="flex flex-col items-start gap-2">
            <LabelChip kind="warning" label={WARNINGS[warning].label()} />
            <p className="text-ink-muted text-body max-w-[72ch]">{WARNINGS[warning].help()}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/**
 * Why this draft cannot be confirmed yet, rule by rule. The shape is the product's refusal: the
 * sentence to act on in full ink on the red wash, then the rule code and the ids of the elements
 * at fault in mono. Every failure is listed rather than the first few — `validatePackage` is total
 * for exactly this reason, and an author fixing a package needs the whole list.
 */
function RuleFailures({ failures }: { failures: readonly ValidationFailure[] }) {
  return (
    <div className="border-red bg-red-soft text-ink text-body flex w-full max-w-[72ch] items-start gap-2 rounded-md border p-3">
      <CircleAlertIcon aria-hidden="true" className="text-red mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p>{t('packageVersion.rulesFailing', { count: failures.length })}</p>
        <ul className="text-meta flex flex-col gap-2">
          {failures.map((failure) => (
            <li key={failure.code} className="flex flex-col gap-0.5">
              <span className="text-ink">{failure.message}</span>
              <span className="text-ink text-mono-sm font-mono break-words">
                {failure.elementIds.length === 0
                  ? failure.code
                  : `${failure.code} · ${t('packageVersion.ruleElements', {
                      keys: failure.elementIds.join(', '),
                    })}`}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function VersionHeader({ version, confirmHref }: VersionHeaderProps) {
  const exportHref = `/api/v1/package-versions/${version.id}/export`
  const failures = version.validation.failures

  return (
    <>
      <PageHeader
        title={version.packageTitle}
        description={statusSentence(version)}
        eyebrow={
          <Link
            href="/packages"
            className="text-primary focus-visible:outline-focus rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t('packageVersion.backToPackages')}
          </Link>
        }
        actions={
          version.restricted ? undefined : (
            // The API route answers with `content-disposition: attachment`, so the browser saves
            // the file instead of navigating away from this screen.
            <a href={exportHref} className={buttonVariants({ variant: 'secondary' })}>
              {t('packageVersion.export')}
            </a>
          )
        }
      />

      {/* The header region owns the gap to what follows it, the way `PageHeader` does. */}
      <Panel
        id="version-identity"
        title={t('packageVersion.identityTitle')}
        headingLevel={2}
        className="mb-6"
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Fact label={t('packageVersion.versionLabel')}>
                <span className="font-mono tabular-nums">{version.version}</span>
              </Fact>
              <Fact label={t('packageVersion.statusLabel')}>
                <StatusChip status={version.status} />
              </Fact>
              <Fact label={t('packageVersion.calibrationLabel')}>
                {/* `items-start` or the chip stretches to the column and reads as a banner. */}
                <span className="flex flex-col items-start gap-1">
                  <CalibrationChip status={version.calibrationStatus} />
                  {version.calibrationStatus === 'uncalibrated' && (
                    <span className="text-ink-muted text-meta">
                      {t('packageVersion.uncalibratedNote')}
                    </span>
                  )}
                </span>
              </Fact>
              <Fact label={t('packageVersion.familyKeyLabel')}>
                <span className="font-mono">{version.familyKey}</span>
              </Fact>
              <Fact label={t('packageVersion.workingClockLabel')}>
                <span className="font-mono tabular-nums">
                  {formatSeconds(version.workingClockSeconds)}
                </span>
              </Fact>
              <Fact label={t('packageVersion.turnDelayLabel')}>
                <span className="font-mono tabular-nums">
                  {formatSeconds(version.turnDelaySeconds)}
                </span>
              </Fact>
              <Fact label={t('packageVersion.difficultyLabel')}>
                <span className="flex flex-col gap-1">
                  <span>{version.difficultyProfile.estimate}</span>
                  {version.difficultyProfile.note.length > 0 && (
                    <span className="text-ink-muted text-meta">
                      {version.difficultyProfile.note}
                    </span>
                  )}
                </span>
              </Fact>
            </dl>

            <dl className="text-meta flex flex-wrap gap-x-6 gap-y-1">
              <Identifier label={t('packageVersion.packageIdLabel')} value={version.packageId} />
              <Identifier label={t('packageVersion.versionIdLabel')} value={version.id} />
            </dl>
          </div>

          {version.conceptSet.length > 0 && <ConceptSet concepts={version.conceptSet} />}

          {/* A restricted seat is told this version's contents are not theirs to read. Titling a
              panel "What it holds" over eight counts of them would contradict that on the same
              screen, so the counts belong to the same gate the contents do (08 §4). */}
          {!version.restricted && <Counts counts={version.counts} />}

          {version.warnings.length > 0 && <Warnings warnings={version.warnings} />}

          {version.status === 'draft' && !version.restricted && (
            <Section title={t('packageVersion.rulesTitle')}>
              {failures.length === 0 ? (
                <p className="text-ink-muted text-body max-w-[72ch]">
                  {t('packageVersion.rulesPass')}
                </p>
              ) : (
                <RuleFailures failures={failures} />
              )}
              {version.capabilities.canEdit ? (
                <Link href={confirmHref} className={buttonVariants({ className: 'w-fit' })}>
                  {t('packageVersion.openWorkspace')}
                </Link>
              ) : (
                <p className="text-ink-muted text-body max-w-[72ch]">
                  {t('packageVersion.draftReadOnly')}
                </p>
              )}
            </Section>
          )}
        </div>
      </Panel>
    </>
  )
}
