import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LegalPage } from '@/components/features/legal/legal-page'
import { formatDate } from '@/lib/format/date-time'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { LegalDeployment, LegalDocument } from '@/lib/legal/document'
import { privacyDocument } from '@/lib/legal/privacy'

// UI-006's one renderer for both legal pages. Nothing here decides what either page says —
// `src/lib/legal/{privacy,terms}.ts` do — so this is about the two duties the renderer has left:
// turning a document into a navigable outline, and turning a block into the right element.
//
// The second is the one worth pinning. A table block is a table with a caption that names it and a
// first column that heads each row (DESIGN.md §Tables); a list block is a list. Rendered as
// paragraphs the two would look almost the same and read to a screen reader as an undifferentiated
// wall, which on the page describing what a product stores about a person is a real loss.
//
// The last describe renders the real privacy document, because four sentences on it are product
// invariants rather than copy (FR-006, D-018): Tassl makes no misconduct findings, a declaration of
// outside-tool use changes nothing, there is no total or rank or percentile anywhere, and a live
// run hiding its own answer key is a rule about the run rather than a judgment about the student.

const LAST_REVIEWED = '2026-09-07'

const STORED_CAPTION = 'What Tassl stores, and where each item comes from'
const STORED_COLUMNS = ['What', 'Detail', 'Where it comes from']
const STORED_ROWS = [
  ['Your account', 'Your name and your email address.', 'You, when you sign up.'],
  ['Your run', 'Everything you write in a run.', 'You, during a run.'],
] as const satisfies readonly (readonly [string, string, string])[]

const RIGHTS = ['Correct your name in Settings.', 'Download what Tassl holds.']

const DOC: LegalDocument = {
  title: 'Privacy',
  summary: 'What this installation stores, and what it does with it.',
  lastReviewed: LAST_REVIEWED,
  sections: [
    {
      id: 'scope',
      heading: 'What this page covers',
      blocks: [
        { kind: 'paragraph', text: 'You reach Tassl through an institution.' },
        { kind: 'paragraph', text: 'The institution decides who has an account.' },
      ],
    },
    {
      id: 'collected',
      heading: 'What Tassl stores',
      blocks: [
        {
          kind: 'table',
          caption: STORED_CAPTION,
          columns: STORED_COLUMNS,
          rows: STORED_ROWS,
        },
      ],
    },
    {
      id: 'rights',
      heading: 'What you can do',
      blocks: [{ kind: 'list', items: RIGHTS }],
    },
  ],
}

const LOCAL_DEPLOYMENT: LegalDeployment = {
  contactEmail: 'privacy@tassl.example',
  managedHosting: false,
  emailDelivery: false,
  googleSignIn: false,
  analytics: false,
  errorMonitoring: false,
  llmProvider: 'mock',
  llmModel: '',
}

