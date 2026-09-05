// New package from a seed case (UI-041), and the import dialog it offers as the second route.
import { scopedT } from '../scoped'

export const packageNew = {
  'packageNew.title': 'New package from a seed case',
  'packageNew.description':
    'A package is built from a case you hold the rights to adapt. Name the family, list the concepts a run on it exercises, record the license you are relying on, and paste the case itself.',
  'packageNew.packageTitle': 'The package',
  'packageNew.packageDescription':
    'What the family is called here and what it teaches. The family key travels with every export and no two packages in one institution may share it.',
  'packageNew.titleLabel': 'Title',
  'packageNew.titleHint': 'What an instructor reads on the shelf, for example “Meridian Roast”.',
  'packageNew.familyKeyLabel': 'Family key',
  'packageNew.familyKeyHint':
    'Lowercase letters, digits and hyphens. It follows the title until you change it, and every version of the family keeps it.',
  'packageNew.conceptsLabel': 'Concepts',
  'packageNew.conceptsHint':
    'The ideas a run on this package exercises; a course matches its taught concepts against them. Press Enter to add one, or separate several with commas.',
  'packageNew.conceptsAdd': 'Add',
  'packageNew.conceptsRemove': 'Remove {concept}',
  'packageNew.conceptsEmpty': 'None yet. Four is the minimum.',
  'packageNew.conceptsCount': '{count} added. Four is the minimum.',
  'packageNew.conceptsDuplicate': '“{concept}” is already in the set.',
  'packageNew.seedTitle': 'The seed case',
  'packageNew.seedDescription':
    'The case this package is re-skinned from and the license that permits it. Tassl keeps the record with the package; no student ever sees it.',
  'packageNew.caseTitleLabel': 'Case title',
  'packageNew.publisherLabel': 'Publisher',
  'packageNew.licenseTermsLabel': 'License terms',
  'packageNew.licenseTermsHint':
    'The terms you are relying on, in your own words: the clause, the edition it belongs to, and where you read it.',
  'packageNew.licenseCheckboxLabel': 'The license permits adaptation',
  'packageNew.licenseCheckboxHint':
    'Tassl records this confirmation against your name and keeps it in the seed record. It will not build a package from a case without it.',
  'packageNew.seedTextLabel': 'Seed case text',
  'packageNew.seedTextHint':
    'Paste the case itself: at least 200 characters, and up to 200,000. A long paste is expected and nothing is trimmed.',
  'packageNew.seedTextCount': '{count} of {max} characters',
  'packageNew.createSubmit': 'Create the package',
  'packageNew.createPending': 'Creating…',
  'packageNew.generateSubmit': 'Create and generate',
  'packageNew.generateUnavailable':
    'Tassl cannot draft a package’s elements for you yet. Create the package, then write its elements in the confirmation workspace or bring in a package export.',
  'packageNew.errorSummaryTitle':
    'The package was not created. Put these right and create it again:',
  'packageNew.errorSummaryItem': '{label}: {message}',
  'packageNew.created': 'Created {title}.',
  'packageNew.createdTitle': '{title} is on the shelf',
  'packageNew.createdBody':
    'Version 1 is a draft and holds nothing. Tassl cannot draft its elements for you yet, so write them in the confirmation workspace or bring in a package export. An assignment can only run on a version once every element is confirmed.',
  'packageNew.createdOpen': 'Open version 1',
  'packageNew.createdBack': 'All packages',
  'packageNew.validation.title': 'Give the package a title.',
  'packageNew.validation.titleTooLong': 'A title is at most 200 characters.',
  'packageNew.validation.familyKey': 'Give the family a key.',
  'packageNew.validation.familyKeyFormat':
    'A family key is 3 to 60 characters of lowercase letters, digits and hyphens.',
  'packageNew.validation.concepts': 'Add at least four concepts.',
  'packageNew.validation.conceptLength': 'A concept is 2 to 60 characters.',
  'packageNew.validation.caseTitle': 'Name the case this package is adapted from.',
  'packageNew.validation.caseTitleTooLong': 'A case title is at most 200 characters.',
  'packageNew.validation.publisher': 'Name who published the case.',
  'packageNew.validation.publisherTooLong': 'A publisher is at most 200 characters.',
  'packageNew.validation.licenseTerms': 'State the license terms you are relying on.',
  'packageNew.validation.licenseTermsTooLong': 'The license terms are at most 4,000 characters.',
  'packageNew.validation.license':
    'Confirm that the license permits adaptation. Tassl will not build a package from a case without it.',
  'packageNew.validation.seedText': 'Paste at least 200 characters of the case.',
  'packageNew.validation.seedTextTooLong':
    'The seed case text is at most 200,000 characters. Leave out the appendices, or split the case across two packages.',
  'packageNew.error.familyKeyTaken':
    'This institution already has a package with that family key. Change it and create again.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(packageNew)
