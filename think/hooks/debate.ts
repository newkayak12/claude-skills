/*
 * Reads a brainstorming debate log (.claude/brainstorming/<slug>.jsonl, written by the
 * think:brainstorming skill, references/debate.md). Plain functions; the mod only draws them.
 */
import type { Debate, Line, Option } from '../types'

const FOR = new Set(['rebut', 'support'])

// one JSON object per line; a torn or foreign line is skipped
export function parse(body: string): Line[] {
  const out: Line[] = []
  for (const raw of body.split('\n')) {
    if (raw.trim() === '') continue
    try {
      const o = JSON.parse(raw) as Record<string, unknown>
      if (typeof o.kind !== 'string' || typeof o.persona !== 'string') continue
      out.push({
        ts: typeof o.ts === 'string' ? o.ts : '',
        round: typeof o.round === 'number' ? o.round : 0,
        persona: o.persona,
        to: typeof o.to === 'string' ? o.to : '',
        kind: o.kind,
        text: typeof o.text === 'string' ? o.text : '',
      })
    } catch {
      // skip
    }
  }
  return out
}

// 1 diverge (personas, options, merge) · 2 attack/rebut · 3 cut/result
const phaseOf = (kind: string): 1 | 2 | 3 =>
  kind === 'attack' || FOR.has(kind) ? 2 : kind === 'cut' || kind === 'result' || kind === 'fallback' ? 3 : 1

export function summarize(lines: Line[]): Debate {
  const personas: string[] = []
  for (const l of lines) if (l.persona !== 'Claude' && !personas.includes(l.persona)) personas.push(l.persona)
  // merged options win; before the merge, the personas' own proposals
  const merged = lines.filter(l => l.kind === 'merge' && l.to !== '')
  const source = merged.length > 0 ? merged : lines.filter(l => l.kind === 'option' && l.to !== '')
  const options: Option[] = []
  for (const l of source) if (!options.some(o => o.id === l.to)) options.push({ id: l.to, title: l.text, by: l.persona, pros: 0, cons: 0, cut: null })
  for (const l of lines) {
    const o = options.find(x => x.id === l.to)
    if (o === undefined) continue
    if (l.kind === 'attack') o.cons += 1
    else if (FOR.has(l.kind)) o.pros += 1
    else if (l.kind === 'cut') o.cut = l.text
  }
  const last = lines.at(-1)
  const end = [...lines].reverse().find(l => l.kind === 'result' || l.kind === 'fallback')
  const ended = end !== undefined
  return {
    lines,
    personas,
    options,
    phase: lines.reduce<1 | 2 | 3>((p, l) => Math.max(p, phaseOf(l.kind)) as 1 | 2 | 3, 1),
    speaking: ended || last === undefined ? null : last.persona,
    ended,
    result: end?.text ?? null,
    fallback: end?.kind === 'fallback',
  }
}

export const byPersona = (lines: Line[], who: string | null) => (who === null ? lines : lines.filter(l => l.persona === who))

// a window of `rows` lines starting at `offset`, the offset clamped to the list
export function page<T>(items: T[], offset: number, rows: number): { items: T[]; offset: number } {
  const max = Math.max(0, items.length - rows)
  const at = Math.min(max, Math.max(0, offset))
  return { items: items.slice(at, at + rows), offset: at }
}

// the newest .jsonl in the folder listing
export function newest<F extends { name: string; kind: string; mtimeMs: number }>(entries: F[]): F | undefined {
  return entries.filter(f => f.kind === 'file' && f.name.endsWith('.jsonl')).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
}
