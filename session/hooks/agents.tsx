import type { EngineInterface, On, PluginOptions } from 'claude-code'

import { matchOrphans, parsePs, PS_ARGV } from './procs.ts'
import type { Row } from './procs.ts'
import { statusLine } from './status.ts'

const MODEL_DENY = 'session: pass model ("sonnet" for build work, "opus" for plan/judge) — without it the subagent inherits the parent model.'

const PANE = 'reap-result'
let reaped: string[] = []

const ALIVE = new Set(['pending', 'running', 'waiting', 'idle'])

const unfinished = async ($: EngineInterface) => (await $.agent.list()).filter(x => ALIVE.has(x.status))

// The number the status line shows.
export const aliveCount = (agents: readonly { status: string }[]): number => agents.filter(x => ALIVE.has(x.status)).length

// The engine pid is the parent of `sh -c 'echo $PPID'`; 0 when it cannot be read.
async function enginePid($: EngineInterface): Promise<number> {
  const r = await $.process.run(['sh', '-c', 'echo $PPID'], { timeoutMs: 3000 })
  const pid = Number(String(r.stdout).trim())
  return Number.isInteger(pid) && pid > 0 ? pid : 0
}

// The claude binary: `claude` on PATH, or an installed build that runs as .../claude/versions/<v>.
const isClaude = (cmd: string) => {
  const bin = cmd.trim().split(/\s+/)[0] ?? ''
  return bin.split('/').pop() === 'claude' || /\/claude\/versions\/[^/]+$/.test(bin)
}

// The claude -p jobs /reap may kill. undefined when `engine` is not this session's claude: pid 1 or a
// non-claude row would reach other sessions' children.
const jobsOf = (ps: string, engine: number): Row[] | undefined => {
  const rows = parsePs(ps)
  const self = rows.find(r => r.pid === engine)
  return engine === 1 || !self || !isClaude(self.cmd) ? undefined : matchOrphans(rows, engine)
}

export const register = (on: On, options: PluginOptions) => {
  const mode = options.agent_model_guard

  // Subagent model guard: no model means the parent's (expensive) model. toast | deny | off.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.tool !== 'Agent' || e.model || e.subagent_type === 'fork' || mode === 'off') return next(e)
    if (mode === 'deny') return { deny: MODEL_DENY }
    if ((await $.session.surfaces()).length > 0) $.ui.toast('⚠ session: no model on this Agent call. ' + MODEL_DENY.replace('session: ', ''), { timeoutMs: 6000 })
    return next(e)
  }).catch(($, e, next) => next(e))

  // /reap: stop unfinished agents (TaskStop) and kill claude -p children, after the person confirms.
  // Answers its own command: neither the hook nor its .catch reads next.
  on('command.run', { command: 'reap' }, async $ => {
    if ((await $.session.surfaces()).length === 0) return { text: '/reap runs in interactive sessions only.' }
    const alive = await unfinished($)
    const ids = new Set(alive.map(x => x.id))
    // a parent's stop ends its children: stopping them too would only report false failures
    const agents = alive.filter(x => !x.parentId || !ids.has(x.parentId))
    const ps = await $.process.run([...PS_ARGV], { timeoutMs: 5000 })
    const procs = jobsOf(ps.stdout, await enginePid($))
    const unknown = procs ? [] : ['claude -p not checked: engine pid unknown']
    const targets = [
      ...agents.map(x => `agent: ${x.description} (${x.status})`),
      ...(procs ?? []).map(p => `pid ${p.pid}: ${p.cmd.slice(0, 80)}`),
    ]
    if (!targets.length) return { text: ['nothing to reap.', ...unknown].join(' ') }
    const answer = await $.ui.ask(`Reap these?\n${targets.join('\n')}`, ['Reap', 'Cancel']).catch(() => undefined)
    if (answer !== 'Reap') return { text: 'reap cancelled; nothing stopped.' }
    const lines: string[] = []
    for (const x of agents) {
      try {
        const res = await $.tool.call({ tool: 'TaskStop', task_id: x.id })
        if (res.deny !== undefined) lines.push(`failed: ${x.description} (${res.deny})`)
        else if (res.isError) lines.push(`failed: ${x.description} (${res.text ?? 'error'})`)
        else lines.push(`stopped: ${x.description}`)
      } catch (err) {
        lines.push(`failed: ${x.description} (${err instanceof Error ? err.message : String(err)})`)
      }
    }
    if (procs?.length) {
      const pids = procs.map(p => String(p.pid))
      const k = await $.process.run(['kill', '-TERM', ...pids])
      lines.push(k.exitCode === 0 ? `killed: claude -p ${pids.join(' ')}` : `failed: kill ${pids.join(' ')} (${k.stderr.trim()})`)
    }
    lines.push(...unknown)
    $.ui.status(statusLine({ agents: aliveCount(await $.agent.list()) }))
    $.ui.toast(`⧗ reap: ${lines.filter(l => /^(stopped|killed):/.test(l)).length} done, ${lines.filter(l => l.startsWith('failed')).length} failed`, { timeoutMs: 6000 })
    reaped = lines
    await $.ui.open({ id: PANE, title: 'Reap' })
    return { text: `reap: ${lines.filter(l => /^(stopped|killed):/.test(l)).length} stopped, ${lines.filter(l => l.startsWith('failed')).length} failed` }
  }).catch(() => ({ text: '/reap failed; nothing more was stopped.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {reaped.map((l, i) => <Text key={`r-${i}`}>{l}</Text>)}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
