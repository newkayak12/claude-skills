// Demo fixture for the teams pane and band: turns a drawn tree into the lines a terminal of `cols` columns shows.
// Test-only; mod.tsx never imports it. Same approach as session/hooks/demo-frames.ts (a row of cells; `wrap="truncate-end"`
// text and a `flexShrink` box give way, ending in `…`, the highest `flexShrink` first; a `flexGrow` box fills what is
// left), extended for what the teams pane draws: nested boxes, margins, gaps, `space-between`, `flex-end`, `flexWrap`,
// `height` and a Text that wraps. Fictional data only.
type Node = { type?: string; props?: Record<string, any>; children?: (Node | string)[] }

const chars = (s: string) => Array.from(s)
const len = (s: string) => chars(s).length
export const fit = (s: string, w: number): string => {
  const c = chars(s)
  return c.length <= w ? s : `${c.slice(0, Math.max(0, w - 1)).join('').trimEnd()}…`
}

const textOf = (n: Node | string): string =>
  typeof n === 'string' ? n : n.type === 'Button' ? String(n.props?.label ?? '') : n.type === 'Input' ? String(n.props?.value || n.props?.placeholder || '') : (n.children ?? []).map(textOf).join('')

const num = (v: unknown) => Number(v ?? 0) || 0
const marginL = (n: Node | string) => (typeof n === 'string' ? 0 : num(n.props?.marginLeft ?? n.props?.marginX ?? n.props?.margin))
const marginR = (n: Node | string) => (typeof n === 'string' ? 0 : num(n.props?.marginRight ?? n.props?.marginX ?? n.props?.margin))
const marginT = (n: Node | string) => (typeof n === 'string' ? 0 : num(n.props?.marginTop ?? n.props?.marginY ?? n.props?.margin))
const marginB = (n: Node | string) => (typeof n === 'string' ? 0 : num(n.props?.marginBottom ?? n.props?.marginY ?? n.props?.margin))

const shrinks = (n: Node | string): boolean =>
  typeof n !== 'string' && (n.props?.wrap === 'truncate-end' || num(n.props?.flexShrink) > 0 || (n.children ?? []).some(shrinks))

// a Text that is not told to truncate wraps at the width, as Ink does
function wrapText(s: string, w: number): string[] {
  if (len(s) <= w) return [s]
  const out: string[] = []
  let rest = s
  while (len(rest) > w) {
    const head = chars(rest).slice(0, w).join('')
    const at = head.lastIndexOf(' ')
    const cut = at > 0 ? at : w
    out.push(chars(rest).slice(0, cut).join(''))
    rest = chars(rest).slice(cut).join('').trimStart()
  }
  return [...out, rest]
}

const widthOf = (b: string[]) => b.reduce((n, l) => Math.max(n, len(l)), 0)
const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - len(s)))

// the lines a node takes at a width of `cols`, its top and bottom margins included
function block(n: Node | string, cols: number): string[] {
  const inner = Math.max(1, cols - marginL(n) - marginR(n))
  const lines = content(n, inner)
  const indent = ' '.repeat(marginL(n))
  const body = indent ? lines.map(l => indent + l) : lines
  return [...Array(marginT(n)).fill(''), ...body, ...Array(marginB(n)).fill('')]
}

function content(n: Node | string, cols: number): string[] {
  if (typeof n === 'string') return wrapText(n, cols)
  if (n.type === 'Text') return n.props?.wrap === 'truncate-end' || n.props?.wrap === 'truncate' ? [fit(textOf(n), cols)] : wrapText(textOf(n), cols)
  if (n.type === 'Button' || n.type === 'Input') return [fit(textOf(n), cols)]
  const kids = (n.children ?? []).filter(k => k !== '' && k !== undefined && k !== null)
  const lines = n.props?.flexDirection === 'column' ? kids.flatMap(k => block(k, cols)) : rowOf(n, kids, cols)
  const h = n.props?.height
  return h !== undefined ? lines.slice(0, num(h)) : lines
}

