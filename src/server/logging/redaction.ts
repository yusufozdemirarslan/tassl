// pino redact paths, exactly the groups in docs/tech/13-observability-ops.md §2.3 (SYS-025, NFR-011).
const SECRET_ENV_NAMES = [
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

const credentials = [
  'password',
  '*.password',
  'currentPassword',
  'newPassword',
  '*.currentPassword',
  '*.newPassword',
  'token',
  '*.token',
  'accessToken',
  'refreshToken',
  '*.accessToken',
  '*.refreshToken',
]

const headers = [
  'cookie',
  '*.cookie',
  'headers.cookie',
  'headers["set-cookie"]',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
  'headers["api-key"]',
  'req.headers["api-key"]',
  '*["api-key"]',
]

const secretEnvValues = SECRET_ENV_NAMES.flatMap((name) => [name, `*.${name}`, `env.${name}`])

const pii = ['email', '*.email', 'user.email', 'actor.email', 'name', 'user.name', 'ip', '*.ip']

const bodies = [
  'body',
  '*.body',
  'request_text',
  'response_text',
  '*.request_text',
  '*.response_text',
  'text_segments',
  '*.text_segments',
  'answer',
  '*.answer',
  'answers',
  'justification',
  '*.justification',
  'statement',
  '*.statement',
]

export const REDACT_PATHS: string[] = [
  ...credentials,
  ...headers,
  ...secretEnvValues,
  ...pii,
  ...bodies,
]
