// A User-Agent header as a person reads it: "Chrome on Windows", "Safari on iOS" (UI-010, the
// signed-in devices list). The raw string is a hundred characters of tokens that name three
// browsers at once — every Chrome says `Safari/537.36`, every Edge says `Chrome/` — so the row
// that has to say which device this is cannot print it and be read.
//
// A recogniser, not a database. Six browsers and six platforms cover every device an institution
// hands a student, and a header that matches none of them yields null so the row can say "Unknown
// device" instead of guessing; the raw header stays on the row for the reader who knows what to
// make of it. Order matters on both lists, because the later browsers and platforms name the
// earlier ones in their own strings: Edge and Opera carry `Chrome/`, Chrome carries `Safari/`,
// Android carries `Linux`, and an iPad claims to be a Macintosh from Safari 13 on.

export type DeviceDescription = {
  /** `Chrome`, `Firefox`, `Safari`, `Edge`, `Opera`, `Samsung Internet`; null when none matched. */
  browser: string | null
  /** `Windows`, `macOS`, `iOS`, `Android`, `ChromeOS`, `Linux`; null when none matched. */
  os: string | null
}

type Recogniser = readonly [name: string, pattern: RegExp]

/** Most specific first: a browser built on another names the other in its own header. */
const BROWSERS: readonly Recogniser[] = [
  ['Edge', /\bEdgi?[oOA]?\/|\bEdge\//],
  ['Opera', /\bOPR\/|\bOpera\b/],
  ['Samsung Internet', /\bSamsungBrowser\//],
  ['Firefox', /\bFirefox\/|\bFxiOS\//],
  // Headless Chromium (Playwright, Puppeteer) is Chrome to the person reading the list.
  ['Chrome', /\b(?:Headless)?Chrome\/|\bCriOS\/|\bChromium\//],
  ['Safari', /\bSafari\//],
]

/** Most specific first: Android is Linux, an iPad is a Macintosh, ChromeOS is Linux too. */
const PLATFORMS: readonly Recogniser[] = [
  ['Android', /\bAndroid\b/],
  ['iOS', /\b(?:iPhone|iPad|iPod)\b/],
  ['ChromeOS', /\bCrOS\b/],
  ['Windows', /\bWindows\b/],
  ['macOS', /\bMac OS X\b|\bMacintosh\b/],
  ['Linux', /\bLinux\b|\bX11\b/],
]

function recognise(userAgent: string, table: readonly Recogniser[]): string | null {
  for (const [name, pattern] of table) if (pattern.test(userAgent)) return name
  return null
}

/** The browser and platform a User-Agent names, each null when it names none this recognises. */
export function describeUserAgent(userAgent: string | null | undefined): DeviceDescription {
  if (typeof userAgent !== 'string' || userAgent.trim().length === 0) {
    return { browser: null, os: null }
  }
  return { browser: recognise(userAgent, BROWSERS), os: recognise(userAgent, PLATFORMS) }
}
