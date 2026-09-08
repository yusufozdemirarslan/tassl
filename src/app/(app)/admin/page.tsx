import { redirect } from 'next/navigation'

// `/admin` is a prefix, not a screen: UI-050's three sections are `/admin/users`, `/admin/flags`
// and `/admin/audit`, and the rail points at the first of them. Somebody who types the prefix by
// hand should land on that first section rather than on the not-found page, so this redirects the
// way `/` does (09 §1) — the layout above has already refused anyone who is not a platform admin,
// so a student who types it still gets the not-found page and learns nothing.
export default function AdminIndexPage() {
  redirect('/admin/users')
}
