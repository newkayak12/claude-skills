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

// ---- Bridge file: a handoff the mod (session/hooks/compact.tsx) wrote ahead for the command hook to print. ----
// The mod imports this file; it holds no import statement so it runs wherever the mod does.
// Path: <home>/.claude/session/handoff/<hashRoot(root)>.json. `root` is an absolute path with no trailing slash
// (path.resolve form), used as-is on both sides: the mod writes with its project root, the hook looks up each
// ancestor of stdin `cwd` (no realpath on either side).
// Record (makeBridgeRecord):
//   key        the mod's precomputeKey for the conversation the handoff covered
//   sessionId  the session the handoff was written in
//   ts         epoch ms when it was written
//   text       the handoff text
//   lastUuid   JSON `uuid` of the last transcript line the handoff covered
//   lineCount  1-based number of that transcript line (transcript lines[lineCount - 1] carries lastUuid)
// The PreCompact stdin field names (session_id, transcript_path, cwd, trigger, custom_instructions) are a default
// to revisit against the engine's types or a live run.

// Default to revisit: a handoff older than 7 days is stale.
export const BRIDGE_MAX_AGE_MS = 604800000

export const EXTEND_PREFACE = `Above is a handoff already written for this session up to an earlier point. Extend it with the turns that came after it: keep what still holds, update what changed, add what is new, and write the result in the sections below.
`

// 32-bit FNV-1a over char codes, 8-char lowercase hex.
export function hashRoot(root) {
  const s = String(root)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function handoffBridgePath(home, root) {
  return `${home}/.claude/session/handoff/${hashRoot(root)}.json`
}

export function makeBridgeRecord({ key, sessionId, ts, text, lastUuid, lineCount }) {
  return { key, sessionId, ts, text, lastUuid, lineCount }
}

// Fresh only when every field is proven: same session, young enough, and the transcript line the handoff ended on
// is still there with the same uuid. Anything absent or unproven is stale.
export function bridgeFresh(record, input, transcriptLines, now) {
  try {
    const r = record
    if (!r || typeof r !== 'object') return false
    if (typeof r.key !== 'string' || !r.key) return false
    if (typeof r.sessionId !== 'string' || typeof r.text !== 'string' || !r.text || typeof r.lastUuid !== 'string') return false
    if (typeof r.ts !== 'number' || !Number.isFinite(r.ts)) return false
    if (!Number.isInteger(r.lineCount) || r.lineCount < 1) return false
    if (typeof input?.session_id !== 'string' || !input.session_id || r.sessionId !== input.session_id) return false
    if (typeof input.transcript_path !== 'string' || !input.transcript_path) return false
    if (typeof now !== 'number' || !Number.isFinite(now)) return false
    const age = now - r.ts
    if (age < 0 || age > BRIDGE_MAX_AGE_MS) return false
    if (!Array.isArray(transcriptLines)) return false
    const line = transcriptLines[r.lineCount - 1]
    if (typeof line !== 'string') return false
    const row = JSON.parse(line)
    return !!row && typeof row === 'object' && row.uuid === r.lastUuid
  } catch {
    return false
  }
}

// '' = add nothing. Only an auto-compact, while smart-compact is on, that is not already smart-compact's own /compact.
// bridge = {record, lines, now}: a fresh one adds the stored handoff ahead of the static sections.
export function precompactInstructions(input, env, bridge) {
  if (input?.trigger !== 'auto') return ''
  if (env?.CLAUDE_PLUGIN_OPTION_SMART_COMPACT_ENABLED === 'false') return ''
  if (String(input.custom_instructions ?? '').trim().startsWith(COMPACT_MARK)) return ''
  if (bridge && bridgeFresh(bridge.record, input, bridge.lines, bridge.now)) {
    return `${bridge.record.text}\n\n${EXTEND_PREFACE}${RECAP_PROMPT}`
  }
  return RECAP_PROMPT
}
