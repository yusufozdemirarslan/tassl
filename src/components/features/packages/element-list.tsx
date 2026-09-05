'use client'

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  BadgeCheckIcon,
  ChevronRightIcon,
  CircleIcon,
  OctagonXIcon,
  PencilLineIcon,
} from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { t } from '@/lib/i18n/messages/package-confirm'
import { countDecided, isSettled, type TreeNode, type WorkspaceElement } from './element-model'

// The left side of UI-043: every element of the version as one tree, grouped by type, each group
// saying how far it has got.
//
// It is a real tree (WAI-ARIA `tree`), not a list of links, for two reasons. Sixty-odd elements in
// fourteen groups is a structure, and a structure a screen reader can announce as one — "Claims,
// level 1, 6 of 24, expanded" — is worth more than sixty flat rows. And an author confirming a
// package works down it with the keyboard: up and down through what is open, right to open a group
// and step into it, left to close it and come back out, Enter to open the element in the editor.
// Selection is separate from focus, exactly as the pattern requires, so arrowing past an element
// does not load it.
//
// Under `lg` the tree becomes a select, because a 320 px rail beside a form does not survive a
// phone. It is a native select on purpose: it is one control, it holds sixty options without
// costing anything, and the platform's own picker is better on a touch screen than anything drawn
// here would be.
//
// The status mark is the point of the whole column. An author's question is always "what have I
// not decided yet?", so the mark is never colour alone — a check, a cross, an empty ring and a
// pencil, each with a word behind it — and the filter above the tree answers the question directly
// by hiding everything that already has a decision. The word is *in the name of the row*: a
// `treeitem` naming itself with `aria-labelledby` overrides its own contents, so the ids listed
// there are the label, and then the state — "Positioning deck D4, Confirmed", "Documents, 6 of 24"
// — rather than the label alone with the mark announced to nobody.

export type ElementListProps = {
  nodes: readonly TreeNode[]
  selectedId: string | null
  /** Elements holding edits that have not been saved; the tree marks them so none is lost. */
  dirtyIds: ReadonlySet<string>
  expanded: ReadonlySet<string>
  onExpandedChange: (next: Set<string>) => void
  onSelect: (id: string) => void
  onlyUndecided: boolean
  onOnlyUndecidedChange: (next: boolean) => void
}

type Status = 'confirmed' | 'rejected' | 'undecided'

const statusOf = (element: WorkspaceElement): Status =>
  isSettled(element) ? 'confirmed' : element.decision === 'rejected' ? 'rejected' : 'undecided'

const STATUS_LABEL: Record<Status, () => string> = {
  confirmed: () => t('confirm.statusConfirmed'),
  rejected: () => t('confirm.statusRejected'),
  undecided: () => t('confirm.statusUndecided'),
}

/** The mark, and the word behind it: colour is never the only thing that says which state this is. */
function StatusMark({ id, status, dirty }: { id: string; status: Status; dirty: boolean }) {
  const Icon = dirty
    ? PencilLineIcon
    : status === 'confirmed'
      ? BadgeCheckIcon
      : status === 'rejected'
        ? OctagonXIcon
        : CircleIcon
  return (
    <>
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-4 shrink-0',
          dirty
            ? 'text-amber'
            : status === 'confirmed'
              ? 'text-green'
              : status === 'rejected'
                ? 'text-red'
                : 'text-ink-faint',
        )}
      />
      <span id={id} className="sr-only">
        {dirty ? `${STATUS_LABEL[status]()}, ${t('confirm.unsavedMark')}` : STATUS_LABEL[status]()}
      </span>
    </>
  )
}

/** Keeps only what still needs a decision, and drops a group the filter has emptied. */
function filterUndecided(nodes: readonly TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  for (const node of nodes) {
    if (node.kind === 'leaf') {
      if (!isSettled(node.element)) out.push(node)
      continue
    }
    const children = filterUndecided(node.children)
    if (children.length > 0) out.push({ ...node, children })
  }
  return out
}

