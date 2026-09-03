import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AccountMenu } from '@/components/layout/account-menu'
import { EmptyState } from '@/components/layout/empty-state'
import { ErrorState } from '@/components/layout/error-state'
import { IllustrativeSample } from '@/components/layout/illustrative-sample'
import { InstitutionSwitcher } from '@/components/layout/institution-switcher'
import { LabelChip, type LabelKind } from '@/components/layout/label-chip'
import { NotificationsBell } from '@/components/layout/notifications-bell'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { Rail } from '@/components/layout/rail'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { FormDemos, OverlayDemos } from './demos'
import { institutions, rail, runs, spacing, tokenRows, typeScale, user } from './fixtures'

// The root layout's template appends " · Tassl" (WCAG 2.4.2).
export const metadata: Metadata = { title: 'Component gallery' }

const LABELS: LabelKind[] = [
  'draft',
  'confirmed',
  'uncalibrated',
  'walkthrough',
  'provisional',
  'unreviewed',
]

// The three groups double as the jump row under the header.
const SECTIONS = [
  { id: 'tokens', title: 'Tokens' },
  { id: 'layout', title: 'Layout components' },
  { id: 'ui', title: 'UI primitives' },
] as const

const RADII: Array<{ className: string; caption: string }> = [
  { className: 'rounded-sm', caption: 'sm 2 px' },
  { className: 'rounded-md', caption: 'md 6 px' },
  { className: 'rounded-lg', caption: 'lg 10 px' },
]

const slug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-12 scroll-mt-6">
      <h2 id={`${id}-title`} className="text-h2 border-line mb-6 border-b pb-2">
        {title}
      </h2>
      {/* minmax(0,1fr) stops nowrap tables from widening the page; they scroll in their own box. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-8">{children}</div>
    </section>
  )
}

// One specimen: an anchor named after its caption, the component name, and the file it exercises.
function Demo({ title, source, children }: { title: string; source: string; children: ReactNode }) {
  return (
    <div id={slug(title)} className="min-w-0 scroll-mt-6">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-ink text-meta font-sans font-medium">{title}</h3>
        {/* wrap-anywhere breaks a long path at its hyphens and braces first, mid-token only when nothing else fits. */}
        <span className="text-ink-muted text-mono-sm min-w-0 font-mono wrap-anywhere">
          {source}
        </span>
      </div>
      {children}
    </div>
  )
}

function ButtonRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <span id={`${id}-label`} className="text-ink-muted text-meta">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={`${id}-label`}
        className="flex flex-wrap items-center gap-3"
      >
        {children}
      </div>
    </div>
  )
}

function SampleCaption({ children }: { children: ReactNode }) {
  return <span className="text-ink-muted text-mono-sm font-mono">{children}</span>
}

// Forces the Rail's bottom-bar arrangement at every viewport so the desktop review shows both
// layouts side by side; the real switch is the md media query inside the component. Under md the
// items are 48 px tall with the icon stacked over the label, so the md+ row classes are pinned back.
const BOTTOM_BAR_FRAME =
  'border-line relative h-20 w-full max-w-[360px] overflow-hidden rounded-md border ' +
  '[&_nav]:absolute! [&_nav]:inset-x-0! [&_nav]:bottom-0! [&_nav]:w-auto! [&_nav]:border-t! [&_nav]:border-r-0! ' +
  '[&_ul]:flex-row! [&_ul]:justify-around! [&_ul]:px-2! [&_ul]:py-1! [&_li]:flex-1! ' +
  '[&_a]:h-12! [&_a]:flex-col! [&_a]:justify-center! [&_a]:gap-0.5! [&_a]:px-1!'

// The opposite pin: the desktop rail at every viewport, in a 224 px column with 40 px row items.
const RAIL_FRAME =
  'border-line inline-block overflow-hidden rounded-md border ' +
  '[&_nav]:static! [&_nav]:w-56! [&_nav]:border-0! ' +
  '[&_ul]:flex-col! [&_ul]:justify-start! [&_ul]:px-3! [&_ul]:py-4! [&_li]:flex-none! ' +
  '[&_a]:h-10! [&_a]:flex-row! [&_a]:justify-start! [&_a]:gap-2! [&_a]:px-3!'

