// Every user-facing string lives here (docs/tech/04-repo-structure.md, NFR-017, SYS-021).
// Keys are dot-separated by screen or module; values may carry {param} placeholders.
export const enUS = {
  'landing.title': 'Tassl',
  'landing.tagline': 'Make the call.',

  // Shared UI primitives
  'ui.close': 'Close',
  'ui.loading': 'Loading',
  'ui.more': 'More',
  // A form that arrives with its dialog (16 §3.2) and did not; reopening the dialog retries.
  'ui.formLoadFailed': 'The form could not be loaded. Close this and open it again.',
  // A menu that arrives with the press that opens it (16 §3.2) and did not; pressing again retries.
  'ui.menuLoadFailed': 'The menu could not be loaded. Try again.',
  // A dialog that arrives with the press that opens it and did not; pressing again retries.
  'ui.actionLoadFailed': 'That could not be opened. Try the button again.',
  // Timestamps are formatted in UTC so a server render and its hydration always agree (D-177).
  'ui.dateTime': '{value} UTC',
  'toast.region': 'Messages',

  // App shell (UI-008)
  'shell.brand': 'Tassl',
  'shell.titleTemplate': '%s · Tassl',
  'shell.skipToMain': 'Skip to main content',
  'shell.primaryNav': 'Primary',
  'shell.institution': 'Institution',
  'shell.switchInstitution': 'Switch institution',
  'shell.noInstitution': 'No institution yet',
  'shell.notifications': 'Notifications',
  'shell.notificationsUnread': '{count} unread',
  'shell.notificationsNone': 'No unread notifications',
  'shell.notificationsLabel': '{title}: {status}',
  'shell.notificationsOverflow': '{max}+',
  'shell.account': 'Account',
  'shell.settings': 'Settings',
  'shell.signOut': 'Sign out',
  'shell.notSignedIn': 'Not signed in',
  'nav.home': 'Home',
  'nav.runs': 'Runs',
  'nav.courses': 'Courses',
  'nav.review': 'Review',
  'nav.packages': 'Packages',
  'nav.admin': 'Admin',

  // Home (UI-009)
  'home.title': 'Home',
  'home.description': 'What needs your attention, and what is coming up.',
  'home.runsTitle': 'Your runs',
  'home.emptyTitle': 'Nothing to do yet',
  'home.emptyBody':
    'When a course assigns you a run, or a run is waiting for your review, it appears here.',
  'home.noMembershipsTitle': 'Waiting for an invitation',
  'home.noMemberships':
    'An institution adds you by an invitation email; once you accept it, your courses and runs appear here.',

  // Error pages (UI-007)
  'notFound.title': 'Not found',
  'notFound.body': 'There is nothing at this address. It may have moved, or the link may be wrong.',
  'notFound.home': 'Go home',
  'error.title': 'Something went wrong',
  'error.body': 'The problem has been recorded. If it continues, quote the reference below.',
  'error.bodyNoReference': 'The problem has been recorded. Try again, or come back in a moment.',
  'error.reference': 'Reference',
  'error.retry': 'Try again',

  // Email templates (SYS-001, SYS-005, INT-003; src/server/email/templates)
  'email.greeting': 'Hello {name},',
  'email.linkFallback': 'If the button does not work, paste this link into your browser:',
  'email.footer': 'Tassl sends this message because your institution runs its decision runs here.',
  'email.verify.subject': 'Confirm your email address for Tassl',
  'email.verify.preview': 'Confirm your email address to finish setting up your Tassl account.',
  'email.verify.heading': 'Confirm your email address',
  'email.verify.body':
    'Confirm this address to finish setting up your Tassl account. The link works for 24 hours.',
  'email.verify.cta': 'Confirm email address',
  'email.verify.ignore':
    'If you did not create a Tassl account, ignore this message and nothing happens.',
  'email.reset.subject': 'Reset your Tassl password',
  'email.reset.preview': 'Choose a new password for your Tassl account.',
  'email.reset.heading': 'Reset your password',
  'email.reset.body':
    'Choose a new password for your Tassl account. The link works for one hour, and setting a new password signs out every other session.',
  'email.reset.cta': 'Choose a new password',
  'email.reset.ignore':
    'If you did not ask to reset your password, ignore this message; your password stays as it is.',
  'email.invitation.subject': '{inviterName} invited you to {organizationName} on Tassl',
  'email.invitation.preview': 'Accept your invitation to {organizationName} on Tassl.',
  'email.invitation.heading': 'You are invited to {organizationName}',
  'email.invitation.body':
    '{inviterName} invited you to join {organizationName} on Tassl. Accept the invitation with this email address; it expires in seven days.',
  'email.invitation.role': 'Your role: {role}',
  'email.invitation.cta': 'Accept the invitation',
  'email.notification.subject': '{title} · Tassl',
  'email.notification.preview': 'An update from Tassl: {title}',
  'email.notification.cta': 'Open in Tassl',
  'email.notification.footer':
    'This is an email copy of a Tassl notification. Email copies can be turned off in your account settings.',
  'email.incident.subject': 'Tassl notice · {title}',
  'email.incident.preview': 'An incident notice from Tassl: {title}',
  'email.incident.cta': 'Read the status page',
  'email.incident.footer':
    'This notice goes to everyone affected. It names no one else and makes no judgement about anyone.',

  // Label chips and sample data (FR-254)
  'label.draft': 'Draft',
  'label.confirmed': 'Confirmed',
  'label.uncalibrated': 'Uncalibrated',
  'label.walkthrough': 'Walkthrough',
  'label.provisional': 'Provisional',
  'label.unreviewed': 'Unreviewed',
  'sample.label': 'Illustrative sample data',

  // Account and identity (SYS-003, SYS-004, UI-010; src/server/modules/identity)
  'identity.exportFileName': 'tassl-my-data.json',
  'identity.accountNotFound': 'This account no longer exists.',
  'identity.confirmEmailMismatch': 'Type the email address of this account to confirm.',

  // Institutions, invitations, and data agreements (SYS-005, FR-234; src/server/modules/tenancy)
  'tenancy.invitationNotFound': 'This invitation has expired or has already been used.',
  'tenancy.invitationEmailUnverified':
    'Confirm your email address before accepting this invitation.',
  'tenancy.slugTaken': 'That institution address is already taken.',
  'tenancy.alreadyMember': 'That person is already a member of this institution.',
  'tenancy.alreadyInvited': 'That person already has an invitation to this institution.',
  'tenancy.programLeadNotFound':
    'No Tassl account uses {email}. The program lead needs an account before the institution is created.',

  // Public authentication screens (UI-001 to UI-004, SYS-001, SYS-002)
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.name': 'Your name',
  'auth.newPassword': 'New password',
  'auth.confirmPassword': 'New password again',
  'auth.or': 'or',
  'auth.signIn.title': 'Sign in to Tassl',
  'auth.signIn.description': 'Use the email address your institution knows you by.',
  'auth.signIn.submit': 'Sign in',
  'auth.signIn.rememberMe': 'Keep me signed in',
  'auth.signIn.forgot': 'Forgot your password?',
  'auth.signIn.noAccount': 'No account yet?',
  'auth.signIn.createAccount': 'Create an account',
  'auth.signIn.google': 'Continue with Google',
  'auth.signUp.title': 'Create your Tassl account',
  'auth.signUp.description': 'One account; your institution then adds you to its courses.',
  'auth.signUp.submit': 'Create account',
  'auth.signUp.passwordHint': '12 to 128 characters',
  'auth.signUp.haveAccount': 'Already have an account?',
  'auth.signUp.signIn': 'Sign in',
  'auth.verify.sentTitle': 'Confirm your email address',
  'auth.verify.sentBody':
    'We sent a confirmation link to {email}. Open it to finish setting up your account; the link works for 24 hours.',
  'auth.verify.sentBodyNoEmail':
    'We sent a confirmation link to your email address. Open it to finish setting up your account; the link works for 24 hours.',
  'auth.verify.verifiedTitle': 'Email address confirmed',
  'auth.verify.verifiedBody': 'Your account is ready.',
  'auth.verify.continue': 'Continue to Tassl',
  'auth.verify.invalidTitle': 'That link no longer works',
  'auth.verify.invalidBody':
    'Confirmation links work once and last 24 hours. Ask for a new one and it arrives in a moment.',
  'auth.verify.resend': 'Resend the link',
  'auth.verify.resendIn': 'Resend the link in {seconds} s',
  'auth.verify.resendSent': 'If that address still needs confirming, a new link is on its way.',
  'auth.verify.backToSignIn': 'Back to sign in',
  'auth.forgot.title': 'Reset your password',
  'auth.forgot.description': 'We email a link that lets you choose a new password.',
  'auth.forgot.submit': 'Email me a link',
  'auth.forgot.sent': 'If that address exists, we sent a link. It works for one hour.',
  'auth.forgot.backToSignIn': 'Back to sign in',
  'auth.reset.title': 'Choose a new password',
  'auth.reset.description': 'Saving a new password signs out every other session.',
  'auth.reset.submit': 'Save the new password',
  'auth.reset.successTitle': 'Password changed',
  'auth.reset.successBody': 'Sign in with your new password.',
  'auth.reset.invalidTitle': 'That reset link no longer works',
  'auth.reset.invalidBody': 'Reset links work once and last one hour. Ask for a new one.',
  'auth.reset.requestNew': 'Ask for a new link',
  'auth.reset.signIn': 'Sign in',
  'auth.validation.email': 'Enter a valid email address.',
  'auth.validation.password': 'Enter your password.',
  'auth.validation.name': 'Enter your name.',
  'auth.validation.nameTooLong': 'Use 120 characters or fewer.',
  'auth.validation.passwordLength': 'Use between 12 and 128 characters.',
  'auth.validation.passwordMismatch': 'Both passwords must be the same.',
  'auth.error.invalidEmailOrPassword': 'That email address and password do not match an account.',
  'auth.error.emailNotVerified': 'Confirm your email address before you sign in.',
  'auth.error.resendVerification': 'Resend verification',
  'auth.error.rateLimited': 'Too many attempts. Try again in {seconds} seconds.',
  'auth.error.rateLimitedNoSeconds': 'Too many attempts. Wait a minute and try again.',
  'auth.error.linkExpired': 'That link has expired or has already been used.',
  'auth.error.generic': 'That did not work. Try again.',
  // Pending labels: with prefers-reduced-motion the spinner is nearly the only sign a call is in
  // flight, so the label says it in words as well (DESIGN.md §Motion).
  'auth.signIn.submitPending': 'Signing in',
  'auth.signUp.submitPending': 'Creating your account',
  'auth.forgot.submitPending': 'Sending the link',
  'auth.reset.submitPending': 'Saving the new password',
  'auth.verify.resendPending': 'Sending the link',
  // The resend cooldown reads as its own line under the control, so the control keeps its label.
  'auth.verify.cooldown': 'You can ask for another link in {seconds} s.',
  // Bare /verify-email: nobody has been sent anything yet, so the screen may not say they have.
  'auth.verify.idleTitle': 'Confirm your email address',
  'auth.verify.idleBody':
    'Enter the address you signed up with and we send a new confirmation link.',
  'auth.verify.sentBodyAddressed':
    'Open the link to finish setting up your account; it works for 24 hours. We sent it to:',
  'auth.reset.backToSignIn': 'Back to sign in',

  // Shell wiring (UI-008, Step 3.5)
  'shell.institutionSwitched': 'Now working in {name}.',
  'shell.signOutFailed': 'Signing out did not work. Try again.',

  // Organization roles as people read them (08-auth-authz.md §3)
  'role.student': 'Student',
  'role.instructor': 'Instructor',
  'role.teaching_assistant': 'Teaching assistant',
  'role.scenario_author': 'Scenario author',
  'role.program_lead': 'Program lead',

  // Notifications (UI-011)
  'notifications.title': 'Notifications',
  'notifications.description': 'What Tassl has told you, newest first.',
  'notifications.listLabel': 'Notifications',
  'notifications.markAllRead': 'Mark all read',
  'notifications.markRead': 'Mark read',
  'notifications.markReadLabel': 'Mark "{title}" read',
  'notifications.markedAllRead': 'Everything is marked read.',
  'notifications.loadMore': 'Load more',
  'notifications.unread': 'Unread',
  'notifications.open': 'Open',
  'notifications.emptyTitle': 'Nothing yet',
  'notifications.emptyBody':
    'Tassl writes here when a run is scored, a package finishes generating, or an instructor confirms your bands.',
  'notifications.notFound': 'That notification no longer exists.',
  'notifications.type.generation_complete': 'Package generated',
  'notifications.type.generation_failed': 'Generation failed',
  'notifications.type.run_scored': 'Run scored',
  'notifications.type.run_held': 'Run held for review',
  'notifications.type.bands_confirmed': 'Bands confirmed',
  'notifications.type.invitation': 'Invitation',
  'notifications.type.export_ready': 'Export ready',
  'notifications.type.package_confirmed': 'Package confirmed',
  'notifications.packageConfirmedTitle': 'A scenario package is ready to assign',
  'notifications.packageConfirmedBody':
    '{title} version {version} is confirmed and frozen, so it can be set on an assignment.',

  // Account settings (UI-010, SYS-003, SYS-004)
  'settings.title': 'Account settings',
  'settings.description': 'Your profile, your password and devices, and your data.',
  'settings.tabsLabel': 'Account settings sections',
  'settings.tabProfile': 'Profile',
  'settings.tabSecurity': 'Security',
  'settings.tabData': 'Data',
  'settings.profileTitle': 'Profile',
  'settings.profileDescription': 'The name your instructors and classmates see beside your work.',
  'settings.profileSave': 'Save changes',
  'settings.profileSaved': 'Your name is saved.',
  'settings.emailFixed':
    'Your institution knows you by this address, so it is not editable here. Ask your program lead if it needs to change.',
  'settings.security.passwordTitle': 'Password',
  'settings.security.passwordDescription':
    'Choosing a new password signs out every other device straight away.',
  'settings.security.currentPassword': 'Current password',
  'settings.security.submit': 'Change password',
  'settings.security.changed': 'Your password is changed. Other devices are signed out.',
  'settings.security.wrongPassword': 'That is not your current password.',
  'settings.security.sessionsTitle': 'Signed-in devices',
  'settings.security.sessionsDescription':
    'Every device holding a live session. Sign out any you do not recognise.',
  'settings.security.sessionsEmpty': 'No other device is signed in.',
  'settings.security.sessionsFailed': 'The device list could not be loaded.',
  'settings.security.thisDevice': 'This device',
  'settings.security.unknownDevice': 'Unknown device',
  'settings.security.signedIn': 'Signed in {value}',
  'settings.security.revoke': 'Sign out',
  'settings.security.revokeLabel': 'Sign out {device}',
  'settings.security.revoked': 'That device is signed out.',
  'settings.security.revokeOthers': 'Sign out every other device',
  'settings.security.revokedOthers': 'Every other device is signed out.',
  'settings.data.exportTitle': 'Download my data',
  'settings.data.exportDescription':
    'A JSON file holding your profile, your memberships, your runs, your notifications, and the actions you took. Twice an hour.',
  'settings.data.exportSubmit': 'Download my data',
  'settings.data.exportStarted': 'Your file is downloading.',
  'settings.data.exportFailed': 'The download did not start. Try again in a moment.',
  'settings.data.deleteTitle': 'Delete account',
  'settings.data.deleteDescription':
    'Your account closes immediately and is deleted 30 days later. Course records keep a pseudonymous copy of your runs so your institution can keep its grades; that copy carries no name and no email address.',
  'settings.data.deleteSubmit': 'Delete my account',
  'settings.data.deleteDialogTitle': 'Delete your account?',
  'settings.data.deleteDialogBody':
    'You are signed out straight away and cannot sign in again. After 30 days everything Tassl holds about you is deleted; the pseudonymous course record of your runs stays with your institution.',
  'settings.data.deleteConfirmLabel': 'Type {email} to confirm',
  'settings.data.deleteConfirm': 'Delete my account',
  'settings.data.deleteCancel': 'Keep my account',
  'settings.data.deleteFailed': 'The account was not deleted. Try again.',

  // Accept invitation (UI-005, SYS-005)
  'invitation.title': 'Invitation',
  'invitation.heading': 'Join {name}',
  'invitation.body':
    '{name} invited you to Tassl. Accept and your courses, assignments, and runs there appear on your home page.',
  'invitation.roleLabel': 'Your role',
  'invitation.accept': 'Accept the invitation',
  'invitation.accepted': 'You are now a member of {name}.',
  'invitation.acceptFailed': 'The invitation was not accepted. Try again.',
  'invitation.expiredTitle': 'This invitation no longer works',
  'invitation.expiredBody':
    'Invitations last seven days and work once. Ask whoever invited you to send a new one.',
  'invitation.mismatchTitle': 'This invitation is for another address',
  'invitation.mismatchBody':
    'You are signed in as {email}. Sign in with the address the invitation was sent to, then open the link again.',
  'invitation.switchAccount': 'Sign out and use another account',
  'invitation.home': 'Go home',

  // Courses, sections, rosters, assignments (UI-030 to UI-032, FR-200, FR-201, FR-205, D-104)
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

  // UI-031 section roster (/courses/[courseId]/sections/[sectionId]/roster, SYS-005)
  'roster.title': 'Section roster',
  'roster.description':
    'Who is in this section. Everyone on it already belongs to the institution; invite anyone who does not.',
  'roster.context': '{course} · {section}',
  'roster.backToCourse': 'Back to the course',
  'roster.membersTitle': 'Members',
  'roster.membersCaption': 'People in {section}',
  'roster.columnName': 'Name',
  'roster.columnEmail': 'Email',
  'roster.columnRole': 'Role',
  'roster.columnActions': 'Actions',
  'roster.remove': 'Remove',
  'roster.removeLabel': 'Remove {name} from this section',
  'roster.removed': '{name} is out of this section.',
  'roster.membersEmptyTitle': 'Nobody is in this section yet',
  'roster.membersEmptyBody':
    'Add the people who will take this section’s assignments. A student needs a row here before a run can start.',
  'roster.truncated': 'The first {count} members are shown.',
  'roster.roleStudent': 'Student',
  'roster.roleInstructor': 'Instructor',
  'roster.roleTa': 'Teaching assistant',
  'roster.addTitle': 'Add member',
  'roster.addDescription':
    'Add someone by the address they sign in with. They must already belong to the institution.',
  'roster.addEmail': 'Email address',
  'roster.addRole': 'Role in this section',
  'roster.addSubmit': 'Add to section',
  'roster.added': '{email} is now in this section.',
  'roster.inviteAction': 'Invite to institution',
  'roster.invited': 'An invitation is on its way to {email}.',
  'roster.invitationsTitle': 'Invitations',
  'roster.invitationsDescription': 'An invitation lasts seven days and can be accepted once.',
  'roster.invitationsCaption': 'Outstanding invitations to this institution',
  'roster.invitationsExpires': 'Expires',
  'roster.invitationsEmptyTitle': 'No invitations yet',
  'roster.invitationsEmptyBody':
    'Invite an address that does not belong to the institution and the invitation appears here with the day it expires.',
  'roster.cancel': 'Cancel',
  'roster.columnStatus': 'Status',
  'roster.invitationPending': 'Pending',
  'roster.invitationExpired': 'Expired',
  'roster.removeConfirmTitle': 'Take this person off the roster?',
  'roster.removeConfirmBody':
    '{name} ({email}) comes off the roster of {section} and can no longer start its assignments. Nothing they have written is deleted, and you can add them back by address.',
  'roster.removeConfirmAction': 'Remove from section',
  'roster.removeConfirmPending': 'Removing…',
  'roster.inviteTitle': 'Invite to the institution',
  'roster.inviteDescription':
    'They get an email with a link that lasts seven days. Accepting it makes them a member of the institution; add them to this section afterwards.',
  'roster.inviteEmail': 'Email address',
  'roster.inviteRole': 'Role in the institution',
  'roster.inviteSubmit': 'Send invitation',
  'roster.invitePending': 'Sending…',

  // UI-032 assignment configuration (/assignments/[assignmentId], FR-200)
  'assignment.title': 'Assignment',
  'assignment.context': '{course} · {section}',
  'assignment.backToCourse': 'Back to the course',
  'assignment.configureTitle': 'Configuration',
  'assignment.configureDescription': 'What every run on this assignment is taken under.',
  'assignment.labelLabel': 'Assignment name',
  'assignment.labelHint': 'What students see in their list.',
  'assignment.packageLabel': 'Scenario package version',
  'assignment.packageOption': '{title} · version {version}',
  'assignment.packageHint': 'Only a confirmed version can carry an assignment.',
  'assignment.variantLegend': 'Variant',
  'assignment.variantDefective': 'Defective',
  'assignment.variantDefectiveHint':
    'The assistant states one consequential claim that does not hold up.',
  'assignment.variantSound': 'Sound',
  'assignment.variantSoundHint': 'Every consequential claim the assistant states holds up.',
  'assignment.clockLabel': 'Working clock (seconds)',
  'assignment.clockDefault': 'The package sets {seconds} seconds. Leave this empty to follow it.',
  'assignment.clockHint': 'Whole seconds, at least 60. Leave this empty to follow the package.',
  'assignment.weightLabel': 'Weight',
  'assignment.weightDefault': 'The course sets {weight}. Leave this empty to follow it.',
  'assignment.walkthroughLabel': 'Walkthrough',
  'assignment.walkthroughHint':
    'A practice assignment. A run on it can be deleted; a run that counts is voided instead.',
  'assignment.opensAtLabel': 'Opens at',
  'assignment.opensAtHint': 'Times are UTC. Leave this empty to open it now.',
  'assignment.lockedTitle': 'The setup is fixed',
  'assignment.lockedBody':
    'A run has already started on this assignment, so the package version, the variant, the working clock, and the weight cannot change. The name, the walkthrough flag, and the opening time stay editable.',
  'assignment.createSubmit': 'Create assignment',
  'assignment.saveSubmit': 'Save configuration',
  'assignment.created': '{label} is ready.',
  'assignment.saved': 'The assignment is saved.',
  'assignment.noPackagesTitle': 'Confirm a scenario package first',
  'assignment.noPackagesBody':
    'An assignment runs on a confirmed scenario package version. Confirm one, then configure the assignment.',
  'assignment.runsTitle': 'Runs',
  'assignment.runsEmptyTitle': 'No runs yet',
  'assignment.runsEmptyBody':
    'Once a student starts this assignment, their run appears here with its state and its replay.',
  'assignment.validation.label': 'Name this assignment.',
  'assignment.validation.labelTooLong': 'Use 200 characters or fewer.',
  'assignment.validation.package': 'Choose a scenario package version.',
  'assignment.validation.variant': 'Choose a variant.',
  'assignment.validation.clock': 'Enter whole seconds, at least 60, or leave it empty.',
  'assignment.validation.weight':
    'Enter the weight as a number of zero or more, or leave it empty.',
  'assignment.validation.opensAt': 'Enter a date and time, or leave it empty.',

  // Scenario packages (UI-040 to UI-044; src/server/modules/scenarios)
  // The package export is a download (07 §1 "Content types"); the family key names the file so two
  // exports taken in a row do not land on top of each other.
  'package.exportFileName': 'tassl-package-{familyKey}.json',
} as const

export type MessageKey = keyof typeof enUS
