// Account and identity (SYS-003, SYS-004, UI-010; src/server/modules/identity)
import { scopedT } from '../scoped'

export const identity = {
  'identity.exportFileName': 'tassl-my-data.json',
  'identity.accountNotFound': 'This account no longer exists.',
  'identity.confirmEmailMismatch': 'Type the email address of this account to confirm.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(identity)
