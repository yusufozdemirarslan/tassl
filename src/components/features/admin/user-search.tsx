import Link from 'next/link'
import { SearchIcon } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/lib/i18n/t'

// UI-050's search, as a GET form: the query lands in the address, so a filtered list can be
// reloaded, linked to, and left with the back button. It needs no script, which is the other half
// of why it is a form and not client state — the admin screens are the ones somebody reaches on a
// bad day, and a search box that depends on hydration is one more thing to have gone wrong.
//
// The label is visible rather than a placeholder (DESIGN.md §Inputs: a placeholder is never the
// only label).
export function UserSearch({ query }: { query: string }) {
  return (
    <form method="get" action="/admin/users" className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-56 flex-1 flex-col gap-1">
        <label htmlFor="admin-user-search" className="text-ink text-meta font-medium">
          {t('admin.users.searchLabel')}
        </label>
        <Input
          id="admin-user-search"
          name="q"
          type="search"
          autoComplete="off"
          spellCheck={false}
          defaultValue={query}
          placeholder={t('admin.users.searchPlaceholder')}
        />
      </div>
      <Button type="submit" variant="secondary">
        <SearchIcon aria-hidden="true" className="size-4" />
        {t('admin.users.searchSubmit')}
      </Button>
      {query.length > 0 && (
        <Link href="/admin/users" className={buttonVariants({ variant: 'ghost' })}>
          {t('admin.users.searchClear')}
        </Link>
      )}
    </form>
  )
}
