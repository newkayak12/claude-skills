// What smart-compact asks of the engine's own summarizer on an auto-compact. Pure: no I/O.
// COMPACT_MARK and RECAP_PROMPT are copies of session/hooks/compact-logic.ts and recap.ts; test-precompact.mjs
// fails when they drift.

export const COMPACT_MARK = 'smart-compact handoff'

export const RECAP_PROMPT = `Write a recap of this session that a fresh context can continue from. Use the session's language.
Keep only what the next steps need; leave out finished work they do not depend on.
Sections:
1. Goal: what the user is trying to achieve
2. Direction: the next concrete steps, in order
3. In progress: what was being done when this recap was written — file:line, the exact snippet or error text the next step needs
4. Decisions: what was settled that the next steps must respect, with the reason; finished work only as one line with its commit
5. Open: unfinished work and known problems not covered by Direction
6. Corrections: things the user had to correct more than once, one per line starting with "- "; write "- none" if there were none
Plain text, no preamble.`

// '' = add nothing. Only an auto-compact, while smart-compact is on, that is not already smart-compact's own /compact.
export function precompactInstructions(input, env) {
  if (input?.trigger !== 'auto') return ''
  if (env?.CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED === 'false') return ''
  if (String(input.custom_instructions ?? '').trim().startsWith(COMPACT_MARK)) return ''
  return RECAP_PROMPT
}
