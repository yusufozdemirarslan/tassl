// Label chips and sample data (FR-254)
import { scopedT } from '../scoped'

export const label = {
  'label.draft': 'Draft',
  'label.confirmed': 'Confirmed',
  'label.uncalibrated': 'Uncalibrated',
  'label.walkthrough': 'Walkthrough',
  'label.provisional': 'Provisional',
  'label.unreviewed': 'Unreviewed',
  /** The kind's own word, when the caller does not pass the warning's own wording. */
  'label.warning': 'Warning',
  'label.planted': 'Planted',
  /** The student's own record that they leaned on a claim (FR-060, FR-084); never a judgment. */
  'label.used': 'Used',
  /**
   * A claim an instructor took out of one run's arithmetic (FR-003). It is a fact about the run
   * rather than about the claim, and the word is "corrected" everywhere a reader meets it: the
   * column and the error code still say `neutralization`, which is the ledger's own vocabulary.
   */
  'label.corrected': 'Corrected',
  'sample.label': 'Illustrative sample data',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(label)
