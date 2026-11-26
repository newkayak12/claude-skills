// Demo fixture for the teams pane and band: turns a drawn tree into the lines a terminal of `cols` columns shows.
// Test-only; mod.tsx never imports it. Same approach as session/hooks/demo-frames.ts (a row of cells; `wrap="truncate-end"`
// text and a `flexShrink` box give way, ending in `…`, the highest `flexShrink` first; a `flexGrow` box fills what is
// left), extended for what the teams pane draws: nested boxes, margins, gaps, `space-between`, `flex-end`, `flexWrap`,
// `height` and a Text that wraps. Widths are display cells (a Hangul or emoji glyph takes two), as a terminal shows them.
// Fictional data only.
type Node = { type?: string; props?: Record<string, any>; children?: (Node | string)[] }

// glyphs of a line; an ANSI SGR sequence (ESC [ ... m) is one zero-width token
const chars = (s: string): string[] => s.match(/\x1b\[[0-9;]*m|[\s\S]/gu) ?? []

// Display cells of a line: wide (CJK, emoji) glyphs take two, combining marks and SGR escapes none.
export const cells = (s: string): number =>
  chars(s).reduce((n, c) => {
    if (c.length > 1 && c.charCodeAt(0) === 0x1b) return n
    const p = c.codePointAt(0)!
    if (p === 0x200d || (p >= 0x300 && p <= 0x36f) || (p >= 0xfe00 && p <= 0xfe0f)) return n
    const wide = (p >= 0x1100 && p <= 0x115f) || (p >= 0x2e80 && p <= 0xa4cf) || (p >= 0xac00 && p <= 0xd7a3) || (p >= 0xf900 && p <= 0xfaff) ||
      (p >= 0xfe30 && p <= 0xfe6f) || (p >= 0xff00 && p <= 0xff60) || (p >= 0xffe0 && p <= 0xffe6) || (p >= 0x1f300 && p <= 0x1faff)
    return n + (wide ? 2 : 1)
  }, 0)

const len = cells

// how many glyphs of `c` fit in `w` cells, never splitting a glyph
const fitCount = (c: string[], w: number): number => {
  let used = 0
  let i = 0
  for (; i < c.length; i++) {
    const cw = cells(c[i]!)
    if (used + cw > w) break
    used += cw
  }
  return i
}

export const fit = (s: string, w: number): string => {
  if (cells(s) <= w) return s
  const c = chars(s)
  const cut = `${c.slice(0, fitCount(c, Math.max(0, w - 1))).join('').trimEnd()}…`
  return cut.includes('\x1b') ? `${cut}${RESET}` : cut
}

// ANSI colour: set only by frame(..., { ansi: true }); theme key -> fixed SGR code
const RESET = '\x1b[0m'
const THEME_SGR: Record<string, string> = {
  text: '39', inactive: '90', subtle: '90', success: '32', error: '31', warning: '33',
  claude: '38;5;173', suggestion: '38;5;105', permission: '38;5;105',
}
let ansiOn = false
const sgr = (codes: string[]) => (codes.length ? `\x1b[${codes.join(';')}m` : '')
const styleOf = (p: Record<string, any> | undefined, colorKey = 'color', dimKey = 'dimColor'): string[] => [
  ...(p?.bold ? ['1'] : []),
  ...(p?.[dimKey] ? ['2'] : []),
  ...(p?.[colorKey] && THEME_SGR[p[colorKey]] ? [THEME_SGR[p[colorKey]]!] : []),
]

// the text of a node; with ANSI on, a styled Text is wrapped in its SGR run and the outer style is re-applied after it
const textOf = (n: Node | string, outer = ''): string => {
  if (typeof n === 'string') return n
  if (n.type === 'Input') return String(n.props?.value || n.props?.placeholder || '')
  const kids = n.children ?? []
  if (n.type === 'Button') {
    if (ansiOn && kids.length > 0) return kids.map(k => textOf(k, outer)).join('')
    const label = n.props?.label
    if (label !== undefined && label !== null) return String(label)
    return kids.map(k => textOf(k, outer)).join('')
  }
  const own = ansiOn && n.type === 'Text' ? sgr(styleOf(n.props)) : ''
  const inner = kids.map(k => textOf(k, outer + own)).join('')
  return own ? `${own}${inner}${RESET}${outer}` : inner
}

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
    const c = chars(rest)
    const n = Math.max(1, fitCount(c, w))
    const at = c.slice(0, n).lastIndexOf(' ')
    const cut = at > 0 ? at : n
    out.push(c.slice(0, cut).join(''))
    rest = c.slice(cut).join('').trimStart()
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

const BORDERS: Record<string, string[]> = {
  single: ['┌', '─', '┐', '│', '└', '┘'],
  round: ['╭', '─', '╮', '│', '╰', '╯'],
  double: ['╔', '═', '╗', '║', '╚', '╝'],
  bold: ['┏', '━', '┓', '┃', '┗', '┛'],
}

// A Box with `borderStyle` below the root: top and bottom lines and │ sides, 2 cols and 2 rows of chrome, `paddingX`
// each side. It fills the width it is given (as a column child does); `fill` false (a row child) takes its content's width.
function boxed(n: Node, cols: number, fill: boolean): string[] {
  const [tl, hz, tr, vt, bl, br] = BORDERS[String(n.props?.borderStyle)] ?? BORDERS.single!
  const px = num(n.props?.paddingX ?? n.props?.padding)
  const avail = Math.max(1, cols - 2 - 2 * px)
  const kids = (n.children ?? []).filter(k => k !== '' && k !== undefined && k !== null)
  const lines = n.props?.flexDirection === 'column' ? kids.flatMap(k => block(k, avail)) : rowOf(n, kids, avail)
  const h = n.props?.height
  const body = h !== undefined ? lines.slice(0, Math.max(0, num(h) - 2)) : lines
  const w = fill ? Math.max(avail, widthOf(body)) : widthOf(body)
  const edge = (s: string) => {
    const codes = ansiOn ? sgr(styleOf(n.props, 'borderColor', 'borderDimColor')) : ''
    return codes ? `${codes}${s}${RESET}` : s
  }
  const side = edge(vt!)
  const padx = ' '.repeat(px)
  return [
    edge(`${tl}${hz!.repeat(w + 2 * px)}${tr}`),
    ...body.map(l => `${side}${padx}${pad(l, w)}${padx}${side}`),
    edge(`${bl}${hz!.repeat(w + 2 * px)}${br}`),
  ]
}

function content(n: Node | string, cols: number, fill = true): string[] {
  if (typeof n === 'string') return wrapText(n, cols)
  if (n.type === 'Text') return n.props?.wrap === 'truncate-end' || n.props?.wrap === 'truncate' ? [fit(textOf(n), cols)] : wrapText(textOf(n), cols)
  if (n.type === 'Button' || n.type === 'Input') return [fit(textOf(n), cols)]
  if (n.props?.borderStyle) return boxed(n, cols, fill)
  const kids = (n.children ?? []).filter(k => k !== '' && k !== undefined && k !== null)
  const lines = n.props?.flexDirection === 'column' ? kids.flatMap(k => block(k, cols)) : rowOf(n, kids, cols)
  const h = n.props?.height
  return h !== undefined ? lines.slice(0, num(h)) : lines
}

function rowOf(n: Node, kids: (Node | string)[], cols: number): string[] {
  if (kids.length === 0) return []
  const gap = num(n.props?.columnGap ?? n.props?.gap)
  const space = (c: Node | string) => marginL(c) + marginR(c)
  const blocks = kids.map(k => content(k, cols - space(k), false))
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
    blocks[i] = content(kids[i]!, w, false)
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

// The lines as laid out, not clipped: a line wider than `cols` stays wider, so a test can see it.
// The root node is laid out without its own border (frame() draws the pane border); only borders below it are boxes.
export function draw(n: Node | string, cols: number): string[] {
  const root = typeof n === 'string' || !n.props?.borderStyle ? n : { ...n, props: { ...n.props, borderStyle: undefined } }
  return block(root, cols)
}

// The frame a pane sits in: a rounded border, body width = cols - 4. `{ ansi: true }` colours Text runs with SGR codes.
export function frame(tree: Node, title: string, cols: number, opts?: { ansi?: boolean }): string[] {
  const before = ansiOn
  ansiOn = opts?.ansi === true
  try {
    const body = draw(tree, cols - 4)
    const top = `╭─ ${title} ${'─'.repeat(Math.max(0, cols - len(title) - 5))}╮`
    return [top, ...body.map(l => `│ ${l}${' '.repeat(Math.max(0, cols - 4 - len(l)))} │`), `╰${'─'.repeat(cols - 2)}╯`]
  } finally {
    ansiOn = before
  }
}
