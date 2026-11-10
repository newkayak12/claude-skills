// Pure decisions of smart-compact; compact.tsx renders and acts on what these return.

export type CompactState = { isRunning: boolean; agentId?: string; surfaces: number }
export type CompactDecision = 'below' | 'run' | 'skipped:running' | 'skipped:agent' | 'skipped:headless'

// At or above the threshold runs; a sub-agent, a run in flight and a headless session never do.
export const shouldCompactNow = (percent: number, threshold: number, state: CompactState): CompactDecision => {
  if (state.agentId) return 'skipped:agent'
  if (state.isRunning) return 'skipped:running'
  if (state.surfaces <= 0) return 'skipped:headless'
  return percent < threshold ? 'below' : 'run'
}

export const firstLine = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).split('\n')[0]!

// smart-compact runs `/compact <COMPACT_MARK>`: a /compact the engine raises reaches this plugin's own
// session.compact hook, where a $.session.compact call from the plugin would skip it.
export const COMPACT_MARK = 'smart-compact handoff'

// Which compactions get a handoff: the engine's auto-compact and smart-compact's own /compact.
// A person's /compact and a subagent's compaction stay the engine's.
export type HandoffFor = 'auto' | 'own' | null
export const handoffFor = (e: { trigger?: string; instructions?: string; agentId?: string }): HandoffFor => {
  if (e.agentId) return null
  if (e.trigger === 'auto') return 'auto'
  return e.trigger === 'manual' && e.instructions?.trim() === COMPACT_MARK ? 'own' : null
}

export const RECAP_HEADER =
  'Recap of the conversation before compaction. The messages after this one are the latest conversation, verbatim.\n\n'

// The rows a tail is cut from: SessionMessage, structurally.
export type TailRow = {
  role: 'user' | 'assistant'
  text: string
  toolUses: { tool_use_id: string; input?: unknown }[]
  toolResults?: { tool_use_id: string; text: string }[]
  handle?: string
}

// Tokens the tail may carry: a share of the window, at most 20%, half the threshold.
export const tailBudget = (window: number, threshold: number): number =>
  Math.floor((window * Math.min(20, threshold / 2)) / 100)

// chars/3 over text, tool_use input and tool_result text; a tool_use's result/text repeats toolResults.
const rowTokens = (row: TailRow): number => {
  let chars = row.text.length
  for (const u of row.toolUses) chars += (JSON.stringify(u.input) ?? '').length
  for (const r of row.toolResults ?? []) chars += r.text.length
  return Math.ceil(chars / 3)
}

// First row of the verbatim tail: newest rows within budget, with no tool_result whose tool_use is cut off.
export const tailStart = (rows: readonly TailRow[], budget: number): number => {
  let start = rows.length
  let sum = 0
  while (start > 0) {
    sum += rowTokens(rows[start - 1]!)
    if (sum > budget) break
    start--
  }
  for (let moved = true; moved; ) {
    moved = false
    const uses = new Set<string>()
    for (let i = start; i < rows.length; i++) for (const u of rows[i]!.toolUses) uses.add(u.tool_use_id)
    for (let i = rows.length - 1; i >= start; i--) {
      if ((rows[i]!.toolResults ?? []).some((r) => !uses.has(r.tool_use_id))) {
        start = i + 1
        moved = true
        break
      }
    }
  }
  return start
}
