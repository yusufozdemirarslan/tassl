// Demo reset (docs/prompts/02-qa-and-guides.md C15.3; docs/guides/demo-runbook.md).
//
//   pnpm demo:reset                      # the database DATABASE_URL names (local: tassl_test via
//                                        # .env.test, or tassl via .env)
//   DATABASE_URL=<owner string> DATABASE_URL_UNPOOLED=<owner string> SEED_PASSWORD=<production
//   value> APP_ENV=production pnpm demo:reset                     # production, from the operator's
//                                                                # machine (docs/guides/demo-runbook.md)
//
// Restores the seeded demo state and then builds what the seed alone does not: runs that have been
// through the whole loop, so the review, debrief, record and export screens are never empty when a
// judge opens them.
//
//   1. `runSeed()` — idempotent: institution, five seats, course, section, the confirmed Meridian
//      Roast version, three walkthrough assignments (`src/server/db/seed.ts`).
//   2. Every run on the three demo assignments is deleted (the cascade of migration 0012 takes
//      everything hanging off a run), together with the seats' notifications, so every seat is free
//      to start again and the bell shows nothing stale.
//   3. Two runs are built through the module services, exactly as `tests/integration/review/fixture.ts`
//      builds the run the review suites work on, on the **second** student seat so the first is free
//      for the live demo:
//        - `Decision Run 1 (walkthrough)`: taken to `recorded` — scored, one band overridden with a
//          note, the remaining drafts confirmed (export version 1 written), the debrief's two
//          questions answered. This is the run whose replay, debrief, Judgment Record and course
//          export a judge can open before anyone runs anything.
//        - `Auto-lock test run`: taken to `scored` and left there, so the review queue has a run
//          waiting to be confirmed.
//
// The assistant is the scripted (mock) provider in this process whatever the deployment runs with
// — `FEATURE_AI` is forced off below before the configuration loads — so a reset never spends a
// token and its replies are deterministic. The Turn is delivered by time: the script waits the
// version's real `turnDelaySeconds` (90 s on the fixture) so the trace carries real timestamps
// rather than a shifted timeline. Total time: about two and a half minutes.
import 'dotenv/config'

process.env.FEATURE_AI = 'false'
process.env.LLM_PROVIDER = 'mock'
process.env.JOBS_DRAIN_ON_ENQUEUE = 'true'

type Stance = 'accept' | 'verify' | 'challenge' | 'reject' | 'escalate'

const FRAME = {
  decision:
    'Whether to move acquisition spend from the value tier to the premium tier this quarter',
  assumptions: [
    'Premium retention holds at the piloted level',
    'Value tier payback stays near four months',
    'Supplier cost per bag is stable through the year',
  ],
  position:
    'Lean toward holding spend in the value tier until the premium payback figure is rechecked',
  confidence: 40,
}

const BRIEF = {
  recommendation: 'Hold the acquisition spend in the value tier for this quarter.',
  rationale:
    'The premium payback figure is load-bearing and has not been traced to the cohort table, so moving spend on it would be a bet on a number nobody has checked.',
  assumptions: [
    'Premium retention holds near the piloted level',
    'Value tier payback stays close to four months',
    'Green coffee cost per bag is stable through the crop year',
  ],
  changeMyMind: 'A cohort table showing premium payback under six months would change this.',
  confidence: 45,
  namedValues: { budget_share_to_premium: 35, premium_payback_months: 11 },
}

const TURN_RESPONSE = {
  response: 'revise' as const,
  justification:
    'The 78 percent was one cohort acquired under the old pricing, so the payback the recommendation was priced on does not hold and the share sized on it comes down.',
  confidence: 55,
}

const DEFENSE_ANSWER =
  'The assistant gave me the 11 month payback figure and I did not check its date against the payback model, so I priced the recommendation on a number I had not traced.'

const DEBRIEF_ANSWERS = {
  stanceToChange:
    'I would change the stance on the payback claim from Accept to Verify, because the figure was dated before the fulfilment costs were quoted.',
  doDifferently:
    'Trace the one figure the recommendation is priced on before writing the brief, and say in the brief which figures I did not trace.',
}

const OVERRIDE_NOTE =
  'The brief names the payback figure it rests on and says it was not traced; that is Developing, not Novice.'

