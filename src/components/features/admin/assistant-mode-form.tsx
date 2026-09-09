'use client'

import { useId, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { t } from '@/lib/i18n/messages/admin'
import { toastSuccess } from '@/lib/toast'
import { setAiModeAction } from '@/server/modules/admin/actions'
import type { AiMode, AssistantMode } from '@/server/modules/admin/schema'

// UI-050 → flags → the runtime assistant switch (11 §6, D-691). The one control on the screen.
//
// **Two radios and a save, not a toggle that saves on change.** The switch reaches every student
// with an open run on the next model call, so it is a consequential act, and DESIGN.md's rule for
// one is that it is confirmed — here by the press of a button that names what it does, with the
// choice visible beside it. A radio that wrote the row as it was checked would make the act the
// same gesture as reading the options.
//
// **The control says why it cannot act, rather than refusing when pressed.** With `FEATURE_AI`
// off the environment has already forced the scripted assistant and the service would refuse the
// write (`CONFLICT`); so the radios are disabled, the button is `aria-disabled` — never `disabled`,
// so its reason stays reachable by keyboard and is announced with it (DESIGN.md §Buttons) — and the
// sentence beside it says which flag, and that the fix is a deploy.
//
// **What it prints is the effect, not the row.** "Effective mode" is `assistantMode`: the row and
// the environment read together, which is what `/api/ready` reports and the assistant panel's chip
// shows. An admin who saves `live` under `FEATURE_AI=false` cannot (the service refuses), and one
// who reads this line is reading the same answer a student's screen would give.

const MODE_LABELS: Record<AssistantMode, () => string> = {
  live: () => t('admin.flags.assistantModeLive'),
  scripted: () => t('admin.flags.assistantModeScripted'),
}

type Option = { value: AiMode; label: string; hint: string }

export type AssistantModeFormProps = {
  /** The `ai_mode` row as it stands (`live` when there is none). */
  aiMode: AiMode
  /** The environment and the row read together: what the assistant actually is right now. */
  assistantMode: AssistantMode
  /** `FEATURE_AI`; off, the switch cannot change anything and says so. */
  aiEnabled: boolean
}

export function AssistantModeForm({ aiMode, assistantMode, aiEnabled }: AssistantModeFormProps) {
  const router = useRouter()
  const id = useId()
  const [pending, startTransition] = useTransition()
  const [mode, setMode] = useState<AiMode>(aiMode)
  const [effective, setEffective] = useState<AssistantMode>(assistantMode)
  const [error, setError] = useState<string | null>(null)

  const legendId = `${id}-legend`
  const reasonId = `${id}-reason`
  const effectiveId = `${id}-effective`

  const options: Option[] = [
    {
      value: 'live',
      label: t('admin.flags.assistantModeLive'),
      hint: t('admin.flags.assistantModeLiveHint'),
    },
    {
      value: 'mock',
      label: t('admin.flags.assistantModeScripted'),
      hint: t('admin.flags.assistantModeScriptedHint'),
    },
  ]

  function save(): void {
    if (pending || !aiEnabled) return
    setError(null)
    startTransition(async () => {
      const result = await setAiModeAction({ mode })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setMode(result.data.aiMode)
      setEffective(result.data.assistantMode)
      toastSuccess(t('admin.flags.assistantModeSaved'))
      // The audit log on the next tab has a new row in it, and the provider panel above reads the
      // same answer this form now holds.
      router.refresh()
    })
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      className="flex flex-col gap-5"
    >
      <p id={effectiveId} className="text-ink text-body max-w-measure">
        {t('admin.flags.assistantModeEffective', { mode: MODE_LABELS[effective]() })}
      </p>

      <FieldSet>
        <FieldLegend id={legendId} variant="label">
          {t('admin.flags.assistantModeLegend')}
        </FieldLegend>
        <RadioGroup
          name="mode"
          value={mode}
          disabled={!aiEnabled}
          aria-labelledby={legendId}
          aria-describedby={aiEnabled ? undefined : reasonId}
          onValueChange={(next) => setMode(next as AiMode)}
          className="max-w-measure"
        >
          {options.map((option) => {
            const itemId = `${id}-${option.value}`
            return (
              <FieldLabel key={option.value} htmlFor={itemId}>
                <Field orientation="horizontal">
                  <RadioGroupItem
                    id={itemId}
                    value={option.value}
                    aria-labelledby={`${itemId}-title`}
                    aria-describedby={`${itemId}-hint`}
                  />
                  <FieldContent>
                    <FieldTitle id={`${itemId}-title`}>{option.label}</FieldTitle>
                    <FieldDescription id={`${itemId}-hint`}>{option.hint}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            )
          })}
        </RadioGroup>
      </FieldSet>

      <FormAlert message={error} />

      <div className="flex flex-col items-start gap-2">
        <Button
          type="submit"
          variant="primary"
          aria-disabled={pending || !aiEnabled ? true : undefined}
          aria-busy={pending}
          aria-describedby={aiEnabled ? undefined : reasonId}
        >
          {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
          {pending ? t('admin.flags.assistantModePending') : t('admin.flags.assistantModeSubmit')}
        </Button>
        {!aiEnabled && (
          <p id={reasonId} className="text-ink-muted text-body max-w-measure">
            {t('admin.flags.assistantModeDisabled')}
          </p>
        )}
      </div>
    </form>
  )
}
