import { CircleAlertIcon, CircleCheckIcon, CircleHelpIcon, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/readiness'
import type { ReadinessConceptStatusValue } from '@/server/modules/runs/schema'

// The concept map that closes the Readiness Check (UI-022, FR-012, FR-014).
//
// **This is the screen a student most expects a score on, and it is the screen that must not have
// one.** There is no total here, no count of items, no percentage, no threshold and no comparison
// with anyone else — CLAUDE.md allows a composite nowhere, and PRD §7.1 gives the check a map of
// named ideas as its whole result. The rows are in the order the check asked about them, never in
// an order that ranks them, because sorting by status would be a scoreboard with the numbers
// hidden.
//
// What each row says is exactly what the server decided and no more: `held` when every item on the
// idea was answered correctly, `not_held` when one was not, `unknown` when the check could not
// tell (`runs/readiness.ts`, which also says how much that discloses). The per-concept counts the
// result row stores for the reviewer's replay are not in the shape this component receives, so no
// call site can put them on the page.
//
// A Server Component: nothing here is interactive, so the sentences render into HTML and the
// browser is sent no JavaScript for them at all.

/** The three readings, each with its sentence and its mark (DESIGN.md: colour is never alone). */
const STATUS: Record<
  ReadinessConceptStatusValue,
  {
    key: 'readiness.conceptHeld' | 'readiness.conceptNotHeld' | 'readiness.conceptUnknown'
    icon: LucideIcon
    tone: string
  }
> = {
  held: { key: 'readiness.conceptHeld', icon: CircleCheckIcon, tone: 'text-green' },
  // Amber, not red: an idea that looks thin is something to read for in the room, not a refusal or
  // an error (DESIGN.md §Semantic). The icon carries the colour; the sentence is ink.
  not_held: { key: 'readiness.conceptNotHeld', icon: CircleAlertIcon, tone: 'text-amber' },
  unknown: { key: 'readiness.conceptUnknown', icon: CircleHelpIcon, tone: 'text-ink-muted' },
}

/**
 * A concept key as a reader says it: `cohort_retention` → "cohort retention", `ai_pushback` → "AI
 * pushback".
 *
 * Concept keys are authored in the package, so there is no catalogue entry for them and there
 * cannot be one — a course adds a scenario and its ideas with it. The words are lower-cased so they
 * sit inside a sentence, and `ai` is the one token spelled back out, because "ai reliance" reads as
 * a typo where "AI reliance" reads as the thing it names.
 */
export function conceptName(key: string): string {
  const words = key
    .split(/[\s_-]+/)
    .filter((word) => word.length > 0)
    .map((word) => (word.toLowerCase() === 'ai' ? 'AI' : word.toLowerCase()))
  return words.join(' ')
}

/** The same words at the head of a sentence: only `not_held` needs them there. */
function atSentenceStart(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

export type ConceptMapProps = {
  concepts: readonly { conceptKey: string; status: ReadinessConceptStatusValue }[]
}

export function ConceptMap({ concepts }: ConceptMapProps) {
  return (
    <ul className="flex flex-col">
      {concepts.map((concept) => {
        const { key, icon: Icon, tone } = STATUS[concept.status]
        const name = conceptName(concept.conceptKey)
        return (
          <li
            key={concept.conceptKey}
            className="border-line flex items-start gap-3 border-t py-3 first:border-t-0 first:pt-0 last:pb-0"
          >
            <Icon aria-hidden="true" className={cn('mt-1 size-4 shrink-0', tone)} />
            <p className="text-ink text-reading max-w-[72ch]">
              {t(key, {
                concept: concept.status === 'not_held' ? atSentenceStart(name) : name,
              })}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
