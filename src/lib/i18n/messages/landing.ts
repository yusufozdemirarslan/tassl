// The product's own name and tagline: the public landing page, and the document title.
import { scopedT } from '../scoped'

export const landing = {
  'landing.title': 'Tassl',
  'landing.tagline': 'Make the call.',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(landing)
