// Every user-facing string lives under `messages/`, one module per namespace, and this file is
// the whole of it (docs/tech/04-repo-structure.md, NFR-017, SYS-021). Keys are dot-separated by
// screen or module; values may carry {param} placeholders. Server code and Server Components read
// the composed catalogue through `t.ts`; a Client Component imports the `t` of the one namespace
// module it needs, so it never ships the other 27 (docs/tech/16 §3.4).
import { landing } from './messages/landing'
import { ui } from './messages/ui'
import { shell } from './messages/shell'
import { home } from './messages/home'
import { error } from './messages/error'
import { email } from './messages/email'
import { label } from './messages/label'
import { stance } from './messages/stance'
import { identity } from './messages/identity'
import { tenancy } from './messages/tenancy'
import { auth } from './messages/auth'
import { role } from './messages/role'
import { notifications } from './messages/notifications'
import { settings } from './messages/settings'
import { invitation } from './messages/invitation'
import { courses } from './messages/courses'
import { roster } from './messages/roster'
import { assignment } from './messages/assignment'
import { packages } from './messages/packages'
import { packageNew } from './messages/package-new'
import { packageImport } from './messages/package-import'
import { packageVersion } from './messages/package-version'
import { packageConfirm } from './messages/package-confirm'
import { claimObject } from './messages/claim-object'

export const enUS = {
  ...landing,
  ...ui,
  ...shell,
  ...home,
  ...error,
  ...email,
  ...label,
  ...stance,
  ...identity,
  ...tenancy,
  ...auth,
  ...role,
  ...notifications,
  ...settings,
  ...invitation,
  ...courses,
  ...roster,
  ...assignment,
  ...packages,
  ...packageNew,
  ...packageImport,
  ...packageVersion,
  ...packageConfirm,
  ...claimObject,
} as const

export type MessageKey = keyof typeof enUS
