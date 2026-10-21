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

// Whole days since the note was written; a note stamped in the future is 0 days old.
export const noteAge = (note: Note, now: number): number => Math.max(0, Math.floor((now - note.ts) / DAY))

export const isStale = (note: Note, now: number): boolean => noteAge(note, now) >= AGE_DAYS

export const ageLabel = (days: number): string => (days === 0 ? 'today' : days === 1 ? '1 day old' : `${days} days old`)

// `<n>/1200 chars`: the characters of `notes` against the cap over both scopes.
export const sizeLabel = (notes: Note[]): string => `${total(notes)}/${MAX_TOTAL} chars`

// Local HH:MM of when the block last went to the model; a dash before the first send.
export function sentLabel(sentAt?: number): string {
  if (!sentAt) return '—'
  const d = new Date(sentAt)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Shown in the pane and in /memo list only; never part of the block.
export function ageHint(note: Note, now: number): string {
  return isStale(note, now) ? `${noteAge(note, now)}d old: move to CLAUDE.md?` : ''
}

export const tokens = (n: Note) => Math.ceil(n.text.length / 4)

export type MemoRow = {
  n: number; scope: 'global' | 'project'; text: string; days: number; stale: boolean; age: string; hint: string; meta: string
}

// One row per note the block carries, numbered as `/memo list` and `/memo rm` number them.
export function memoRows(g: Note[], p: Note[], now: number): MemoRow[] {
  const v = visible(g, p)
  const row = (scope: MemoRow['scope'], note: Note, n: number): MemoRow => {
    const days = noteAge(note, now)
    const age = ageLabel(days)
    return { n, scope, text: note.text, days, stale: isStale(note, now), age, hint: ageHint(note, now), meta: `${n} · ${scope} · ${age}` }
  }
  return [...v.g.map(x => ['global', x] as const), ...v.p.map(x => ['project', x] as const)].map(([s, x], i) => row(s, x, i + 1))
}

// Everything the pane and /memo list show beyond the block itself: rows, counts, size, truncation.
export function facts(g: Note[], p: Note[], now: number, sentAt = 0) {
  const v = visible(g, p)
  const shown = [...v.g, ...v.p]
  const sent = sentLabel(sentAt)
  return {
    v,
    rows: memoRows(g, p, now),
    size: sizeLabel(shown),
    sent,
    summary: `sent with this conversation: ${sent} · ${sizeLabel(shown)}`,
    count: `${shown.length}/${MAX_NOTES} notes · ${sizeLabel(shown)} · ~${shown.reduce((n, x) => n + tokens(x), 0)} tok`,
    cut: v.cut ? 'truncated: the store is over its caps; only whole notes up to the caps are used' : '',
  }
}

// The pane's own wording, one function per fact it draws; the tsx renders what these return.
export const FOOTER_KEYS = '/memo add <text> · /memo rm <n> · /memo clear'
export const FOOTER_LEAD = `${FOOTER_KEYS} · Esc,`
export const FOOTER_TAIL = 'or /memo closes'
const BADGE_WIDTH = 'project'.length

export const AGE_WIDTH = 'today'.length

export const ageText = (days: number): string => (days === 0 ? 'today' : `${days}d`)

export const scopeBadge = (scope: 'global' | 'project'): string => scope.padEnd(BADGE_WIDTH)

export type MemoLine = { n: number; badge: string; text: string; age: string; stale: boolean }

// One line per note the block carries, numbered as `/memo list` and `/memo rm` number them.
export function memoLines(g: Note[], p: Note[], now: number): MemoLine[] {
  const v = visible(g, p)
  const all = [...v.g.map(n => ['global', n] as const), ...v.p.map(n => ['project', n] as const)]
  return all.map(([scope, note], i) => ({
    n: i + 1, badge: scopeBadge(scope), text: note.text, age: ageText(noteAge(note, now)).padStart(AGE_WIDTH), stale: isStale(note, now),
  }))
}

// The send time while the block is out in this conversation; a dash while it is armed to go out again.
export const sentText = (armed: boolean, sentAt?: number): string => (armed ? '—' : sentLabel(sentAt))

export function memoHeader(g: Note[], p: Note[], sent: { armed: boolean; sentAt?: number }): string {
  const v = visible(g, p)
  const shown = [...v.g, ...v.p]
  return `${shown.length} ${shown.length === 1 ? 'note' : 'notes'} · ${sizeLabel(shown)} · sent ${sentText(sent.armed, sent.sentAt)}`
}

// Stored notes the caps left out of the block; '' when none.
export function cutLine(g: Note[], p: Note[]): string {
  const v = visible(g, p)
  const left = g.length + p.length - v.g.length - v.p.length
  return left > 0 ? `+${left} not sent` : ''
}

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
