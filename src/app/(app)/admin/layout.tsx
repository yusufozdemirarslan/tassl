import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getViewer } from '../viewer'

// The platform-admin gate on everything under /admin (UI-050, SYS-006, 08 §4 column Adm).
//
// `notFound()` and not `forbidden()`: 08 §5's rule for a resource you may not see is that it does
// not exist, and a student who types /admin/users learns nothing from a 404 — where a 403 would
// tell them the address is real and that somebody has it. It renders `(app)/not-found.tsx`, so the
// shell, the rail and the way back stay on screen.
//
// This is the layout's own guard and it is not the enforcement: every function of the `admin`
// service opens with `requirePlatformRole(actor, 'admin')`, so a page or a route that forgot this
// check would still be refused. Hidden controls are a courtesy; the service check is the fence.
//
// `getViewer()` is `cache()`d, so this session read is shared with the page below it (D-178).
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { me } = await getViewer()
  if (me.platformRole !== 'admin') notFound()
  return <>{children}</>
}