describe('LegalPage (UI-006)', () => {
  it('gives the document its page title, its summary, and the date a person last read it', () => {
    render(<LegalPage document={DOC} />)

    expect(screen.getByRole('heading', { level: 1, name: DOC.title })).toBeInTheDocument()
    expect(screen.getByText(DOC.summary)).toBeInTheDocument()

    const reviewed = screen.getByText(t('legal.lastReviewed', { date: formatDate(LAST_REVIEWED) }))
    // The machine-readable value stays the ISO date the document carries, so the sentence a person
    // reads and the value a parser reads cannot drift apart.
    expect(reviewed).toHaveAttribute('datetime', LAST_REVIEWED)
    // A calendar date with no clock and no zone on it, in the product's one fixed format (D-177).
    expect(reviewed).toHaveTextContent('September 7, 2026')
  })

  // The contents list is a labelled nav rather than a stripe of teal words between the description
  // and the document, and every entry lands on a section that exists.
  it('lists the sections in order, each entry landing on the section it names', () => {
    render(<LegalPage document={DOC} />)

    const contents = screen.getByRole('navigation', { name: enUS['legal.contentsLabel'] })
    const entries = within(contents).getAllByRole('link')

    expect(entries.map((entry) => entry.textContent)).toEqual(
      DOC.sections.map((section) => section.heading),
    )
    expect(entries.map((entry) => entry.getAttribute('href'))).toEqual(
      DOC.sections.map((section) => `#${section.id}`),
    )
    for (const section of DOC.sections) {
      // The anchor is a landmark named by its own heading, so following the link says where it went.
      expect(screen.getByRole('region', { name: section.heading })).toHaveAttribute(
        'id',
        section.id,
      )
    }
  })

  it('gives every section a second-level heading, in the order the document wrote them', () => {
    render(<LegalPage document={DOC} />)

    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map((heading) => heading.textContent)).toEqual(
      DOC.sections.map((section) => section.heading),
    )
  })

  it('renders a paragraph block as prose, in the order the section wrote it', () => {
    render(<LegalPage document={DOC} />)

    const scope = screen.getByRole('region', { name: 'What this page covers' })
    expect(within(scope).getByText('You reach Tassl through an institution.')).toBeInTheDocument()
    expect(
      within(scope).getByText('The institution decides who has an account.'),
    ).toBeInTheDocument()
  })

  it('renders a list block as a list, one item to a sentence', () => {
    render(<LegalPage document={DOC} />)

    const rights = screen.getByRole('region', { name: 'What you can do' })
    expect(
      within(rights)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(RIGHTS)
  })

  // The caption is the table's accessible name, and the first cell of a row heads that row rather
  // than being another cell: the row is then read as "Your run: everything you write in a run",
  // which is the whole reason for the table being a table.
  it('renders a table block with its caption as the name and the first column heading each row', () => {
    render(<LegalPage document={DOC} />)

    const table = screen.getByRole('table', { name: STORED_CAPTION })
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((column) => column.textContent),
    ).toEqual(STORED_COLUMNS)

    const lines = within(table).getAllByRole('row').slice(1)
    expect(lines.map((line) => within(line).getByRole('rowheader').textContent)).toEqual(
      STORED_ROWS.map(([name]) => name),
    )
    expect(
      lines.map((line) =>
        within(line)
          .getAllByRole('cell')
          .map((cell) => cell.textContent),
      ),
    ).toEqual(STORED_ROWS.map(([, ...cells]) => cells))
  })

  it('draws no contents entry and no section for a document with none', () => {
    render(<LegalPage document={{ ...DOC, sections: [] }} />)

    const contents = screen.getByRole('navigation', { name: enUS['legal.contentsLabel'] })
    expect(within(contents).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: DOC.title })).toBeInTheDocument()
  })
})

describe('the privacy page as this installation can honestly describe itself', () => {
  it('denies the misconduct reading, and the totals with it (FR-006, D-018)', () => {
    render(<LegalPage document={privacyDocument(LOCAL_DEPLOYMENT)} />)

    expect(screen.getByText(enUS['legal.noMisconductFindings'])).toBeInTheDocument()
    expect(screen.getByText(enUS['legal.privacy.limits.declaration'])).toBeInTheDocument()
    expect(screen.getByText(enUS['legal.privacy.limits.noTotals'])).toBeInTheDocument()
    // What a live run withholds — the warranted stance, the planted document, what the checks would
    // have found — is named as a rule about the run, and as something the debrief opens on scoring.
    expect(screen.getByText(enUS['legal.privacy.limits.hidden'])).toBeInTheDocument()
  })

  // "A service that is switched off here is not named here": the processor table is built from the
  // deployment's own configuration, so a page rendered for a local installation running the mock
  // provider must not name a hosted service that never sees a byte of it.
  it('names no service this installation does not use', () => {
    render(<LegalPage document={privacyDocument(LOCAL_DEPLOYMENT)} />)

    const processors = screen.getByRole('table', {
      name: enUS['legal.privacy.processors.caption'],
    })
    expect(
      within(processors).getByRole('rowheader', {
        name: enUS['legal.privacy.processors.databaseLocal'],
      }),
    ).toBeInTheDocument()
    for (const service of [
      enUS['legal.privacy.processors.hosting'],
      enUS['legal.privacy.processors.email'],
      enUS['legal.privacy.processors.google'],
      enUS['legal.privacy.processors.analytics'],
      enUS['legal.privacy.processors.monitoring'],
    ]) {
      expect(within(processors).queryByRole('rowheader', { name: service })).not.toBeInTheDocument()
    }
    // No model-provider row at all, and the sentence saying why in its place.
    expect(screen.getByText(enUS['legal.privacy.processors.modelNone'])).toBeInTheDocument()
  })

  it('names the model provider when there is one for a run to reach', () => {
    render(
      <LegalPage
        document={privacyDocument({
          ...LOCAL_DEPLOYMENT,
          llmProvider: 'mimo',
          llmModel: 'MiMo-V2.5-Pro',
        })}
      />,
    )

    const processors = screen.getByRole('table', {
      name: enUS['legal.privacy.processors.caption'],
    })
    expect(
      within(processors).getByRole('rowheader', {
        name: t('legal.privacy.processors.model', { provider: 'mimo', model: 'MiMo-V2.5-Pro' }),
      }),
    ).toBeInTheDocument()
    expect(screen.queryByText(enUS['legal.privacy.processors.modelNone'])).not.toBeInTheDocument()
  })
})
