// The stance vocabulary (06 §3.3), shared by every surface that shows a stance: the claims table
// and the claim object here, the stance control, the matrix and the debrief in later phases.
import { scopedT } from '../scoped'

export const stance = {
  'stance.accept': 'Accept',
  'stance.verify': 'Verify',
  'stance.challenge': 'Challenge',
  'stance.reject': 'Reject',
  'stance.escalate': 'Escalate',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(stance)
