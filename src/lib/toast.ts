'use client'

// B4 / NFR-013 (16 §3.2). Nothing is toasted on a first paint: a toast says what an action just
// did, so the library that draws it is not part of what a screen paints and should not be part of
// what it downloads. `import { toast } from 'sonner'` at the top of a component is 10 KB of gzip in
// that route's entry bundle, spent before the reader has pressed anything.
//
// The shell already mounts the toaster through `ToasterClient`, which loads `@/components/ui/sonner`
// — and with it `sonner` itself — after hydration (D-156). So by the time an action finishes, this
// `import()` resolves from the module cache: it asks the network for nothing and costs the entry
// bundle nothing. `deferred-menu.tsx` announces a failed menu import exactly this way; this is that
// one line, named, for the forms and tables that were importing the library outright.
//
// A toast that never arrives is not worth handling. It is a confirmation of something that has
// already happened, never the only record of it — every caller here has also refreshed the route or
// closed its dialog — so a rejected import is swallowed rather than turned into a second failure.

type ToastKind = 'success' | 'error'

function announce(kind: ToastKind, message: string): void {
  void import('sonner').then(
    ({ toast }) => {
      toast[kind](message)
    },
    () => {
      // The toaster itself never arrived; what the toast would have confirmed still happened.
    },
  )
}

/** Confirms something that has already succeeded, without interrupting what the reader is doing. */
export function toastSuccess(message: string): void {
  announce('success', message)
}

/** Says something failed, where the failure has no field of its own to sit under. */
export function toastError(message: string): void {
  announce('error', message)
}
