// Import a package export (UI-041, SYS-026)
import { scopedT } from '../scoped'

export const packageImport = {
  'packageImport.trigger': 'Import a package export',
  'packageImport.title': 'Import a package export',
  'packageImport.description':
    'Paste a package JSON export. It arrives as a new family with its own draft version, and the family key it carries must still be free here.',
  'packageImport.importedDescription':
    'The package is on the shelf. Its elements are drafts until an authority confirms each one.',
  'packageImport.documentLabel': 'Package JSON',
  'packageImport.documentHint': 'The whole file, from the first brace to the last.',
  'packageImport.submit': 'Import',
  'packageImport.pending': 'Importing…',
  'packageImport.cancel': 'Cancel',
  'packageImport.close': 'Close',
  'packageImport.openVersion': 'Open the version',
  'packageImport.empty': 'Paste the export before importing.',
  'packageImport.notJson':
    'That is not JSON. Paste the exported file exactly as it was written, with nothing before or after it.',
  'packageImport.notObject':
    'A package export is a single JSON object. This is a value of another kind.',
  'packageImport.refusedHeadline': 'This document is not a package export Tassl can read:',
  'packageImport.invalidHeadline':
    'The package was refused because it breaks rules that must pass before a version can be confirmed:',
  'packageImport.conflict':
    'This institution already has a package with the family key in that export. Change the family key in the file, or open the package you already have.',
  'packageImport.problemAt': 'at {path}',
  'packageImport.problemElements': 'elements {keys}',
  'packageImport.problemUnnamed': 'The document is not shaped the way an export is.',
  'packageImport.moreProblems': 'and {count} more',
  'packageImport.unknownReference':
    'The document names {kind} “{key}” but never defines it. Every reference in an export is a key the same file has to declare.',
  'packageImport.documentCycle':
    'These documents supersede one another in a loop, so none of them can be the current one: {keys}.',
  'packageImport.kindDocument': 'the document',
  'packageImport.kindStakeholder': 'the stakeholder',
  'packageImport.kindClaim': 'the claim',
  'packageImport.kindVariant': 'the variant',
  'packageImport.done': 'Package imported. Version 1 is a draft.',
  'packageImport.doneWithFailures': 'Package imported. {count} rules still fail.',
  'packageImport.importedClean':
    'Every rule passes. Confirm each element to freeze version 1, and an assignment can run on it.',
  'packageImport.importedWithFailures':
    'These rules still fail. The version is a draft and can be edited, but it cannot be confirmed until each one passes:',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(packageImport)
