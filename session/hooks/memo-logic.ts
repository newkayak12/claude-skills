// Pure core of the memo module: caps, the injected block, the age hint. No `$` in here.
export type Note = { text: string; ts: number }

export const MAX_NOTES = 8
export const MAX_CHARS = 280
export const MAX_TOTAL = 1200
export const AGE_DAYS = 14
export const HEADER = 'User pinned notes, authoritative, set by the user'
export const USAGE = 'usage: /memo add [--global] <text> | list | rm <n> | clear [--global]'

const DAY = 86_400_000

// A stored value that is not a list of { text, ts } is treated as empty, never thrown on.
export const clean = (v: unknown): Note[] =>
  Array.isArray(v) ? v.filter(n => n && typeof n.text === 'string' && typeof n.ts === 'number') : []

const total = (ns: Note[]) => ns.reduce((n, x) => n + x.text.length, 0)

// The refusal for adding `text`, or undefined when it fits. Caps count both scopes together.
export function refusal(g: Note[], p: Note[], text: string): string | undefined {
  if (g.length + p.length >= MAX_NOTES) return `refused: note limit ${MAX_NOTES} reached; /memo rm <n> first`
  if (text.length > MAX_CHARS) return `refused: ${text.length} chars; the limit is ${MAX_CHARS} per note`
  if (total(g) + total(p) + text.length > MAX_TOTAL) return `refused: total limit ${MAX_TOTAL} chars would be passed`
  return undefined
}

// Notes that fit the caps, whole, in order global then project. `cut` is true when some were left out.
export function visible(g: Note[], p: Note[]): { g: Note[]; p: Note[]; cut: boolean } {
  const out = { g: [] as Note[], p: [] as Note[] }
  let n = 0
  let chars = 0
  for (const [key, list] of [['g', g], ['p', p]] as const) {
    for (const note of list) {
      if (n + 1 > MAX_NOTES || chars + note.text.length > MAX_TOTAL) return { ...out, cut: true }
      out[key].push(note)
      n += 1
      chars += note.text.length
    }
  }
  return { ...out, cut: false }
}

export const noteLines = (g: Note[], p: Note[]) => [
  ...g.map(n => `[global] ${n.text}`),
  ...p.map(n => `[project] ${n.text}`),
]

// The exact block the model reads; '' when there is nothing to say.
export function render(g: Note[], p: Note[]): string {
  const v = visible(g, p)
  const lines = noteLines(v.g, v.p)
  return lines.length === 0 ? '' : [HEADER, ...lines].join('\n')
}

// Shown in the pane and in /memo list only; never part of the block.
export function ageHint(note: Note, now: number): string {
  const days = Math.floor((now - note.ts) / DAY)
  return days >= AGE_DAYS ? `${days}d old: move to CLAUDE.md?` : ''
}

export const tokens = (n: Note) => Math.ceil(n.text.length / 4)

export type Cmd =
  | { op: 'add'; global: boolean; text: string }
  | { op: 'list' | 'pane' }
  | { op: 'rm'; n: number }
  | { op: 'clear'; global: boolean }
  | { op: 'usage' }

export function parse(args: string): Cmd {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const tail = rest.join(' ')
  const global = rest[0] === '--global'
  switch (word) {
    case '': return { op: 'pane' }
    case 'list': return { op: 'list' }
    case 'add': {
      const text = (global ? rest.slice(1).join(' ') : tail).trim()
      return text ? { op: 'add', global, text } : { op: 'usage' }
    }
    case 'rm': {
      const n = Number(rest[0])
      return Number.isInteger(n) && n > 0 ? { op: 'rm', n } : { op: 'usage' }
    }
    case 'clear': return { op: 'clear', global }
    default: return { op: 'usage' }
  }
}
