// Scenario packages (UI-040 to UI-044; src/server/modules/scenarios)
// The package export is a download (07 §1 "Content types"); the family key names the file so two
// exports taken in a row do not land on top of each other.
import { scopedT } from '../scoped'

export const packages = {
  'package.exportFileName': 'tassl-package-{familyKey}.json',

  // UI-040 packages list (/packages)
  'packages.title': 'Packages',
  'packages.description':
    'The scenario packages this institution has authored. A confirmed version is what an assignment runs on.',
  'packages.listCaption': 'Scenario packages in this institution',
  'packages.columnPackage': 'Package',
  'packages.columnFamily': 'Family',
  'packages.columnLatestVersion': 'Latest version',
  'packages.columnStatus': 'Status',
  'packages.columnCalibration': 'Calibration',
  'packages.columnWarnings': 'Warnings',
  'packages.openVersion': 'Open {title}, version {version}',
  'packages.versionNumber': 'Version {version}',
  'packages.versionCount': '{count} versions in the family',
  'packages.noVersion': 'No version yet',
  'packages.statusRetired': 'Retired',
  'packages.calibrated': 'Calibrated',
  'packages.warningsNone': 'No warnings',
  'packages.showMore': 'Show more packages',
  'packages.newPackage': 'New package from a seed case',
  'packages.emptyTitle': 'No packages yet',
  'packages.emptyBody':
    'A scenario package holds one decision case: the brief, the documents, the claims the assistant states, and the questions a student answers afterwards. Start one from a seed case you hold the rights to adapt, then confirm every element to freeze a version an assignment can run on.',
  'packages.noInstitutionTitle': 'No institution yet',
  'packages.noInstitutionBody':
    'Packages belong to an institution. Once you accept an invitation to one, the packages you may author appear here.',
  'packages.noAccessTitle': 'Packages are not open to your seat',
  'packages.noAccessBody':
    'Only an instructor or a scenario author reads and writes packages in {name}. If you should be one, an administrator of the institution can change your seat.',
  // D-083: the ethical-shortcut rule is per family, and the build family carries a single
  // stale-evidence defect, so this is stated as a warning an author can act on rather than a block.
  'packages.warningEthicalShortcut': 'No ethical-shortcut defect',
  'packages.warningEthicalShortcutHelp':
    'No version of a marked family plants a defect that reaches a plausible result by an ethically or organizationally unacceptable route — the case students are least prepared for. Add one to a claim state in the next version. It does not stop you confirming a version or setting an assignment on it.',
  // D-251: the concept map is what a student is told when the Readiness Check closes, so a concept
  // carried by a single item makes that item's own marking the thing they are told.
  'packages.warningReadinessConcept': 'A concept rests on one item',
  'packages.warningReadinessConceptHelp':
    'When the Readiness Check closes, the student is shown each concept and whether it is held, not held or unknown. A concept carried by a single item makes that status the item’s own marking, handed back before the run is scored. Give each concept at least two of the sixteen items in the next version. It does not stop you confirming a version or setting an assignment on it.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(packages)