// UI-060: every component in every state, on fixture data, for review and Lighthouse CI.
// Renders only when APP_ENV is local or test (src/app/dev/layout.tsx).
export default function ComponentGalleryPage() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Component gallery"
        description="Every component in every state, on fixture data. This page is the design review surface and the Lighthouse target for run-route script budgets."
        eyebrow="UI-060 · local and test only"
        actions={<Badge variant="outline">DESIGN.md v1</Badge>}
      />
      <nav aria-label="Sections" className="mb-8">
        {/* Each link keeps its text-sized focus ring; the ::before box widens the tap target to the
            40 px nav-item height (DESIGN.md §Layout), and the row gap keeps wrapped targets apart. */}
        <ul className="flex flex-wrap gap-x-4 gap-y-5">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="text-ink-muted text-meta hover:text-ink focus-visible:outline-focus relative inline-block rounded-sm underline underline-offset-2 transition-colors duration-150 ease-out before:absolute before:inset-x-0 before:-inset-y-2.5 focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <Group id={SECTIONS[0].id} title={SECTIONS[0].title}>
        <Demo title="Color" source="DESIGN.md">
          {/* The caption names the table and its scroll region. It stays one short line: a caption
              takes the table's width, so a long one clips inside the region at 360 px. */}
          <Table>
            <TableCaption className="text-left">
              Color tokens with their WCAG 2.x contrast against --paper
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Swatch</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Value</TableHead>
                <TableHead className="text-right">Contrast</TableHead>
                <TableHead>Use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokenRows().map((token) => (
                <TableRow key={token.name}>
                  <TableCell>
                    <span
                      aria-hidden="true"
                      className="border-line block h-6 w-12 rounded-sm border"
                      style={{ background: `var(--${token.name})` }}
                    />
                  </TableCell>
                  <TableCell className="text-mono font-mono">--{token.name}</TableCell>
                  <TableCell className="text-mono font-mono">{token.value}</TableCell>
                  <TableCell className="text-mono tabular text-right font-mono">
                    {token.contrast}
                  </TableCell>
                  <TableCell className="whitespace-normal">{token.use}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-ink-muted text-meta mt-3 max-w-[72ch]">
            Values are read from the DESIGN.md frontmatter when the page renders; globals.css
            declares the same values on :root, and a unit test keeps the two in sync.
          </p>
        </Demo>
        <Demo title="Type scale" source="src/app/globals.css">
          <ul className="grid gap-4">
            {typeScale.map((step) => (
              <li
                key={step.label}
                className="grid gap-1 md:grid-cols-[16rem_1fr] md:items-baseline"
              >
                <span className="text-ink-muted text-mono-sm font-mono">{step.label}</span>
                <span className={step.className}>{step.sample}</span>
              </li>
            ))}
          </ul>
        </Demo>
        <Demo title="Spacing, radius, elevation" source="src/app/globals.css">
          <div className="flex flex-wrap items-end gap-8">
            <div className="flex flex-wrap items-end gap-3">
              {spacing.map(({ step, px }) => (
                <div key={step} className="flex flex-col items-center gap-1">
                  <span
                    aria-hidden="true"
                    className="bg-primary-soft block rounded-sm"
                    style={{ width: `var(--space-${step})`, height: `var(--space-${step})` }}
                  />
                  <SampleCaption>{`${step} · ${px} px`}</SampleCaption>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {RADII.map((radius) => (
                <div key={radius.caption} className="flex flex-col items-center gap-1">
                  <span
                    aria-hidden="true"
                    className={`border-line-control size-10 border ${radius.className}`}
                  />
                  <SampleCaption>{radius.caption}</SampleCaption>
                </div>
              ))}
            </div>
            <div className="flex flex-col items-center gap-1">
              <span
                aria-hidden="true"
                className="bg-paper-raised shadow-float size-10 rounded-lg"
              />
              <SampleCaption>float</SampleCaption>
            </div>
          </div>
        </Demo>
      </Group>

      <Group id={SECTIONS[1].id} title={SECTIONS[1].title}>
        <Demo title="Panel" source="src/components/layout/panel.tsx">
          <Panel
            id="demo-panel"
            title="Evidence Room"
            description="Four documents; two are superseded."
            headingLevel={4}
            actions={
              <Button variant="secondary" size="sm">
                Open all
              </Button>
            }
          >
            <p className="text-body">
              Panels are the only container. They never nest; sections inside are separated by
              whitespace and h4 headings.
            </p>
          </Panel>
        </Demo>
        <Demo title="Empty state" source="src/components/layout/empty-state.tsx">
          <Panel>
            <EmptyState
              title="No runs yet"
              body="When an instructor assigns you a run, it appears here with its start date."
              headingLevel={4}
              action={<Button variant="secondary">Check again</Button>}
            />
          </Panel>
        </Demo>
        <Demo title="Error state" source="src/components/layout/error-state.tsx">
          <Panel>
            {/* ErrorState tops out at level 3: an h3 beside the Demo caption's h3 skips nothing. */}
            <ErrorState
              message="The run could not be loaded."
              requestId="5b2c1a7e-9d0f-4c3a-8e21-6f4a2b9c0d11"
              headingLevel={3}
              action={<Button>Try again</Button>}
            />
          </Panel>
        </Demo>
        <Demo title="Illustrative sample" source="src/components/layout/illustrative-sample.tsx">
          <IllustrativeSample label="Sample review queue" headingLevel={4}>
            <Table>
              {/* Names the table's scroll region without repeating the visible heading. */}
              <TableCaption className="sr-only">Runs in the review queue</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Clock</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-mono font-mono">{run.id}</TableCell>
                    <TableCell>{run.scenario}</TableCell>
                    <TableCell>{run.variant}</TableCell>
                    <TableCell>{run.state}</TableCell>
                    <TableCell className="text-mono tabular text-right font-mono">
                      {run.clock}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </IllustrativeSample>
        </Demo>
        <Demo title="Label chips" source="src/components/layout/label-chip.tsx">
          <div className="flex flex-wrap gap-2">
            {LABELS.map((kind) => (
              <LabelChip key={kind} kind={kind} />
            ))}
          </div>
        </Demo>
        <Demo title="Rail (desktop layout, md and up)" source="src/components/layout/rail.tsx">
          <div className={RAIL_FRAME}>
            <Rail items={rail} />
          </div>
        </Demo>
        <Demo
          title="Rail (bottom-bar layout under md, in a 360 px frame)"
          source="src/components/layout/rail.tsx"
        >
          <div className={BOTTOM_BAR_FRAME}>
            <Rail items={rail} />
          </div>
        </Demo>
        <Demo
          title="Institution switcher (none, one, several)"
          source="src/components/layout/institution-switcher.tsx"
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <InstitutionSwitcher institutions={[]} />
            <InstitutionSwitcher institutions={institutions.slice(0, 1)} />
            <InstitutionSwitcher institutions={institutions} activeId="org-gu" />
          </div>
        </Demo>
        <Demo
          title="Notifications bell (none, some, many) and account menu (signed out, signed in)"
          source="src/components/layout/{notifications-bell,account-menu}.tsx"
        >
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <NotificationsBell unreadCount={0} />
            <NotificationsBell unreadCount={3} />
            <NotificationsBell unreadCount={120} />
            <Separator orientation="vertical" className="h-8" />
            <AccountMenu user={null} />
            <AccountMenu user={user} />
          </div>
        </Demo>
      </Group>

      <Group id={SECTIONS[2].id} title={SECTIONS[2].title}>
        <Demo title="Buttons" source="src/components/ui/button.tsx">
          <div className="grid gap-4">
            <ButtonRow id="buttons-variants" label="Variants">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="link">Link</Button>
            </ButtonRow>
            <ButtonRow id="buttons-sizes" label="Sizes">
              <Button size="sm">Small (32 px)</Button>
              <Button>Default (40 px)</Button>
              <Button size="lg">Large (48 px)</Button>
            </ButtonRow>
            <ButtonRow id="buttons-states" label="States">
              <Button disabled>Disabled</Button>
              <Button
                variant="secondary"
                aria-disabled="true"
                aria-describedby="buttons-aria-disabled-why"
              >
                Lock decision
              </Button>
              <p id="buttons-aria-disabled-why" className="text-ink-muted text-meta basis-full">
                <code className="text-mono-sm font-mono">aria-disabled</code> keeps the control in
                the Tab order and lets it announce why it is not yet allowed: here, one claim still
                has no stance.
              </p>
            </ButtonRow>
          </div>
        </Demo>
        <Demo title="Badges" source="src/components/ui/badge.tsx">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </Demo>
        <Demo
          title="Progress, skeleton, separator, scroll area"
          source="src/components/ui/{progress,skeleton,separator,scroll-area}.tsx"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {/* content-start keeps these rows at their own height beside the taller scroll area. The
                progress bar names its label part by id (Base UI links it only after hydration) and shows its
                value in tabular mono. */}
            <div className="grid content-start gap-3">
              <Progress value={40} aria-labelledby="demo-progress-label">
                <ProgressLabel id="demo-progress-label">Generation progress</ProgressLabel>
                <ProgressValue />
              </Progress>
              <Separator />
              <div className="grid gap-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            </div>
            {/* Base UI makes the viewport the tab stop once it overflows (after hydration, so the server
                HTML sets tabIndex 0 as well), and the viewport carries the name; the list itself is not
                focusable, so there is one stop per scroll region. */}
            <ScrollArea
              className="border-line h-32 rounded-md border p-3"
              viewportProps={{ role: 'region', 'aria-label': 'Trace excerpt', tabIndex: 0 }}
            >
              <ol className="text-mono-sm grid gap-2 font-mono">
                {Array.from({ length: 12 }, (_, i) => (
                  <li
                    key={i}
                  >{`00:${String(i * 4).padStart(2, '0')}:00 · document_opened · doc-${i + 1}`}</li>
                ))}
              </ol>
            </ScrollArea>
          </div>
        </Demo>
        <Demo
          title="Forms: field, input, textarea, select, checkbox, radio, switch, tabs"
          source="src/components/ui/{field,input,textarea,select,checkbox,radio-group,switch,tabs}.tsx"
        >
          <FormDemos />
        </Demo>
        <Demo
          title="Overlays: dialog, alert dialog, sheet, popover, tooltip, dropdown menu, toast"
          source="src/components/ui/{dialog,alert-dialog,sheet,popover,tooltip,dropdown-menu,sonner}.tsx"
        >
          <OverlayDemos />
        </Demo>
      </Group>
    </div>
  )
}
