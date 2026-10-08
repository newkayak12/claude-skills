// The recap smart-compact and /handoff make, and what is kept of it. Pure: callers do the $ calls.

export const RECAP_PROMPT = `Write a recap of this session that a fresh context can continue from. Use the session's language. Sections:
1. Goal: what the user is trying to achieve
2. Decisions: what was settled, with the reason
3. State: what is done, files touched, what is verified
4. Open: unfinished work, known problems
5. Direction: the next concrete steps
6. Corrections: things the user had to correct more than once, one per line starting with "- "; write "- none" if there were none
Plain text, no preamble.`

export type Recap = { text: string; ts: number; sessionId: string }

export const RECAP_MAX = 8000
export const LESSONS_MAX = 20
export const RECAP_FRESH_MS = 7 * 24 * 60 * 60 * 1000

export const recapKey = (root: string) => `recap.project:${root}`
export const lessonsKey = (root: string) => `lessons.project:${root}`

export const makeRecap = (text: string, ts: number, sessionId: string): Recap => ({
  text: text.length > RECAP_MAX ? `${text.slice(0, RECAP_MAX)}\n…(cut)` : text,
  ts,
  sessionId,
})

export const isFresh = (r: Recap | undefined, now: number): r is Recap =>
  r !== undefined && typeof r.text === 'string' && now - r.ts < RECAP_FRESH_MS

// The "- " lines under the Corrections heading, up to the next numbered heading; "none" is dropped.
export function corrections(text: string): string[] {
  const lines = text.split('\n')
  const start = lines.findIndex(l => /^\s*(6\.|#+)?\s*\**\s*corrections\b/i.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\d+\.\s/.test(line)) break
    const m = line.match(/^\s*[-*]\s+(.+?)\s*$/)
    if (m && !/^none\.?$/i.test(m[1]!)) out.push(m[1]!)
  }
  return out
}

// Newest last; an exact duplicate is not added twice; the oldest go past the cap.
export function mergeLessons(kept: readonly string[], fresh: readonly string[]): string[] {
  const out = [...kept]
  for (const l of fresh) if (!out.includes(l)) out.push(l)
  return out.slice(-LESSONS_MAX)
}

export const fmtAgo = (ms: number): string => {
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}