/** Every group id in a subtree; what "open everything" means while the filter is on. */
function allGroupIds(nodes: readonly TreeNode[]): Set<string> {
  const ids = new Set<string>()
  const walk = (list: readonly TreeNode[]): void => {
    for (const node of list) {
      if (node.kind !== 'group') continue
      ids.add(node.id)
      walk(node.children)
    }
  }
  walk(nodes)
  return ids
}

type Row = { node: TreeNode; level: number; parentId: string | null }

/** The rows the keyboard walks: what is on screen, in the order it is drawn. */
function visibleRows(
  nodes: readonly TreeNode[],
  expanded: ReadonlySet<string>,
  level = 1,
  parentId: string | null = null,
): Row[] {
  const rows: Row[] = []
  for (const node of nodes) {
    rows.push({ node, level, parentId })
    if (node.kind === 'group' && expanded.has(node.id)) {
      rows.push(...visibleRows(node.children, expanded, level + 1, node.id))
    }
  }
  return rows
}

export function ElementList({
  nodes,
  selectedId,
  dirtyIds,
  expanded,
  onExpandedChange,
  onSelect,
  onlyUndecided,
  onOnlyUndecidedChange,
}: ElementListProps) {
  const shown = useMemo(
    () => (onlyUndecided ? filterUndecided(nodes) : nodes),
    [nodes, onlyUndecided],
  )
  const rows = useMemo(() => visibleRows(shown, expanded), [shown, expanded])
  const items = useRef(new Map<string, HTMLLIElement>())

  const focusRow = useCallback((id: string | undefined): void => {
    if (id === undefined) return
    items.current.get(id)?.focus()
  }, [])

  // Turning the filter on opens every group that still has something undecided in it — a collapsed
  // group hiding three of them would defeat the filter's whole purpose. It *writes* that into
  // `expanded` rather than overriding it on the way to the screen, because a rendered expansion the
  // keyboard cannot change is a group whose ArrowLeft and Enter do nothing.
  const onFilterChange = useCallback(
    (next: boolean): void => {
      if (next) onExpandedChange(new Set([...expanded, ...allGroupIds(filterUndecided(nodes))]))
      onOnlyUndecidedChange(next)
    },
    [nodes, expanded, onExpandedChange, onOnlyUndecidedChange],
  )

  // The row that had focus can be taken off the screen by something the author did somewhere else:
  // confirming the open element while the filter is on removes it from the list. A removed row
  // leaves focus on the document, which is nowhere; the tree keeps it, on whatever took its place.
  const focused = useRef<{ id: string; at: number } | null>(null)
  useEffect(() => {
    const held = focused.current
    if (held === null || rows.some((row) => row.node.id === held.id)) return
    focused.current = null
    if (document.activeElement !== null && document.activeElement !== document.body) return
    focusRow(rows[Math.min(held.at, rows.length - 1)]?.node.id)
  }, [rows, focusRow])

  const toggle = useCallback(
    (id: string, shouldOpen: boolean): void => {
      const next = new Set(expanded)
      if (shouldOpen) next.add(id)
      else next.delete(id)
      onExpandedChange(next)
    },
    [expanded, onExpandedChange],
  )

  // The tree's own roving tab stop: the selected element when it is on screen, the first row
  // otherwise, so tabbing into the column always lands somewhere meaningful.
  const tabStop =
    rows.find((row) => row.node.kind === 'leaf' && row.node.id === selectedId)?.node.id ??
    rows[0]?.node.id ??
    null

  const onKeyDown = (event: KeyboardEvent<HTMLLIElement>, row: Row): void => {
    const index = rows.findIndex((candidate) => candidate.node.id === row.node.id)
    const isGroup = row.node.kind === 'group'
    const isOpen = isGroup && expanded.has(row.node.id)

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        event.stopPropagation()
        focusRow(rows[index + 1]?.node.id)
        return
      case 'ArrowUp':
        event.preventDefault()
        event.stopPropagation()
        focusRow(rows[index - 1]?.node.id)
        return
      case 'ArrowRight':
        event.preventDefault()
        event.stopPropagation()
        if (isGroup && !isOpen) toggle(row.node.id, true)
        else if (isGroup) focusRow(rows[index + 1]?.node.id)
        return
      case 'ArrowLeft':
        event.preventDefault()
        event.stopPropagation()
        if (isGroup && isOpen) toggle(row.node.id, false)
        else if (row.parentId !== null) focusRow(row.parentId)
        return
      case 'Home':
        event.preventDefault()
        event.stopPropagation()
        focusRow(rows[0]?.node.id)
        return
      case 'End':
        event.preventDefault()
        event.stopPropagation()
        focusRow(rows[rows.length - 1]?.node.id)
        return
      case 'Enter':
      case ' ':
        event.preventDefault()
        event.stopPropagation()
        if (isGroup) toggle(row.node.id, !isOpen)
        else onSelect(row.node.id)
        return
      default:
        return
    }
  }

  const renderNodes = (list: readonly TreeNode[], level: number): ReactNode =>
    list.map((node) => {
      const labelId = `tree-${node.id}-label`
      // The state of the row — its decision, or how far a group has got — named so it is part of
      // the row's own name rather than contents `aria-labelledby` throws away.
      const stateId = `tree-${node.id}-state`
      const isGroup = node.kind === 'group'
      const isOpen = isGroup && expanded.has(node.id)
      const selected = !isGroup && node.id === selectedId
      const row = rows.find((candidate) => candidate.node.id === node.id)
      const progress = isGroup ? countDecided(node.children) : null

      return (
        <li
          key={node.id}
          role="treeitem"
          aria-labelledby={`${labelId} ${stateId}`}
          aria-level={level}
          aria-selected={selected}
          {...(isGroup ? { 'aria-expanded': isOpen } : {})}
          tabIndex={node.id === tabStop ? 0 : -1}
          ref={(element) => {
            if (element) items.current.set(node.id, element)
            else items.current.delete(node.id)
          }}
          onFocus={(event) => {
            if (event.target !== event.currentTarget) return
            focused.current = { id: node.id, at: rows.findIndex((r) => r.node.id === node.id) }
          }}
          onKeyDown={(event) => {
            if (row) onKeyDown(event, row)
          }}
          onClick={(event) => {
            event.stopPropagation()
            if (isGroup) toggle(node.id, !isOpen)
            else onSelect(node.id)
          }}
          className={cn(
            'focus-visible:outline-focus cursor-default rounded-md focus-visible:outline-2 focus-visible:-outline-offset-2',
            level > 1 && 'border-line ml-3 border-l pl-1',
          )}
        >
          <span
            className={cn(
              'flex min-h-10 items-start gap-2 rounded-md px-2 py-2 transition-colors duration-150 ease-out',
              selected ? 'bg-primary-soft text-ink' : 'hover:bg-paper-sunken',
            )}
          >
            {isGroup ? (
              <ChevronRightIcon
                aria-hidden="true"
                className={cn(
                  'text-ink-muted mt-0.5 size-4 shrink-0 transition-transform duration-150 ease-out',
                  isOpen && 'rotate-90',
                )}
              />
            ) : (
              <StatusMark
                id={stateId}
                status={statusOf(node.element)}
                dirty={dirtyIds.has(node.id)}
              />
            )}
            <span id={labelId} className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={cn(
                  'text-body break-words',
                  isGroup ? 'font-medium' : undefined,
                  selected ? 'text-primary font-medium' : 'text-ink',
                )}
              >
                {node.label}
              </span>
              {node.caption !== null && (
                <span
                  className={cn(
                    'text-mono-sm font-mono break-all',
                    selected ? 'text-primary' : 'text-ink-muted',
                  )}
                >
                  {node.caption}
                </span>
              )}
            </span>
            {progress !== null && (
              <span
                id={stateId}
                className="text-ink-muted text-mono-sm shrink-0 pt-0.5 font-mono tabular-nums"
              >
                {t('confirm.groupProgress', {
                  decided: progress.decided,
                  total: progress.total,
                })}
              </span>
            )}
          </span>
          {isGroup && isOpen && (
            <ul role="group" className="flex flex-col">
              {renderNodes(node.children, level + 1)}
            </ul>
          )}
        </li>
      )
    })

  return (
    <div className="flex flex-col gap-3">
      <Field orientation="horizontal">
        <Checkbox
          id="confirm-only-undecided"
          checked={onlyUndecided}
          aria-labelledby="confirm-only-undecided-label"
          onCheckedChange={onFilterChange}
        />
        <FieldContent>
          <FieldLabel id="confirm-only-undecided-label" htmlFor="confirm-only-undecided">
            {t('confirm.onlyUndecided')}
          </FieldLabel>
        </FieldContent>
      </Field>

      {shown.length === 0 ? (
        <p className="text-ink-muted text-body py-4">{t('confirm.onlyUndecidedEmpty')}</p>
      ) : (
        <>
          {/* Under lg the tree is a select: one control, sixty options, and the platform's own
              picker on a touch screen. */}
          <div className="lg:hidden">
            <label htmlFor="confirm-element-select" className="text-meta text-ink font-medium">
              {t('confirm.selectLabel')}
            </label>
            <select
              id="confirm-element-select"
              value={selectedId ?? ''}
              onChange={(event) => onSelect(event.target.value)}
              className="border-line-control bg-paper-raised text-body text-ink focus-visible:border-primary focus-visible:outline-focus mt-1 h-10 w-full rounded-md border px-3 focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {flatOptions(shown).map((group) => {
                const options = group.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))
                // A run of top-level singletons belongs to no group; `<optgroup label="">` would
                // draw an unnamed heading and, keyed by that empty name, collide with the next run.
                return group.label === null ? (
                  <Fragment key={group.id}>{options}</Fragment>
                ) : (
                  <optgroup key={group.id} label={group.label}>
                    {options}
                  </optgroup>
                )
              })}
            </select>
          </div>

          <ul
            role="tree"
            aria-label={t('confirm.treeLabel')}
            className="hidden max-h-[70vh] flex-col overflow-y-auto lg:flex"
          >
            {renderNodes(shown, 1)}
          </ul>
        </>
      )}
    </div>
  )
}

