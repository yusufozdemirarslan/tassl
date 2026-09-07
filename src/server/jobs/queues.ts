// Job queues: docs/tech/10-backend-spec.md §7 (queue table, options, singleton keys, drain order).
// Pure constants and types; no database access. Scripts (pgboss-migrate, jobs-worker) and the
// drain read these so every queue is declared exactly once.

export const QUEUE_NAMES = [
  'score_run',
  'generate_package_step',
  'send_email',
  'purge_deleted_accounts',
  'recompute_exports',
] as const

export type QueueName = (typeof QUEUE_NAMES)[number]

/** Priority order for the drain (10 §7): scoring first, maintenance last. */
export const DRAIN_ORDER = [
  'score_run',
  'generate_package_step',
  'recompute_exports',
  'send_email',
  'purge_deleted_accounts',
] as const satisfies readonly QueueName[]

/** Every queue dead-letters into `<name>_dead`; the dead queue must exist before it is referenced. */
export const deadLetterQueue = (name: QueueName): string => `${name}_dead`

export type QueueOptions = {
  retryLimit: number
  retryDelay: number
  retryBackoff: boolean
  expireInSeconds: number
  deadLetter: string
}

const BASE_QUEUE_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 280,
} as const

export const QUEUE_OPTIONS: Readonly<Record<QueueName, QueueOptions>> = Object.fromEntries(
  QUEUE_NAMES.map((name) => [name, { ...BASE_QUEUE_OPTIONS, deadLetter: deadLetterQueue(name) }]),
) as Record<QueueName, QueueOptions>

/** Typed payload per queue (10 §7). Handlers arrive with their modules in later phases. */
export type JobPayloads = {
  score_run: { runId: string }
  /**
   * One step of the authoring pipeline (10 §5). It carries its institution beside its version for
   * the reason `recompute_exports` does — a job has no session to resolve a tenant from and every
   * read it makes is tenant-scoped (D-006, D-447) — and it carries `restatedRules`, which is the
   * retry channel itself: a second pass of a step is the same job told, in the validator's own
   * words, which rule the first pass broke. `standalone` marks a regeneration, which re-runs one
   * step and stops rather than carrying the pipeline on to the next.
   */
  generate_package_step: {
    packageVersionId: string
    organizationId: string
    step: string
    passNumber: number
    restatedRules: string[]
    standalone?: boolean
  }
  send_email: { to: string; template: string; props: Record<string, unknown> }
  purge_deleted_accounts: Record<string, never>
  /**
   * The mapping change's recompute (FR-206). It carries its institution as well as its course,
   * because a job has no session to resolve one from and every read it makes is tenant-scoped
   * (D-006, D-447); the singleton key stays the course, which is the thing being recomputed.
   */
  recompute_exports: { courseId: string; organizationId: string }
}

export type Payload<Q extends QueueName> = JobPayloads[Q]

/** `YYYY-MM-DD` in UTC: the date part of the daily maintenance singleton key. */
export const utcDateKey = (now: Date = new Date()): string => now.toISOString().slice(0, 10)

/** Singleton key builders per the table in 10 §7; `send_email` has none (every email is sent). */
export const singletonKeyFor: { [Q in QueueName]: (payload: Payload<Q>) => string | undefined } = {
  score_run: (p) => `score_run:${p.runId}`,
  generate_package_step: (p) => `generate:${p.packageVersionId}:${p.step}`,
  send_email: () => undefined,
  purge_deleted_accounts: () => `purge:${utcDateKey()}`,
  recompute_exports: (p) => `recompute:${p.courseId}`,
}

export const isQueueName = (value: string): value is QueueName =>
  (QUEUE_NAMES as readonly string[]).includes(value)
