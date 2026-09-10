import type { MetadataRoute } from 'next'

// The judged demo stays out of search engines (docs/prompts/02-qa-and-guides.md C9): every page
// already carries `<meta name="robots" content="noindex">` from the root layout, and this is the
// crawler-facing half of the same statement. Before this file `/robots.txt` answered with the 404
// page.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } }
}
