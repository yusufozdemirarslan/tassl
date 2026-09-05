'use client'

import { useEffect, useState } from 'react'
import { Loader2Icon, MonitorSmartphone } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { authClient } from '@/lib/auth-client'
import { formatDateTime } from '@/lib/format/date-time'
import { auth } from '@/lib/i18n/messages/auth'
import { settings } from '@/lib/i18n/messages/settings'
import { ui } from '@/lib/i18n/messages/ui'
import { scopedT } from '@/lib/i18n/scoped'
import { FormAlert } from './form-feedback'

// A settings screen that loads in the browser: the loading word is shared (ui), and a refusal from
// Better Auth is worded the way the auth screens word it.
const t = scopedT(auth, settings, ui)

// UI-010 Security → "Signed-in devices". Better Auth owns sessions, so the list is read in the
// browser from `authClient.listSessions()`; the current session is marked by matching its token
// against `authClient.getSession()`, and that row carries no revoke button — signing this device
// out is what the account menu is for, and a "sign out" that silently ejects you from the page you
// are reading is a trap.
//
// States: loading, failed to load, only this device, and the list.

type SessionRow = {
  token: string
  userAgent: string | null
  ipAddress: string | null
  createdAt: string
}

type ListState = { rows: SessionRow[]; currentToken: string | null; failed: boolean }

/** Better Auth's client revives some date fields and leaves others as ISO strings. */
function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return typeof value === 'string' ? value : ''
}

function toRow(session: Record<string, unknown>): SessionRow {
  return {
    token: typeof session.token === 'string' ? session.token : '',
    userAgent: typeof session.userAgent === 'string' ? session.userAgent : null,
    ipAddress: typeof session.ipAddress === 'string' ? session.ipAddress : null,
    createdAt: toIso(session.createdAt),
  }
}

/** Reads both calls and returns the whole state; it touches no React state itself. */
async function readSessions(): Promise<ListState> {
  const [list, current] = await Promise.all([authClient.listSessions(), authClient.getSession()])
  if (list.error || !list.data) return { rows: [], currentToken: null, failed: true }
  const session = current.data?.session as { token?: unknown } | undefined
  return {
    rows: (list.data as Record<string, unknown>[]).map(toRow),
    currentToken: typeof session?.token === 'string' ? session.token : null,
    failed: false,
  }
}

export function SessionList() {
  const [state, setState] = useState<ListState | null>(null)
  const [busyToken, setBusyToken] = useState<string | null>(null)
  const [revokingOthers, setRevokingOthers] = useState(false)

  // The state is applied from the promise's callback, never synchronously in the effect body: a
  // synchronous write here would cost a second render before the first has painted.
  useEffect(() => {
    let cancelled = false
    void readSessions().then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function refresh(): Promise<void> {
    setState(await readSessions())
  }

  async function revoke(token: string): Promise<void> {
    setBusyToken(token)
    const result = await authClient.revokeSession({ token })
    setBusyToken(null)
    if (result.error) {
      toast.error(t('auth.error.generic'))
      return
    }
    toast.success(t('settings.security.revoked'))
    await refresh()
  }

  async function revokeOthers(): Promise<void> {
    setRevokingOthers(true)
    const result = await authClient.revokeOtherSessions()
    setRevokingOthers(false)
    if (result.error) {
      toast.error(t('auth.error.generic'))
      return
    }
    toast.success(t('settings.security.revokedOthers'))
    await refresh()
  }

  if (state === null) {
    return (
      <p role="status" className="text-ink-muted text-body py-6">
        {t('ui.loading')}
      </p>
    )
  }

  if (state.failed) {
    return <FormAlert message={t('settings.security.sessionsFailed')} />
  }

  const others = state.rows.filter((row) => row.token !== state.currentToken)

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col">
        {state.rows.map((row) => {
          const current = row.token === state.currentToken
          const device = row.userAgent ?? t('settings.security.unknownDevice')
          const signedIn = t('settings.security.signedIn', {
            value: formatDateTime(row.createdAt),
          })
          return (
            <li
              key={row.token}
              className="border-line flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-1 basis-64 items-start gap-2">
                <MonitorSmartphone
                  aria-hidden="true"
                  className="text-ink-faint mt-0.5 size-4 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-ink text-body [overflow-wrap:anywhere]">{device}</p>
                  <p className="text-ink-muted text-meta [overflow-wrap:anywhere]">
                    {row.ipAddress === null ? signedIn : `${row.ipAddress} · ${signedIn}`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {current ? (
                  <Badge variant="default">{t('settings.security.thisDevice')}</Badge>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busyToken === row.token}
                    aria-label={t('settings.security.revokeLabel', { device })}
                    onClick={() => {
                      void revoke(row.token)
                    }}
                  >
                    {busyToken === row.token && (
                      <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
                    )}
                    {t('settings.security.revoke')}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {others.length === 0 ? (
        <p className="text-ink-muted text-body">{t('settings.security.sessionsEmpty')}</p>
      ) : (
        <Button
          variant="secondary"
          className="w-fit"
          disabled={revokingOthers}
          aria-busy={revokingOthers}
          onClick={() => {
            void revokeOthers()
          }}
        >
          {revokingOthers && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
          {t('settings.security.revokeOthers')}
        </Button>
      )}
    </div>
  )
}
