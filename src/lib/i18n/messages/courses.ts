// Courses, sections, rosters, assignments (UI-030 to UI-032, FR-200, FR-201, FR-205, D-104)
import { scopedT } from '../scoped'

export const courses = {
  'courses.courseNotFound': 'That course no longer exists.',
  'courses.sectionNotFound': 'That section no longer exists.',
  'courses.assignmentNotFound': 'That assignment no longer exists.',
  'courses.runNotFound': 'That run no longer exists.',
  'courses.runNotWalkthrough':
    'Only a run on a walkthrough assignment can be deleted. A run that counts is voided instead.',
  // The sentence the policy display shows above the Begin control (FR-201, PRD §7.19).
  'courses.countsStatement': 'This run counts toward the course grade. Run one counts.',

  // UI-030 course list (/courses)
  'courses.title': 'Courses',
  'courses.description':
    'Every course in this institution, with the sections that hold its rosters and the assignments a run starts from.',
  'courses.listCaption': 'Courses in this institution',
  'courses.columnName': 'Course',
  'courses.columnTerm': 'Term',
  'courses.columnSections': 'Sections',
  'courses.columnAssignments': 'Assignments',
  'courses.openCourse': 'Open {name}',
  'courses.showMore': 'Show more courses',
  'courses.emptyTitle': 'No courses yet',
  'courses.emptyBody':
    'A course carries the outside-AI policy, the run weight, and the band-to-points mapping its assignments run under.',
  'courses.noInstitutionTitle': 'No institution yet',
  'courses.noInstitutionBody':
    'Courses belong to an institution. Once you accept an invitation, the courses you teach appear here.',

  // UI-030 new course (CourseForm)
  'courses.newCourse': 'New course',
  'courses.newCourseDescription':
    'Name it and give it a term. Policy, weight, and the band mapping are set on the course once it exists.',
  'courses.nameLabel': 'Course name',
  'courses.termLabel': 'Term',
  'courses.termHint': 'The term this course runs in, written the way your institution writes it.',
  'courses.createSubmit': 'Create course',
  'courses.createPending': 'Creating…',
  'courses.cancel': 'Cancel',
  'courses.created': '{name} is ready.',
  'courses.validation.name': 'Give the course a name.',
  'courses.validation.nameTooLong': 'A course name is at most 200 characters.',
  'courses.validation.term': 'Give the course a term.',
  'courses.validation.termTooLong': 'A term is at most 100 characters.',

  // UI-030 course detail: the four sub-views
  'courses.backToCourses': 'All courses',
  'courses.termLine': 'Term {term}',
  'courses.viewsLabel': 'Course views',
  'courses.tabSections': 'Sections',
  'courses.tabAssignments': 'Assignments',
  'courses.tabPolicy': 'Policy',
  'courses.tabMapping': 'Mapping',
  // Each sub-view is its own address, so each is its own document title (WCAG 2.4.2).
  'courses.metaTitle': '{course} · {view}',
  'courses.readOnlyNote':
    'You can read this course. Only an instructor who teaches it can change its setup.',

  // UI-030 sections sub-view (SectionsList)
  'courses.sectionsTitle': 'Sections',
  'courses.sectionsDescription':
    'A section holds its own roster, and every assignment belongs to one section.',
  'courses.sectionsCaption': 'Sections in this course',
  'courses.columnSection': 'Section',
  'courses.columnMembers': 'Members',
  'courses.columnRoster': 'Roster',
  'courses.openRoster': 'Open the roster for {name}',
  'courses.rosterLink': 'Roster',
  'courses.sectionsEmptyTitle': 'No sections yet',
  'courses.sectionsEmptyBody':
    'Add a section, then add the people who run its assignments to its roster.',
  'courses.newSection': 'New section',
  'courses.newSectionDescription':
    'Sections divide one course into rosters. An assignment is configured on a section.',
  'courses.sectionNameLabel': 'Section name',
  'courses.sectionSubmit': 'Add section',
  'courses.sectionPending': 'Adding…',
  'courses.sectionCreated': 'Section {name} added.',
  'courses.validation.sectionName': 'Give the section a name.',
  'courses.validation.sectionNameTooLong': 'A section name is at most 100 characters.',

  // UI-030 assignments sub-view (AssignmentsList)
  'courses.assignmentsTitle': 'Assignments',
  'courses.assignmentsDescription':
    'Each assignment points at one confirmed scenario package version; a run starts from it.',
  'courses.assignmentsCaption': 'Assignments in this course',
  'courses.columnAssignment': 'Assignment',
  'courses.columnType': 'Type',
  'courses.columnState': 'State',
  'courses.columnClock': 'Working clock',
  'courses.runTypeDecision': 'Decision run',
  'courses.runTypeCritique': 'Critique run',
  'courses.stateOpen': 'Open now',
  'courses.stateScheduled': 'Opens {date}',
  'courses.clockMinutes': '{minutes} min',
  'courses.clockPackageDefault': 'Package default',
  'courses.configureAssignment': 'Configure {label}',
  'courses.assignmentsEmptyTitle': 'No assignments yet',
  'courses.assignmentsEmptyBody':
    'An assignment carries the scenario package version, the working clock, and the weight a run starts from. Confirm a scenario package first.',
  'courses.newAssignment': 'New assignment',
  'courses.newAssignmentDescription':
    'An assignment belongs to one section and points at one confirmed scenario package version. Every run on it is taken under what you set here.',
  'courses.newAssignmentNoSections':
    'An assignment belongs to a section. Add a section to this course first.',
  'courses.assignmentSectionLabel': 'Section',
  'courses.assignmentSectionHint':
    'The roster this assignment is set for; its students are the ones who take it.',
  'courses.assignmentSectionOne':
    'This assignment goes to {name}, the only section of this course.',

  // UI-030 policy sub-view (PolicyForm); the three policies are PRD §7.19, FR-062
  'courses.policyTitle': 'Policy and weight',
  'courses.policyDescription':
    'What this course allows outside Tassl, what one run is worth, and which concepts it teaches.',
  'courses.policyLegend': 'Outside-AI policy',
  'courses.policyNotEnforced':
    'Tassl displays this policy and never enforces it. It does not detect, infer, or estimate undeclared use, and a declaration never lowers a band or a point.',
  'courses.policyOpen': 'Open',
  'courses.policyOpenDescription':
    'Students may use any AI tool they like, inside Tassl or outside it, and need not say so.',
  'courses.policyDeclared': 'Declared',
  'courses.policyDeclaredDescription':
    'Students may use outside AI tools and are asked to declare each use and its purpose. The declaration is recorded beside the run and changes nothing about its score.',
  'courses.policyInEnvironment': 'In-Environment Only',
  'courses.policyInEnvironmentDescription':
    'The course asks students to work only with the assistant inside Tassl. A declaration of outside use is still recorded and shown to you, with no scoring effect; what follows is your call.',
  'courses.weightLabel': 'Default run weight',
  'courses.weightDescription':
    'What one Decision Run in this course is worth in your gradebook. A Critique Run defaults to half of it.',
  'courses.conceptsLabel': 'Taught concepts',
  'courses.conceptsDescription':
    'One per line. Tassl matches scenarios to what the course has taught.',
  'courses.policySubmit': 'Save policy',
  'courses.policyPending': 'Saving…',
  'courses.policySaved': 'Policy saved.',
  'courses.validation.weight': 'Enter the weight as a number.',
  'courses.validation.weightNegative': 'A weight cannot be negative.',
  'courses.validation.concept': 'A taught concept is at most 120 characters.',
  'courses.validation.conceptsTooMany': 'A course lists at most 50 taught concepts.',

  // UI-030 mapping sub-view (MappingEditor); apply-with-recompute is FR-206, Phase 11
  'courses.mappingTitle': 'Band-to-points mapping',
  'courses.mappingDescription':
    "What one confirmed band is worth in this course. A run's points are the mean over the dimensions it assessed; an unassessed dimension is excluded, never counted as zero.",
  'courses.mappingNovice': 'Novice',
  'courses.mappingDeveloping': 'Developing',
  'courses.mappingProficient': 'Proficient',
  'courses.mappingProfessional': 'Professional',
  'courses.mappingSubmit': 'Save mapping',
  'courses.mappingPending': 'Saving…',
  'courses.mappingSaved': 'Mapping saved.',
  // The Apply control itself arrives with Phase 11 (FR-206), together with the preview table and
  // the "every confirmed run will be re-exported" acknowledgement; until then only the note shows.
  'courses.mappingApply': 'Apply to confirmed runs',
  'courses.mappingApplyNote': 'Recomputation of confirmed runs arrives with review.',
  'courses.validation.point': 'Enter the points as a number.',
  'courses.validation.pointPositive': 'Points must be above zero.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(courses)
