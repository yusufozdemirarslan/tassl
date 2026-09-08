import type { ReactNode } from 'react'

// The auth screens of UI-001 to UI-004: one centred card on the paper ground. The ground, the
// brand banner, `main` and the legal footer are the parent layout's; the card and the centring are
// this group's, because the legal documents that share the parent want neither (D-573).
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      {/* The card is capped at the 420 px of 09 §UI-001 and stays a single column at every width. */}
      <div className="border-line bg-paper-raised w-full max-w-[420px] rounded-md border p-6">
        {children}
      </div>
    </div>
  )
}
