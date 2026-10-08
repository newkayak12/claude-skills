import type { EngineInterface, Register } from 'claude-code'

const REPO_NAME = /claude-skills(\.git)?$/
const CLAUDE_P = /\bclaude\b.*\s-p(\s|$)/
const MODEL_DENY = 'mods: pass model ("sonnet" for build work, "opus" for plan/judge) — without it the subagent inherits the parent model.'

// reload-safe caches only; nothing here is read for diagnostics
let mine: Set<string> | undefined

const words = (cmd: string) => cmd.split(/\s+/).filter(Boolean)

// absolute path of `p` against `base`, without `.` / `..` segments
function resolve(base: string, p: string): string {
  const out: string[] = []
  for (const seg of (p.startsWith('/') ? p : `${base}/${p}`).split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return `/${out.join('/')}`
}

// the marketplace.json of the marketplace this plugin came from, from the plugin root only (D1)
function marketplaceCandidates(root: string): string[] {
  const mkt = resolve(root, '../..').split('/').pop() ?? ''
  return [
    resolve(root, '../.claude-plugin/marketplace.json'),
    resolve(root, `../../../../marketplaces/${mkt}/.claude-plugin/marketplace.json`),
  ]
}

type Proc = { pid: number; ppid: number; cmd: string }

function psRows(ps: string): Proc[] {
  return ps.split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] ?? '' }] : []
  })
}

// pids of `engine` and every process below it
function subtree(rows: Proc[], engine: number): Set<number> {
  const below = new Set<number>([engine])
  for (let grew = true; grew;) {
    grew = false
    for (const r of rows) {
      if (!below.has(r.pid) && below.has(r.ppid)) {
        below.add(r.pid)
        grew = true
      }
    }
  }
  return below
}

// number of claude -p processes among the descendants of `engine` (D2); a wrapper shell
// counts once: a match whose parent also matches is the same job
function countClaudeP(ps: string, engine: number): number {
  const rows = psRows(ps)
  const below = subtree(rows, engine)
  const hits = new Set(rows.filter(r => below.has(r.pid) && r.pid !== engine && CLAUDE_P.test(r.cmd)).map(r => r.pid))
  return rows.filter(r => hits.has(r.pid) && !hits.has(r.ppid)).length
}

// the claude binary: `claude` on PATH, or an installed build that runs as .../claude/versions/<v>
const isClaude = (cmd: string) => {
  const bin = words(cmd)[0] ?? ''
  return bin.split('/').pop() === 'claude' || /\/claude\/versions\/[^/]+$/.test(bin)
}

// what /reap kills: the claude binary itself run with -p/--print below `engine`, never a wrapper
// shell (it exits with its child). undefined when `engine` is not this session's claude: pid 1 or
// a non-claude row would reach other sessions' children.
function claudePToKill(ps: string, engine: number): Proc[] | undefined {
  const rows = psRows(ps)
  const self = rows.find(r => r.pid === engine)
  if (engine === 1 || !self || !isClaude(self.cmd)) return undefined
  const below = subtree(rows, engine)
  return rows.filter(r => below.has(r.pid) && r.pid !== engine && isClaude(r.cmd) && words(r.cmd).some(w => w === '-p' || w === '--print'))
}

const ALIVE = new Set(['pending', 'running', 'waiting', 'idle'])

async function enginePid($: EngineInterface): Promise<number> {
  const me = await $.process.run(['sh', '-c', 'echo $PPID'])
  return Number(me.stdout.trim())
}

// status line: this session's unfinished agents and headless claude -p children (D2)
async function aliveStatus($: EngineInterface): Promise<void> {
  const engine = await enginePid($)
  const ps = await $.process.run(['ps', '-A', '-o', 'pid=,ppid=,command='])
  const n = Number.isInteger(engine) && engine > 0 ? countClaudeP(ps.stdout, engine) : 0
  const a = (await $.agent.list()).filter(x => ALIVE.has(x.status)).length
  const parts = [...(a > 0 ? [`${a} agent(s)`] : []), ...(n > 0 ? [`${n} claude -p child(ren)`] : [])]
  $.ui.status(parts.length ? `⧗ ${parts.join(' · ')} running · /reap` : undefined)
}

