// Section and roster factories (06 §5 item 3) writing through the courses repository.
import type { NewSection, Section, SectionMembership } from '@/server/db/schema'
import { insertSection, upsertSectionMembership } from '@/server/modules/courses/repository'
import { uuidFrom } from './ids'
import { FROZEN_TIME } from './time'

export async function createSection(
  organizationId: string,
  courseId: string,
  label: string,
  overrides: Partial<Omit<NewSection, 'organizationId' | 'courseId'>> = {},
): Promise<Section> {
  return insertSection(organizationId, {
    id: uuidFrom(`section:${label}`),
    courseId,
    name: 'A',
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
    ...overrides,
  })
}

/** Puts the user on the section roster; the row carries no role (D-748). */
export async function addSectionMember(
  organizationId: string,
  sectionId: string,
  userId: string,
): Promise<SectionMembership> {
  const row = await upsertSectionMembership(organizationId, { sectionId, userId })
  if (!row) throw new Error(`section ${sectionId} is not in organization ${organizationId}`)
  return row
}
