'use client'

import { FormAlert } from '@/components/features/account/form-feedback'
import type { DeferredStatus } from '@/lib/hooks/use-deferred-module'
import { t } from '@/lib/i18n/messages/ui'

// B4 / NFR-013 (16 §3.2). A form that only exists once a dialog is open is not part of what the
// route paints, so it should not be part of what the route downloads: react-hook-form, the
// zod/mini schema, the resolver and the field primitives are one chunk of about 32 KB gzip, and on
// a screen whose first paint is a table and a button that chunk buys nothing until the button is
// pressed.
//
// What stays in the entry bundle is the trigger, the dialog frame, its title and its description,
// so the control is keyboard operable from the first paint and the dialog announces itself before
// the form arrives. Only the fields are deferred.
//
// The import can fail — an offline moment, a deployment that moved the file — and a button that
// opens an empty dialog is worse than no button, so the failure is stated where the form would
// have been. Closing the dialog unmounts it (Base UI portals are not kept mounted), so the next
// open calls `request` again and retries.
//
// The hook itself lives in `src/lib/hooks/use-deferred-module.ts`: the header's two menus (UI-008)
// arrive the same way, and a layout component has no business importing a course screen.
export {
  type DeferredModule,
  type DeferredStatus,
  useDeferredModule,
} from '@/lib/hooks/use-deferred-module'

/** What the dialog holds while its form is in flight, and the sentence when it never arrives. */
export function DeferredFormFallback({ status }: { status: DeferredStatus }) {
  if (status === 'failed') return <FormAlert message={t('ui.formLoadFailed')} />
  return (
    <p role="status" className="text-ink-muted text-body py-2">
      {t('ui.loading')}
    </p>
  )
}
