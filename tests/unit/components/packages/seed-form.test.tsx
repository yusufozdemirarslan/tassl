import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ImportPackageTrigger,
  SeedForm,
  toFamilyKey,
} from '@/components/features/packages/seed-form'
import { enUS } from '@/lib/i18n/en-US'
import { t } from '@/lib/i18n/t'

// UI-041 (step 5.4). Two rules of `CreatePackageFromSeedSchema` and `createPackageFromSeed` that
// the author has to satisfy before the request is worth making: the license tick (FR-190, answered
// server-side with LICENSE_NOT_CONFIRMED) and four concepts. Both are restated in the browser, so
// what this file protects is that they are actually enforced there and said in the field they
// belong to — and that the seed text's counter follows a paste rather than a keystroke.
//
// Two of these are about how a refusal reaches a person rather than whether it happens: a form
// 1,963 px long says everything still wrong in one place beside the button that was pressed, and
// the concept entry's own notices are tied to the input rather than only shouted at the page.

const actions = vi.hoisted(() => ({ createPackageFromSeedAction: vi.fn() }))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

// A Server Action: importing the real module would pull the scenarios service, the database client
// and `server-only` into jsdom.
vi.mock('@/server/modules/scenarios/actions', () => ({
  createPackageFromSeedAction: actions.createPackageFromSeedAction,
}))

vi.mock('sonner', () => ({ toast: { success: toasts.success, error: toasts.error } }))

const ORG_ID = 'org_1'
const CREATED = {
  packageId: '11111111-1111-4111-8111-111111111111',
  versionId: '22222222-2222-4222-8222-222222222222',
}

/** 200 characters is the floor the seed text schema states; this is comfortably over it. */
const SEED_TEXT = `Meridian Roast is a regional coffee roaster deciding how much of next year's marketing budget to move from the value tier to a premium line. ${'The retention memo, the positioning deck and the supplier contract disagree about what the pilot showed. '.repeat(4)}`

const licenseCheckbox = () =>
  screen.getByRole('checkbox', { name: enUS['packageNew.licenseCheckboxLabel'] })
const conceptInput = () => screen.getByLabelText(enUS['packageNew.conceptsLabel'])
const seedTextArea = () => screen.getByLabelText(enUS['packageNew.seedTextLabel'])
const submit = () => screen.getByRole('button', { name: enUS['packageNew.createSubmit'] })

type FillOptions = { concepts?: string[]; license?: boolean }

/** Everything a valid submission needs; each test then removes exactly one thing. */
async function fill(
  user: ReturnType<typeof userEvent.setup>,
  {
    concepts = ['pricing', 'segmentation', 'retention', 'evidence quality'],
    license = true,
  }: FillOptions = {},
): Promise<void> {
  await user.type(screen.getByLabelText(enUS['packageNew.titleLabel']), 'Meridian Roast')
  for (const concept of concepts) {
    await user.type(conceptInput(), `${concept}{Enter}`)
  }
  await user.type(screen.getByLabelText(enUS['packageNew.caseTitleLabel']), 'Meridian Roast (A)')
  await user.type(screen.getByLabelText(enUS['packageNew.publisherLabel']), 'Tassl')
  await user.type(
    screen.getByLabelText(enUS['packageNew.licenseTermsLabel']),
    'Internal fixture; adaptation permitted for teaching use.',
  )
  if (license) await user.click(licenseCheckbox())
  await user.click(seedTextArea())
  await user.paste(SEED_TEXT)
}

function renderForm() {
  render(<SeedForm orgId={ORG_ID} />)
  return userEvent.setup()
}

