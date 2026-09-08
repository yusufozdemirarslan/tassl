// What may leave the process on a Sentry event (docs/tech/12-security.md §7, 13 §2.3, 13 §3.1).
//
// `beforeSend` in sentry.server.config.ts and sentry.edge.config.ts runs every event through
// `scrubSentryEvent`. It is here, in `src/lib`, for two reasons: the root Sentry configs must not
// import `@/server/config` (instrumentation.ts loads them *before* the environment is validated, so
// that an invalid environment is itself reported), and a pure function is testable without booting
// the SDK.
//
// Three leaks this closes, in the order they actually happen:
//   1. a connection string or an API key inside an exception message (a driver error quotes the DSN);
//   2. a token inside a URL — `/verify-email?token=…`, `/reset-password?token=…` — which arrives on
//      `request.url`, `request.query_string`, and on every navigation breadcrumb;
//   3. a request body or cookie attached by the SDK's request isolation.
// Student free text never reaches an event by construction: `defineRoute` attaches no body, and
// services throw `AppError` with fixed messages (D-560).

/** The ten secret environment values of 13 §2.3, plus the Sentry token the build uses. */
export const SECRET_ENV_NAMES = [
  'LLM_API_KEY',
  'ANTHROPIC_API_KEY',
  'RESEND_API_KEY',
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'BETTER_AUTH_SECRET',
  'CRON_SECRET',
  'GOOGLE_CLIENT_SECRET',
  'SEED_PASSWORD',
  'SENTRY_AUTH_TOKEN',
] as const

const REDACTED = '[REDACTED]'

/** Values long enough that a substring match cannot be a coincidence (the logger uses the same floor). */
export function secretValues(source: Record<string, string | undefined>): string[] {
  return SECRET_ENV_NAMES.map((name) => source[name] ?? '').filter((value) => value.length >= 8)
}

export function scrubSecretsIn(text: string, secrets: string[]): string {
  return secrets.reduce((acc, secret) => acc.split(secret).join(REDACTED), text)
}

/** Everything from the first `?` or `#`: query strings carry verification and reset tokens. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}

type Breadcrumb = { data?: Record<string, unknown> | undefined }
type ExceptionValue = { value?: string | undefined; type?: string | undefined }

/** The shape of a Sentry event this module touches; assignable from `ErrorEvent` and `TransactionEvent`. */
export type ScrubbableEvent = {
  message?: string | undefined
  exception?: { values?: ExceptionValue[] | undefined } | undefined
  request?:
    | {
        url?: string | undefined
        query_string?: unknown
        cookies?: unknown
        data?: unknown
        headers?: Record<string, unknown> | undefined
      }
    | undefined
  user?: { id?: string | number | undefined } | undefined
  breadcrumbs?: Breadcrumb[] | undefined
  extra?: Record<string, unknown> | undefined
}

const DROP_HEADERS = ['cookie', 'set-cookie', 'authorization', 'api-key', 'x-api-key']

/**
 * Mutates and returns the event. Returning `null` is never right here: an error that cannot be
 * scrubbed is still an error someone must see, and every field that could carry a secret is either
 * cleaned or deleted rather than judged.
 */
export function scrubSentryEvent<E extends ScrubbableEvent>(
  event: E,
  source: Record<string, string | undefined> = process.env,
): E {
  const secrets = secretValues(source)
  const clean = (text: string): string => scrubSecretsIn(text, secrets)

  if (typeof event.message === 'string') event.message = clean(event.message)
  for (const value of event.exception?.values ?? []) {
    if (typeof value.value === 'string') value.value = clean(value.value)
  }

  if (event.request) {
    delete event.request.cookies
    delete event.request.data
    delete event.request.query_string
    if (typeof event.request.url === 'string') {
      event.request.url = clean(stripQuery(event.request.url))
    }
    const headers = event.request.headers
    if (headers) for (const name of DROP_HEADERS) delete headers[name]
  }

  // The hashed id is the only user field Tassl ever sets (13 §3); anything else the SDK inferred
  // (ip_address, email, username) is dropped rather than trusted.
  if (event.user) event.user = event.user.id ? { id: event.user.id } : {}

  for (const crumb of event.breadcrumbs ?? []) {
    const data = crumb.data
    if (!data) continue
    if (typeof data.url === 'string') data.url = clean(stripQuery(data.url))
    if (typeof data.to === 'string') data.to = stripQuery(data.to)
    if (typeof data.from === 'string') data.from = stripQuery(data.from)
    delete data.body
    delete data.input
  }

  // Tassl never sets `extra`; anything there came from an integration and has not been reviewed.
  delete event.extra

  return event
}
