import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getSession } from '@/server/auth/session'

// 09 §1: `/` is a signpost, not a screen — signed in it is `/home`, signed out it is `/sign-in`.
// Tassl has no marketing surface, so nothing is rendered here.
export default async function RootPage() {
  const session = await getSession(await headers())
  redirect(session ? '/home' : '/sign-in')
}
