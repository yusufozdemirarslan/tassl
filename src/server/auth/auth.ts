// Better Auth server configuration (docs/tech/08-auth-authz.md §1). Phase 2 uses this file to
// generate the identity and tenancy tables; Phase 3 wires the route handler, the client, and the
// email module. Until then every outbound email is written to the server log by notifyByConsole.
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { organization } from 'better-auth/plugins'
import { env } from '@/server/config'
import { db } from '@/server/db/client'
import * as schema from '@/server/db/schema'
import { rootLogger } from '@/server/logging/logger'
import { ac, roles } from './access-control-shared'

type ConsoleEmail = {
  to: string
  template: 'verify-email' | 'reset-password' | 'invitation'
  props: Record<string, string>
}

// Placeholder for src/server/email/send (Phase 3). Never logs the recipient's address in full.
function notifyByConsole({ to, template, props }: ConsoleEmail): void {
  const domain = to.split('@')[1] ?? ''
  rootLogger.info({ event: 'email.console', template, domain, props }, 'email (console transport)')
}

export const auth = betterAuth({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
    useSecureCookies: env.APP_ENV !== 'local' && env.APP_ENV !== 'test',
    defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, path: '/' },
  },
  user: {
    additionalFields: {
      platformRole: {
        type: 'string',
        defaultValue: 'none',
        input: false,
        fieldName: 'platform_role',
      },
      deletedAt: { type: 'date', required: false, input: false, fieldName: 'deleted_at' },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: false,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) =>
      notifyByConsole({ to: user.email, template: 'reset-password', props: { url } }),
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) =>
      notifyByConsole({ to: user.email, template: 'verify-email', props: { url } }),
  },
  socialProviders: env.GOOGLE_CLIENT_ID
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          prompt: 'select_account',
        },
      }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 10,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  rateLimit: {
    enabled: true,
    storage: 'database',
    window: 60,
    max: 60,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 10 },
      '/request-password-reset': { window: 60, max: 10 },
      '/send-verification-email': { window: 60, max: 10 },
    },
  },
  plugins: [
    organization({
      ac,
      roles,
      allowUserToCreateOrganization: async (user) =>
        (user as { platformRole?: string }).platformRole === 'admin',
      sendInvitationEmail: async ({ id, email, organization: org, inviter }) =>
        notifyByConsole({
          to: email,
          template: 'invitation',
          props: {
            url: `${env.NEXT_PUBLIC_APP_URL}/invitations/${id}`,
            organizationName: org.name,
            inviterName: inviter.user.name,
          },
        }),
    }),
    nextCookies(),
  ],
})

export type Auth = typeof auth