function rowOf(n: Node, kids: (Node | string)[], cols: number): string[] {
  if (kids.length === 0) return []
  const gap = num(n.props?.columnGap ?? n.props?.gap)
  const space = (c: Node | string) => marginL(c) + marginR(c)
  const blocks = kids.map(k => content(k, cols - space(k)))
  const widths = kids.map((k, i) => widthOf(blocks[i]!) + space(k))
  const total = () => widths.reduce((s, w) => s + w, 0) + gap * (kids.length - 1)
  if (n.props?.flexWrap === 'wrap' && total() > cols) return wrapRow(kids, blocks, widths, gap, cols)
  // give way: the highest `flexShrink` first, the last first among equals; pinned boxes keep their width
  const weight = (c: Node | string) => (typeof c !== 'string' && num(c.props?.flexShrink) > 0 ? num(c.props!.flexShrink) : 1)
  const order = kids.map((c, i) => (shrinks(c) ? i : -1)).filter(i => i >= 0).reverse().sort((a, b) => weight(kids[b]!) - weight(kids[a]!))
  for (const i of order) {
    const over = total() - cols
    if (over <= 0) break
    const w = Math.max(1, widths[i]! - space(kids[i]!) - over)
    blocks[i] = content(kids[i]!, w)
    widths[i] = widthOf(blocks[i]!) + space(kids[i]!)
  }
  // the room left: a `flexGrow` box takes it all, else `space-between` spreads it between the boxes
  const left = cols - total()
  let between = gap
  const grow = kids.findIndex(c => typeof c !== 'string' && c.props?.flexGrow)
  if (left > 0 && grow >= 0) {
    const w = widthOf(blocks[grow]!) + left
    const k = kids[grow] as Node
    blocks[grow] = k.props?.justifyContent === 'flex-end' ? content(k, w).map(l => ' '.repeat(Math.max(0, w - len(l))) + l) : content(k, w).map(l => pad(l, w))
    widths[grow] = w + space(k)
  } else if (left > 0 && n.props?.justifyContent === 'space-between' && kids.length > 1) {
    between = gap + Math.floor(left / (kids.length - 1))
  }
  const height = Math.max(...blocks.map(b => b.length))
  return Array.from({ length: height }, (_, y) =>
    kids.map((k, i) => ' '.repeat(marginL(k)) + pad(blocks[i]![y] ?? '', widths[i]! - space(k)) + ' '.repeat(marginR(k))).join(' '.repeat(between)))
}

// `flexWrap="wrap"`: the boxes break onto the next line when they no longer fit
function wrapRow(kids: (Node | string)[], blocks: string[][], widths: number[], gap: number, cols: number): string[] {
  const rows: number[][] = [[]]
  let used = 0
  kids.forEach((_, i) => {
    const next = used + (rows[rows.length - 1]!.length > 0 ? gap : 0) + widths[i]!
    if (next > cols && rows[rows.length - 1]!.length > 0) {
      rows.push([i])
      used = widths[i]!
    } else {
      rows[rows.length - 1]!.push(i)
      used = next
    }
  })
  return rows.flatMap(r => {
    const height = Math.max(...r.map(i => blocks[i]!.length))
    return Array.from({ length: height }, (_, y) => r.map(i => pad(blocks[i]![y] ?? '', widths[i]!)).join(' '.repeat(gap)))
  })
}

// Display cells of a line: wide (CJK, emoji) glyphs take two, combining marks none.
export const cells = (s: string): number =>
  chars(s).reduce((n, c) => {
    const p = c.codePointAt(0)!
    if (p === 0x200d || (p >= 0x300 && p <= 0x36f) || (p >= 0xfe00 && p <= 0xfe0f)) return n
    const wide = (p >= 0x1100 && p <= 0x115f) || (p >= 0x2e80 && p <= 0xa4cf) || (p >= 0xac00 && p <= 0xd7a3) || (p >= 0xf900 && p <= 0xfaff) ||
      (p >= 0xfe30 && p <= 0xfe6f) || (p >= 0xff00 && p <= 0xff60) || (p >= 0xffe0 && p <= 0xffe6) || (p >= 0x1f300 && p <= 0x1faff)
    return n + (wide ? 2 : 1)
  }, 0)

// The lines as laid out, not clipped: a line wider than `cols` stays wider, so a test can see it.
export function draw(n: Node | string, cols: number): string[] {
  return block(n, cols)
}

// The frame a pane sits in: a rounded border, body width = cols - 4.
export function frame(tree: Node, title: string, cols: number): string[] {
  const body = draw(tree, cols - 4)
  const top = `╭─ ${title} ${'─'.repeat(Math.max(0, cols - len(title) - 5))}╮`
  return [top, ...body.map(l => `│ ${l}${' '.repeat(Math.max(0, cols - 4 - len(l)))} │`), `╰${'─'.repeat(cols - 2)}╯`]
}
