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

export async function addSectionMember(
  organizationId: string,
  sectionId: string,
  userId: string,
  role: SectionMembership['role'],
): Promise<SectionMembership> {
  const row = await upsertSectionMembership(organizationId, { sectionId, userId, role })
  if (!row) throw new Error(`section ${sectionId} is not in organization ${organizationId}`)
  return row
}
