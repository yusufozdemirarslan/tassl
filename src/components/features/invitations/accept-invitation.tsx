'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSignOut } from '@/lib/hooks/use-sign-out'
import { t } from '@/lib/i18n/messages/invitation'
import { acceptInvitationAction } from '@/server/modules/tenancy/actions'
import { FormAlert } from '@/components/features/account/form-feedback'

// UI-005. Accepting writes the membership through the tenancy action (which is where the email is
// checked again against the session, 08 §2.5) and then lands on /home, where the institution the
// person just joined is already in the switcher.
export function AcceptInvitationButton({
  invitationId,
  organizationName,
}: {
  invitationId: string
  organizationName: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  async function accept(): Promise<void> {
    setPending(true)
    setFailure(null)
    const result = await acceptInvitationAction({ invitationId })
    if (!result.ok) {
      setPending(false)
      setFailure(result.error.message)
      return
    }
    toast.success(t('invitation.accepted', { name: organizationName }))
    router.push('/home')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert message={failure} />
      <Button
        className="w-fit"
        disabled={pending}
        aria-busy={pending}
        onClick={() => {
          void accept()
        }}
      >
        {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
        {t('invitation.accept')}
      </Button>
    </div>
  )
}

/** The way out of the email-mismatch state: sign out here, sign in as the invited address. */
export function SwitchAccountButton() {
  const { signOut, pending } = useSignOut()
  return (
    <Button
      variant="secondary"
      className="w-fit"
      disabled={pending}
      aria-busy={pending}
      onClick={() => {
        void signOut()
      }}
    >
      {pending && <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />}
      {t('invitation.switchAccount')}
    </Button>
  )
}
