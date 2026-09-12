/**
 * Consistency gate for docs/manual (one-off tooling for the manual, not a test lane).
 *
 *   pnpm exec tsx scripts/manual-check.ts
 *
 * Checks, and prints every failure:
 *   - every relative link resolves to a file that exists, and every #anchor to a real heading
 *   - every embedded image exists
 *   - every screenshot under docs/manual/screenshots is embedded at least once
 *   - no screenshot is embedded twice in the same file
 *   - each role file carries the ten prescribed sections, in order
 *   - no banned content: TODO, "coming soon", file paths, line-number citations
 *   - every bold label appears verbatim in a captured screen text dump (reported, not fatal)
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const MANUAL = join(process.cwd(), 'docs', 'manual')
const SHOTS = join(MANUAL, 'screenshots')
const TEXT = process.env.MANUAL_TEXT_DIR ?? join(process.cwd(), '.manual-text')

const SECTIONS = [
  '## 1. Who you are in Tassl',
  '## 2. Signing in and your home screen',
  '## 3. Navigation map',
  '## 4. Dashboards',
  '## 5. Features',
  '## 6. The AI assistant',
  '## 7. Notifications, settings, and account',
  '## 8. Common situations',
  '## 9. Error messages and what they mean',
  '## 10. Glossary',
]

const ROLE_FILES = [
  '01-instructor.md',
  '02-learner.md',
  '03-admin.md',
  '04-scenario-author.md',
  '05-teaching-assistant.md',
  '06-program-lead.md',
]

const BANNED = [
  /\bTODO\b/,
  /coming soon/i,
  /\bTBD\b/,
  /\bFIXME\b/,
  /\bsrc\/[a-z]/,
  /\.tsx?:\d+/,
  /docs\/tech\//,
  /\[placeholder\]|<placeholder>|PLACEHOLDER/,
]

/**
 * Bold that is a fragment of a sentence rather than a label: a markdown slip, not a UI string.
 * A bold run opening with punctuation, closing with punctuation that cannot end a label, starting
 * mid-sentence in lower case, or trailing off in a connective.
 */
