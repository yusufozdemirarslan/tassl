'use client'

import { useState } from 'react'
import { DownloadIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { identity } from '@/lib/i18n/messages/identity'
import { settings } from '@/lib/i18n/messages/settings'
import { scopedT } from '@/lib/i18n/scoped'
import { FormAlert } from './form-feedback'

// The panel is a settings screen; the downloaded file's name belongs to the identity module.
const t = scopedT(identity, settings)

// UI-010 Data → "Download my data" (SYS-004). The export is a route, not an action, because it
// answers with a file: `POST /api/v1/me/export` sets `content-disposition`, and the browser is
// handed the body as a blob so the download starts without leaving the page.
//
// `X-Requested-With: tassl` is the CSRF condition every cookie-authenticated mutation carries
// (08 §2.7); without it `defineRoute` refuses the request.
//
// Two downloads an hour (08 §2.9). The third answers 429 with `EXPORT_RATE_LIMITED`, and the
// sentence shown is the one in that envelope — the limit is the message, so it is not rewritten
// here.
const EXPORT_URL = '/api/v1/me/export'

type ErrorEnvelope = { error?: { message?: unknown } }

export function ExportDataPanel() {
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function download(): Promise<void> {
    setPending(true)
    setFailure(null)
    try {
      const response = await fetch(EXPORT_URL, {
        method: 'POST',
        headers: { 'X-Requested-With': 'tassl' },
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorEnvelope | null
        const message = body?.error?.message
        setFailure(typeof message === 'string' ? message : t('settings.data.exportFailed'))
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = t('identity.exportFileName')
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      toast.success(t('settings.data.exportStarted'))
    } catch {
      setFailure(t('settings.data.exportFailed'))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert message={failure} />
      <Button
        variant="secondary"
        className="w-fit"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          void download()
        }}
      >
        {pending ? (
          <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <DownloadIcon aria-hidden="true" className="size-4" />
        )}
        {t('settings.data.exportSubmit')}
      </Button>
    </div>
  )
}
