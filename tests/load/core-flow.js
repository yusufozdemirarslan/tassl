// Load test of the student demo path (docs/prompts/02-qa-and-guides.md C8; NFR-008, NFR-014).
//
//   k6 run -e BASE_URL=https://tassl-pr-<n>.vercel.app -e BYPASS=<VERCEL_AUTOMATION_BYPASS_SECRET> \
//     -e SEED_PASSWORD=<seed password> -e VUS=25 -e DURATION=2m \
//     --summary-export tests/load/summary.json tests/load/core-flow.js
//
// Target: a **preview** deployment (D-102), never production. Previews sit behind Vercel
// Authentication, so every request carries the project's Protection Bypass for Automation secret.
// `scripts/load/seed-users.ts` is not needed: every virtual user signs in as one of the 25 load
// accounts `load-student-NN@tassl.local` that `pnpm demo:reset --load-users` creates on the target
// database (see docs/qa/QA-REPORT.md C8 for the run that was recorded).
//
// Each VU: sign in → list assignments → start a run on the load assignment → acknowledge the
// policy → read the Readiness Check → submit it → open a document → lock the frame → read the
// claims → file the brief (lock) → poll the run once. Reads are tagged kind:read and writes
// kind:write; thresholds are the budgets of 16-performance-a11y-budgets.md (p95 read < 400 ms,
// p95 write < 800 ms, error rate < 1 %). A refusal by the rate limiter (429) is counted as a
// failure: the budget is set so 25 students at once stay inside it.
import http from 'k6/http'
import { check, sleep } from 'k6'

const BASE = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const BYPASS = __ENV.BYPASS || ''
const PASSWORD = __ENV.SEED_PASSWORD || 'Walkthrough-Pass-2026'
const VUS = Number(__ENV.VUS || 25)
const DURATION = __ENV.DURATION || '2m'
/** The assignment label the load accounts run; created by `pnpm demo:reset --load-users`. */
const ASSIGNMENT_LABEL = __ENV.ASSIGNMENT_LABEL || 'Load test run'

export const options = {
  scenarios: {
    students: { executor: 'constant-vus', vus: VUS, duration: DURATION },
  },
  thresholds: {
    'http_req_duration{kind:read}': ['p(95)<400'],
    'http_req_duration{kind:write}': ['p(95)<800'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
}

const baseHeaders = () => (BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {})

function read(path, params) {
  const res = http.get(`${BASE}${path}`, {
    headers: Object.assign({ accept: 'application/json' }, baseHeaders()),
    tags: { kind: 'read' },
    ...params,
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

export default function student() {
  const vu = String(((__VU - 1) % VUS) + 1).padStart(2, '0')
  const email = `load-student-${vu}@tassl.local`

  const signIn = http.post(
    `${BASE}/api/auth/sign-in/email`,
    JSON.stringify({ email, password: PASSWORD, rememberMe: false }),
    {
      headers: Object.assign({ 'content-type': 'application/json', origin: BASE }, baseHeaders()),
      tags: { kind: 'write' },
    },
  )
  if (!check(signIn, { 'sign-in 200': (r) => r.status === 200 })) {
    sleep(5)
    return
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
