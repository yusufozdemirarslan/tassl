'use client'

import { useEffect } from 'react'
import { plexMono, plexSans, plexSerif } from '@/app/fonts'
import { cn } from '@/lib/cn'

// UI-007: the last-resort boundary replaces the root layout, so it carries its own html and body,
// loads the Plex faces itself (next/font hashes family names, so a literal family never resolves),
// and styles inline with the raw token values because globals.css may not have loaded. Phase 13
// adds Sentry.captureException; until then the error is logged to the console.
// Inline because globals.css is not loaded on this page.
const FOCUS_CSS = 'button:focus-visible{outline:2px solid #0F6E74;outline-offset:2px}'

// The five sentences are written out here rather than read from `src/lib/i18n/en-US.ts` for the
// same reason the fonts and the colours are: this file is its own client entry, and Turbopack
// gives every entry group its own copy of every module it reaches, so one `t()` call put the whole
// 25 KB catalogue (7 KB gzip) into the bundle of every route in the app — to spell five sentences
// this page shows only when the root layout itself has failed (B4, 16 §3.2). The wording is
// `error.title`, `error.body`, `error.bodyNoReference`, `error.reference` and `error.retry`
// verbatim: change one there and change it here.
const MESSAGES = {
  title: 'Something went wrong',
  body: 'The problem has been recorded. If it continues, quote the reference below.',
  bodyNoReference: 'The problem has been recorded. Try again, or come back in a moment.',
  reference: 'Reference',
  retry: 'Try again',
} as const

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en-US" className={cn(plexSans.variable, plexMono.variable, plexSerif.variable)}>
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F6F7F9',
          color: '#141A26',
          fontFamily: 'var(--font-plex-sans, system-ui, sans-serif)',
          fontSize: 14,
          lineHeight: '22px',
          padding: 16,
        }}
      >
        <style>{FOCUS_CSS}</style>
        <main
          id="main"
          tabIndex={-1}
          style={{
            width: '100%',
            minWidth: 0,
            maxWidth: 512,
            background: '#FFFFFF',
            border: '1px solid #D5DAE2',
            borderRadius: 6,
            padding: 24,
            outline: 'none',
          }}
        >
          <div role="alert">
            <h1
              style={{
                fontFamily: 'var(--font-plex-serif, Georgia, serif)',
                fontSize: 30,
                lineHeight: '38px',
                fontWeight: 500,
                margin: 0,
              }}
            >
              {MESSAGES.title}
            </h1>
            {/* Margins are explicit because the preflight reset may not have loaded either; the
                rhythm and colors mirror ErrorState (message in ink, reference label muted). */}
            <p style={{ color: '#141A26', margin: '12px 0 0' }}>
              {error.digest ? MESSAGES.body : MESSAGES.bodyNoReference}
            </p>
            {error.digest && (
              <p style={{ color: '#4B5563', fontSize: 13, lineHeight: '20px', margin: '12px 0 0' }}>
                {MESSAGES.reference}
                {': '}
                <code
                  style={{
                    fontFamily: 'var(--font-plex-mono, ui-monospace, monospace)',
                    color: '#141A26',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {error.digest}
                </code>
              </p>
            )}
            <button
              type="button"
              onClick={() => reset()}
              style={{
                marginTop: 16,
                height: 40,
                padding: '0 16px',
                borderRadius: 6,
                border: '1px solid transparent',
                background: '#0F6E74',
                color: '#FFFFFF',
                fontFamily: 'inherit',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {MESSAGES.retry}
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}