const log = (line: string): void => {
  process.stdout.write(`demo:reset ${line}\n`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function main(): Promise<void> {
  const { env } = await import('@/server/config')
  const { client, db } = await import('@/server/db/client')
  const { runSeed, SEED_USERS } = await import('@/server/db/seed')
  const {
    assignments,
    notifications,
    runs: runsTable,
    scenarioClaims,
    scenarioDocuments,
    scenarioPackageVersions,
    user,
  } = await import('@/server/db/schema')
  const { eq, inArray } = await import('drizzle-orm')
  const runs = await import('@/server/modules/runs')
  const assistant = await import('@/server/modules/assistant')
  const reliance = await import('@/server/modules/reliance')
  const defense = await import('@/server/modules/defense')
  const scoring = await import('@/server/modules/scoring')
  const review = await import('@/server/modules/review')
  const debrief = await import('@/server/modules/debrief')
  const { stopBoss } = await import('@/server/jobs/boss')
  const { effectiveLlmProvider } = await import('@/server/config')
  if (effectiveLlmProvider() !== 'mock') throw new Error('the reset must run on the mock provider')

  log(`target ${env.APP_ENV}: ${env.DATABASE_URL.replace(/\/\/[^@]*@/, '//…@')}`)

  // 1. The seed.
  const seed = await runSeed()
  log(`seed: ${Object.keys(seed.users).length} seats, course ${seed.courseId}`)

  // 2. Take every rehearsal run off the demo assignments, and the seats' notifications with them.
  const demoAssignments = await db
    .select({ id: assignments.id, label: assignments.label })
    .from(assignments)
    .where(eq(assignments.sectionId, seed.sectionId))
  const assignmentIds = demoAssignments.map((row) => row.id)
  await db
    .update(assignments)
    .set({ isWalkthrough: true })
    .where(inArray(assignments.id, assignmentIds))
  const removed = await db
    .delete(runsTable)
    .where(inArray(runsTable.assignmentId, assignmentIds))
    .returning({ id: runsTable.id })
  const seatIds = Object.values(seed.users)
  await db.delete(notifications).where(inArray(notifications.userId, seatIds))
  log(`cleared ${removed.length} run(s) on ${assignmentIds.length} assignment(s)`)

  // 3. The two pre-built runs on the second student seat.
  const seatRows = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(user)
    .where(inArray(user.id, seatIds))
  const actor = (email: string) => {
    const row = seatRows.find((seat) => seat.email === email)
    const seat = SEED_USERS.find((entry) => entry.email === email)
    if (!row || !seat) throw new Error(`the seed has no seat ${email}`)
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      emailVerified: true,
      activeOrganizationId: seed.organizationId,
      platformRole: seat.platformRole,
    }
  }
  const student = actor('student2@tassl.local')
  const instructor = actor('instructor@tassl.local')

  const [version] = await db
    .select({ turnDelaySeconds: scenarioPackageVersions.turnDelaySeconds })
    .from(scenarioPackageVersions)
    .where(eq(scenarioPackageVersions.id, seed.packageVersionId))
  if (!version) throw new Error('the seeded package version is missing')
  const claimRows = await db
    .select({ id: scenarioClaims.id, key: scenarioClaims.key })
    .from(scenarioClaims)
    .where(eq(scenarioClaims.packageVersionId, seed.packageVersionId))
  const documentRows = await db
    .select({ id: scenarioDocuments.id, key: scenarioDocuments.key })
    .from(scenarioDocuments)
    .where(eq(scenarioDocuments.packageVersionId, seed.packageVersionId))
  const claimId = (key: string): string => {
    const row = claimRows.find((claim) => claim.key === key)
    if (!row) throw new Error(`the seeded version has no claim ${key}`)
    return row.id
  }
  const documentId = (key: string): string => {
    const row = documentRows.find((document) => document.key === key)
    if (!row) throw new Error(`the seeded version has no document ${key}`)
    return row.id
  }
  const assignmentId = (label: string): string => {
    const row = demoAssignments.find((row) => row.label === label)
    if (!row) throw new Error(`the seed has no assignment "${label}"`)
    return row.id
  }

  /** Start, acknowledge, answer the whole Readiness Check, read two documents, lock the frame. */
  async function toWorking(label: string): Promise<string> {
    const started = await runs.startRun(student, assignmentId(label))
    await runs.acknowledgePolicy(student, started.id)
    const check = await runs.getReadiness(student, started.id)
    for (const item of check.items) {
      const first = item.options[0]
      if (first)
        await runs.answerReadinessItem(student, started.id, item.id, { answerKey: first.key })
    }
    await runs.submitReadiness(student, started.id)
    for (const key of ['D1', 'D5']) {
      const opened = await runs.openDocument(student, started.id, documentId(key))
      await runs.closeDocument(student, started.id, opened.openId)
    }
    await runs.lockFrame(student, started.id, FRAME)
    return started.id
  }

  /** One request to the scripted assistant, read to the end so the delegation row is finished. */
  async function ask(runId: string, request: string): Promise<void> {
    const stream = await assistant.delegate(student, runId, { request })
    for await (const chunk of stream) void chunk
  }

  async function stance(runId: string, key: string, value: Stance): Promise<void> {
    await reliance.setStance(student, runId, claimId(key), value)
  }

  /** The working period, the lock, and the run's Turn due instant. */
  async function toLocked(runId: string): Promise<void> {
    await ask(runId, 'What is the premium payback?')
    await ask(
      runId,
      'What is the price sensitivity, is the value tier saturated, and what did the survey find?',
    )
    await stance(runId, 'C3', 'accept')
    const [firstDelegation] = await assistant.listDelegations(student, runId)
    if (!firstDelegation) throw new Error('the first delegation was not stored')
    await assistant.updateDelegation(student, runId, firstDelegation.id, {
      why: 'To get the payback figure the upmarket case rests on.',
      usedClaimIds: [claimId('C3')],
    })
    await stance(runId, 'C5', 'verify')
    await reliance.runAction(student, runId, claimId('C5'), 'source_trace')
    await stance(runId, 'C5', 'accept')
    await stance(runId, 'C8', 'reject')
    await stance(runId, 'C7', 'escalate')
    await reliance.escalate(student, runId, claimId('C7'), {
      statement: 'Was the survey sample drawn from the value tier or from both tiers?',
    })
    await assistant.declareOutsideTool(student, runId, {
      purpose: 'A calculator, to check the payback arithmetic.',
    })
    await runs.saveBriefDraft(student, runId, BRIEF)
    await runs.lockDecision(student, runId, BRIEF)
    await runs.addAddendum(student, runId, {
      text: 'If the cohort table arrives before the board meets, re-run the payback with fulfilment costs in it.',
    })
  }

  /** After the Turn has been delivered: stance the window claims, respond, answer the defense. */
  async function toDefenseComplete(runId: string): Promise<void> {
    await runs.getRun(student, runId)
    for (const claim of await reliance.listRunClaims(student, runId)) {
      if (claim.inTurnWindow && claim.stance === null) {
        await reliance.setStance(student, runId, claim.id, 'verify')
      }
    }
    await runs.respondToTurn(student, runId, TURN_RESPONSE)
    for (let round = 0; round < 40; round += 1) {
      const view = await defense.openDefense(student, runId)
      const next = view.questions.find((question) => !question.answered)
      if (!next) break
      await defense.answerQuestion(student, runId, next.runQuestionId, {
        text: DEFENSE_ANSWER,
        durationMs: 1_000,
      })
    }
    await defense.completeDefense(student, runId)
  }

  async function toScored(runId: string): Promise<void> {
    const current = await runs.getRun(student, runId)
    if (current.state !== 'scored') {
      const result = await scoring.scoreRun(runId)
      if (result.outcome !== 'scored') throw new Error(`run ${runId} came back ${result.outcome}`)
    }
  }

  // One run at a time through the working period: the second assignment's clock is two minutes,
  // and a run whose clock runs out while another is being worked auto-locks with an empty brief.
  const recordedRun = await toWorking('Decision Run 1 (walkthrough)')
  await toLocked(recordedRun)
  const waitingRun = await toWorking('Auto-lock test run')
  await toLocked(waitingRun)
  log(`filed ${recordedRun} and ${waitingRun} as student2@tassl.local`)
  const waitMs = version.turnDelaySeconds * 1000 + 3_000
  log(`decisions filed; waiting ${Math.round(waitMs / 1000)} s for the Turn`)
  await sleep(waitMs)
  await toDefenseComplete(recordedRun)
  await toDefenseComplete(waitingRun)
  await toScored(recordedRun)
  await toScored(waitingRun)
  log('both runs scored')

  // The instructor reads the first run: one band recorded differently with a note, the rest confirmed.
  await review.decideBand(instructor, recordedRun, 'framing', {
    decision: 'overridden',
    band: 'developing',
    note: OVERRIDE_NOTE,
  })
  await review.confirmRemaining(instructor, recordedRun)
  await debrief.getDebrief(student, recordedRun)
  await debrief.answerDebrief(student, recordedRun, DEBRIEF_ANSWERS)
  const recorded = await runs.getRun(student, recordedRun)
  const waiting = await runs.getRun(student, waitingRun)
  log(`run ${recordedRun} is ${recorded.state}; run ${waitingRun} is ${waiting.state}`)
  if (recorded.state !== 'recorded' || waiting.state !== 'scored') {
    throw new Error('the pre-built runs did not reach recorded and scored')
  }

  await stopBoss()
  await client.end({ timeout: 5 })
  log('passed')
}

main().catch(async (error: unknown) => {
  process.stderr.write(
    `demo:reset failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exit(1)
})
