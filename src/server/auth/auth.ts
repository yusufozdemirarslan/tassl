// Better Auth server configuration (docs/tech/08-auth-authz.md §1). The generated identity and
// tenancy tables come from this file (D-099: `npx auth@1.7.2 generate` owns
// src/server/db/schema/auth.ts and it is never hand-edited). Every outbound email goes through the
// email module's `sendEmail`, which renders the react-email template and enqueues `send_email`.
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { nextCookies } from 'better-auth/next-js'
import { organization } from 'better-auth/plugins'
import { track } from '@/server/analytics/track'
import { env } from '@/server/config'
import { db } from '@/server/db/client'
import * as schema from '@/server/db/schema'
import { sendEmail } from '@/server/email/send'
import { ac, roles } from './access-control-shared'

export const auth = betterAuth({
  baseURL: env.NEXT_PUBLIC_APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  // Better Auth's own origin check for its endpoints (08 §2.7); /api/v1 uses X-Requested-With.
  trustedOrigins: [env.NEXT_PUBLIC_APP_URL],
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
      sendEmail({ to: user.email, template: 'reset-password', props: { url } }),
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) =>
      sendEmail({ to: user.email, template: 'verify-email', props: { url } }),
    // AN-002 (17-analytics-events.md §5.5).
    afterEmailVerification: async (user) => {
      track(
        'email_verified',
        { ms_since_sign_up: Math.max(0, Date.now() - user.createdAt.getTime()) },
        { userId: user.id },
      )
    },
  },
  // The three activation events Better Auth owns (17 §5.5); every other event is emitted by the
  // service that performs the write.
  databaseHooks: {
    user: {
      create: {
        after: async (user, ctx) => {
          const method = ctx?.path?.startsWith('/callback/') ? 'google' : 'password'
          track('sign_up_completed', { method }, { userId: user.id })
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      const session = ctx.context.newSession
      if (!session) return
      const method = ctx.path.startsWith('/callback/')
        ? 'google'
        : ctx.path === '/verify-email'
          ? 'verification'
          : ctx.path === '/sign-in/email'
            ? 'password'
            : null
      if (method) track('sign_in_succeeded', { method }, { userId: session.user.id })
    }),
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
      // Seven days rather than Better Auth's 48 hours (08 §2.5).
      invitationExpiresIn: 60 * 60 * 24 * 7,
      // 08 §3 does not use the built-in owner/admin roles for people: the account an admin names
      // when creating an institution is its program lead.
      creatorRole: 'program_lead',
      allowUserToCreateOrganization: async (user) =>
        (user as { platformRole?: string }).platformRole === 'admin',
      sendInvitationEmail: async ({ id, email, organization: org, inviter }) =>
        sendEmail({
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
