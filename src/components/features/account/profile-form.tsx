'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n/t'
import { updateProfileAction } from '@/server/modules/identity/actions'
import { updateProfileSchema, type UpdateProfileInput } from '@/server/modules/identity/schema'
import { FormAlert, SubmitButton } from './form-feedback'

// UI-010 Profile (SYS-003). The form validates with the module's own schema — the one the action
// and `PATCH /me` use — so the browser and the server can never disagree about what a name is.
//
// A schema file may not reach `t()` (it is the client-safe surface and imports nothing from the
// app), so the sentence under the field is chosen here from what the value actually is: empty, or
// too long. The refusal from the action is rendered from its error envelope, verbatim.
export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    getValues,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name },
  })

  const nameError = errors.name
    ? getValues('name').trim().length === 0
      ? t('auth.validation.name')
      : t('auth.validation.nameTooLong')
    : undefined

  async function onSubmit(values: UpdateProfileInput): Promise<void> {
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
