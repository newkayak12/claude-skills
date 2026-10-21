// Demo fixture for the Memo and Guard panes: turns a drawn tree into the lines a terminal of `cols` columns shows.
// Test-only; the module never imports it. It mimics Ink: a row of cells, `wrap="truncate-end"` text and a
// `flexShrink` box give way (ending in `…`), a `flexGrow` box fills what is left, everything else keeps its width.
// Fictional data only.
type Node = { type?: string; props?: Record<string, any>; children?: (Node | string)[] }

const chars = (s: string) => Array.from(s)
export const fit = (s: string, w: number): string => {
  const c = chars(s)
  return c.length <= w ? s : `${c.slice(0, Math.max(0, w - 1)).join('')}…`
}

const textOf = (n: Node | string): string =>
  typeof n === 'string' ? n : n.type === 'Button' ? String(n.props?.label ?? '') : (n.children ?? []).map(textOf).join('')

const shrinks = (n: Node | string): boolean =>
  typeof n !== 'string' && (n.props?.wrap === 'truncate-end' || n.props?.flexShrink !== undefined || (n.children ?? []).some(shrinks))

function row(cells: (Node | string)[], gap: number, cols: number): string {
  const parts = cells.map(textOf)
  const total = () => parts.reduce((n, s) => n + chars(s).length, 0) + gap * (parts.length - 1)
  const flex = cells.map((c, i) => (shrinks(c) ? i : -1)).filter(i => i >= 0)
  for (const i of flex.reverse()) {
    const over = total() - cols
    if (over <= 0) break
    parts[i] = fit(parts[i]!, Math.max(1, chars(parts[i]!).length - over))
  }
  // a `flexGrow` box takes the width left over, so the cells after it start at the same column on every row
  const grow = cells.findIndex(c => typeof c !== 'string' && c.props?.flexGrow)
  if (grow >= 0 && total() < cols) parts[grow] = parts[grow]!.padEnd(chars(parts[grow]!).length + cols - total())
  return fit(parts.join(' '.repeat(gap)), cols)
}

export function draw(n: Node | string, cols: number): string[] {
  if (typeof n === 'string') return [fit(n, cols)]
  if (n.type === 'Text' || n.type === 'Button') return [fit(textOf(n), cols)]
  const kids = n.children ?? []
  if (n.props?.flexDirection === 'column') return kids.flatMap(k => draw(k, cols))
  return [row(kids, Number(n.props?.gap ?? 0), cols)]
}

// The frame a pane sits in: a rounded border, body width = cols - 4.
export function frame(tree: Node, title: string, cols: number): string[] {
  const body = draw(tree, cols - 4)
  const top = `╭─ ${title} ${'─'.repeat(Math.max(0, cols - chars(title).length - 5))}╮`
  return [top, ...body.map(l => `│ ${l}${' '.repeat(cols - 4 - chars(l).length)} │`), `╰${'─'.repeat(cols - 2)}╯`]
}
