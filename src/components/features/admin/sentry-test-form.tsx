'use client'

import { useId, useState, useTransition } from 'react'
import { Loader2Icon } from 'lucide-react'
import { FormAlert } from '@/components/features/account/form-feedback'
import { Button } from '@/components/ui/button'
import { t } from '@/lib/i18n/messages/admin'
import { toastSuccess } from '@/lib/toast'
import { sendSentryTestAction } from '@/server/modules/admin/actions'

// UI-050 → flags → the Sentry test event (13 §4, D-708). One button. It is `aria-disabled` rather
// than `disabled` when the deployment has no DSN, so the sentence that says why stays reachable by
// keyboard and is announced with the control (DESIGN.md §Buttons).
export type SentryTestFormProps = {
  /** `NEXT_PUBLIC_SENTRY_DSN` is set: the SDK is on and an event can leave this deployment. */
  dsnConfigured: boolean
}

export function SentryTestForm({ dsnConfigured }: SentryTestFormProps) {
  const id = useId()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const reasonId = `${id}-reason`

  function send(): void {
    if (pending || !dsnConfigured) return
    setError(null)
    startTransition(async () => {
      const result = await sendSentryTestAction({})
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      const line = t('admin.flags.sentrySent', {
        id: result.data.eventId,
        environment: result.data.environment,
      })
      setSent(line)
      toastSuccess(line)
    })
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        send()
      }}
      className="flex flex-col gap-4"
    >
      <FormAlert message={error} />
      {!dsnConfigured && (
        <p id={reasonId} className="text-ink-muted text-body max-w-measure">
          {t('admin.flags.sentryNoDsn')}
        </p>
      )}
      {sent !== null && (
        <p className="text-ink text-body max-w-measure" role="status">
          {sent}
        </p>
      )}
      <div>
        <Button
          type="submit"
          aria-disabled={!dsnConfigured || pending}
          aria-describedby={dsnConfigured ? undefined : reasonId}
          aria-busy={pending}
        >
          {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
          {pending ? t('admin.flags.sentrySending') : t('admin.flags.sentrySend')}
        </Button>
      </div>
    </form>
  )
}
