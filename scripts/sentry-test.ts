// scripts/sentry-test.ts — the one thing that proves the DSN reaches Sentry
// (docs/tech/build-plan/phase-13-cross-cutting-hardening.md Step 13.1).
//
//   NEXT_PUBLIC_SENTRY_DSN='<dsn>' pnpm exec tsx scripts/sentry-test.ts
//
// Prints the event id it sent; open Sentry → Issues and confirm `ops.sentry_test` arrived under
// that id. With an empty DSN it prints one line and exits 1 rather than pretending: an
// observability check that passes without an endpoint is worse than no check at all.
import * as Sentry from '@sentry/nextjs'

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN ?? ''

async function main(): Promise<void> {
  if (dsn.length === 0) {
    console.error('NEXT_PUBLIC_SENTRY_DSN is empty; nothing sent')
    process.exit(1)
  }

  Sentry.init({
    dsn,
    enabled: true,
    environment: process.env.APP_ENV ?? 'local',
    release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev',
    sendDefaultPii: false,
    tracesSampleRate: 0,
  })

  // The same shape `alertOps` sends (13 §3.7), so a rule written against the `ops` tag can be
  // verified with this script before a real incident does it for you.
  const eventId = Sentry.withScope((scope) => {
    scope.setTag('ops', 'sentry_test')
    scope.setFingerprint(['ops', 'sentry_test'])
    scope.setLevel('warning')
    return Sentry.captureMessage('ops.sentry_test')
  })

  const delivered = await Sentry.flush(10_000)
  console.log(eventId)
  if (!delivered) {
    console.error('event id printed, but the transport did not flush within 10s')
    process.exit(1)
  }
}

void main()
