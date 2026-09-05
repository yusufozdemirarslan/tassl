import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantPanel } from '@/components/features/run/assistant-panel'
import { enUS } from '@/lib/i18n/en-US'
import type { ClaimView } from '@/server/modules/reliance/schema'

// UI-023's assistant panel (FR-050 to FR-053, FR-056, AI-002). Three things this component has to
// get right, and the step names all three.
//
// *The reply arrives in pieces, and the pieces are not the same kind of thing.* Connective prose is
// the model's; a claim object is the author's, and it is what the student takes a position on. They
// have to come out in the order the server sent them, with the claims as their own articles.
//
// *One announcement.* A live region that spoke on every segment would read the reply aloud twice.
// The panel says one sentence when the stream is over, and it carries the count.
//
// *A reply with no commentary is still a reply.* 11 §3's content-policy path leaves the claims on
// screen with one sentence in place of the prose, and the panel draws it like any other text.
//
// The fourth is the invariant underneath all of them: nothing on this screen says whether a claim
// is reliable. It cannot — the payload carries a claim's text, key, stance and used mark and
// nothing authored about it — and the assertions below pin the shape that keeps it true.

const RUN_ID = '9f6ab2f8-9f14-4f6f-a3a0-64f1f3a1a001'

const CLAIM: ClaimView = {
  id: '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f',
  key: 'C3',
  text: 'Month-three retention on the premium pilot is 78 percent, seven points above the value tier at the same age.',
  surfacedBy: 'delegation',
  surfacedAt: '2026-09-05T10:00:00.000Z',
  inTurnWindow: false,
  stance: null,
  previousStance: null,
  stanceSetAt: null,
  actions: [],
  availableActions: ['source_trace'],
  escalation: null,
  canEscalate: true,
  remainingEscalations: 2,
  usedMarked: false,
  reliedOn: false,
}

const LEAD_IN = 'Here is what the room already says on that.'
const CLOSING = 'The Evidence Room has the documents behind this.'

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: router.push,
    refresh: router.refresh,
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}))

/** 07 §7's wire format: `event: <name>`, one `data:` line of JSON, a blank line. */
const frame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

const REPLY_FRAMES = [
  frame('segment', { type: 'text', text: `${LEAD_IN} ` }),
  frame('segment', { type: 'claim', claim: CLAIM }),
  frame('segment', { type: 'text', text: `\n\n${CLOSING}` }),
  frame('done', { delegationId: 'ac8f2f1e-6a3d-4a1f-8b62-2d0f5a9c7e31' }),
]

/**
 * A body that hands the frames over one read at a time, the way the route writes them.
 *
 * Split across reads on purpose, and one of them cut mid-frame: the hook buffers until it sees the
 * blank line, and a test that handed it whole frames would never exercise that.
 */
function streamOf(frames: readonly string[]): { getReader: () => ReadableStreamDefaultReader } {
  const encoder = new TextEncoder()
  const joined = frames.join('')
  const cut = Math.floor(joined.length / 2)
  const chunks = [joined.slice(0, cut), joined.slice(cut)].filter((chunk) => chunk !== '')
  let index = 0
  return {
    getReader: () =>
      ({
        read: () =>
          Promise.resolve(
            index < chunks.length
              ? { done: false, value: encoder.encode(chunks[index++]) }
              : { done: true, value: undefined },
          ),
      }) as unknown as ReadableStreamDefaultReader,
  }
}

const streamed = (frames: readonly string[]) =>
  vi.fn(() => Promise.resolve({ ok: true, body: streamOf(frames) } as unknown as Response))

const refused = (status: number, code: string, message: string, details?: unknown) =>
  vi.fn(() =>
    Promise.resolve({
      ok: false,
      status,
      body: null,
      json: () => Promise.resolve({ error: { code, message, details, requestId: 'req-1' } }),
    } as unknown as Response),
  )

function renderPanel(canDelegate = true) {
  render(<AssistantPanel runId={RUN_ID} canDelegate={canDelegate} />)
  return userEvent.setup()
}

const requestBox = () => screen.getByLabelText(enUS['workspace.assistantRequestLabel'])
const sendButton = () => screen.getByRole('button', { name: enUS['workspace.assistantSend'] })

async function ask(user: ReturnType<typeof userEvent.setup>, request: string): Promise<void> {
  await user.type(requestBox(), request)
  await user.click(sendButton())
}

