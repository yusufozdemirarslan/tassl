// Fixture props for the component gallery (UI-060). Graph fixtures are added in Phase 10.
import type { Institution } from '@/components/layout/institution-switcher'
import type { RailItem } from '@/components/layout/rail'

export const institutions: Institution[] = [
  { id: 'org-gw', name: 'George Washington University' },
  { id: 'org-gu', name: 'Georgetown University' },
]

export const user = { name: 'Marco Villanueva', email: 'marco@student.example.edu' }

export const rail: RailItem[] = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/runs' as RailItem['href'], label: 'Runs', icon: 'runs' },
  { href: '/courses' as RailItem['href'], label: 'Courses', icon: 'courses' },
  { href: '/review' as RailItem['href'], label: 'Review', icon: 'review' },
]

export const tokens: Array<{ name: string; use: string }> = [
  { name: 'paper', use: 'page ground' },
  { name: 'paper-raised', use: 'panels, dialogs, inputs' },
  { name: 'paper-sunken', use: 'input wells, timeline track' },
  { name: 'ink', use: 'primary text' },
  { name: 'ink-muted', use: 'secondary text' },
  { name: 'ink-faint', use: 'decorative strokes only' },
  { name: 'line', use: 'hairlines' },
  { name: 'line-strong', use: 'dashed sample borders' },
  { name: 'line-control', use: 'control boundaries' },
  { name: 'primary', use: 'actions, links, selection' },
  { name: 'primary-soft', use: 'selected row wash' },
  { name: 'amber', use: 'draft, provisional (border, icon, fill only)' },
  { name: 'amber-soft', use: 'draft chip wash' },
  { name: 'red', use: 'refusals, errors' },
  { name: 'red-soft', use: 'error wash' },
  { name: 'green', use: 'confirmed, matched' },
  { name: 'green-soft', use: 'confirmation wash' },
  { name: 'focus', use: 'focus ring' },
  { name: 'stance-accept', use: 'stance: accept' },
  { name: 'stance-verify', use: 'stance: verify' },
  { name: 'stance-challenge', use: 'stance: challenge' },
  { name: 'stance-reject', use: 'stance: reject' },
  { name: 'stance-escalate', use: 'stance: escalate' },
]

export const typeScale: Array<{ className: string; label: string; sample: string }> = [
  { className: 'font-serif text-h1', label: 'h1 · Serif 600 · 36/44', sample: 'Make the call.' },
  {
    className: 'font-serif text-h2',
    label: 'h2 · Serif 500 · 30/38',
    sample: 'Frame the decision',
  },
  { className: 'font-serif text-h3', label: 'h3 · Serif 500 · 24/32', sample: 'Evidence Room' },
  { className: 'font-serif text-h4', label: 'h4 · Serif 500 · 20/28', sample: 'Named fields' },
  {
    className: 'text-lead',
    label: 'lead · Sans 400 · 18/28',
    sample: 'The board meets on Friday and expects a recommendation.',
  },
  {
    className: 'text-reading',
    label: 'reading · Sans 400 · 16/26',
    sample:
      'Everything the student writes and reads at length sits at this size, with a 72ch measure.',
  },
  {
    className: 'text-body',
    label: 'body · Sans 400 · 14/22',
    sample: 'The default UI size for controls and panels.',
  },
  {
    className: 'text-meta font-medium',
    label: 'label · Sans 500 · 13/20',
    sample: 'Buttons, chips, table headers, metadata',
  },
  {
    className: 'font-mono text-mono',
    label: 'mono · Mono 400 · 14/20',
    sample: 'req 8f1c…e2a4 · 00:42:17 · 1,204 words',
  },
  {
    className: 'font-mono text-mono-sm',
    label: 'mono dense · Mono 400 · 12/18',
    sample: 'accept verify challenge reject escalate',
  },
]

export const runs = [
  {
    id: 'run-1',
    scenario: 'Meridian Foods pricing',
    variant: 'defective',
    state: 'working',
    clock: '00:38:10',
  },
  {
    id: 'run-2',
    scenario: 'Meridian Foods pricing',
    variant: 'sound',
    state: 'decision_locked',
    clock: '00:00:00',
  },
  {
    id: 'run-3',
    scenario: 'Northwind logistics',
    variant: 'defective',
    state: 'scored',
    clock: '—',
  },
]

export const stances = [
  { value: 'accept', label: 'Accept' },
  { value: 'verify', label: 'Verify' },
  { value: 'challenge', label: 'Challenge' },
  { value: 'reject', label: 'Reject' },
  { value: 'escalate', label: 'Escalate' },
]
