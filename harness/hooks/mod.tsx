import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Decision } from '../types'

const last = atom({ plugin: 'harness', key: 'last' } as const, null as Decision | null)
const armed = atom({ plugin: 'harness', key: 'armed' } as const, false)
const patterns = atom({ plugin: 'harness', key: 'patterns' } as const, [] as string[])
const windowHours = atom({ plugin: 'harness', key: 'windowHours' } as const, 2)

const PANE = 'harness-gate'
const CONFIG = '.claude/harness-gate.json'
const DECISION = '.claude/.harness-last-decision.json'
const TICK_MS = 5000
const RECENT_MS = 10 * 60 * 1000

// the deny() message of hooks/goal-gate.mjs, after the gated paths
const ENGAGE =
  'Engage the harness before editing it: invoke the harness skill and follow its Process - ' +
  'the graph MCP, the Workflow engine, or an Agent Team fallback run whose plan, goal-spec and ' +
  'sound critique are on disk. A mention in text does not engage it.'

// an unparseable or partial decision file is no decision
function parseDecision(text: string): Decision | null {
  try {
    const d = JSON.parse(text) as Partial<Decision> | null
    if (d === null || typeof d !== 'object') return null
    if (typeof d.ts !== 'number' || typeof d.tool !== 'string' || typeof d.target !== 'string') return null
    if (d.decision !== 'allow' && d.decision !== 'deny') return null
    return { ts: d.ts, session_id: d.session_id, tool: d.tool, target: d.target, decision: d.decision, reason: typeof d.reason === 'string' ? d.reason : '' }
  } catch {
    return null
  }
}

const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000))
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)

    async function tick() {
      try {
        if (!(await $.fs.exists(CONFIG))) {
          await update($, armed, () => false)
          await update($, last, () => null)
          $.ui.status(undefined)
          return
        }
        const cfg = JSON.parse(await $.fs.read(CONFIG)) as { patterns?: unknown; window_hours?: unknown }
        const list = Array.isArray(cfg.patterns) ? cfg.patterns.map(String) : []
        const hours = Number(cfg.window_hours) > 0 ? Number(cfg.window_hours) : 2
        let decision: Decision | null = null
        if (await $.fs.exists(DECISION)) decision = parseDecision(await $.fs.read(DECISION))
        await update($, patterns, () => list)
        await update($, windowHours, () => hours)
        await update($, armed, () => true)
        await update($, last, () => decision)
        const now = await $.clock.now()
        if (decision !== null && decision.decision === 'deny' && now - decision.ts < RECENT_MS) {
          $.ui.status(`gate: denied ${decision.target} — /harness-gate`)
        } else {
          $.ui.status(`gate: armed (${list.length} patterns)`)
        }
      } catch {
        // a read error leaves the status as it was
      }
    }

    await $.command.register({
      name: 'harness-gate',
      description: 'Why the harness gate denied the last call, and how to engage it',
    })
    await tick()
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  // asked for by the person: the pane seats at any width
  on('command.run', { command: 'harness-gate' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Harness gate' })
    return { text: 'harness-gate: pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    if (!(await read($, armed))) {
      return (
        <Box flexDirection="column">
          <Text>No gate configured: .claude/harness-gate.json is not in this project.</Text>
        </Box>
      )
    }
    const list = await read($, patterns)
    const hours = await read($, windowHours)
    const d = await read($, last)
    const now = await $.clock.now()
    return (
      <Box flexDirection="column">
        <Text>{`Gated patterns (${list.length}): ${list.join(', ')}`}</Text>
        <Text>{`Engagement window: ${hours} h`}</Text>
        {d === null ? (
          <Text>No gated call decided yet.</Text>
        ) : (
          <Box flexDirection="column">
            <Text>{`Last decision: ${d.decision} (${d.tool} ${d.target}, ${ago(now - d.ts)})`}</Text>
            <Text>{`Reason: ${d.reason}`}</Text>
          </Box>
        )}
        <Text>{ENGAGE}</Text>
      </Box>
    )
  })
}
