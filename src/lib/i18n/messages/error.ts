// Error pages (UI-007)
import { scopedT } from '../scoped'

export const error = {
  'notFound.title': 'Not found',
  'notFound.body': 'There is nothing at this address. It may have moved, or the link may be wrong.',
  'notFound.home': 'Go home',
  'error.title': 'Something went wrong',
  'error.body': 'The problem has been recorded. If it continues, quote the reference below.',
  'error.bodyNoReference': 'The problem has been recorded. Try again, or come back in a moment.',
  'error.reference': 'Reference',
  'error.retry': 'Try again',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(error)
