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
  'sample.label': 'Illustrative sample data',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(label)
