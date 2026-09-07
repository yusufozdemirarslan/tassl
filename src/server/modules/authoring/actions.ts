'use server'
// Server Actions of the `authoring` module: the mirror of every mutation in 07-api-spec.md §6
// (07 §11), so the generation screen and `/api/v1` cannot drift apart. `defineAction` runs
// `requireSession()`, maps errors to the envelope and never throws to the client — which is what
// lets the screen render `GENERATION_ALREADY_RUNNING` and `SEED_MISSING` inline rather than on an
// error page.
//
// Every input schema is the module schema plus the ids the screen is routed by. `packageId` rides
// along because the screens live under `/packages/[packageId]/versions/[versionId]` and
// `revalidatePath` needs the path it is invalidating, not the id of the thing that changed.
import { z } from 'zod'
import { defineAction } from '@/server/http/define-action'
import { ElementTypeSchema } from '@/server/modules/scenarios/schema'
import { regenerateElement, startGeneration } from './service'
import { RegenerateElementSchema } from './schema'

const versionView = (packageId: string, versionId: string): string =>
  `/packages/${packageId}/versions/${versionId}`
const generationScreen = (packageId: string, versionId: string): string =>
  `${versionView(packageId, versionId)}/generation`
const confirmWorkspace = (packageId: string, versionId: string): string =>
  `${versionView(packageId, versionId)}/confirm`

const VersionRouteSchema = z.object({ packageId: z.uuid(), versionId: z.uuid() })

/** One element of that version; a singleton is addressed by `SINGLETON_ELEMENT_ID` (06 §3.3). */
const ElementRouteSchema = VersionRouteSchema.extend({
  elementType: ElementTypeSchema,
  elementId: z.uuid(),
})

const StartGenerationActionSchema = VersionRouteSchema
const RegenerateElementActionSchema = ElementRouteSchema.extend(RegenerateElementSchema.shape)

export const startGenerationAction = defineAction(
  StartGenerationActionSchema,
  async ({ packageId, versionId }, ctx) => ({
    data: await startGeneration(ctx.actor, versionId),
    revalidate: [generationScreen(packageId, versionId), versionView(packageId, versionId)],
  }),
  { name: 'startGenerationAction' },
)

export const regenerateElementAction = defineAction(
  RegenerateElementActionSchema,
  async ({ packageId, versionId, elementType, elementId, ...input }, ctx) => ({
    data: await regenerateElement(ctx.actor, versionId, elementType, elementId, input),
    // The element changes and so does the record of what generation has done to this version.
    revalidate: [
      confirmWorkspace(packageId, versionId),
      generationScreen(packageId, versionId),
      versionView(packageId, versionId),
    ],
  }),
  { name: 'regenerateElementAction' },
)
