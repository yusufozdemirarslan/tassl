// New package (UI-041, D-751), and the import dialog it offers as the second route.
import { scopedT } from '../scoped'

export const packageNew = {
  'packageNew.title': 'New package',
  'packageNew.description':
    'A scenario package is built from one decision case. Name it, paste the case if you have one, and generate: Tassl drafts every element the package rules require and shows you the result to read before anything is published.',
  'packageNew.packageTitle': 'The package',
  'packageNew.packageDescription':
    'What the family is called here. The family key travels with every export and no two packages in one institution may share it.',
  'packageNew.titleLabel': 'Title',
  'packageNew.titleHint': 'What an instructor reads on the shelf, for example “Meridian Roast”.',
  'packageNew.familyKeyLabel': 'Family key',
  'packageNew.familyKeyHint':
    'Lowercase letters, digits and hyphens. It follows the title until you change it, and every version of the family keeps it.',
  'packageNew.seedTitle': 'The scenario',
  'packageNew.seedDescription':
    'The case this package is built from. Paste it here, or leave it empty and Tassl writes the scenario from the title.',
  'packageNew.seedTextLabel': 'Scenario text',
  'packageNew.seedTextHint':
    'Optional. Paste the case itself, up to 200,000 characters; a long paste is expected and nothing is trimmed. Left empty, the title and the concepts are what the scenario is written from.',
  'packageNew.seedTextCount': '{count} of {max} characters',

  // The disclosure: everything an author may set and almost never has to (D-751).
  'packageNew.moreLabel': 'Concepts and licensing',
  'packageNew.moreHint':
    'Set these when the package teaches a particular vocabulary, or when it adapts a case somebody else published.',
  'packageNew.conceptsLabel': 'Concepts',
  'packageNew.conceptsHint':
    'The ideas a run on this package exercises; a course matches its taught concepts against them. Press Enter to add one, or separate several with commas. Left empty, Tassl declares four that any decision run exercises.',
  'packageNew.conceptsAdd': 'Add',
  'packageNew.conceptsRemove': 'Remove {concept}',
  'packageNew.conceptsEmpty': 'None yet. Add four or more, or leave this empty.',
  'packageNew.conceptsCount': '{count} added. Add four or more, or leave this empty.',
  'packageNew.conceptsDuplicate': '“{concept}” is already in the set.',
  'packageNew.caseTitleLabel': 'Case title',
  'packageNew.caseTitleHint':
    'Name the case only when this package adapts one somebody else published. Tassl keeps the record with the package; no student ever sees it.',
  'packageNew.publisherLabel': 'Publisher',
  'packageNew.licenseTermsLabel': 'License terms',
  'packageNew.licenseTermsHint':
    'The terms you are relying on, in your own words: the clause, the edition it belongs to, and where you read it.',
  'packageNew.licenseCheckboxLabel': 'The license permits adaptation',
  'packageNew.licenseCheckboxHint':
    'Tassl records this confirmation against your name and keeps it in the seed record. It will not build a package from somebody else’s case without it.',

  'packageNew.createSubmit': 'Create without generating',
  'packageNew.createPending': 'Creating…',
  'packageNew.generateSubmit': 'Generate',
  'packageNew.generatePending': 'Starting…',
  'packageNew.generateNote':
    'Generate writes the package and drafts every element it needs, which takes a few minutes. You read the result and publish it in one press. Create without generating is for an author bringing an export or writing the elements by hand.',
  'packageNew.errorSummaryTitle':
    'The package was not created. Put these right and create it again:',
  'packageNew.errorSummaryItem': '{label}: {message}',
  'packageNew.created': 'Created {title}.',
  'packageNew.createdTitle': '{title} is on the shelf',
  'packageNew.createdBody':
    'Version 1 is a draft and holds nothing yet. Draft its elements, write them in the review workspace, or bring in a package export. An assignment can only run on a version once it is published.',
  'packageNew.createdGenerationRefused':
    'The package was created. Generation did not start: {message}',
  'packageNew.createdGenerate': 'Generate version 1',
  'packageNew.createdOpen': 'Open version 1',
  'packageNew.createdBack': 'All packages',

  // What the seed record says about a package that adapts nothing (D-751).
  'packageNew.originalPublisher': 'Original material',
  'packageNew.originalLicenseTerms':
    'Original material authored in Tassl. No case published by anyone else is adapted here, so no external license is relied on.',
  'packageNew.originalSeedText':
    '{title}. No source case was supplied with this package: the scenario is written from the title above and the concepts the package declares.',

  'packageNew.validation.title': 'Give the package a title.',
  'packageNew.validation.titleTooLong': 'A title is at most 200 characters.',
  'packageNew.validation.familyKey': 'Give the family a key.',
  'packageNew.validation.familyKeyFormat':
    'A family key is 3 to 60 characters of lowercase letters, digits and hyphens.',
  'packageNew.validation.concepts': 'Add at least four concepts, or remove them all.',
  'packageNew.validation.conceptLength': 'A concept is 2 to 60 characters.',
  'packageNew.validation.caseTitleTooLong': 'A case title is at most 200 characters.',
  'packageNew.validation.publisherTooLong': 'A publisher is at most 200 characters.',
  'packageNew.validation.licenseTermsTooLong': 'The license terms are at most 4,000 characters.',
  'packageNew.validation.license':
    'Confirm that the license permits adaptation. Tassl will not build a package from somebody else’s case without it.',
  'packageNew.validation.seedTextTooLong':
    'The scenario text is at most 200,000 characters. Leave out the appendices, or split the case across two packages.',
  'packageNew.error.familyKeyTaken':
    'This institution already has a package with that family key. Change it and create again.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(packageNew)