describe('AssistantPanel (UI-023, FR-051)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('streams the reply in the order the server sent it, with the claim card between the prose', async () => {
    const fetchMock = streamed(REPLY_FRAMES)
    vi.stubGlobal('fetch', fetchMock)
    const user = renderPanel()

    await ask(user, 'What is the premium payback?')

    await screen.findByText(LEAD_IN)
    const card = await screen.findByRole('article')
    expect(within(card).getByRole('heading', { name: 'Claim C3' })).toBeInTheDocument()
    expect(within(card).getByText(CLAIM.text)).toBeInTheDocument()
    await screen.findByText(CLOSING)

    // The order on screen is the order of the segments, not the order the pieces happen to render:
    // prose, then the claim object, then the prose that followed it.
    const rendered = [...document.querySelectorAll('p, article')]
      .filter((node) => node.textContent?.trim() !== '')
      .map((node) => (node.tagName === 'ARTICLE' ? 'claim' : node.textContent?.trim()))
    expect(rendered.indexOf(LEAD_IN)).toBeLessThan(rendered.indexOf('claim'))
    expect(rendered.indexOf('claim')).toBeLessThan(rendered.indexOf(CLOSING))

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/runs/${RUN_ID}/delegations`,
      expect.objectContaining({
        method: 'POST',
        // 08 §2.7: a cookie-authenticated mutation carries the header a cross-site form cannot.
        headers: expect.objectContaining({ 'X-Requested-With': 'tassl' }),
        body: JSON.stringify({ request: 'What is the premium payback?' }),
      }),
    )
  })

  it('announces the reply once, when it is complete, with the number of claims', async () => {
    vi.stubGlobal('fetch', streamed(REPLY_FRAMES))
    const user = renderPanel()

    await ask(user, 'What is the premium payback?')

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        enUS['workspace.assistantReplyCompleteOne'],
      )
    })
    // One region, one sentence: nothing announces per segment, and the count is in the sentence
    // rather than in a second live region beside it.
    expect(screen.getAllByRole('status')).toHaveLength(1)
    // The claims are read back through the server render, which is why the panel asks for one.
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('draws the content-policy sentence as the reply when no commentary came back', async () => {
    vi.stubGlobal(
      'fetch',
      streamed([
        frame('segment', { type: 'text', text: enUS['workspace.assistantNoCommentary'] }),
        frame('segment', { type: 'claim', claim: CLAIM }),
        frame('done', { delegationId: 'ac8f2f1e-6a3d-4a1f-8b62-2d0f5a9c7e31' }),
      ]),
    )
    const user = renderPanel()

    await ask(user, 'Audit your own last answer.')

    expect(await screen.findByText(enUS['workspace.assistantNoCommentary'])).toBeInTheDocument()
    // The claim is still on screen: the prose is what the provider withheld, not the claim object.
    expect(await screen.findByRole('article')).toHaveTextContent(CLAIM.text)
  })

  it('says nothing about a claim beyond the claim (FR-056)', async () => {
    vi.stubGlobal('fetch', streamed(REPLY_FRAMES))
    const user = renderPanel()

    await ask(user, 'What is the premium payback?')

    const card = await screen.findByRole('article')
    // The card carries the claim, its key, and the seat the stance control takes in Phase 8. No
    // evidence status, no failure family, no warranted stance, no reliability mark of any kind.
    expect(card).toHaveTextContent(CLAIM.text)
    expect(card).toHaveTextContent(enUS['workspace.claimStancePending'])
    for (const word of ['defect', 'defective', 'sound', 'planted', 'unreliable', 'verified']) {
      expect(card.textContent?.toLowerCase()).not.toContain(word)
    }
  })

  // -------------------------------------------------------------------------------------------
  // The figure with no source in the room (D-068, D-281)
  // -------------------------------------------------------------------------------------------
  //
  // The numeric guard wraps a figure no claim, document or request sourced in `[[figure:…]]`,
  // inside the prose, in both of its modes. `flag` keeps the figure between the marks and `block`
  // empties them; the panel draws both, because a student who cannot see which figures came from
  // nowhere cannot practise the thing FR-025 assesses them on.
  //
  // The mark is about provenance and can never become a mark about a claim: a claim's own figures
  // are in the claim's text, which no guard reads, so the third test below — the sourced figure
  // that is drawn plain — is the one that keeps that true on screen.

  it('marks a figure the room does not source, keeping the figure in flag mode', async () => {
    vi.stubGlobal(
      'fetch',
      streamed([
        frame('segment', {
          type: 'text',
          text: 'Blending the cohorts gives a payback of [[figure:14]] months.',
        }),
        frame('done', { delegationId: 'ac8f2f1e-6a3d-4a1f-8b62-2d0f5a9c7e31' }),
      ]),
    )
    const user = renderPanel()

    await ask(user, 'How long is the payback?')

    // The sentence reads as the assistant wrote it, with the figure still in it.
    const paragraph = await screen.findByText(/Blending the cohorts gives a payback of/)
    expect(paragraph).toHaveTextContent('Blending the cohorts gives a payback of 14')
    expect(paragraph.textContent).not.toContain('[[figure:')

    // The mark itself: the figure, an amber chip with ink text, reachable by keyboard, and a note
    // that says where the figure came from and nothing about whether it is right.
    const mark = screen.getByText(enUS['workspace.unverifiedNumberLabel']).parentElement
    expect(mark).not.toBeNull()
    expect(mark).toHaveTextContent('14')
    expect(mark).toHaveAttribute('tabindex', '0')
    expect(mark?.className).toContain('bg-amber-soft')
    expect(mark?.className).toContain('text-ink')

    await user.tab()
    await user.hover(mark as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      enUS['workspace.unverifiedNumberTooltip'],
    )
  })

  it('draws the mark with the figure gone when the guard blocked it', async () => {
    vi.stubGlobal(
      'fetch',
      streamed([
        frame('segment', {
          type: 'text',
          text: 'Blending the cohorts gives a payback of [[figure:]] months.',
        }),
        frame('done', { delegationId: 'ac8f2f1e-6a3d-4a1f-8b62-2d0f5a9c7e31' }),
      ]),
    )
    const user = renderPanel()

    await ask(user, 'How long is the payback?')

    const mark = (await screen.findByText(enUS['workspace.unverifiedNumberLabel'])).parentElement
    expect(mark).toHaveTextContent(enUS['workspace.unverifiedNumberWithheld'])
    // The figure is not on screen under any spelling: block mode withholds it (D-068).
    expect(document.body.textContent).not.toContain('[[figure:')
    expect(screen.getByText(/Blending the cohorts gives a payback of/).textContent).not.toMatch(
      /\d/,
    )
  })

  it('draws a figure the room sources with no mark at all (FR-056)', async () => {
    vi.stubGlobal(
      'fetch',
      streamed([
        frame('segment', {
          type: 'text',
          text: 'Month-three retention on the premium pilot is 78 percent, as the room states it.',
        }),
        frame('segment', { type: 'claim', claim: CLAIM }),
        frame('done', { delegationId: 'ac8f2f1e-6a3d-4a1f-8b62-2d0f5a9c7e31' }),
      ]),
    )
    const user = renderPanel()

    await ask(user, 'What is month-three retention?')

    // The guard sourced the 78 and left it alone, so nothing is drawn round it — here or in the
    // claim card, whose figures are the author's and are never read by a guard.
    const prose = await screen.findByText(/as the room states it/)
    expect(prose).toHaveTextContent(
      'Month-three retention on the premium pilot is 78 percent, as the room states it.',
    )
    expect(screen.queryByText(enUS['workspace.unverifiedNumberLabel'])).not.toBeInTheDocument()
    expect(screen.queryByText(enUS['workspace.unverifiedNumberWithheld'])).not.toBeInTheDocument()
    expect(await screen.findByRole('article')).toHaveTextContent(CLAIM.text)
  })

  it('refuses an empty request without asking the server', async () => {
    const fetchMock = streamed(REPLY_FRAMES)
    vi.stubGlobal('fetch', fetchMock)
    const user = renderPanel()

    await user.click(sendButton())

    expect(await screen.findByText(enUS['workspace.assistantRequestRequired'])).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows the refusal in the server’s own words', async () => {
    const message = 'That request is too long. Shorten it and send it again.'
    vi.stubGlobal('fetch', refused(400, 'ASSISTANT_REQUEST_TOO_LONG', message))
    const user = renderPanel()

    await ask(user, 'Say everything you know about this scenario.')

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('names the wait when the llm bucket refuses the request', async () => {
    vi.stubGlobal(
      'fetch',
      refused(429, 'RATE_LIMITED', 'Too many requests. Try again shortly.', {
        retryAfterSeconds: 42,
      }),
    )
    const user = renderPanel()

    await ask(user, 'What is the premium payback?')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      enUS['workspace.assistantRateLimited'].replace('{seconds}', '42'),
    )
  })

  it('keeps the control reachable and says why while the run is paused', () => {
    vi.stubGlobal('fetch', streamed(REPLY_FRAMES))
    render(
      <AssistantPanel
        runId={RUN_ID}
        canDelegate={false}
        lockedReason={enUS['workspace.assistantPaused']}
      />,
    )

    const button = sendButton()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    expect(screen.getByText(enUS['workspace.assistantPaused'])).toBeInTheDocument()
  })
})
