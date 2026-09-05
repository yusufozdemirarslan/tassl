import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConceptMap, conceptName } from '@/components/features/run/concept-map'

// UI-022's result (FR-012, FR-014). The concept map is the one reading a student is given before
// their run is scored, and the screen they would most expect a mark on — so what is tested here is
// as much what is absent as what is present.

describe('conceptName', () => {
  it('says an authored key the way a reader says it', () => {
    expect(conceptName('cohort_retention')).toBe('cohort retention')
    expect(conceptName('survey_error')).toBe('survey error')
  })

  it('spells AI back out, wherever it sits in the key', () => {
    expect(conceptName('ai_sycophancy')).toBe('AI sycophancy')
    expect(conceptName('reliance_on_ai')).toBe('reliance on AI')
  })
})

describe('ConceptMap', () => {
  const concepts = [
    { conceptKey: 'cohort_retention', status: 'held' as const },
    { conceptKey: 'survey_error', status: 'not_held' as const },
    { conceptKey: 'ai_pushback', status: 'unknown' as const },
  ]

  it('says each of the three readings in plain language', () => {
    render(<ConceptMap concepts={concepts} />)
    expect(screen.getByText('You showed a working grasp of cohort retention.')).toBeInTheDocument()
    expect(screen.getByText('Survey error looks thin.')).toBeInTheDocument()
    expect(screen.getByText('We could not tell about AI pushback.')).toBeInTheDocument()
  })

  it('keeps the order the check asked in, so nothing on the page ranks anything', () => {
    render(<ConceptMap concepts={concepts} />)
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent)
    expect(rows).toEqual([
      'You showed a working grasp of cohort retention.',
      'Survey error looks thin.',
      'We could not tell about AI pushback.',
    ])
  })

  it('carries no total, count, percentage or rank of any kind', () => {
    render(<ConceptMap concepts={concepts} />)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\d/)
    expect(text).not.toMatch(/%/)
    for (const word of ['score', 'total', 'out of', 'percent', 'rank', 'correct']) {
      expect(text.toLowerCase()).not.toContain(word)
    }
  })
})
