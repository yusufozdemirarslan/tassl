// Step 13.4 — nothing a person typed, and no credential, reaches a log line
// (docs/tech/12-security.md §6.5, 13-observability-ops.md §2.3, SYS-025, NFR-011, D-066).
//
// The rule has two halves and this file tests both, because either alone passes while the product
// leaks. The rule proper is that **no log call passes free text**: the typed helper takes ids and
// numbers, and a request's body never becomes a log field. `redact.paths` is the **backstop** for
// the call that forgets. A test of the backstop alone would pass a codebase that logged every
// request body under a key nobody had thought to list; a test of the calls alone would pass a
// codebase one careless `logger.info(body)` away from publishing a student's brief.
//
// So: a real `PATCH /api/v1/me` is driven through `defineRoute` — session cookie, name, email,
// the lot — against a captured pino destination, and every line it wrote is searched for the
// values that went in. Then every path in `REDACT_PATHS` is fed a marker and checked to censor it,
// with a bare pino instance as the control so an empty finding cannot mean "pino wrote nothing".
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pino from 'pino'
import { asUser, truncateAll } from '@tests/setup/integration'
import { REDACT_PATHS } from '@/server/logging/redaction'
import { hashId, rootLogger, scrubSecrets } from '@/server/logging/logger'

type Factories = typeof import('@tests/factories')
type IdentityRouter = typeof import('@/server/modules/identity/router')

const BASE = 'http://localhost/api/v1'
const ROUTE_CTX = { params: Promise.resolve({}) }

/** The censor `13 §2.3` fixes; asserted as a literal so a change of censor is a change of test. */
const CENSOR = '[REDACTED]'

// ---------------------------------------------------------------------------------------------
// The captured destination
//
// `postgres.js` is instrumented for D-252 by assigning into its live options; pino is instrumented
// the same way, by swapping the stream the logger already holds. Children reach it through the
// prototype chain (`child()` is `Object.create(parent)` and sets no stream of its own), so this
// captures the request logger `defineRoute` builds without the route knowing anything about it.
// ---------------------------------------------------------------------------------------------

const streamSym = pino.symbols.streamSym
type Writable = { write: (line: string) => void }

let lines: string[] = []
let originalStream: Writable
let originalLevel: string

const captured = (): Record<string, unknown>[] =>
  lines.map((line) => JSON.parse(line) as Record<string, unknown>)

/** Everything written while `call` ran, as raw JSON text: the form a log sink actually receives. */
async function capturing(call: () => Promise<unknown> | unknown): Promise<string> {
  lines = []
  await call()
  return lines.join('\n')
}

let f: Factories
let router: IdentityRouter
let user: { id: string; email: string; name: string }
let headers: Headers

beforeAll(async () => {
  await truncateAll()
  f = await import('@tests/factories')
  router = await import('@/server/modules/identity/router')

  const org = (await f.createInstitution('redaction')).organization.id
  user = await f.createUser('redaction-student')
  await f.addMember(org, user.id, 'student')
  headers = await asUser(user.id, { activeOrganizationId: org })

  const logger = rootLogger as unknown as Record<symbol, unknown>
  originalStream = logger[streamSym] as Writable
  originalLevel = rootLogger.level
  logger[streamSym] = {
    write: (line: string) => {
      lines.push(line.trimEnd())
    },
  }
  // `tests/setup/integration.ts` defaults LOG_LEVEL to `warn`; `defineRoute` reports a completed
  // request at `info`. A sweep over lines that were never written is the vacuous version of this
  // whole file.
  rootLogger.level = 'trace'
})

afterAll(async () => {
  const logger = rootLogger as unknown as Record<symbol, unknown>
  logger[streamSym] = originalStream
  rootLogger.level = originalLevel
  await truncateAll()
})

// ---------------------------------------------------------------------------------------------
// A real request, through the real wrapper
// ---------------------------------------------------------------------------------------------

describe('a request carrying a name and an email logs neither', () => {
  const NEW_NAME = 'Dana Ruiz'
  const IN_BODY = 'dana.ruiz@meridian.example'

  it('the capture is live: the route wrote its own lines and they are readable', async () => {
    const text = await capturing(async () => {
      const response = await router.getMe(new Request(`${BASE}/me`, { headers }), ROUTE_CTX)
      expect(response.status).toBe(200)
    })

    expect(text.length, 'nothing was captured, so this suite proves nothing').toBeGreaterThan(0)
    const completed = captured().find((line) => line.event === 'http_request')
    expect(completed, 'defineRoute logged no http_request line').toBeDefined()
    expect(completed).toMatchObject({ route: '/api/v1/me', method: 'GET', status: 200 })
    // 13 §2.4: the account travels as the first twelve hex characters of its sha256 and never as
    // itself, so a log line cannot be joined back to a person without the database.
    expect(completed?.userId).toBe(hashId(user.id))
    expect(String(completed?.userId)).toHaveLength(12)
  })

  it('a PATCH whose body is a name and an email logs neither, nor the session cookie', async () => {
    const text = await capturing(async () => {
      const request = new Request(`${BASE}/me`, {
        method: 'PATCH',
        headers: new Headers([
          ...headers,
          ['x-requested-with', 'tassl'],
          ['content-type', 'application/json'],
        ]),
        body: JSON.stringify({ name: `${NEW_NAME} <${IN_BODY}>` }),
      })
      const response = await router.updateMe(request, ROUTE_CTX)
      expect(response.status).toBe(200)
    })

    for (const secret of [IN_BODY, NEW_NAME, headers.get('cookie') ?? 'no-cookie', user.email]) {
      expect(text, `the logs carry ${secret}`).not.toContain(secret)
    }
    // And the account's own id, which is what `hashId` exists to keep out.
    expect(text).not.toContain(user.id)
  })

  it('a refusal logs the code and the route, and not the body that was refused', async () => {
    const rejected = 'priya.shah@meridian.example'
    const text = await capturing(async () => {
      const request = new Request(`${BASE}/me`, {
        method: 'PATCH',
        headers: new Headers([
          ...headers,
          ['x-requested-with', 'tassl'],
          ['content-type', 'application/json'],
        ]),
        // Empty name: refused by `updateProfileSchema`, so the VALIDATION_ERROR path runs with a
        // body that also carries an address.
        body: JSON.stringify({ name: '', contact: rejected }),
      })
      const response = await router.updateMe(request, ROUTE_CTX)
      expect(response.status).toBe(400)
    })

    const refusal = captured().find((line) => line.code === 'VALIDATION_ERROR')
    expect(refusal, 'the refusal was not logged at all').toBeDefined()
    expect(refusal).toMatchObject({ event: 'http_request', status: 400, route: '/api/v1/me' })
    expect(text).not.toContain(rejected)
  })
})

