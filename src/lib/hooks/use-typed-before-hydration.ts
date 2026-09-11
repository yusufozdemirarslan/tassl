'use client'

import { useState } from 'react'

/**
 * What the form's inputs already hold when this component first renders in the browser.
 *
 * A public form is server-rendered and readable long before React has hydrated it — on a cold
 * serverless start that window is seconds, and a person who knows the screen starts typing inside
 * it. React Hook Form registers each field with the default it is given, which overwrites whatever
 * is in the input, so that typing disappears without a word and the screen then complains that the
 * field is empty (QA-074, D-738).
 *
 * The read happens in a `useState` initializer, which runs during the first client render — while
 * the DOM still carries what was typed and before React has committed anything over it. On the
 * server there is no document and the defaults are returned unchanged, so the markup React renders
 * on both sides is the same.
 */
export function useTypedBeforeHydration<T extends Record<string, string>>(defaults: T): T {
  const [initial] = useState<T>(() => {
    if (typeof document === 'undefined') return defaults
    const entries = Object.entries(defaults).map(([name, fallback]) => {
      const field = document.querySelector(`input[name="${name}"]`)
      const typed = field instanceof HTMLInputElement ? field.value : ''
      return [name, typed === '' ? fallback : typed]
    })
    return Object.fromEntries(entries) as T
  })
  return initial
}
