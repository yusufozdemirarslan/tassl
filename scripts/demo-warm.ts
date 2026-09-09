// Demo warm-up (docs/prompts/02-qa-and-guides.md C15.2, docs/guides/demo-runbook.md T-60).
//
//   PLAYWRIGHT_BASE_URL=https://tassl.vercel.app SEED_PASSWORD=… pnpm demo:warm
//
// Hits `/api/ready` (which wakes Neon when its compute is suspended), then signs in as the demo
// instructor and the demo student through the same endpoint the sign-in form posts to and loads
// every page of the demo path (docs/qa/demo-path.md) with the session cookie, so each route's
// function is warm before a judge clicks it. Every page must answer 200; the script prints the
// time each one took and ends with `demo:warm passed`, or exits 1 naming the first page that did
// not answer.
//
// It never writes anything: no run is started, no row is changed. The seat password is
// `SEED_PASSWORD` (the production value on the operator's machine, the documented default
// locally). `PLAYWRIGHT_BASE_URL` (or `NEXT_PUBLIC_APP_URL`) names the deployment.
import 'dotenv/config'

const BASE = (
  process.env.PLAYWRIGHT_BASE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  'http://localhost:3000'
).replace(/\/$/, '')
const PASSWORD = process.env.SEED_PASSWORD ?? 'Walkthrough-Pass-2026' // gitleaks:allow

type Jar = Map<string, string>

const cookieHeader = (jar: Jar): string =>
  [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

function absorb(jar: Jar, response: Response): void {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';')
    const eq = pair?.indexOf('=') ?? -1
    if (!pair || eq <= 0) continue
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
}

async function signIn(email: string): Promise<Jar> {
  const jar: Jar = new Map()
  const started = performance.now()
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ email, password: PASSWORD, rememberMe: true }),
    redirect: 'manual',
  })
  absorb(jar, response)
  if (!response.ok) {
    throw new Error(`sign-in as ${email}: ${response.status} ${await response.text()}`)
  }
  report(`sign in ${email}`, response.status, started)
  return jar
}

async function getJson<T>(path: string, jar: Jar): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader(jar), accept: 'application/json' },
  })
  absorb(jar, response)
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`)
  return (await response.json()) as T
}

function report(label: string, status: number, started: number): void {
  const ms = Math.round(performance.now() - started)
  console.log(`  ${String(status).padEnd(4)} ${String(ms).padStart(6)} ms  ${label}`)
}

async function loadPage(path: string, jar: Jar): Promise<void> {
  const started = performance.now()
  const response = await fetch(`${BASE}${path}`, {
    headers: { cookie: cookieHeader(jar), accept: 'text/html' },
    redirect: 'manual',
  })
  absorb(jar, response)
  // A signed-in page answers 200; a redirect means the session did not take or the route is not
  // this seat's, and either is a failure the runbook must hear about before the demo.
  report(path, response.status, started)
  if (response.status !== 200) {
    throw new Error(`${path} answered ${response.status} (expected 200)`)
  }
  await response.arrayBuffer()
}

type Me = { memberships: { organizationId: string; role: string }[] }
type Courses = { items: { id: string }[] }
type Packages = {
  items: { id: string; latestVersion: { id?: string; versionId?: string } | null }[]
}
type Assignments = { items: { assignmentId: string; latestRun: { id: string } | null }[] }

async function main(): Promise<void> {
  console.log(`demo:warm against ${BASE}`)

  const readyStarted = performance.now()
  const ready = await fetch(`${BASE}/api/ready`, { headers: { accept: 'application/json' } })
  const readyBody = (await ready.json().catch(() => ({}))) as { assistantMode?: string }
  report(
    `/api/ready${readyBody.assistantMode ? ` (assistant: ${readyBody.assistantMode})` : ''}`,
    ready.status,
    readyStarted,
  )
  if (ready.status !== 200) throw new Error(`/api/ready answered ${ready.status}`)

  // The instructor's half of the demo path.
  const instructor = await signIn('instructor@tassl.local')
  const me = await getJson<Me>('/api/v1/me', instructor)
  const orgId = me.memberships.find((m) => m.role === 'instructor')?.organizationId
  if (!orgId) throw new Error('instructor@tassl.local has no instructor membership')
  await loadPage('/home', instructor)
  await loadPage('/courses', instructor)
  const courses = await getJson<Courses>(`/api/v1/institutions/${orgId}/courses`, instructor)
  const course = courses.items[0]
  if (!course) throw new Error('no course in the walkthrough institution: run pnpm demo:reset')
  await loadPage(`/courses/${course.id}`, instructor)
  await loadPage(`/courses/${course.id}?tab=assignments`, instructor)
  await loadPage('/review', instructor)
  await loadPage('/packages', instructor)
  const packages = await getJson<Packages>(`/api/v1/institutions/${orgId}/packages`, instructor)
  const pkg = packages.items[0]
  const versionId = pkg?.latestVersion?.id ?? pkg?.latestVersion?.versionId
  if (pkg && versionId) await loadPage(`/packages/${pkg.id}/versions/${versionId}`, instructor)
  await loadPage('/notifications', instructor)

  // The student's half.
  const student = await signIn('student1@tassl.local')
  await loadPage('/home', student)
  await loadPage('/runs', student)
  const assignments = await getJson<Assignments>('/api/v1/me/assignments', student)
  const run = assignments.items.map((a) => a.latestRun).find((r) => r !== null)
  if (run) await loadPage(`/runs/${run.id}`, student)
  await loadPage('/notifications', student)

  console.log('demo:warm passed')
}

main().catch((error: unknown) => {
  console.error(`demo:warm failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
