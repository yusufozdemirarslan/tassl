// D-738 / QA-074: a public form is readable before React hydrates it, and on a cold serverless
// start that window is seconds. React Hook Form registers each field with the default it is given,
// which overwrites whatever the person has already typed — silently, and then the screen complains
// that the field is empty. The hook reads the inputs during the first client render, while the DOM
// still carries what was typed.
//
// The cases below fix the behaviour at both ends: what is already in the input wins, and an empty
// input leaves the caller's default alone. The initializer must run once, or a later render would
// take a value the person has since cleared.
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useTypedBeforeHydration } from '@/lib/hooks/use-typed-before-hydration'

function plant(fields: Record<string, string>): void {
  const form = document.createElement('form')
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement('input')
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('useTypedBeforeHydration', () => {
  it('adopts what the person typed before the form hydrated', () => {
    plant({ email: 'typed@tassl.local', password: 'typed-password' })
    const { result } = renderHook(() => useTypedBeforeHydration({ email: '', password: '' }))
    expect(result.current).toEqual({ email: 'typed@tassl.local', password: 'typed-password' })
  })

  it('keeps the default for a field nobody touched', () => {
    plant({ email: 'typed@tassl.local', password: '' })
    const { result } = renderHook(() => useTypedBeforeHydration({ email: '', password: '' }))
    expect(result.current).toEqual({ email: 'typed@tassl.local', password: '' })
  })

  it('keeps a default the server supplied when the input is empty', () => {
    // The verify-email panel is rendered with the address already known.
    plant({ email: '' })
    const { result } = renderHook(() => useTypedBeforeHydration({ email: 'known@tassl.local' }))
    expect(result.current).toEqual({ email: 'known@tassl.local' })
  })

  it('lets what was typed win over a default the server supplied', () => {
    plant({ email: 'corrected@tassl.local' })
    const { result } = renderHook(() => useTypedBeforeHydration({ email: 'known@tassl.local' }))
    expect(result.current).toEqual({ email: 'corrected@tassl.local' })
  })

  it('returns the defaults when the form is not in the document', () => {
    const { result } = renderHook(() => useTypedBeforeHydration({ email: '', password: '' }))
    expect(result.current).toEqual({ email: '', password: '' })
  })

  it('reads the inputs once, so a value cleared after the first render is not re-adopted', () => {
    plant({ email: 'typed@tassl.local' })
    const { result, rerender } = renderHook(() => useTypedBeforeHydration({ email: '' }))
    const first = result.current
    document.querySelector<HTMLInputElement>('input[name="email"]')!.value = 'changed@tassl.local'
    rerender()
    expect(result.current).toBe(first)
    expect(result.current).toEqual({ email: 'typed@tassl.local' })
  })
})
