// Test factories (docs/tech/06-data-model.md §5; 14-testing-strategy.md §5). Every id is
// deterministic (uuidFrom) and every row is stamped FROZEN_TIME, so fixtures rebuild identically
// after truncateAll(). Repositories do the writing wherever one exists.
export { createAssignment } from './assignment'
export { createCourse } from './course'
export { emailFrom, uuidFrom } from './ids'
export { addMember, createInstitution } from './institution'
export { createPackageVersion, minimalConfirmedVersion } from './package'
export { addSectionMember, createSection } from './section'
export { FROZEN_TIME, at } from './time'
export { createUser } from './user'

import { createAssignment } from './assignment'
import { createCourse } from './course'
import { addMember, createInstitution } from './institution'
import { createPackageVersion } from './package'
import { addSectionMember, createSection } from './section'
import { createUser } from './user'

/** The walkthrough shape (06 §5 items 1–3 and 5) with fixture ids: one org, four seats, a course,
 *  section A, a minimal package version, and the walkthrough assignment on the defective variant. */
export async function buildWalkthroughFixture() {
  const { organization } = await createInstitution('walkthrough')
  const instructor = await createUser('instructor')
  const student1 = await createUser('student-1')
  const student2 = await createUser('student-2')
  const editor = await createUser('editor', { platformRole: 'tassl_scenario_editor' })
  await addMember(organization.id, instructor.id, 'instructor')
  await addMember(organization.id, student1.id, 'student')
  await addMember(organization.id, student2.id, 'student')
  await addMember(organization.id, editor.id, 'scenario_author')

  const course = await createCourse(organization.id, 'marketing-strategy', {
    createdBy: instructor.id,
  })
  const section = await createSection(organization.id, course.id, 'marketing-strategy-a')
  await addSectionMember(organization.id, section.id, instructor.id, 'instructor')
  await addSectionMember(organization.id, section.id, student1.id, 'student')
  await addSectionMember(organization.id, section.id, student2.id, 'student')

  const pkg = await createPackageVersion(organization.id, 'meridian-roast', {
    createdBy: instructor.id,
  })
  const assignment = await createAssignment(organization.id, section.id, 'decision-run-1', {
    packageVersionId: pkg.version.id,
    variantId: pkg.defective.id,
  })

  return { organization, instructor, student1, student2, editor, course, section, pkg, assignment }
}
