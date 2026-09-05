import { formatDateTime } from '@/lib/format/date-time'
import { t } from '@/lib/i18n/messages/workspace'
import type { Frame } from '@/server/modules/runs/schema'

// UI-023 / UI-027: the locked frame, read back (FR-041, FR-043).
//
// It renders *content*, not a panel. Two places show the frame — the disclosure in the `RunFrame`
// band, which is already a panel, and the workspace column once the frame is locked — and
// DESIGN.md's One-Layer Rule puts sections inside a panel rather than another panel. The caller
// supplies the container; this supplies the four fields.
//
// The frame is immutable in the database (`run_frames` holds INSERT and SELECT alone) and this is
// the read-only reading of it, so there is no control here at all: nothing to edit, nothing to
// copy, nothing to expand. FR-043 says a locked frame is never restored, edited or replaced,
// including by an instructor, and a screen with no affordance is the plainest way to say so.
//
// It carries no namespace but its own and no hooks, so it renders on the server beside the layout
// and in the browser inside a client tree without dragging the catalogue into either (D-221).

/** The label above a value: Sans 500 in ink, which is DESIGN.md's rung below `h5` for prose. */
function Term({ children }: { children: string }) {
  return <dt className="text-ink text-body font-medium">{children}</dt>
}

export type FramePanelProps = {
  /** The locked frame, exactly as `RunWorkspace.frame` carries it. */
  frame: Frame
}

export function FramePanel({ frame }: FramePanelProps) {
  return (
    <div className="flex max-w-[72ch] flex-col gap-4">
      <dl className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Term>{t('workspace.framePanelDecision')}</Term>
          <dd className="text-ink text-reading whitespace-pre-line">{frame.decision}</dd>
        </div>

        <div className="flex flex-col gap-1">
          <Term>{t('workspace.framePanelAssumptions')}</Term>
          <dd>
            <ol className="text-ink text-reading flex list-decimal flex-col gap-2 pl-5">
              {frame.assumptions.map((assumption, index) => (
                <li key={`${String(index)}-${assumption.slice(0, 32)}`}>
                  <span className="whitespace-pre-line">{assumption}</span>
                </li>
              ))}
            </ol>
          </dd>
        </div>

        <div className="flex flex-col gap-1">
          <Term>{t('workspace.framePanelPosition')}</Term>
          <dd className="text-ink text-reading whitespace-pre-line">{frame.position}</dd>
        </div>

        <div className="flex flex-col gap-1">
          <Term>{t('workspace.framePanelConfidence')}</Term>
          {/* Mono with tabular figures: anything that counts lines up (DESIGN.md's clock rule). */}
          <dd className="text-ink text-mono font-mono tabular-nums">
            {t('workspace.framePanelConfidenceValue', { value: frame.confidence })}
          </dd>
        </div>
      </dl>

      <p className="text-ink-muted text-meta">
        <time dateTime={frame.lockedAt}>
          {t('workspace.framePanelLockedAt', { when: formatDateTime(frame.lockedAt) })}
        </time>{' '}
        {t('workspace.framePanelPermanent')}
      </p>
    </div>
  )
}
