// Shared email shell and inline styles for every template in ./templates (03-adrs.md ADR-014,
// 09-frontend-spec.md §2 tokens). Email clients strip <style> and CSS variables, so the DESIGN.md
// tokens are repeated here as inline hex; this is the one place in the codebase where that is right.
// Lives outside ./templates so `pnpm email:dev` does not list it as a previewable email.
// No `import 'server-only'`: the send_email handler runs in the tsx jobs worker and in Vitest (D-143).
import { Body, Container, Head, Hr, Html, Preview, Text } from '@react-email/components'
import type { CSSProperties, ReactNode } from 'react'
import { t } from '@/lib/i18n/t'

/** DESIGN.md tokens used by email (paper, paper-raised, ink, ink-muted, primary, primary-ink, line). */
export const emailColors = {
  paper: '#F6F7F9',
  raised: '#FFFFFF',
  ink: '#141A26',
  inkMuted: '#4B5563',
  primary: '#0F6E74',
  primaryInk: '#FFFFFF',
  line: '#D5DAE2',
} as const

const sans = 'IBM Plex Sans, Segoe UI, Helvetica Neue, Arial, sans-serif'
const serif = 'IBM Plex Serif, Georgia, Times New Roman, serif'

export const emailStyles = {
  body: {
    backgroundColor: emailColors.paper,
    color: emailColors.ink,
    fontFamily: sans,
    margin: 0,
    padding: '24px 12px',
  },
  container: {
    backgroundColor: emailColors.raised,
    border: `1px solid ${emailColors.line}`,
    borderRadius: '10px',
    margin: '0 auto',
    maxWidth: '560px',
    padding: '32px',
  },
  heading: {
    color: emailColors.ink,
    fontFamily: serif,
    fontSize: '24px',
    fontWeight: 500,
    lineHeight: '32px',
    margin: '0 0 16px',
  },
  text: {
    color: emailColors.ink,
    fontSize: '16px',
    lineHeight: '26px',
    margin: '0 0 16px',
  },
  muted: {
    color: emailColors.inkMuted,
    fontSize: '13px',
    lineHeight: '20px',
    margin: '0 0 8px',
  },
  button: {
    backgroundColor: emailColors.primary,
    borderRadius: '6px',
    color: emailColors.primaryInk,
    display: 'inline-block',
    fontFamily: sans,
    fontSize: '16px',
    fontWeight: 500,
    lineHeight: '24px',
    padding: '12px 20px',
    textDecoration: 'none',
  },
  link: {
    color: emailColors.primary,
    wordBreak: 'break-all',
  },
  hr: {
    border: 'none',
    borderTop: `1px solid ${emailColors.line}`,
    margin: '24px 0',
  },
} satisfies Record<string, CSSProperties>

export type EmailLayoutProps = { preview: string; children: ReactNode }

/** Html/Head/Preview/Body/Container shell plus the standing footer. Plain, no images (ADR-014). */
export function EmailLayout({ preview, children }: EmailLayoutProps): ReactNode {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={emailStyles.body}>
        <Container style={emailStyles.container}>
          {children}
          <Hr style={emailStyles.hr} />
          <Text style={emailStyles.muted}>{t('email.footer')}</Text>
        </Container>
      </Body>
    </Html>
  )
}
