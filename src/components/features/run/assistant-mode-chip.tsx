import { Badge } from '@/components/ui/badge'
import { t } from '@/lib/i18n/messages/workspace'
import type { AssistantMode } from '@/server/modules/admin/schema'

// The chip in the "AI assistant" panel header (D-691): which assistant is answering, as a fact.
//
// `Badge` in `secondary` — the sunken wash with ink text — because it is an ad-hoc tag with no
// semantic colour, the same register the Turn's voice chip uses. It is deliberately not amber and
// deliberately not a sentence: with the scripted assistant the product is whole (D-029), and a
// chip that read as a warning would tell a student they are in a degraded run they are not in
// (D-655). No 'use client': the workspace page draws it on the framing screen's placeholder panel
// from the server, and the client panel draws the same element in its header.
export function AssistantModeChip({ mode }: { mode: AssistantMode }) {
  return (
    <Badge variant="secondary">
      {mode === 'scripted'
        ? t('workspace.assistantModeScripted')
        : t('workspace.assistantModeLive')}
    </Badge>
  )
}
