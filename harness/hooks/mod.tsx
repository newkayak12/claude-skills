import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision } from '../types'

const last = atom({ plugin: 'harness', key: 'last' } as const, null as Decision | null)
const armed = atom({ plugin: 'harness', key: 'armed' } as const, false)
const patterns = atom({ plugin: 'harness', key: 'patterns' } as const, [] as string[])
const windowHours = atom({ plugin: 'harness', key: 'windowHours' } as const, 2)

const PANE = 'harness-gate'
const CONFIG = '.claude/harness-gate.json'
const DECISION = '.claude/.harness-last-decision.json'
const TICK_MS = 5000

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

// Open runs per stage, in flow order: fallback runs (.harness-run/<slug>/, the stage rule of
// mods/hooks/runs.mjs) and graph runs (.harness-run/broker/runs/<id>.json), every worktree.
const STAGES = ['plan', 'setgoal', 'critique', 'implement', 'test', 'gate', 'report'] as const
type Stage = (typeof STAGES)[number]
// A run untouched for 12 h is abandoned, not open.
const STALE_MS = 12 * 60 * 60 * 1000
const FINISHED = new Set(['done', 'skipped', 'unreachable'])

export type StageCounts = { harness: Partial<Record<Stage, number>>; graph: Partial<Record<Stage, number>> }

const label = (s: Stage) => s.charAt(0).toUpperCase() + s.slice(1)
const counted = (c: Partial<Record<Stage, number>>) =>
  STAGES.filter(s => (c[s] ?? 0) > 0).map(s => `${label(s)}(${c[s]})`).join(' / ')

// `Plan(6) / Implement(11) · graph Implement(3)`; nothing open is no status
export function stageStatus(c: StageCounts): string | undefined {
  const parts = [counted(c.harness), counted(c.graph) ? `graph ${counted(c.graph)}` : ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

async function countStages($: EngineInterface, cwd: string, now: number): Promise<StageCounts> {
  const out: StageCounts = { harness: {}, graph: {} }
  const add = (c: Partial<Record<Stage, number>>, s: Stage) => { c[s] = (c[s] ?? 0) + 1 }
  const json = async (p: string) => { try { return JSON.parse(await $.fs.read(p)) } catch { return null } }
  const list = async (p: string) => { try { return await $.fs.list(p) } catch { return [] } }
  let trees = [cwd]
  try {
    const wt = await $.process.run(['git', '-C', cwd, 'worktree', 'list', '--porcelain'])
    const found = wt.stdout.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9))
    if (wt.exitCode === 0 && found.length > 0) trees = found
  } catch {
    // not a repo: this cwd alone
  }
  for (const tree of trees) {
    const base = `${tree}/.harness-run`
    for (const run of await list(base)) {
      if (run.kind !== 'dir') continue
      const dir = `${base}/${run.name}`
      if (run.name === 'broker') {
        for (const f of await list(`${dir}/runs`)) {
          if (!f.name.endsWith('.json') || now - f.mtimeMs > STALE_MS) continue
          const g = await json(`${dir}/runs/${f.name}`)
          const nodes = (Array.isArray(g?.nodes) ? g.nodes : []) as { stage?: string; state?: string }[]
          if (nodes.some(n => n.stage === 'report' && n.state === 'done')) continue
          const stage = STAGES.find(s => nodes.some(n => n.stage === s && !FINISHED.has(String(n.state))))
          if (stage) add(out.graph, stage)
        }
        continue
      }
      const files = await list(dir)
      const has = (name: string) => files.some(f => f.name === name)
      if (!has('manifest.json') || has('05-report.md')) continue
      const subs = await list(`${dir}/subgoals`)
      if (now - Math.max(0, ...files.map(f => f.mtimeMs), ...subs.map(f => f.mtimeMs)) > STALE_MS) continue
      const spec = await json(`${dir}/02-goal-spec.json`)
      const crit = await json(`${dir}/02-critique.json`)
      const ids = (Array.isArray(spec?.subgoals) ? spec.subgoals : []).map((s: { id?: unknown }) => String(s.id))
      let judged = 0
      for (const id of ids) {
        const r = await json(`${dir}/subgoals/${id}/result.json`)
        if (r?.passed === true || r?.passed === false) judged++
      }
      add(out.harness, !has('01-plan.md') ? 'plan'
        : !spec ? 'setgoal'
        : crit?.sound !== true ? 'critique'
        : judged < ids.length ? 'implement'
        : !has('04-goal-gate.json') ? 'gate'
        : 'report')
    }
  }
  return out
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
        // the status line: open runs per stage; the gate's decisions live in /harness-gate
        $.ui.status(stageStatus(await countStages($, await $.session.cwd(), await $.clock.now())))
        if (!(await $.fs.exists(CONFIG))) {
          await update($, armed, () => false)
          await update($, last, () => null)
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
      } catch {
        // a read error leaves the gate state as it was
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
          <Text dimColor wrap="truncate-end">
            {'○ No gate configured: .claude/harness-gate.json is not in this project.'}
          </Text>
        </Box>
      )
    }
    const list = await read($, patterns)
    const hours = await read($, windowHours)
    const d = await read($, last)
    const now = await $.clock.now()
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text bold wrap="truncate-end">
            <Text color="claude">●</Text> Gate armed
          </Text>
          <Text>{`Gated patterns (${list.length}):`}</Text>
          {list.map(p => (
            <Text key={p} wrap="truncate-end">
              <Text dimColor>· </Text>
              {p}
            </Text>
          ))}
          <Text>
            <Text dimColor>Engagement window:</Text> {`${hours} h`}
          </Text>
        </Box>
        {d === null ? (
          <Text dimColor>No gated call decided yet.</Text>
        ) : (
          <Box flexDirection="column">
            <Text dimColor>Last decision:</Text>
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor={d.decision === 'deny' ? 'error' : 'success'}
              paddingX={1}
            >
              <Text wrap="truncate-end">
                <Text bold color={d.decision === 'deny' ? 'error' : 'success'}>
                  {`${d.decision === 'deny' ? '✘' : '✔'} ${d.decision}`}
                </Text>
                {` ${d.tool} ${d.target}, ${ago(now - d.ts)}`}
              </Text>
              <Text>{`Reason: ${d.reason}`}</Text>
            </Box>
          </Box>
        )}
        <Box borderStyle="round" borderDimColor paddingX={1}>
          <Text dimColor>{ENGAGE}</Text>
        </Box>
      </Box>
    )
  })
}
