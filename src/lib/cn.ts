import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// The type scale in globals.css (--text-meta … --text-h1) adds font-size utilities that
// tailwind-merge would otherwise mistake for text colors and drop.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: ['meta', 'body', 'reading', 'lead', 'mono', 'mono-sm', 'h1', 'h2', 'h3', 'h4'],
        },
      ],
    },
  },
})

/** Merges Tailwind class lists without duplicate or conflicting utilities. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
