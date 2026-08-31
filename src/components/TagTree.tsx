import { useEffect, useState } from 'react'

import { buildTagTree, type TagNode } from '../engine/tags'

interface TagTreeProps {
  /** Entries per tag under every active filter except the tag one. */
  counts: Record<string, number>
  /** Entries matching the other filters, whatever folder they are in. */
  total: number
  /** '' means "all scores", which is a node of its own, not an empty state. */
  selected: string
  onSelect: (tag: string) => void
}

/**
 * The catalog's virtual folders, Visual-Studio-filter style: selecting one adds
 * a filter, it does not navigate anywhere. So there is no breadcrumb, no "up"
 * button and no notion of a current directory -- the tree stays put while the
 * search box and the other filters keep working, and its counts follow them.
 *
 * A node with no matches is dimmed rather than hidden, so the tree does not
 * reshuffle under the cursor as the other filters change.
 */
export default function TagTree({ counts, total, selected, onSelect }: TagTreeProps) {
  const tree = buildTagTree(counts)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Whatever holds the selection is open, otherwise selecting `study/bartok`
  // from the flat mobile picker would leave the tree showing a collapsed
  // `study` with no sign of where the filter came from.
  useEffect(() => {
    if (!selected.includes('/')) {
      return
    }
    setExpanded((current) => {
      const next = new Set(current)
      const parts = selected.split('/')
      for (let index = 1; index < parts.length; index += 1) {
        next.add(parts.slice(0, index).join('/'))
      }
      return next
    })
  }, [selected])

  if (tree.length === 0) {
    return null
  }

  const toggle = (path: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })

  const rowClasses = (path: string, count: number) =>
    `flex-1 truncate rounded px-2 py-1 text-left text-sm ${
      selected === path
        ? 'bg-indigo-100 font-medium text-indigo-800'
        : count === 0
          ? 'text-gray-400 hover:bg-indigo-50'
          : 'text-gray-700 hover:bg-indigo-50'
    }`

  const renderNode = (node: TagNode, depth: number) => {
    const isOpen = expanded.has(node.path)
    return (
      <li key={node.path}>
        <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 12}px` }}>
          {node.children.length > 0 ? (
            <button
              type="button"
              onClick={() => toggle(node.path)}
              aria-label={isOpen ? `Collapse ${node.name}` : `Expand ${node.name}`}
              aria-expanded={isOpen}
              className="w-4 shrink-0 text-xs text-gray-400 hover:text-gray-700"
            >
              {isOpen ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <button type="button" onClick={() => onSelect(node.path)} className={rowClasses(node.path, node.count)}>
            {node.name}
            <span className="ml-1.5 text-xs text-gray-400">{node.count}</span>
          </button>
        </div>
        {isOpen && node.children.length > 0 && (
          <ul className="mt-0.5 space-y-0.5">{node.children.map((child) => renderNode(child, depth + 1))}</ul>
        )}
      </li>
    )
  }

  // The same tree flattened, for the phone: a select costs one row of screen
  // where the tree costs one row per folder.
  const flatten = (nodes: TagNode[], depth = 0): Array<{ node: TagNode; depth: number }> =>
    nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)])

  return (
    <>
      <select
        value={selected}
        onChange={(event) => onSelect(event.target.value)}
        aria-label="Filter by folder"
        className="w-full rounded-md border border-indigo-200 bg-white px-2 py-2 text-sm text-gray-900 focus:border-indigo-400 focus:outline-none sm:hidden"
      >
        <option value="">All scores ({total})</option>
        {flatten(tree).map(({ node, depth }) => (
          <option key={node.path} value={node.path}>
            {`${'  '.repeat(depth)}${node.name} (${node.count})`}
          </option>
        ))}
      </select>

      <nav aria-label="Folders" className="hidden sm:block">
        <ul className="space-y-0.5">
          <li>
            <div className="flex items-center gap-1">
              <span className="w-4 shrink-0" />
              <button type="button" onClick={() => onSelect('')} className={rowClasses('', total)}>
                All scores
                <span className="ml-1.5 text-xs text-gray-400">{total}</span>
              </button>
            </div>
          </li>
          {tree.map((node) => renderNode(node, 0))}
        </ul>
      </nav>
    </>
  )
}
