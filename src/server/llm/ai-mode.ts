// The runtime assistant switch (docs/tech/11-llm-integration.md §6, D-691).
//
// `FEATURE_AI=false` plus a redeploy has been the kill switch since Phase 14, and it still is: it
// is the layer that cannot be talked out of by anything in the product. What it costs is a build
// and a deploy — minutes, on a day when an operator may have seconds — so this file adds the second
// layer: one row in `app_settings`, key `ai_mode`, that a platform admin flips from `/admin/flags`
// and that the registry reads **on every call** before it picks a chain. No cache, no restart, no
// deploy; the next request after the write is answered by the scripted assistant.
//
// The precedence is fixed and is the whole design:
//
//     FEATURE_AI=false   >   ai_mode = mock   >   LLM_PROVIDER
//
// The environment wins wherever the two disagree. With the flag off the registry never asks this
// file anything — the mock is unconditional and there is no database read on that path (D-651) —
// so the row can only ever *narrow* what the environment allows, never widen it. An admin cannot
// switch a deployment that has no key onto a model, and a deployment that has one can always be
// switched off it.
//
// `readAiMode` never throws. A database that cannot be read is a worse day than a switch that
// cannot be honoured, and the answer on that day is the one the environment already gave: `live`.
// The read is guarded, logged through the request's logger, and answered `live` on any failure —
// which also means a missing row and a corrupted row read the same as no switch at all.
import { eq } from 'drizzle-orm'
import { effectiveLlmProvider } from '@/server/config'
import { db } from '@/server/db/client'
import { appSettings } from '@/server/db/schema/platform'
import type { DbOrTx } from '@/server/db/tx'
import { getLogger } from '@/server/http/request-context'

/** What the row may hold. Anything else — including no row — reads as `live`. */
export type AiMode = 'live' | 'mock'

/** What the assistant actually is, once the environment and the row have both been read. */
export type AssistantMode = 'live' | 'scripted'

/** `app_settings.key` of the switch. */
export const AI_MODE_KEY = 'ai_mode'

/**
 * The row, or `live` when there is none, when it holds anything but `mock`, or when the read fails.
 *
 * One indexed primary-key lookup per model call on the live path. It is deliberately not cached:
 * a cache is a second place the answer lives, with its own staleness, and the point of the switch
 * is that the *next* call honours it.
 */
export async function readAiMode(): Promise<AiMode> {
  try {
    const rows = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, AI_MODE_KEY))
      .limit(1)
    return rows[0]?.value === 'mock' ? 'mock' : 'live'
  } catch (error) {
    getLogger().error({ err: error, key: AI_MODE_KEY }, 'ai mode read failed; answering live')
    return 'live'
  }
}

/**
 * Upserts the row. `updatedBy` is the admin's user id, or null for a script; it is a plain column
 * with no foreign key because the row outlives the account (06 §3.6). The admin service calls this
 * inside the transaction that also writes the `ai_mode.set` audit row, so the two commit together.
 */
export async function writeAiMode(
  mode: AiMode,
  updatedBy: string | null,
  dbx: DbOrTx = db,
): Promise<void> {
  const updatedAt = new Date()
  await dbx
    .insert(appSettings)
    .values({ key: AI_MODE_KEY, value: mode, updatedBy, updatedAt })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: mode, updatedBy, updatedAt },
    })
}

/**
 * The precedence above, as one answer: `scripted` when the environment forces the mock or the row
 * says `mock`, else `live`. What `/api/ready`, the flags screen and the assistant panel's chip all
 * print, so the three can never disagree.
 */
export async function effectiveAssistantMode(): Promise<AssistantMode> {
  if (effectiveLlmProvider() === 'mock') return 'scripted'
  return (await readAiMode()) === 'mock' ? 'scripted' : 'live'
}
