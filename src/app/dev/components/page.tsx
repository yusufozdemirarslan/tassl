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
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
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
import { institutions, rail, runs, tokens, typeScale, user } from './fixtures'

export const metadata: Metadata = { title: 'Component gallery · Tassl' }

const LABELS: LabelKind[] = [
  'draft',
  'confirmed',
  'uncalibrated',
  'walkthrough',
  'provisional',
  'unreviewed',
]

function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mb-12">
      <h2 id={`${id}-title`} className="text-h2 border-line mb-6 border-b pb-2">
        {title}
      </h2>
      <div className="grid gap-8">{children}</div>
    </section>
  )
}

function Demo({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="text-ink-muted text-meta mb-3 font-sans font-medium">{title}</h3>
      {children}
    </div>
  )
}

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

      <Group id="tokens" title="Tokens">
        <Demo title="Color">
          <Table>
            <TableCaption>Token values are declared on :root in src/app/globals.css.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Swatch</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Use</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => (
                <TableRow key={token.name}>
                  <TableCell>
                    <span
                      aria-hidden="true"
                      className="border-line block h-6 w-12 rounded-sm border"
                      style={{ background: `var(--${token.name})` }}
                    />
                  </TableCell>
                  <TableCell className="text-mono font-mono">--{token.name}</TableCell>
                  <TableCell>{token.use}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Demo>
        <Demo title="Type scale">
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
        <Demo title="Spacing, radius, elevation">
          <div className="flex flex-wrap items-end gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((step) => (
              <div key={step} className="flex flex-col items-center gap-1">
                <span
                  className="bg-primary-soft block rounded-sm"
                  style={{ width: `var(--space-${step})`, height: `var(--space-${step})` }}
                />
                <span className="text-ink-muted text-mono-sm font-mono">{step}</span>
              </div>
            ))}
            <span
              className="border-line-control ml-6 size-10 rounded-sm border"
              title="radius-sm"
            />
            <span className="border-line-control size-10 rounded-md border" title="radius-md" />
            <span className="border-line-control size-10 rounded-lg border" title="radius-lg" />
            <span
              className="bg-paper-raised shadow-float ml-6 size-10 rounded-lg"
              title="shadow-float"
            />
          </div>
        </Demo>
      </Group>

      <Group id="layout" title="Layout components">
        <Demo title="Panel">
          <Panel
            id="demo-panel"
            title="Evidence Room"
            description="Four documents; two are superseded."
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
        <Demo title="Empty state">
          <Panel>
            <EmptyState
              title="No runs yet"
              body="When an instructor assigns you a run, it appears here with its start date."
              action={<Button variant="secondary">Check again</Button>}
            />
          </Panel>
        </Demo>
        <Demo title="Error state">
          <Panel>
            <ErrorState
              message="The run could not be loaded."
              requestId="5b2c1a7e-9d0f-4c3a-8e21-6f4a2b9c0d11"
              action={<Button>Try again</Button>}
            />
          </Panel>
        </Demo>
        <Demo title="Illustrative sample">
          <IllustrativeSample label="Sample review queue">
            <Table>
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
        <Demo title="Label chips">
          <div className="flex flex-wrap gap-2">
            {LABELS.map((kind) => (
              <LabelChip key={kind} kind={kind} />
            ))}
          </div>
        </Demo>
        <Demo title="Rail (desktop and bottom-bar layouts share one component)">
          <div className="border-line inline-block overflow-hidden rounded-md border [&_nav]:static! [&_nav]:w-56 [&_nav]:border-0!">
            <Rail items={rail} />
          </div>
        </Demo>
        <Demo title="Institution switcher (none, one, several)">
          <div className="flex flex-wrap items-center gap-8">
            <InstitutionSwitcher institutions={[]} />
            <InstitutionSwitcher institutions={institutions.slice(0, 1)} />
            <InstitutionSwitcher institutions={institutions} activeId="org-gu" />
          </div>
        </Demo>
        <Demo title="Notifications bell (none, some, many) and account menu (signed out, signed in)">
          <div className="flex flex-wrap items-center gap-6">
            <NotificationsBell unreadCount={0} />
            <NotificationsBell unreadCount={3} />
            <NotificationsBell unreadCount={120} />
            <Separator orientation="vertical" className="h-8" />
            <AccountMenu user={null} />
            <AccountMenu user={user} />
          </div>
        </Demo>
      </Group>

      <Group id="ui" title="UI primitives">
        <Demo title="Buttons: variants, sizes, disabled">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
            <Button variant="secondary" aria-disabled="true">
              Discoverable but not yet allowed
            </Button>
          </div>
        </Demo>
        <Demo title="Badges">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
        </Demo>
        <Demo title="Progress, skeleton, separator, scroll area">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="demo-progress">Generation progress</Label>
              <Progress id="demo-progress" value={40} aria-label="Generation progress" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
            <ScrollArea className="border-line h-32 rounded-md border p-3">
              <ol
                tabIndex={0}
                aria-label="Trace excerpt"
                className="text-mono-sm grid gap-2 font-mono"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <li
                    key={i}
                  >{`00:${String(i * 4).padStart(2, '0')}:00 · document_opened · doc-${i + 1}`}</li>
                ))}
              </ol>
            </ScrollArea>
            <Separator className="md:col-span-2" />
          </div>
        </Demo>
        <Demo title="Forms: field, input, textarea, select, checkbox, radio, switch, tabs">
          <FormDemos />
        </Demo>
        <Demo title="Overlays: dialog, alert dialog, sheet, popover, tooltip, dropdown menu, toast">
          <OverlayDemos />
        </Demo>
      </Group>
    </div>
  )
}