export const register: Register = (on, options) => {
  const mode = options.agent_model_guard

  // Interactive only (shared rule 2): timers and toasts start when a surface exists.
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if ((await $.session.surfaces()).length === 0) return r
    await $.command.register({ name: 'reap', description: "Stop this session's unfinished agents and claude -p children (asks first)" })
    // Fetch reminder in claude-skills: origin/main moves from other sessions. Detached: session.start is not held.
    void (async () => {
      const repo = await $.session.repo()
      if (!repo?.remote || !REPO_NAME.test(repo.remote)) return
      await $.process.run(['git', 'fetch', '-q', 'origin'], { cwd: repo.root, timeoutMs: 20000 })
      const behind = await $.process.run(['git', 'rev-list', '--count', 'origin/main', '^HEAD'])
      const n = Number(behind.stdout.trim())
      if (n > 0) $.ui.toast(`↓ origin/main is ${n} commit(s) ahead — pull before editing`, { timeoutMs: 8000 })
    })().catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  // Skill toast: only skills from this marketplace.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    const result = await next(e)
    if (e.tool !== 'Skill' || (await $.session.surfaces()).length === 0) return result
    if (!mine) {
      mine = new Set()
      for (const path of marketplaceCandidates($.plugin.root)) {
        try {
          const { plugins } = JSON.parse(await $.fs.read(path)) as { plugins: { name: string }[] }
          mine = new Set(plugins.map(p => p.name))
          break
        } catch {
          // try the next candidate; none readable leaves the set empty (no toast)
        }
      }
    }
    if (mine.has(e.skill.split(':')[0])) {
      $.ui.toast(`◆ skill: ${e.skill}`)
      $.ui.status(`◆ skill: ${e.skill}`)
    }
    return result
  }).catch(($, e, next) => next(e))

  // Subagent model guard: no model means the parent's (expensive) model. toast | deny | off (D3).
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.tool !== 'Agent' || e.model || e.subagent_type === 'fork' || mode === 'off') return next(e)
    if (mode === 'deny') return { deny: MODEL_DENY }
    if ((await $.session.surfaces()).length > 0) $.ui.toast('⚠ ' + MODEL_DENY.replace('mods: ', 'mods: no model on this Agent call. '), { timeoutMs: 6000 })
    return next(e)
  }).catch(($, e, next) => next(e))

  // Running-script guard: bash reads a script by byte offset while it runs.
  on('tool.call', ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write') return next(e)
    if (!/\.(sh|bash)$/.test(e.file_path)) return next(e)
    return $.process.run(['pgrep', '-f', e.file_path]).then(p =>
      p.exitCode === 0 && p.stdout.trim()
        ? { deny: `mods: ${e.file_path} is running (pid ${p.stdout.trim().split('\n').join(', ')}). Copy it and edit the copy, or wait until it exits.` }
        : next(e))
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.tool !== 'Bash') return next(e)
    const cmd = e.command

    // Worktree guard: never remove a worktree with uncommitted work. Fails open when the path is gone.
    const wt = cmd.match(/git\s+(?:-C\s+(\S+)\s+)?worktree\s+remove\s+([^;&|]+)/)
    if (wt) {
      const args = words(wt[2])
      if (args.some(a => a === '--force' || a === '-f')) {
        const target = args.find(a => !a.startsWith('-'))
        if (target) {
          const cwd = await $.session.cwd()
          const path = resolve(wt[1] ? resolve(cwd, wt[1]) : cwd, target)
          const st = await $.process.run(['git', '-C', path, 'status', '--porcelain'])
          if (st.exitCode === 0 && st.stdout.trim()) {
            return { deny: `mods: ${path} has uncommitted changes:\n${st.stdout.slice(0, 500)}\nCommit (and verify with git log) before removing it.` }
          }
        }
      }
    }

    // The rest encodes the claude-skills repo's rules (D4): other repos pass untouched.
    const repo = await $.session.repo()
    if (!repo?.remote || !REPO_NAME.test(repo.remote)) return next(e)

    // Push / version bump: ask the person first; headless runs pass.
    if (/\bgit\s+push\b|patch-harness\.mjs|skills\/patch\/patch\.mjs/.test(cmd) && (await $.session.surfaces()).length > 0) {
      // a dismissed ask rejects: that is a refusal, not a failure to fail open on
      const answer = await $.ui.ask(`Run \`${cmd.slice(0, 120)}\`?`, ['Run', 'Cancel']).catch(() => undefined)
      if (answer !== 'Run') return { deny: 'mods: the person declined the push / version bump.' }
    }

    // README/KOR pair: a staged README.md without its KOR.md.
    if (/\bgit\s+commit\b/.test(cmd)) {
      const staged = await $.process.run(['git', 'diff', '--cached', '--name-only'])
      const files = new Set(staged.stdout.split('\n').filter(Boolean))
      const lonely = [...files].filter(f => f.endsWith('/README.md') && !files.has(f.replace(/README\.md$/, 'KOR.md')))
      if (lonely.length) $.ui.toast(`⚠ README without KOR: ${lonely.join(', ')}`, { timeoutMs: 8000 })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Turn-end check: unfinished agents and headless claude -p children of this session (D2).
  // Subagent turns refresh it too; harmless. Only /reap stops anything.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if ((await $.session.surfaces()).length === 0) return r
    await aliveStatus($)
    return r
  }).catch(($, e, next) => next(e))

  // /reap: stop unfinished agents (TaskStop) and kill claude -p children, after the person confirms.
  // Answers its own command: neither the hook nor its .catch reads next.
  on('command.run', { command: 'reap' }, async $ => {
    if ((await $.session.surfaces()).length === 0) return { text: '/reap runs in interactive sessions only.' }
    const alive = (await $.agent.list()).filter(x => ALIVE.has(x.status))
    const ids = new Set(alive.map(x => x.id))
    // a parent's stop ends its children: stopping them too would only report false failures
    const agents = alive.filter(x => !x.parentId || !ids.has(x.parentId))
    const engine = await enginePid($)
    const ps = await $.process.run(['ps', '-A', '-o', 'pid=,ppid=,command='])
    const procs = claudePToKill(ps.stdout, engine)
    const unknown = procs ? [] : ['claude -p not checked: engine pid unknown']
    const targets = [
      ...agents.map(x => `agent: ${x.description} (${x.status})`),
      ...(procs ?? []).map(p => `pid ${p.pid}: ${p.cmd.slice(0, 80)}`),
    ]
    if (!targets.length) return { text: ['nothing to reap.', ...unknown].join('\n') }
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
    await aliveStatus($)
    $.ui.toast(`⧗ reap: ${lines.filter(l => /^(stopped|killed):/.test(l)).length} done, ${lines.filter(l => l.startsWith('failed')).length} failed`, { timeoutMs: 6000 })
    return { text: ['/reap', ...lines].join('\n') }
  }).catch(() => ({ text: '/reap failed; nothing more was stopped.' }))
}
