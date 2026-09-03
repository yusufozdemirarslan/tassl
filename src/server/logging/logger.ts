// Logger factory: docs/tech/13-observability-ops.md §2.4.
// No `import 'server-only'`: this module is loaded by tsx scripts (jobs worker, seed) and by
// Vitest, where the marker throws (D-143). The client/server boundary is the ESLint boundaries rule.
import { createHash } from 'node:crypto'
import pino, { type Logger, type LoggerOptions } from 'pino'
import { env } from '@/server/config'
import { REDACT_PATHS } from '@/server/logging/redaction'

export type RequestBindings = {
  requestId: string
  userId?: string
  orgId?: string
  route: string
  method: string
}
export type JobBindings = {
  jobId: string
  queue: string
  runId?: string
  packageVersionId?: string
}

/** First 12 hex characters of sha256(id): the only form in which a user id appears in a log line. */
export const hashId = (id: string): string =>
  createHash('sha256').update(id).digest('hex').slice(0, 12)

const SECRET_VALUES = [
  env.LLM_API_KEY,
  env.ANTHROPIC_API_KEY,
  env.RESEND_API_KEY,
  env.DATABASE_URL,
  env.DATABASE_URL_UNPOOLED ?? '',
  env.BETTER_AUTH_SECRET,
  env.CRON_SECRET,
  env.GOOGLE_CLIENT_SECRET,
  env.SEED_PASSWORD,
  process.env.SENTRY_AUTH_TOKEN ?? '',
].filter((v) => v.length >= 8)

/** Replaces every occurrence of a secret env value inside a string with [REDACTED]. */
export const scrubSecrets = (text: string): string =>
  SECRET_VALUES.reduce((acc, secret) => acc.split(secret).join('[REDACTED]'), text)

const options: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: 'msg',
  formatters: { level: (label) => ({ level: label }) },
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  serializers: {
    err: (err: Error) => ({
      type: err.name,
      message: scrubSecrets(err.message),
      stack: scrubSecrets(err.stack ?? ''),
    }),
  },
  hooks: {
    logMethod(args, method) {
      const scrubbed = args.map((a) => (typeof a === 'string' ? scrubSecrets(a) : a)) as typeof args
      method.apply(this, scrubbed)
    },
  },
}

// pino-pretty only in local (devDependency); JSON everywhere else, including tests.
export const rootLogger: Logger =
  env.APP_ENV === 'local'
    ? pino({
        ...options,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'requestId,orgId' },
        },
      })
    : pino(options)

export const createRequestLogger = (b: RequestBindings): Logger => rootLogger.child(b)
export const createJobLogger = (b: JobBindings): Logger => rootLogger.child(b)
