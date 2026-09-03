// Self-hosted IBM Plex (docs/tech/16-performance-a11y-budgets.md §6, D-124). Only the Sans faces
// are preloaded; Mono and Serif load on first use with `font-display: swap`.
import localFont from 'next/font/local'

export const plexSans = localFont({
  src: [
    { path: '../../public/fonts/IBMPlexSans-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/IBMPlexSans-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../../public/fonts/IBMPlexSans-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-sans',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'Segoe UI', 'Helvetica Neue', 'Arial', 'sans-serif'],
  adjustFontFallback: 'Arial',
})

export const plexMono = localFont({
  src: [
    { path: '../../public/fonts/IBMPlexMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/IBMPlexMono-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-plex-mono',
  display: 'swap',
  preload: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
  adjustFontFallback: false,
  // Single quotes on purpose: Turbopack serializes these declarations into a JSON query string and
  // double quotes inside the value break the loader (D-153).
  declarations: [{ prop: 'font-feature-settings', value: "'tnum' 1" }],
})

export const plexSerif = localFont({
  src: [
    { path: '../../public/fonts/IBMPlexSerif-Medium.woff2', weight: '500', style: 'normal' },
    { path: '../../public/fonts/IBMPlexSerif-SemiBold.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-plex-serif',
  display: 'swap',
  preload: false,
  fallback: ['Georgia', 'Times New Roman', 'serif'],
  adjustFontFallback: 'Times New Roman',
})
