'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { object, type output } from 'zod/mini'
import { toast } from 'sonner'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { nameField } from '@/lib/auth/form-fields'
import { auth } from '@/lib/i18n/messages/auth'
import { settings } from '@/lib/i18n/messages/settings'
import { scopedT } from '@/lib/i18n/scoped'
import { updateProfileAction } from '@/server/modules/identity/actions'
import { FormAlert, SubmitButton } from './form-feedback'

// A settings screen whose one field is the name the auth screens already word and validate.
const t = scopedT(auth, settings)

// UI-010 Profile (SYS-003). The rule is the same one `updateProfileSchema` enforces at the action
// and at `PATCH /me`, built here from the shared `nameField` so the bound has one source (D-186):
// a client component that imports a module's `schema.ts` drags the full Zod runtime — with its
// JSON-schema converter and locale table — into the browser, 66 KB of gzip for a name field.
// Validation that decides anything still runs in the action; this only tells the person sooner.
//
// The sentence under the field is chosen from what the value actually is (empty, or too long); the
// refusal from the action is rendered from its error envelope, verbatim.
const profileSchema = object({ name: nameField })

type ProfileValues = output<typeof profileSchema>

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name },
  })

  const nameError = errors.name
    ? getValues('name').trim().length === 0
      ? t('auth.validation.name')
      : t('auth.validation.nameTooLong')
    : undefined

  async function onSubmit(values: ProfileValues): Promise<void> {
    setFormError(null)
    const result = await updateProfileAction(values)
    if (!result.ok) {
      setFormError(result.error.message)
      return
    }
    // The saved name is what the field now holds: the shell reads it from the session on the next
    // render, and the form is no longer dirty.
    reset({ name: result.data.name })
    toast.success(t('settings.profileSaved'))
    router.refresh()
  }

  return (
    <form noValidate onSubmit={(event) => void handleSubmit(onSubmit)(event)}>
      <div className="flex max-w-[48ch] flex-col gap-5">
        <Field data-invalid={nameError ? 'true' : undefined}>
          <FieldLabel htmlFor="profile-name">{t('auth.name')}</FieldLabel>
          <Input
            id="profile-name"
            autoComplete="name"
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'profile-name-error' : undefined}
            {...register('name')}
          />
          <FieldError id="profile-name-error">{nameError}</FieldError>
        </Field>

        <Field>
          <FieldLabel htmlFor="profile-email">{t('auth.email')}</FieldLabel>
          <Input
            id="profile-email"
            type="email"
            value={email}
            readOnly
            disabled
            aria-describedby="profile-email-note"
          />
          <FieldDescription id="profile-email-note">{t('settings.emailFixed')}</FieldDescription>
        </Field>

        <FormAlert message={formError} />

        <SubmitButton pending={isSubmitting}>{t('settings.profileSave')}</SubmitButton>
      </div>
    </form>
  )
}
