// UI-032 assignment configuration (/assignments/[assignmentId], FR-200)
import { scopedT } from '../scoped'

export const assignment = {
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
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(assignment)
