// Email link validation: docs/tech/12-security.md §OWASP A10 — "every link targets
// NEXT_PUBLIC_APP_URL only". Every `url` prop of every template is parsed with `appLink`, so a
// template can never be rendered with an off-origin address, whoever calls sendEmail().
// No `import 'server-only'`: the send_email handler runs in the tsx jobs worker and in Vitest (D-143).
import { z } from 'zod'
import { env } from '@/server/config'

/** Origin (scheme + host + port) of NEXT_PUBLIC_APP_URL; every email link must match it. */
export const appOrigin = (): string => new URL(env.NEXT_PUBLIC_APP_URL).origin

const sameOrigin = (value: string): boolean => {
  try {
    return new URL(value).origin === appOrigin()
  } catch {
    return false
  }
}

/** An absolute URL on this deployment's own origin. */
export const appLink = z
  .string()
  .url()
  .refine(sameOrigin, { message: 'Link must be on this application origin.' })

/** The recipient address of an email; the only free-form string the transport sees. */
export const emailAddress = z.string().email()
