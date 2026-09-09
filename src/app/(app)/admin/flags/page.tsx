import type { Metadata } from 'next'
import { AdminNav } from '@/components/features/admin/admin-nav'
import { AssistantModeForm } from '@/components/features/admin/assistant-mode-form'
import { FlagTable } from '@/components/features/admin/flag-table'
import { LlmUsageTable } from '@/components/features/admin/llm-usage-table'
import { PageHeader } from '@/components/layout/page-header'
import { Panel } from '@/components/layout/panel'
import { t } from '@/lib/i18n/t'
import { getFlags } from '@/server/modules/admin'
import { getViewer } from '../../viewer'

export const metadata: Metadata = { title: t('admin.flags.title') }

// UI-050 → flags (SYS-006). The screen exists to answer one question honestly: what is this
// deployment running with right now? So the provider row is `effectiveLlmProvider()` and not
// `LLM_PROVIDER` — with FEATURE_AI off the two disagree, and the one that decides is the first.
//
// It has one control, and it is the one value on the screen that does not live in the environment:
// the runtime assistant switch (11 §6, D-691). It sits under the provider panel because it is read
// *after* the provider — `FEATURE_AI=false` wins whatever it says — and the form says so.
export default async function AdminFlagsPage() {
  const { actor } = await getViewer()
  const flags = await getFlags(actor)

  return (
    <>
      <PageHeader title={t('admin.flags.title')} description={t('admin.flags.description')} />
      <AdminNav current="flags" />
      <div className="flex flex-col gap-6">
        {/* The page h1 already names the screen, so the panel carries no second copy of it. */}
        <Panel id="admin-flags">
          <FlagTable flags={flags} />
        </Panel>
        <Panel
          id="admin-provider"
          title={t('admin.flags.providerTitle')}
          description={t('admin.flags.providerDescription')}
          headingLevel={2}
        >
          <p className="text-ink text-mono max-w-measure font-mono">{flags.effectiveLlmProvider}</p>
          {flags.effectiveLlmProvider === 'mock' && (
            <p className="text-ink-muted text-body max-w-measure mt-3">
              {t('admin.flags.providerMockNote')}
            </p>
          )}
          {/* 11 §3's constrained-mode sentence, keyed on the flag itself rather than on the
              effective provider: a deployment with FEATURE_AI on and LLM_PROVIDER=mock is a
              deliberate choice about which model to call, not a degradation (D-655). */}
          {!flags.ai && (
            <p className="text-ink-muted text-body max-w-measure mt-3">
              {t('admin.flags.constrainedMode')}
            </p>
          )}
        </Panel>
        <Panel
          id="admin-assistant-mode"
          title={t('admin.flags.assistantModeTitle')}
          description={t('admin.flags.assistantModeDescription')}
          headingLevel={2}
        >
          <AssistantModeForm
            aiMode={flags.aiMode}
            assistantMode={flags.assistantMode}
            aiEnabled={flags.ai}
          />
        </Panel>
        {/* Step 14.5: the flags say what this deployment is running with; this says what it has
            cost. Both come from the server, and this one from the same two sums the budget
            guardrail reads before every call (NFR-016, D-065). */}
        <Panel
          id="admin-llm-usage"
          title={t('admin.flags.usageTitle')}
          description={t('admin.flags.usageDescription')}
          headingLevel={2}
        >
          <LlmUsageTable usage={flags.llmUsage} />
        </Panel>
      </div>
    </>
  )
}
