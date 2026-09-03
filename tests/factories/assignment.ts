// Assignment factory (06 §5 item 5 shape) writing through the courses repository.
import type { Assignment, NewAssignment } from '@/server/db/schema'
import { insertAssignment } from '@/server/modules/courses/repository'
import { uuidFrom } from './ids'
import { FROZEN_TIME } from './time'

export async function createAssignment(
  organizationId: string,
  sectionId: string,
  label: string,
  input: { packageVersionId: string; variantId: string } & Partial<
    Omit<NewAssignment, 'organizationId' | 'sectionId' | 'packageVersionId' | 'variantId'>
  >,
): Promise<Assignment> {
  const { packageVersionId, variantId, ...overrides } = input
  return insertAssignment(organizationId, {
    id: uuidFrom(`assignment:${label}`),
    sectionId,
    label: 'Decision Run 1 (walkthrough)',
    packageVersionId,
    variantId,
    isWalkthrough: true,
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
    ...overrides,
  })
}
