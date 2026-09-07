import { t } from '@/lib/i18n/t'

// UI-028 → "How this run could have gone" (PRD §7.14, FR-151).
//
// Three sentences the scenario's author wrote about the scenario. They are the same for everyone
// who takes it, which is the one thing a reader has to know about them and the reason the note
// under the text is not optional: a paragraph in the middle of a page about *your* run reads as a
// paragraph about your run unless it says otherwise.

export function Counterfactual({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ink text-reading max-w-measure break-words whitespace-pre-line">{text}</p>
      <p className="text-ink-muted text-meta">{t('debrief.counterfactual.authored')}</p>
    </div>
  )
}
