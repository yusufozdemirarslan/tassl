import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantModeForm } from '@/components/features/admin/assistant-mode-form'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'
import type { AdminFlags, AiMode, AssistantMode } from '@/server/modules/admin/schema'

// UI-050 → flags → the runtime assistant switch (11 §6, D-691, C15). It is the demo safeguard: the
// one control on the platform screens that changes what a student's next model call reaches, and
// it reaches every open run without a redeploy.
//
// Three rules carry the whole component, and each of them is a test here. The switch is a
// *confirmed* act, so choosing an option must write nothing and the press must be what calls the
// action. The environment still wins, so with `FEATURE_AI` off the control says which flag holds
// it shut rather than refusing when it is pressed — and it says so somewhere a keyboard can reach.
// And what the screen prints is the effect rather than the row, so the effective line is whatever
// the action reports back, never the option the reader happened to leave selected.

const actions = vi.hoisted(() => ({ setAiModeAction: vi.fn() }))
const router = vi.hoisted(() => ({ refresh: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

// A Server Action: importing the real module would pull the admin service, the database client and
// `server-only` into jsdom.
vi.mock('@/server/modules/admin/actions', () => ({ setAiModeAction: actions.setAiModeAction }))

vi.mock('next/navigation', () => ({ useRouter: () => router }))

// `@/lib/toast` reaches sonner through a dynamic import, which this mock answers as well.
vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

/**
 * What the action answers with: the whole flag view, read back after the write. The form reads two
 * fields of it, and the rest is here because a partial answer would let a test pass against a
 * component that had started reading a third.
 */
const flags = (aiMode: AiMode, assistantMode: AssistantMode): AdminFlags => ({
  ai: true,
  sampleData: false,
  testControls: false,
  demoMode: false,
  effectiveLlmProvider: assistantMode === 'live' ? 'mimo' : 'mock',
  aiMode,
  assistantMode,
  llmUsage: {
    today: { calls: 12, tokens: 8_400, costUsd: 0.11 },
    month: { calls: 340, tokens: 220_000, costUsd: 2.85 },
    budgets: { userDaily: 60_000, globalMonthly: 4_000_000 },
  },
})

const liveOption = () => screen.getByRole('radio', { name: enUS['admin.flags.assistantModeLive'] })
const scriptedOption = () =>
  screen.getByRole('radio', { name: enUS['admin.flags.assistantModeScripted'] })
const saveButton = () =>
  screen.getByRole('button', { name: enUS['admin.flags.assistantModeSubmit'] })
const savingButton = () =>
  screen.getByRole('button', { name: enUS['admin.flags.assistantModePending'] })
const alert = () => screen.getByRole('alert')

/** The sentence the panel prints above the radios, for the mode the assistant actually is. */
const effectiveLine = (mode: AssistantMode) =>
  t('admin.flags.assistantModeEffective', {
    mode:
      mode === 'live'
        ? enUS['admin.flags.assistantModeLive']
        : enUS['admin.flags.assistantModeScripted'],
  })

describe('AssistantModeForm (UI-050, D-691)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.setAiModeAction.mockResolvedValue({ ok: true, data: flags('mock', 'scripted') })
  })

  it('checks the option the row holds and prints the mode the assistant actually is', () => {
    render(<AssistantModeForm aiMode="live" assistantMode="live" aiEnabled />)

    expect(liveOption()).toBeChecked()
    expect(scriptedOption()).not.toBeChecked()
    expect(screen.getByText(effectiveLine('live'))).toBeInTheDocument()
    // Each option carries the sentence that says what choosing it costs a student's run, and the
    // radio is described by it rather than only sitting near it.
    expect(liveOption()).toHaveAccessibleDescription(enUS['admin.flags.assistantModeLiveHint'])
    expect(scriptedOption()).toHaveAccessibleDescription(
      enUS['admin.flags.assistantModeScriptedHint'],
    )
  })

  // The row is `mock` and the effect is `scripted`: two vocabularies for the same switch, and the
  // screen shows the one each place means. Reading the effect off the row would print "Live model"
  // on a deployment whose environment had already forced the fixture.
  it('shows the scripted row as chosen, in the words the effective line uses for it', () => {
    render(<AssistantModeForm aiMode="mock" assistantMode="scripted" aiEnabled />)

    expect(scriptedOption()).toBeChecked()
    expect(liveOption()).not.toBeChecked()
    expect(screen.getByText(effectiveLine('scripted'))).toBeInTheDocument()
  })

  // The rule the two-radios-and-a-save shape exists for: reading the options is not the same
  // gesture as throwing the switch, so nothing is written until the button is pressed.
  it('writes nothing when an option is merely chosen', async () => {
    const user = userEvent.setup()
    render(<AssistantModeForm aiMode="live" assistantMode="live" aiEnabled />)

    await user.click(scriptedOption())

    await waitFor(() => expect(scriptedOption()).toBeChecked())
    expect(actions.setAiModeAction).not.toHaveBeenCalled()
    // Nothing has changed yet, so the assistant is still what it was.
    expect(screen.getByText(effectiveLine('live'))).toBeInTheDocument()
  })

  it('saves the chosen mode, confirms it, and asks the route for the state the write left', async () => {
    const user = userEvent.setup()
    render(<AssistantModeForm aiMode="live" assistantMode="live" aiEnabled />)

    await user.click(scriptedOption())
    await user.click(saveButton())

    await waitFor(() => expect(actions.setAiModeAction).toHaveBeenCalledWith({ mode: 'mock' }))
    // The line now reads the answer the service gave back, which is the same answer `/api/ready`
    // and the assistant panel's chip would give.
    expect(await screen.findByText(effectiveLine('scripted'))).toBeInTheDocument()
    expect(toasts.success).toHaveBeenCalledWith(enUS['admin.flags.assistantModeSaved'])
    // The audit log on the next tab has a new row in it, and the provider panel above is stale.
    expect(router.refresh).toHaveBeenCalled()
    expect(alert()).toBeEmptyDOMElement()
  })

  it('saves the live mode when that is the option left chosen', async () => {
    actions.setAiModeAction.mockResolvedValue({ ok: true, data: flags('live', 'live') })
    const user = userEvent.setup()
    render(<AssistantModeForm aiMode="mock" assistantMode="scripted" aiEnabled />)

    await user.click(liveOption())
    await user.click(saveButton())

    await waitFor(() => expect(actions.setAiModeAction).toHaveBeenCalledWith({ mode: 'live' }))
    expect(await screen.findByText(effectiveLine('live'))).toBeInTheDocument()
  })

  // A press that races a deploy turning `FEATURE_AI` off: the service raises `CONFLICT`, and the
  // envelope's own message is what the reader sees, under the form rather than as a toast that
  // leaves nothing to re-read.
  it('shows the service refusal and leaves the effective mode as it was', async () => {
    actions.setAiModeAction.mockResolvedValue({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: enUS['admin.flags.assistantModeEnvForced'],
        requestId: 'req_admin_1',
      },
    })
    const user = userEvent.setup()
    render(<AssistantModeForm aiMode="live" assistantMode="live" aiEnabled />)

    await user.click(scriptedOption())
    await user.click(saveButton())

    expect(await screen.findByRole('alert')).toHaveTextContent(
      enUS['admin.flags.assistantModeEnvForced'],
    )
    expect(toasts.success).not.toHaveBeenCalled()
    expect(router.refresh).not.toHaveBeenCalled()
    expect(screen.getByText(effectiveLine('live'))).toBeInTheDocument()
  })

  it('clears a refusal when the save is tried again', async () => {
    actions.setAiModeAction.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: 'The switch is held by the environment.',
        requestId: 'r1',
      },
    })
    const user = userEvent.setup()
    render(<AssistantModeForm aiMode="live" assistantMode="live" aiEnabled />)

    await user.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The switch is held by the environment.',
    )

    await user.click(saveButton())

    await waitFor(() => expect(alert()).toBeEmptyDOMElement())
  })

  // With `FEATURE_AI` off the service would refuse the write, so the control says so first. The
  // button is `aria-disabled` and never `disabled`: a disabled control is skipped by the keyboard,
  // taking the sentence that explains it out of reach of the reader most likely to need it
  // (DESIGN.md §Buttons).
  it('says which flag holds it shut, in reach of the keyboard, and does not act while it is', async () => {
    const user = userEvent.setup()
    render(<AssistantModeForm aiMode="live" assistantMode="live" aiEnabled={false} />)

    expect(saveButton()).toHaveAttribute('aria-disabled', 'true')
    expect(saveButton()).not.toBeDisabled()
    expect(saveButton()).toHaveAccessibleDescription(enUS['admin.flags.assistantModeDisabled'])
    expect(screen.getByRole('radiogroup')).toHaveAccessibleDescription(
      enUS['admin.flags.assistantModeDisabled'],
    )
    // The radios refuse the same way and for the same reason: `aria-disabled`, still in the tab
    // order, so the sentence describing the group is announced with the control it explains.
    expect(liveOption()).toHaveAttribute('aria-disabled', 'true')
    expect(scriptedOption()).toHaveAttribute('aria-disabled', 'true')

    saveButton().focus()
    expect(saveButton()).toHaveFocus()
    await user.click(saveButton())
    await user.click(scriptedOption())

    expect(actions.setAiModeAction).not.toHaveBeenCalled()
    expect(scriptedOption()).not.toBeChecked()
  })

  it('names the group by its legend so the two options are announced as one choice', () => {
    render(<AssistantModeForm aiMode="live" assistantMode="live" aiEnabled />)

    expect(screen.getByRole('radiogroup')).toHaveAccessibleName(
      enUS['admin.flags.assistantModeLegend'],
    )
    // With the flag on there is nothing to explain, so no reason is printed at all.
    expect(screen.queryByText(enUS['admin.flags.assistantModeDisabled'])).not.toBeInTheDocument()
    expect(saveButton()).not.toHaveAttribute('aria-disabled')
  })

  it('says it is working and swallows a second press while the write is in flight', async () => {
    let release: (result: { ok: true; data: AdminFlags }) => void = () => {}
    actions.setAiModeAction.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const user = userEvent.setup()
    render(<AssistantModeForm aiMode="live" assistantMode="live" aiEnabled />)

    await user.click(saveButton())

    await waitFor(() => expect(savingButton()).toHaveAttribute('aria-disabled', 'true'))
    expect(savingButton()).toHaveAttribute('aria-busy', 'true')
    // The switch reaches every open run, so a second press must not throw it twice.
    await user.click(savingButton())
    expect(actions.setAiModeAction).toHaveBeenCalledTimes(1)

    release({ ok: true, data: flags('live', 'live') })
    await waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-disabled'))
  })
})
