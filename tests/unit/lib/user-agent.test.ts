import { describe, expect, it } from 'vitest'
import { describeUserAgent } from '@/lib/format/user-agent'

// UI-010's signed-in devices: the row names the device as a person would ("Chrome on Windows"),
// never as the header does. Four headers a student's browser actually sends, plus the ones that
// name other browsers inside their own string, which is where a naive match goes wrong.

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const FIREFOX_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:130.0) Gecko/20100101 Firefox/130.0'
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15'
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1'
/** What Playwright's Chromium sends under `pnpm test:e2e`. */
const PLAYWRIGHT_HEADLESS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.6778.33 Safari/537.36'
/** Playwright's WebKit project, which is Safari's engine on whatever host runs it. */
const PLAYWRIGHT_WEBKIT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.2903.51'
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

describe('describeUserAgent', () => {
  it.each([
    ['Chrome on Windows', CHROME_WINDOWS, { browser: 'Chrome', os: 'Windows' }],
    ['Firefox on macOS', FIREFOX_MAC, { browser: 'Firefox', os: 'macOS' }],
    ['Safari on macOS', SAFARI_MAC, { browser: 'Safari', os: 'macOS' }],
    ['Safari on an iPhone', SAFARI_IPHONE, { browser: 'Safari', os: 'iOS' }],
    ['a Playwright headless Chromium', PLAYWRIGHT_HEADLESS, { browser: 'Chrome', os: 'Windows' }],
    ['a Playwright WebKit', PLAYWRIGHT_WEBKIT, { browser: 'Safari', os: 'macOS' }],
  ])('reads %s', (_name, header, expected) => {
    expect(describeUserAgent(header)).toEqual(expected)
  })

  it('names the browser that is built on another, not the one it names inside', () => {
    // Every Edge says Chrome and every Chrome says Safari; the specific one wins.
    expect(describeUserAgent(EDGE_WINDOWS)).toEqual({ browser: 'Edge', os: 'Windows' })
    expect(describeUserAgent(CHROME_ANDROID)).toEqual({ browser: 'Chrome', os: 'Android' })
  })

  it('gives up cleanly on a header it does not recognise, and on none at all', () => {
    expect(describeUserAgent('curl/8.6.0')).toEqual({ browser: null, os: null })
    expect(describeUserAgent('Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Lynx')).toEqual({
      browser: null,
      os: 'Linux',
    })
    expect(describeUserAgent(null)).toEqual({ browser: null, os: null })
    expect(describeUserAgent('   ')).toEqual({ browser: null, os: null })
  })
})