const SUSPICIOUS_BOLD =
  /^[,;:)]|[,;(]$|^[a-z]+\s|\s(and|then|of|to|before|under|above|with|from|into|the|a|an)$/

const failures: string[] = []
const notes: string[] = []

function slug(heading: string): string {
  return heading
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

function headingsOf(file: string): Set<string> {
  if (!existsSync(file)) return new Set()
  const set = new Set<string>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (/^#{1,6}\s/.test(line)) set.add(slug(line))
  }
  return set
}

const markdown = readdirSync(MANUAL).filter((name) => name.endsWith('.md'))
const embedded = new Map<string, string[]>() // screenshot path -> files embedding it

for (const name of markdown) {
  const path = join(MANUAL, name)
  const body = readFileSync(path, 'utf8')
  const lines = body.split('\n')

  // Banned content
  lines.forEach((line, index) => {
    if (line.trimStart().startsWith('<!--')) return
    for (const pattern of BANNED) {
      if (pattern.test(line)) {
        failures.push(
          `${name}:${String(index + 1)} banned content ${String(pattern)}: ${line.trim().slice(0, 120)}`,
        )
      }
    }
  })

  // Images
  const seenHere = new Set<string>()
  for (const match of body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const alt = match[1] ?? ''
    const target = match[2] ?? ''
    if (alt.trim() === '') failures.push(`${name}: image with no alt text -> ${target}`)
    const full = resolve(dirname(path), target)
    if (!existsSync(full)) {
      failures.push(`${name}: image does not exist -> ${target}`)
      continue
    }
    if (seenHere.has(full)) failures.push(`${name}: image embedded twice -> ${target}`)
    seenHere.add(full)
    embedded.set(full, [...(embedded.get(full) ?? []), name])
  }

  // Links
  for (const match of body.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g)) {
    const target = match[2] ?? ''
    if (/^(https?:|mailto:)/.test(target)) continue
    const [pathPart, anchor] = target.split('#')
    if (pathPart === undefined || pathPart === '') {
      if (anchor !== undefined && !headingsOf(path).has(anchor)) {
        failures.push(`${name}: anchor #${anchor} is not a heading in this file`)
      }
      continue
    }
    const full = resolve(dirname(path), pathPart)
    if (!existsSync(full)) {
      failures.push(`${name}: link target does not exist -> ${target}`)
      continue
    }
    if (anchor !== undefined && anchor !== '' && statSync(full).isFile()) {
      if (!headingsOf(full).has(anchor)) {
        failures.push(`${name}: anchor #${anchor} is not a heading in ${pathPart}`)
      }
    }
  }
}

// Every screenshot embedded somewhere
for (const dir of readdirSync(SHOTS)) {
  const full = join(SHOTS, dir)
  if (!statSync(full).isDirectory()) continue
  for (const file of readdirSync(full)) {
    if (!file.endsWith('.png')) continue
    const path = join(full, file)
    if (!embedded.has(path))
      failures.push(`screenshots/${dir}/${file} is embedded in no manual file`)
  }
}

// Required sections
for (const name of ROLE_FILES) {
  const path = join(MANUAL, name)
  if (!existsSync(path)) {
    failures.push(`${name} is missing`)
    continue
  }
  const body = readFileSync(path, 'utf8')
  let cursor = 0
  for (const heading of SECTIONS) {
    const at = body.indexOf(`\n${heading}`, cursor)
    if (at === -1) {
      failures.push(`${name}: missing or out-of-order section "${heading}"`)
      continue
    }
    cursor = at + 1
  }
}

if (!existsSync(join(MANUAL, 'README.md'))) failures.push('README.md is missing')
if (!existsSync(join(MANUAL, '00-what-tassl-is.md')))
  failures.push('00-what-tassl-is.md is missing')

// Bold labels against the captured screens (advisory)
const captures: string[] = []
if (existsSync(TEXT)) {
  for (const dir of readdirSync(TEXT)) {
    const full = join(TEXT, dir)
    if (!statSync(full).isDirectory()) continue
    for (const file of readdirSync(full)) captures.push(readFileSync(join(full, file), 'utf8'))
  }
}
const haystack = captures.join('\n')
// With no captures on disk every label would read as unverified, which is noise rather than a
// finding: the check is simply not available then, and says so once.
const canCheckLabels = captures.length > 0
if (!canCheckLabels) {
  notes.push(
    `no screen captures under ${TEXT}, so bold labels were not checked against them; run scripts/manual-capture.ts to rebuild them`,
  )
}
const unverified = new Map<string, Set<string>>()
const fragments = new Map<string, Set<string>>()
for (const name of markdown) {
  // Bold labels are allowed to wrap across source lines, so the scan runs on one line: matching
  // per line pairs the closing `**` of a wrapped label with the next opening one and invents
  // fragments that are not in the file at all. The content range has to admit a one-character run
  // too (`version **1**`): a run the pattern cannot match flips the pairing parity for the rest of
  // the file, and every 'fragment' after it is the scan's invention rather than the file's.
  const body = readFileSync(join(MANUAL, name), 'utf8').replace(/\s*\n\s*/g, ' ')
  for (const match of body.matchAll(/\*\*([^*]{1,200})\*\*/g)) {
    const label = (match[1] ?? '').trim()
    if (label === '' || /^(I want to|You can|You cannot|Why|What|How|Note|Warning)\b/.test(label))
      continue
    // Bold used for emphasis on a whole sentence, not for a UI label.
    if (/[.!?]$/.test(label)) continue
    if (SUSPICIOUS_BOLD.test(label)) {
      fragments.set(name, (fragments.get(name) ?? new Set()).add(label))
      continue
    }
    if (/[.:]$/.test(label)) continue
    // A label carrying a {placeholder} cannot be matched against a capture; it is checked by eye.
    if (label.includes('{')) continue
    if (!canCheckLabels || haystack.includes(label)) continue
    unverified.set(name, (unverified.get(name) ?? new Set()).add(label))
  }
}
for (const [name, labels] of fragments) {
  notes.push(
    `${name}: ${String(labels.size)} bold runs that read as sentence fragments: ${[...labels].slice(0, 30).join(' | ')}`,
  )
}
for (const [name, labels] of unverified) {
  notes.push(
    `${name}: ${String(labels.size)} bold labels not found in any captured screen: ${[...labels].slice(0, 40).join(' | ')}`,
  )
}

console.log(
  `checked ${String(markdown.length)} markdown files, ${String(embedded.size)} embedded images`,
)
if (notes.length > 0) {
  console.log(`\n--- advisory (${String(notes.length)}) ---`)
  for (const note of notes) console.log(note)
}
if (failures.length === 0) {
  console.log('\nOK: no failures')
} else {
  console.log(`\n--- FAILURES (${String(failures.length)}) ---`)
  for (const failure of failures) console.log(failure)
  process.exitCode = 1
}