type OptionGroup = {
  /** The React key: the tree node's own id, or the first leaf of an ungrouped run. */
  id: string
  /** The `optgroup` label, or null for singletons that belong to no group. */
  label: string | null
  items: { id: string; label: string }[]
}

/** The tree flattened for the select: one optgroup per top-level node, its leaves inside it. */
function flatOptions(nodes: readonly TreeNode[]): OptionGroup[] {
  const groups: OptionGroup[] = []
  for (const node of nodes) {
    if (node.kind === 'leaf') {
      const last = groups[groups.length - 1]
      const label = node.caption === null ? node.label : `${node.caption} · ${node.label}`
      if (last && last.label === null) last.items.push({ id: node.id, label })
      else groups.push({ id: node.id, label: null, items: [{ id: node.id, label }] })
      continue
    }
    const items: { id: string; label: string }[] = []
    const walk = (children: readonly TreeNode[], prefix: string): void => {
      for (const child of children) {
        const own = child.caption === null ? child.label : `${child.caption} · ${child.label}`
        if (child.kind === 'leaf') items.push({ id: child.id, label: `${prefix}${own}` })
        else walk(child.children, `${prefix}${own} — `)
      }
    }
    walk(node.children, '')
    groups.push({ id: node.id, label: node.label, items })
  }
  return groups
}
