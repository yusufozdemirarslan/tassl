// Load test of the student demo path (docs/prompts/02-qa-and-guides.md C8; 15-cicd-deployment.md
// §16.2; NFR-008, NFR-014).
//
//   VUS=60 DURATION=10m RAMP=1m BASE_URL=https://tassl-pr-<n>.vercel.app \
//     BYPASS=<VERCEL_AUTOMATION_BYPASS_SECRET> SEED_PASSWORD=<seed password> pnpm test:load
//
// Target: a **preview** deployment (D-102), never production. Previews sit behind Vercel
// Authentication, so every request carries the project's Protection Bypass for Automation secret.
// Every virtual user is one of the load accounts `load-student-NN@tassl.local` that
// `pnpm demo:reset --load-users=<VUS>` creates on the target database (D-711); the accounts are
// students of the seeded section and the assignment they run is "Load test run".
//
// Arrival is a ramp over RAMP (default one minute for sixty of them): a class arrives from one
// campus address within a minute or two, not within the same second, and the per-address sign-in
// ceiling is sized for exactly that (120 a minute, D-712). Each virtual user signs in once and
// carries its session for the rest of the test, the way a browser does — as an explicit `Cookie`
// header rather than through k6's jar, which is emptied between iterations (D-734).
//
// Each iteration: list assignments → start a run on the load assignment (or continue the live one)
// → acknowledge the policy → read the Readiness Check → submit it → open a document → lock the frame
// → read the run, its claims and its workspace. Reads are tagged kind:read and writes kind:write;
// thresholds are the budgets of 16-performance-a11y-budgets.md (p95 read < 400 ms, p95 write < 800
// ms, error rate < 1 %). A refusal by the rate limiter (429) counts as a failure: the budgets are
// set so a section at once stays inside them.
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = (__ENV.BASE_URL || 'http://localhost:3000').replace(/[/]$/, '')
const BYPASS = __ENV.BYPASS || ''
const PASSWORD = __ENV.SEED_PASSWORD || 'Walkthrough-Pass-2026'
const VUS = Number(__ENV.VUS || 60)
const DURATION = __ENV.DURATION || '10m'
const RAMP = __ENV.RAMP || '1m'
/** The assignment label the load accounts run; created by `pnpm demo:reset --load-users`. */
const ASSIGNMENT_LABEL = __ENV.ASSIGNMENT_LABEL || 'Load test run'

export const options = {
  scenarios: {
    students: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP, target: VUS },
        { duration: DURATION, target: VUS },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<400'],
    'http_req_duration{kind:write}': ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
}

/**
 * The session this virtual user signed in with, as a `Cookie` header (D-734).
 *
 * k6 empties the per-VU cookie jar at the end of every iteration, so a script that signs in once
 * and leans on the jar is signed out from its second iteration onward — and this one did: every VU
 * completed its first iteration and then read `/me/assignments` without a session for the rest of
 * the run, which is how a ten-minute test reported 91 % failures against a deployment answering
 * every one of those requests in 143 ms. The cookies are held here instead, in a module-level
 * variable, which k6 does keep for the life of the VU.
 */
let sessionCookie = ''

const baseHeaders = () =>
  Object.assign(
    BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {},
    sessionCookie ? { cookie: sessionCookie } : {},
  )

function read(path) {
  const res = http.get(`${BASE}${path}`, {
    headers: Object.assign({ accept: 'application/json' }, baseHeaders()),
    tags: { kind: 'read' },
  })
  check(res, { [`GET ${path} ok`]: (r) => r.status === 200 })
  return res
}

function write(method, path, body, expected) {
  const res = http.request(method, `${BASE}${path}`, JSON.stringify(body || {}), {
    headers: Object.assign(
      { 'content-type': 'application/json', 'X-Requested-With': 'tassl' },
      baseHeaders(),
    ),
    tags: { kind: 'write' },
  })
  check(res, { [`${method} ${path} ${expected}`]: (r) => r.status === expected })
  return res
}

// Per virtual user (each VU runs its own copy of this module): whether its sign-in has happened.
let signedIn = false

function signIn() {
  const vu = String(((__VU - 1) % VUS) + 1).padStart(2, '0')
  const email = `load-student-${vu}@tassl.local`
  const res = http.post(
    `${BASE}/api/auth/sign-in/email`,
    JSON.stringify({ email, password: PASSWORD, rememberMe: false }),
    {
      headers: Object.assign({ 'content-type': 'application/json', origin: BASE }, baseHeaders()),
      tags: { kind: 'write' },
    },
  )
  const ok = check(res, { 'sign-in 200': (r) => r.status === 200 })
  if (ok) {
    // Every cookie the sign-in set, as one header. Better Auth sets the session token and the
    // signed session data beside it, and the session is only whole with both.
    const jar = res.cookies || {}
    sessionCookie = Object.keys(jar)
      .map((name) => `${name}=${(jar[name][0] || {}).value}`)
      .join('; ')
  }
  return ok
}

export default function student() {
  if (!signedIn) {
    signedIn = signIn()
    if (!signedIn) {
      sleep(10)
      return
    }
  }

  const assignments = read('/api/v1/me/assignments')
  const items = (assignments.json() || {}).items || []
  const assignment = items.find((item) => item.label === ASSIGNMENT_LABEL)
  if (!assignment) {
    check(null, { 'load assignment exists': () => false })
    sleep(5)
    return
  }

  // A student who already has a live run continues it; one live run per student per assignment.
  let runId = assignment.latestRun && assignment.latestRun.id
  if (!runId) {
    const started = write('POST', `/api/v1/assignments/${assignment.assignmentId}/runs`, {}, 201)
    runId = (started.json() || {}).id
    if (!runId) {
      sleep(5)
      return
    }
    write('POST', `/api/v1/runs/${runId}/policy-ack`, {}, 200)
    read(`/api/v1/runs/${runId}/readiness`)
    write('POST', `/api/v1/runs/${runId}/readiness/submit`, {}, 200)
    const workspace = read(`/api/v1/runs/${runId}/workspace`)
    const documents = (workspace.json() || {}).documents || []
    if (documents.length > 0) {
      write('POST', `/api/v1/runs/${runId}/documents/${documents[0].id}/open`, {}, 200)
    }
    write(
      'POST',
      `/api/v1/runs/${runId}/frame`,
      {
        decision: 'Hold the premium share until the payback figure has been checked.',
        assumptions: [
          'The payback figure has not been revised since the board deck.',
          'Value tier acquisition keeps performing at its current rate.',
          'Roastery capacity absorbs the current premium volume this quarter.',
        ],
        position: 'Hold the split until the payback number is checked against a later source.',
        confidence: 55,
      },
      200,
    )
  }

  read(`/api/v1/runs/${runId}`)
  read(`/api/v1/runs/${runId}/claims`)
  read(`/api/v1/runs/${runId}/workspace`)
  sleep(1)
}
