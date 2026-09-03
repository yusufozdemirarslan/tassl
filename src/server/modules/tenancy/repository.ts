// Repository of the `tenancy` module (docs/tech/10-backend-spec-modules.md §2): institution
// settings and data agreements (DATA-005, DATA-052). Organizations, members, and invitations are
// Better Auth's; the service reaches them through `auth.api`. Query bodies only.
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { AppError } from '@/lib/errors'
import { db } from '@/server/db/client'
import {
  dataAgreements,
  institutionSettings,
  type BandMapping,
  type DataAgreement,
  type InstitutionSettings,
  type NewDataAgreement,
} from '@/server/db/schema'
import type { DbOrTx } from '@/server/db/tx'

/** Fields of institution settings a program lead may change; omitted fields keep their value. */
export type SettingsPatch = {
  plan?: InstitutionSettings['plan'] | undefined
  defaultMapping?: BandMapping | undefined
}

/** An agreement as the service hands it in; `id` set = update that row, absent = insert. */
export type AgreementInput = Omit<
  NewDataAgreement,
  'organizationId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>

function one<T>(rows: readonly T[]): T {
  const row = rows[0]
  if (row === undefined) throw new AppError('INTERNAL_ERROR', 'The statement returned no row.')
  return row
}

export async function findSettings(
  tenantId: string,
  dbx: DbOrTx = db,
): Promise<InstitutionSettings | null> {
  const rows = await dbx
    .select()
    .from(institutionSettings)
    .where(eq(institutionSettings.organizationId, tenantId))
    .limit(1)
  return rows[0] ?? null
}

/** Creates the settings row with the platform defaults, or applies the patch to the existing row. */
export async function upsertSettings(
  tenantId: string,
  patch: SettingsPatch,
  dbx: DbOrTx = db,
): Promise<InstitutionSettings> {
  const rows = await dbx
    .insert(institutionSettings)
    .values({ organizationId: tenantId, plan: patch.plan, defaultMapping: patch.defaultMapping })
    .onConflictDoUpdate({
      target: institutionSettings.organizationId,
      set: { plan: patch.plan, defaultMapping: patch.defaultMapping, updatedAt: sql`now()` },
    })
    .returning()
  return one(rows)
}

/**
 * The most recently signed agreement that is not deleted and has not ended
 * (`canReadIdentifiedRecords`); the service checks roles and purposes on it.
 */
export async function findActiveAgreement(
  tenantId: string,
  dbx: DbOrTx = db,
): Promise<DataAgreement | null> {
  const rows = await dbx
    .select()
    .from(dataAgreements)
    .where(
      and(
        eq(dataAgreements.organizationId, tenantId),
        isNull(dataAgreements.deletedAt),
        or(isNull(dataAgreements.endsAt), gt(dataAgreements.endsAt, sql`now()`)),
      ),
    )
    .orderBy(desc(dataAgreements.signedAt), desc(dataAgreements.createdAt), desc(dataAgreements.id))
    .limit(1)
  return rows[0] ?? null
}

export async function listAgreements(tenantId: string, dbx: DbOrTx = db): Promise<DataAgreement[]> {
  return dbx
    .select()
    .from(dataAgreements)
    .where(and(eq(dataAgreements.organizationId, tenantId), isNull(dataAgreements.deletedAt)))
    .orderBy(desc(dataAgreements.createdAt), desc(dataAgreements.id))
}

/**
 * Inserts the agreement, or updates the row named by `input.id` when it belongs to the tenant and
 * is not deleted. Null means the id exists but is not this tenant's live agreement.
 */
export async function upsertAgreement(
  tenantId: string,
  input: AgreementInput,
  dbx: DbOrTx = db,
): Promise<DataAgreement | null> {
  const rows = await dbx
    .insert(dataAgreements)
    .values({ ...input, organizationId: tenantId })
    .onConflictDoUpdate({
      target: dataAgreements.id,
      set: {
        counterparty: input.counterparty,
        permittedPlatformRoles: input.permittedPlatformRoles,
        purposes: input.purposes,
        recordTypesCovered: input.recordTypesCovered,
        recordTypesExcluded: input.recordTypesExcluded,
        retentionDays: input.retentionDays,
        documentReference: input.documentReference,
        signedAt: input.signedAt,
        endsAt: input.endsAt,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${dataAgreements.organizationId} = ${tenantId} and ${dataAgreements.deletedAt} is null`,
    })
    .returning()
  return rows[0] ?? null
}

export async function softDeleteAgreement(
  tenantId: string,
  id: string,
  dbx: DbOrTx = db,
): Promise<DataAgreement | null> {
  const rows = await dbx
    .update(dataAgreements)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(
      and(
        eq(dataAgreements.id, id),
        eq(dataAgreements.organizationId, tenantId),
        isNull(dataAgreements.deletedAt),
      ),
    )
    .returning()
  return rows[0] ?? null
}
