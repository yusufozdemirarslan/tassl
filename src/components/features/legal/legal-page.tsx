import { PageHeader } from '@/components/layout/page-header'
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
import { formatDate } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/messages/legal'
import type { LegalBlock, LegalDocument } from '@/lib/legal/document'

// UI-006. One renderer for both legal pages, because they are the same document in two contents:
// a page title, the date a person last read it against the code, a contents list, and a run of
// sections. Nothing here decides what either page says — `src/lib/legal/{privacy,terms}.ts` do,
// from the message catalogue and the deployment's own configuration.
//
// One Panel holds the whole document rather than one per section: sections are separated by
// whitespace and a hairline, never by nested containers (DESIGN.md §Layout, the One-Layer Rule).
//
// The column is `max-w-3xl` (768 px) so that the panel's interior — 720 px after its 24 px reading
// padding — is wider than the 60ch measure, which leaves `max-w-measure` as the thing that actually
// clamps the prose rather than a hand-written width doing it silently (D-317). It is also what lets
// the two tables sit at their natural width instead of side-scrolling at every viewport: a table
// declares no minimum here, and the scroll region under it takes over only when the viewport is
// genuinely narrower than the content.

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === 'paragraph') {
    return <p className="text-ink text-reading max-w-measure">{block.text}</p>
  }
  if (block.kind === 'list') {
    return (
      <ul className="text-ink text-reading max-w-measure flex list-disc flex-col gap-2 pl-5">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    )
  }
  return (
    <Table>
      <TableCaption>{block.caption}</TableCaption>
      <TableHeader>
        <TableRow>
          {block.columns.map((column) => (
            <TableHead key={column} scope="col">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {block.rows.map((row) => (
          <TableRow key={row[0]}>
            {row.map((cell, index) =>
              index === 0 ? (
                <TableHead key={cell} scope="row" className="text-ink align-top whitespace-normal">
                  {cell}
                </TableHead>
              ) : (
                <TableCell key={cell} className="align-top whitespace-normal">
                  {cell}
                </TableCell>
              ),
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function LegalPage({ document }: { document: LegalDocument }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={document.title} description={document.summary} className="mb-4" />
      {/* Under the title, not above it: a date is information about the document, and a line set
          over a heading reads as a label for it. */}
      <p className="text-ink-muted text-mono-sm mb-6 font-mono">
        <time dateTime={document.lastReviewed}>
          {t('legal.lastReviewed', { date: formatDate(document.lastReviewed) })}
        </time>
      </p>
      {/* A visible label, not an aria-label alone: without it the contents read as a stripe of
          teal words between the description and the document. */}
      <nav aria-labelledby="legal-contents" className="mb-6 flex flex-col gap-2">
        <p id="legal-contents" className="text-ink-muted text-meta font-medium">
          {t('legal.contentsLabel')}
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          {document.sections.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="text-primary text-meta focus-visible:outline-focus rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {section.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <Panel padding="reading">
        <div className="divide-line flex flex-col divide-y">
          {document.sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              aria-labelledby={`${section.id}-heading`}
              className={index === 0 ? 'pb-6' : 'py-6 last:pb-0'}
            >
              <h2 id={`${section.id}-heading`} className="text-h3 mb-3">
                {section.heading}
              </h2>
              <div className="flex flex-col gap-4">
                {section.blocks.map((block, blockIndex) => (
                  <Block key={blockIndex} block={block} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </Panel>
    </div>
  )
}
