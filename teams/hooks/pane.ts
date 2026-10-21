/*
 * Pure helpers of the teams pane: which key does what, how a step moves, where the selection goes when
 * its task leaves the list. No engine, no drawing: mod.tsx reads state and calls these.
 */

// `[` / `]` step the EPIC, `j` / `k` the STORY row, `g` opens the row's run. Digits and q are Button hotkeys, so they
// are not read here (a key would fire twice). Any other text, none, or a non-string is no key.
export type PaneKey = { kind: 'step'; by: 1 | -1 } | { kind: 'row'; by: 1 | -1 } | { kind: 'open' } | null

export function paneKey(text: unknown): PaneKey {
  if (typeof text !== 'string' || text === '') return null
  const k = [...text].pop()!
  if (k === ']') return { kind: 'step', by: 1 }
  if (k === '[') return { kind: 'step', by: -1 }
  if (k === 'j') return { kind: 'row', by: 1 }
  if (k === 'k') return { kind: 'row', by: -1 }
  if (k === 'g') return { kind: 'open' }
  return null
}

// one step inside 0..count-1: it stops at the ends, never wraps
export function stepClamp(index: number, by: number, count: number): number {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, index + by))
}

// The selected id after a new list arrives. Still listed: it stays. Gone: the nearest id of the previous list that
// is still listed (the later one first on a tie), else the first listed. Nothing selected yet: the first listed.
export function fallbackSelection(previous: readonly string[], ids: readonly string[], selected: string | null): string | null {
  if (ids.length === 0) return selected
  if (selected !== null && ids.includes(selected)) return selected
  const at = selected === null ? -1 : previous.indexOf(selected)
  if (at >= 0) {
    for (let d = 1; d < previous.length; d += 1) {
      for (const i of [at + d, at - d]) {
        const id = previous[i]
        if (id !== undefined && ids.includes(id)) return id
      }
    }
  }
  return ids[0]!
}

// the STORY rows of every listed task, in list order, each with the task it belongs to
export function storyRows<T extends { items: readonly I[] }, I>(tasks: readonly T[]): { entry: T; item: I }[] {
  return tasks.flatMap(entry => entry.items.map(item => ({ entry, item })))
}
