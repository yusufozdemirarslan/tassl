'use client'

import { useId, type Ref } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { t } from '@/lib/i18n/messages/readiness'
import type { ReadinessItemView } from '@/server/modules/runs/schema'

// One item of the Readiness Check (UI-022): the stem as a `legend`, the four options as a radio
// group, and the two controls that move along the check.
//
// **The item is drawn from exactly the five fields `ReadinessItemView` carries.** There is no key
// to the question here, no marking of the answer, and no sign of whether an answer was right —
// correctness is computed on the server, stored, traced, and reduced to the concept map that closes
// the check (FR-012, `runs/readiness.ts`). Nothing on this screen changes when a student picks the
// right option rather than a wrong one.
//
// `category` is the sixth field the view carries and this component deliberately ignores it. The
// three categories are `foundation`, `defect_concept` and `ai_behavior`; labelling a question
// "defect concept" would tell a student what kind of flaw to go hunting for in the Evidence Room
// before they have read a document, which is the disclosure CLAUDE.md forbids.
//
// Selecting an option is a write, and the parent owns it: this component reports the key that was
// chosen and renders the answer it is handed back. That is what lets a refused write put the
// previous answer back on the screen it was chosen on.

export type ReadinessItemProps = {
  item: ReadinessItemView
  /** 1-based position in the check, and how many items there are: "Item 3 of 16". */
  index: number
  total: number
  /** The key the student has chosen, null until they choose one (FR-017 restores it on return). */
  answerKey: string | null
  onAnswer: (answerKey: string) => void
  /** Absent at the ends of the check; the control stays visible and says it cannot move. */
  onPrevious?: (() => void) | undefined
  onNext?: (() => void) | undefined
  /** The check is closing: the options stop taking answers, and say so by not responding. */
  disabled?: boolean
  /**
   * The `fieldset`'s id and a handle on it, both owned by the check around this item: the navigator
   * buttons point at it with `aria-controls`, and Next and Previous move focus into it.
   *
   * It is the fieldset that is focused rather than a wrapper, and that is the whole point. Pressing
   * Next changes the question under a button that does not move, which a screen reader has no way
   * to notice; focusing the group whose `legend` is the question makes the new question the next
   * thing announced, and does it without a second element repeating the name the fieldset already
   * carries.
   */
  panelId?: string
  panelRef?: Ref<HTMLFieldSetElement>
}

export function ReadinessItem({
  item,
  index,
  total,
  answerKey,
  onAnswer,
  onPrevious,
  onNext,
  disabled = false,
  panelId,
  panelRef,
}: ReadinessItemProps) {
  const fieldId = useId()
  const legendId = `${fieldId}-legend`

  return (
    <div className="flex flex-col gap-6">
      <FieldSet
        id={panelId}
        ref={panelRef}
        tabIndex={-1}
        className="focus-visible:outline-focus rounded-md focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {/* The position rides inside the legend rather than above it, so a reader who arrives at
            this panel by keyboard hears which of the sixteen they are on before the question. */}
        <FieldLegend id={legendId} variant="legend" className="mb-4">
          <span className="text-ink-muted text-meta mb-1 block font-normal">
            {t('readiness.itemPosition', { position: index, total })}
          </span>
          <span className="text-ink text-lead block max-w-[72ch] font-medium">{item.stem}</span>
        </FieldLegend>

        <RadioGroup
          name={`readiness-item-${item.id}`}
          value={answerKey}
          disabled={disabled}
          aria-labelledby={legendId}
          onValueChange={(next) => {
            if (typeof next === 'string') onAnswer(next)
          }}
          className="max-w-[72ch]"
        >
          {item.options.map((option) => {
            const optionId = `${fieldId}-${option.key}`
            return (
              <FieldLabel key={option.key} htmlFor={optionId}>
                <Field orientation="horizontal">
                  <RadioGroupItem
                    id={optionId}
                    value={option.key}
                    aria-labelledby={`${optionId}-label`}
                  />
                  <FieldTitle id={`${optionId}-label`} className="text-reading font-normal">
                    {option.text}
                  </FieldTitle>
                </Field>
              </FieldLabel>
            )
          })}
        </RadioGroup>
      </FieldSet>

      {/* `aria-disabled`, not `disabled`: pressing Previous on item 2 lands on item 1, where
          Previous can no longer move — and a control the browser disables under a keyboard user's
          focus drops them at the top of the document (DESIGN.md §Buttons → Disabled). */}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          aria-disabled={onPrevious === undefined ? true : undefined}
          onClick={() => onPrevious?.()}
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          {t('readiness.previous')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          aria-disabled={onNext === undefined ? true : undefined}
          onClick={() => onNext?.()}
        >
          {t('readiness.next')}
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </div>
  )
}
