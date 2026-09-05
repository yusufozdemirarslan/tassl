// Step 5.1 — AI-005: no Readiness Check item may name a claim (docs/tech/10-backend-spec-modules.md
// §4, rule `READINESS_SPLIT`; 12-security.md §"A readiness item names a defect").
//
// The rule is a string test: eight or more consecutive words of any claim text inside an item stem
// hands the student the defect before the run starts. What this file pins is the threshold (seven
// shared words is authoring overlap, eight is an echo), the normalisation that makes the threshold
// meaningful across punctuation and case, and the pairing of item to claim the caller turns into
// element ids.
import { describe, expect, it } from 'vitest'
import { noItemNamesAClaim, normalizeWords } from '@/server/modules/authoring/checks'

/** Exactly eight words once normalised, so an item that repeats it whole is the boundary case. */
const PAYBACK = { id: 'claim-payback', text: 'Premium payback is 11 months per the deck.' }
const RETENTION = {
  id: 'claim-retention',
  text: 'Premium pilot retention in month three is 78 percent across the whole cohort.',
}
const SATURATION = {
  id: 'claim-saturation',
  text: 'The value tier is saturated and cannot absorb another price increase this year.',
}

describe('noItemNamesAClaim — the eight-word threshold', () => {
  it('passes an item that shares seven consecutive words with a claim', () => {
    const item = {
      id: 'item-retention',
      stem: 'Which check tells you whether premium pilot retention in month three is trustworthy?',
    }

    expect(noItemNamesAClaim([item], [RETENTION])).toEqual({ ok: true, echoes: [] })
  })

  it('fails an item that shares eight consecutive words with a claim', () => {
    const item = {
      id: 'item-retention',
      stem: 'Which check tells you whether premium pilot retention in month three is 78 percent?',
    }

    expect(noItemNamesAClaim([item], [RETENTION])).toEqual({
      ok: false,
      echoes: [
        {
          itemId: 'item-retention',
          claimId: 'claim-retention',
          phrase: 'premium pilot retention in month three is 78',
        },
      ],
    })
  })

  it('passes an item stem shorter than eight words even when every word is the claim', () => {
    const item = { id: 'item-short', stem: 'Premium payback is 11 months.' }

    expect(noItemNamesAClaim([item], [PAYBACK]).ok).toBe(true)
  })

  it('passes an item that repeats a claim shorter than eight words in full', () => {
    const claim = { id: 'claim-churn', text: 'Churn rose last quarter.' }
    const item = {
      id: 'item-churn',
      stem: 'Which document shows that churn rose last quarter for the value tier?',
    }

    expect(noItemNamesAClaim([item], [claim]).ok).toBe(true)
  })
})

describe('noItemNamesAClaim — normalisation', () => {
  it('matches across punctuation the claim does not have', () => {
    const item = {
      id: 'item-payback',
      stem: 'Premium payback is 11 months, per the deck — which verification path fits?',
    }

    expect(noItemNamesAClaim([item], [PAYBACK]).echoes).toEqual([
      {
        itemId: 'item-payback',
        claimId: 'claim-payback',
        phrase: 'premium payback is 11 months per the deck',
      },
    ])
  })

  it('matches across case and collapsed whitespace', () => {
    const item = { id: 'item-payback', stem: 'PREMIUM  PAYBACK\n IS 11 MONTHS PER THE DECK?' }

    expect(noItemNamesAClaim([item], [PAYBACK]).ok).toBe(false)
  })

  it('matches through markup, which is stripped before the words are compared', () => {
    const item = {
      id: 'item-payback',
      stem: 'Premium <em>payback is 11 months</em>, per the deck: which path fits?',
    }

    expect(noItemNamesAClaim([item], [PAYBACK]).ok).toBe(false)
  })
})

describe('noItemNamesAClaim — which claim was echoed', () => {
  it('names the claim the item actually echoes, not the first claim in the package', () => {
    const item = {
      id: 'item-saturation',
      stem: 'Which stance fits the value tier is saturated and cannot absorb another price increase?',
    }

    expect(noItemNamesAClaim([item], [PAYBACK, RETENTION, SATURATION]).echoes).toEqual([
      {
        itemId: 'item-saturation',
        claimId: 'claim-saturation',
        phrase: 'the value tier is saturated and cannot absorb',
      },
    ])
  })

  it('attributes a run two claims share to the first of them, deterministically', () => {
    const restated = {
      id: 'claim-payback-restated',
      text: 'Premium payback is 11 months per the deck, the founder says.',
    }
    const item = {
      id: 'item-payback',
      stem: 'Premium payback is 11 months per the deck: which path fits?',
    }

    expect(noItemNamesAClaim([item], [PAYBACK, restated]).echoes[0]?.claimId).toBe('claim-payback')
    expect(noItemNamesAClaim([item], [restated, PAYBACK]).echoes[0]?.claimId).toBe(
      'claim-payback-restated',
    )
  })

  it('reports one echo per offending item, in item order, across a whole package', () => {
    const items = [
      { id: 'item-1', stem: 'What makes a number worth verifying before you rely on it?' },
      {
        id: 'item-2',
        stem: 'Which action would test that premium payback is 11 months per the deck?',
      },
      { id: 'item-3', stem: 'When does a superseded document stop being evidence for a decision?' },
      {
        id: 'item-4',
        stem: 'A memo says the value tier is saturated and cannot absorb another price rise.',
      },
    ]

    const result = noItemNamesAClaim(items, [PAYBACK, RETENTION, SATURATION])

    expect(result.ok).toBe(false)
    expect(result.echoes.map((echo) => [echo.itemId, echo.claimId])).toEqual([
      ['item-2', 'claim-payback'],
      ['item-4', 'claim-saturation'],
    ])
  })
})

describe('noItemNamesAClaim — empty inputs', () => {
  it('passes with no items and no claims', () => {
    expect(noItemNamesAClaim([], [])).toEqual({ ok: true, echoes: [] })
  })

  it('passes with items but no claims', () => {
    const item = { id: 'item-payback', stem: 'Premium payback is 11 months per the deck, it says.' }

    expect(noItemNamesAClaim([item], [])).toEqual({ ok: true, echoes: [] })
  })

  it('passes with claims but no items', () => {
    expect(noItemNamesAClaim([], [PAYBACK, RETENTION])).toEqual({ ok: true, echoes: [] })
  })

  it('passes when a stem or a claim is empty text', () => {
    expect(noItemNamesAClaim([{ id: 'item-empty', stem: '' }], [PAYBACK]).ok).toBe(true)
    expect(
      noItemNamesAClaim([{ id: 'item-payback', stem: PAYBACK.text }], [{ id: 'c', text: '' }]),
    ).toEqual({ ok: true, echoes: [] })
  })
})

describe('normalizeWords', () => {
  it('folds case and treats punctuation as a word separator', () => {
    expect(normalizeWords('Premium payback is 11 months, per the deck.')).toEqual([
      'premium',
      'payback',
      'is',
      '11',
      'months',
      'per',
      'the',
      'deck',
    ])
  })

  it('drops apostrophes rather than splitting the word around them', () => {
    expect(normalizeWords('the founder’s note')).toEqual(['the', 'founders', 'note'])
    expect(normalizeWords("the founder's note")).toEqual(['the', 'founders', 'note'])
  })

  it('folds accents so a retyped code point cannot dodge the check', () => {
    expect(normalizeWords('Café résumé')).toEqual(['cafe', 'resume'])
  })

  it('returns no words for empty or punctuation-only text', () => {
    expect(normalizeWords('')).toEqual([])
    expect(normalizeWords('  —  ')).toEqual([])
  })
})
