// Course factory (06 §5 item 3) writing through the courses repository.
import type { Course, NewCourse } from '@/server/db/schema'
import { insertCourse } from '@/server/modules/courses/repository'
import { uuidFrom } from './ids'
import { FROZEN_TIME } from './time'

export type CourseOverrides = Partial<Omit<NewCourse, 'organizationId' | 'createdBy'>>

export async function createCourse(
  organizationId: string,
  label: string,
  input: { createdBy: string } & CourseOverrides,
): Promise<Course> {
  const { createdBy, ...overrides } = input
  return insertCourse(organizationId, {
    id: uuidFrom(`course:${label}`),
    name: 'Marketing Strategy Walkthrough',
    term: '2026-fall',
    outsideAiPolicy: 'declared',
    createdBy,
    createdAt: FROZEN_TIME,
    updatedAt: FROZEN_TIME,
    ...overrides,
  })
}
