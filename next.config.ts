import type { NextConfig } from 'next'

// Grows in Phases 13 and 14; the final listing is docs/tech/12-security.md §4.3.
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
}

export default config
