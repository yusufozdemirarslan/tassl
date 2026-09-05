'use server'
// Server Actions of the `scenarios` module: the mirror of every mutation in 07-api-spec.md §6
// (07 §11). Each one validates with the same Zod schema as its route and calls the same service
// function, so the authoring screens and `/api/v1` cannot drift apart. `defineAction` runs
// `requireSession()`, maps errors to the envelope, and never throws to the client — which is what
// lets the confirmation workspace render `ELEMENTS_UNCONFIRMED` and `PACKAGE_INVALID` details
// inline instead of on an error page.
//
// Every input schema here is the module schema plus the ids the screen is routed by. `packageId`
// rides along on the version mutations for one reason: the screens live under
// `/packages/[packageId]/versions/[versionId]`, and `revalidatePath` needs the path it is
// invalidating, not the id of the thing that changed.
import { z } from 'zod'
import { defineAction } from '@/server/http/define-action'
import {
  confirmVersion,
  createPackageFromSeed,
  decideElement,
  importPackage,
  regenerateVersion,
  updateElement,
} from './service'
import {
  ConfirmVersionSchema,
  CreatePackageFromSeedSchema,
  ElementDecisionSchema,
  ElementTypeSchema,
  RegenerateVersionSchema,
} from './schema'

const PACKAGES = '/packages'
const versionView = (packageId: string, versionId: string): string =>
  `/packages/${packageId}/versions/${versionId}`
const confirmWorkspace = (packageId: string, versionId: string): string =>
  `${versionView(packageId, versionId)}/confirm`

/** The version a screen is on, as its route names it. */
const VersionRouteSchema = z.object({ packageId: z.uuid(), versionId: z.uuid() })

/** One element of that version; a singleton is addressed by `SINGLETON_ELEMENT_ID` (06 §3.3). */
const ElementRouteSchema = VersionRouteSchema.extend({
  elementType: ElementTypeSchema,
  elementId: z.uuid(),
})

/**
 * An object whose shape the service owns. The imported document is parsed by `importPackage` so a
 * malformed one answers `IMPORT_INVALID` (07 §6), and an element patch is parsed by `updateElement`
 * against the schema of the type being edited.
 */
const PassthroughSchema = z.looseObject({})

const CreatePackageFromSeedActionSchema = CreatePackageFromSeedSchema.extend({
  orgId: z.string().min(1),
})
const ImportPackageActionSchema = z.object({
  orgId: z.string().min(1),
  document: PassthroughSchema,
})
const UpdateElementActionSchema = ElementRouteSchema.extend({ patch: PassthroughSchema })
const DecideElementActionSchema = ElementRouteSchema.extend(ElementDecisionSchema.shape)
const ConfirmVersionActionSchema = VersionRouteSchema.extend(ConfirmVersionSchema.shape)
const RegenerateVersionActionSchema = VersionRouteSchema.extend(RegenerateVersionSchema.shape)

export const createPackageFromSeedAction = defineAction(
  CreatePackageFromSeedActionSchema,
  async ({ orgId, ...input }, ctx) => ({
    data: await createPackageFromSeed(ctx.actor, orgId, input),
    revalidate: [PACKAGES],
  }),
  { name: 'createPackageFromSeedAction' },
)

export const importPackageAction = defineAction(
  ImportPackageActionSchema,
  async ({ orgId, document }, ctx) => ({
    data: await importPackage(ctx.actor, orgId, document),
    revalidate: [PACKAGES],
  }),
  { name: 'importPackageAction' },
)

export const updateElementAction = defineAction(
  UpdateElementActionSchema,
  async ({ packageId, versionId, elementType, elementId, patch }, ctx) => ({
    data: await updateElement(ctx.actor, versionId, elementType, elementId, patch),
    revalidate: [versionView(packageId, versionId), confirmWorkspace(packageId, versionId)],
  }),
  { name: 'updateElementAction' },
)

export const decideElementAction = defineAction(
  DecideElementActionSchema,
  async ({ packageId, versionId, elementType, elementId, ...input }, ctx) => ({
    data: await decideElement(ctx.actor, versionId, elementType, elementId, input),
    revalidate: [versionView(packageId, versionId), confirmWorkspace(packageId, versionId)],
  }),
  { name: 'decideElementAction' },
)

export const confirmVersionAction = defineAction(
  ConfirmVersionActionSchema,
  async ({ packageId, versionId, ...input }, ctx) => ({
    data: await confirmVersion(ctx.actor, versionId, input),
    // Confirming changes the shelf as well: the list shows the latest version's status (UI-040).
    revalidate: [
      PACKAGES,
      versionView(packageId, versionId),
      confirmWorkspace(packageId, versionId),
    ],
  }),
  { name: 'confirmVersionAction' },
)

export const regenerateVersionAction = defineAction(
  RegenerateVersionActionSchema,
  async ({ packageId, versionId, ...input }, ctx) => ({
    data: await regenerateVersion(ctx.actor, versionId, input),
    // The source version now has a successor, and the shelf's latest version has changed (FR-195).
    revalidate: [PACKAGES, versionView(packageId, versionId)],
  }),
  { name: 'regenerateVersionAction' },
)