// ---------------------------------------------------------------------------------------------
// The backstop: every path in the list
// ---------------------------------------------------------------------------------------------

/**
 * Builds the smallest object that puts `marker` where a pino redact path points.
 *
 * `req.headers["x-api-key"]` → `{ req: { headers: { 'x-api-key': marker } } }`;
 * `*.password` → `{ any: { password: marker } }`. A `*` is a real key with a name of its own, which
 * is the whole of what a wildcard segment means to pino.
 */
function objectFor(path: string, marker: string): Record<string, unknown> {
  const segments = path
    .replace(/\["([^"]+)"\]/g, '.$1')
    .replace(/\['([^']+)'\]/g, '.$1')
    .split('.')
    .map((segment) => (segment === '*' ? 'anyObject' : segment))

  const root: Record<string, unknown> = {}
  let node = root
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) node[segment] = marker
    else {
      const next: Record<string, unknown> = {}
      node[segment] = next
      node = next
    }
  })
  return root
}

describe('every path in REDACT_PATHS censors what it points at', () => {
  const MARKER = 'MARKER-a3f9-do-not-log'

  it('the list is the one 13 §2.3 owns, and it is not empty', () => {
    expect(REDACT_PATHS.length).toBeGreaterThan(50)
    // The four groups, one representative each, so a group deleted wholesale is a failure here and
    // not a silent narrowing of the sweep below.
    for (const path of ['*.password', 'req.headers.authorization', 'env.LLM_API_KEY', '*.email']) {
      expect(REDACT_PATHS, `${path} is no longer in the list`).toContain(path)
    }
  })

  it('the control: an unredacted pino writes the marker in plain sight', () => {
    // Without this, "the marker is not in the line" would also be true of a logger that wrote
    // nothing, of a path this test built wrongly, and of a marker that never got there.
    const seen: string[] = []
    const bare = pino({ base: null }, { write: (line: string) => seen.push(line) } as never)

    for (const path of REDACT_PATHS) {
      seen.length = 0
      bare.info(objectFor(path, MARKER), 'control')
      expect(seen.join(''), `${path}: the fixture never put the marker in the object`).toContain(
        MARKER,
      )
    }
  })

  it('the real logger censors every one of them', () => {
    const missed: string[] = []
    for (const path of REDACT_PATHS) {
      lines = []
      rootLogger.info(objectFor(path, MARKER), 'redaction sweep')
      const line = lines.join('')
      if (line.includes(MARKER) || !line.includes(CENSOR)) missed.push(path)
    }
    expect(missed).toEqual([])
  })

  it('censors at the depth the path names, and leaves everything else alone', () => {
    lines = []
    rootLogger.info({ runId: 'r1', seq: 4, user: { email: MARKER, id: 'u1' } }, 'one event')
    const [line] = captured()

    expect(line).toMatchObject({ runId: 'r1', seq: 4, msg: 'one event' })
    expect(line?.user).toEqual({ email: CENSOR, id: 'u1' })
  })
})

// ---------------------------------------------------------------------------------------------
// The other backstop: secret *values*, wherever they appear in prose
// ---------------------------------------------------------------------------------------------

describe('a secret that reaches a message or a stack is scrubbed by value', () => {
  it('replaces the configured secret inside an error message and its stack', async () => {
    const secret = process.env.BETTER_AUTH_SECRET ?? ''
    expect(
      secret.length,
      'BETTER_AUTH_SECRET is unset, so this test proves nothing',
    ).toBeGreaterThan(8)

    const text = await capturing(() => {
      rootLogger.error(
        { err: new Error(`connect failed while presenting ${secret}`) },
        `and again in the message: ${secret}`,
      )
    })

    expect(text).not.toContain(secret)
    expect(text).toContain('[REDACTED]')
    expect(scrubSecrets(`x ${secret} y`)).toBe('x [REDACTED] y')
  })

  it('leaves a message with no secret in it untouched', () => {
    // The pair to the assertion above: a scrubber that replaced everything would pass it.
    expect(scrubSecrets('the run was locked at 12:04')).toBe('the run was locked at 12:04')
  })
})