describe('SeedForm (UI-041)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    actions.createPackageFromSeedAction.mockResolvedValue({ ok: true, data: CREATED })
  })

  it('refuses to create until the license tick is made, and says so at the checkbox', async () => {
    const user = renderForm()
    await fill(user, { license: false })

    await user.click(submit())

    expect(await screen.findByText(enUS['packageNew.validation.license'])).toBeInTheDocument()
    expect(licenseCheckbox()).toHaveAttribute('aria-invalid', 'true')
    expect(actions.createPackageFromSeedAction).not.toHaveBeenCalled()
  })

  it('creates the package once the license tick is made', async () => {
    const user = renderForm()
    await fill(user)

    await user.click(submit())

    await waitFor(() => expect(actions.createPackageFromSeedAction).toHaveBeenCalled())
    expect(actions.createPackageFromSeedAction.mock.calls[0]?.[0]).toMatchObject({
      orgId: ORG_ID,
      title: 'Meridian Roast',
      familyKey: 'meridian-roast',
      conceptSet: ['pricing', 'segmentation', 'retention', 'evidence quality'],
      seed: { licensePermitsAdaptation: true, publisher: 'Tassl' },
    })
    expect(screen.queryByText(enUS['packageNew.validation.license'])).not.toBeInTheDocument()
  })

  it('refuses to create on three concepts and says how many the set needs', async () => {
    const user = renderForm()
    await fill(user, { concepts: ['pricing', 'segmentation', 'retention'] })

    await user.click(submit())

    expect(await screen.findByText(enUS['packageNew.validation.concepts'])).toBeInTheDocument()
    expect(conceptInput()).toHaveAttribute('aria-invalid', 'true')
    expect(actions.createPackageFromSeedAction).not.toHaveBeenCalled()

    // The fourth concept is all that was missing.
    await user.type(conceptInput(), 'evidence quality{Enter}')
    await user.click(submit())
    await waitFor(() => expect(actions.createPackageFromSeedAction).toHaveBeenCalledTimes(1))
  })

  it('splits a pasted list into concepts rather than holding it as one', async () => {
    const user = renderForm()

    await user.type(conceptInput(), 'pricing, segmentation, retention, evidence quality{Enter}')

    expect(screen.getByText(t('packageNew.conceptsCount', { count: 4 }))).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('packageNew.conceptsRemove', { concept: 'pricing' }) }),
    ).toBeInTheDocument()
  })

  it('refuses a concept already in the set instead of adding it twice, at the input', async () => {
    const user = renderForm()

    await user.type(conceptInput(), 'pricing{Enter}')
    await user.type(conceptInput(), 'Pricing{Enter}')

    const notice = screen.getByText(t('packageNew.conceptsDuplicate', { concept: 'Pricing' }))
    expect(notice).toBeInTheDocument()
    expect(screen.getByText(t('packageNew.conceptsCount', { count: 1 }))).toBeInTheDocument()

    // The notice is the input's own: a screen reader on the field hears why the entry was refused
    // rather than being left with a message that belongs to nothing.
    const described = conceptInput().getAttribute('aria-describedby')?.split(' ') ?? []
    const noticeId = described.find((id) => document.getElementById(id)?.contains(notice))
    expect(noticeId).toBeDefined()
  })

  it('summarises a refused submission beside the button and links to each field', async () => {
    const user = renderForm()

    await user.click(submit())

    const summary = await screen.findByText(enUS['packageNew.errorSummaryTitle'])
    expect(summary).toBeInTheDocument()
    expect(actions.createPackageFromSeedAction).not.toHaveBeenCalled()

    // Every field still to be put right is named once, and its entry is the way to it.
    const licenseEntry = screen.getByRole('link', {
      name: t('packageNew.errorSummaryItem', {
        label: enUS['packageNew.licenseCheckboxLabel'],
        message: enUS['packageNew.validation.license'],
      }),
    })
    expect(licenseEntry).toHaveAttribute('href', '#seed-license')

    await user.click(licenseEntry)
    expect(licenseCheckbox()).toHaveFocus()
  })

  it('derives the family key from the title and stops once the key is edited', async () => {
    const user = renderForm()
    const familyKey = screen.getByLabelText(enUS['packageNew.familyKeyLabel'])

    await user.type(screen.getByLabelText(enUS['packageNew.titleLabel']), 'Meridian Roast: A')
    expect(familyKey).toHaveValue('meridian-roast-a')

    await user.clear(familyKey)
    await user.type(familyKey, 'meridian-roast-2027')
    await user.type(screen.getByLabelText(enUS['packageNew.titleLabel']), ' (revised)')
    expect(familyKey).toHaveValue('meridian-roast-2027')
  })

  it('counts a pasted seed case in one step rather than a character at a time', async () => {
    const user = renderForm()

    await user.click(seedTextArea())
    await user.paste(SEED_TEXT)

    expect(
      screen.getByText(
        t('packageNew.seedTextCount', {
          count: new Intl.NumberFormat('en-US').format(SEED_TEXT.length),
          max: '200,000',
        }),
      ),
    ).toBeInTheDocument()
    // Nothing was trimmed on the way in: the whole paste is still in the field.
    expect(seedTextArea()).toHaveValue(SEED_TEXT)
  })

  it('lands a taken family key on the field that has to change', async () => {
    const user = renderForm()
    actions.createPackageFromSeedAction.mockResolvedValue({
      ok: false,
      error: { code: 'CONFLICT', message: 'Server sentence', requestId: 'req_1' },
    })
    await fill(user)

    await user.click(submit())

    expect(await screen.findByText(enUS['packageNew.error.familyKeyTaken'])).toBeInTheDocument()
    expect(screen.getByLabelText(enUS['packageNew.familyKeyLabel'])).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.queryByText('Server sentence')).not.toBeInTheDocument()
  })

  it('keeps “Create and generate” on the screen and says why it cannot act', () => {
    renderForm()

    const generate = screen.getByRole('button', { name: enUS['packageNew.generateSubmit'] })
    expect(generate).toHaveAttribute('aria-disabled', 'true')
    const reason = generate.getAttribute('aria-describedby')
    expect(reason).not.toBeNull()
    expect(document.getElementById(reason as string)).toHaveTextContent(
      enUS['packageNew.generateUnavailable'],
    )
  })

  it('states what the new package holds instead of leaving the form filled in', async () => {
    const user = renderForm()
    await fill(user)

    await user.click(submit())

    expect(
      await screen.findByRole('heading', {
        name: t('packageNew.createdTitle', { title: 'Meridian Roast' }),
      }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS['packageNew.createdBody'])).toBeInTheDocument()
    expect(screen.getByRole('link', { name: enUS['packageNew.createdOpen'] })).toHaveAttribute(
      'href',
      `/packages/${CREATED.packageId}/versions/${CREATED.versionId}`,
    )
    expect(screen.queryByLabelText(enUS['packageNew.titleLabel'])).not.toBeInTheDocument()
  })

  it('leaves the import route to the page header rather than the foot of the form', () => {
    renderForm()

    expect(screen.queryByRole('button', { name: enUS['packageImport.trigger'] })).toBeNull()
  })
})

describe('ImportPackageTrigger (UI-041, SYS-026)', () => {
  it('paints the import dialog’s trigger without the dialog behind it', () => {
    render(<ImportPackageTrigger orgId={ORG_ID} />)

    expect(screen.getByRole('button', { name: enUS['packageImport.trigger'] })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('toFamilyKey', () => {
  it('makes a key a title can be read back from', () => {
    expect(toFamilyKey('Meridian Roast')).toBe('meridian-roast')
    expect(toFamilyKey('  Meridian Roast: Premium Tier (A)  ')).toBe(
      'meridian-roast-premium-tier-a',
    )
    expect(toFamilyKey('Café Rüdiger')).toBe('cafe-rudiger')
  })

  it('never returns a key the schema would refuse for its shape', () => {
    // No leading or trailing hyphen, and never longer than 60 characters.
    const long = toFamilyKey('A'.repeat(80))
    expect(long.length).toBeLessThanOrEqual(60)
    expect(long).toMatch(/^[a-z0-9]/)
    expect(long).not.toMatch(/-$/)
    expect(toFamilyKey('!!! Meridian !!!')).toBe('meridian')
  })
})
