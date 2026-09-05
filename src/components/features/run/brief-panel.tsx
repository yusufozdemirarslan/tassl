import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'

// UI-023, left column: the Scenario Brief (FR-020) — at most 200 words of situation, written by the
// package author and read by the student before anything else on the run.
//
// It is a Server Component and stays one. Nothing here is interactive, so the browser is sent no
// JavaScript for it and the brief is in the first HTML the student receives — which is the point,
// because it is the first thing they read and the working clock has not started yet. That is also
// why it may use the whole catalogue's `t`: nothing imports this file into a client bundle.
//
// The brief is the author's prose, so it is set at the reading measure DESIGN.md gives student
// writing (16/26, 72ch), and its opening paragraph takes the Lead style the design system reserves
// for exactly this: "Lead (Sans 400, 18px, 28px): the scenario brief's opening."
//
// **The paragraphs are the author's own.** The text arrives as plain text with markup already
// stripped (`10 §5`), so the only structure applied is the blank lines the author typed; single
// newlines are preserved inside a paragraph rather than joined, because an author who laid out a
// short list of figures meant those lines. Nothing is highlighted, numbered, or summarised —
// FR-023's rule about the room holds over the brief above it just as plainly.

/** Blank-line-separated paragraphs, with any run of blank lines counting once. */
function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
}

export type BriefPanelProps = {
  /** `RunWorkspace.brief.text`: the scenario's own brief, never the student's decision brief. */
  text: string
}

export function BriefPanel({ text }: BriefPanelProps) {
  const paragraphs = paragraphsOf(text)

  return (
    <Panel id="scenario-brief" title={t('workspace.briefTitle')} headingLevel={2} padding="reading">
      {paragraphs.length === 0 ? (
        <p className="text-ink-muted text-reading">{t('workspace.briefEmpty')}</p>
      ) : (
        <div className="flex max-w-[72ch] flex-col gap-4">
          {paragraphs.map((paragraph, index) => (
            <p
              key={paragraph.slice(0, 48) + String(index)}
              className={
                index === 0
                  ? 'text-ink text-lead whitespace-pre-line'
                  : 'text-ink text-reading whitespace-pre-line'
              }
            >
              {paragraph}
            </p>
          ))}
        </div>
      )}
    </Panel>
  )
}
