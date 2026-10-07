import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { HarnessRun } from '../types'

const REPO_NAME = /claude-skills(\.git)?$/
const CLAUDE_P = /\bclaude\b.*\s-p(\s|$)/
const MODEL_DENY = 'mods: pass model ("sonnet" for build work, "opus" for plan/judge) — without it the subagent inherits the parent model.'

const runs = atom({ plugin: 'mods', key: 'runs' } as const, [] as HarnessRun[])

// reload-safe caches only; nothing here is read for diagnostics
let mine: Set<string> | undefined
let stopTick: (() => void) | undefined

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

// number of claude -p processes among the descendants of `engine` (D2); a wrapper shell
// counts once: a match whose parent also matches is the same job
function countClaudeP(ps: string, engine: number): number {
  const rows = ps.split('\n').flatMap(line => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] }] : []
  })
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
  const hits = new Set(rows.filter(r => below.has(r.pid) && r.pid !== engine && CLAUDE_P.test(r.cmd)).map(r => r.pid))
  return rows.filter(r => hits.has(r.pid) && !hits.has(r.ppid)).length
}

export const register: Register = (on, options) => {
  const mode = options.agent_model_guard

  // Interactive only (shared rule 2): timers and toasts start when a surface exists.
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    if ((await $.session.surfaces()).length === 0) return r
    const root = await $.session.root()

    // Harness run band: poll open fallback runs of every worktree.
    const poll = async () => {
      const out = await $.process.run(['node', `${$.plugin.root}/hooks/runs.mjs`, root])
      if (out.exitCode === 0) await update($, runs, () => JSON.parse(out.stdout) as HarnessRun[])
    }
    stopTick?.()
    stopTick = $.clock.every(5000, () => { void poll().catch(() => {}) }).cancel
    void poll().catch(() => {})

    // Fetch reminder in claude-skills: origin/main moves from other sessions. Detached: session.start is not held.
    void (async () => {
      const repo = await $.session.repo()
      if (!repo?.remote || !REPO_NAME.test(repo.remote)) return
      await $.process.run(['git', 'fetch', '-q', 'origin'], { cwd: repo.root, timeoutMs: 20000 })
      const behind = await $.process.run(['git', 'rev-list', '--count', 'origin/main', '^HEAD'])
      const n = Number(behind.stdout.trim())
      if (n > 0) $.ui.toast(`origin/main is ${n} commit(s) ahead — pull before editing`, { timeoutMs: 8000 })
    })().catch(() => {})
    return r
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const open = await read($, runs)
    if (open.length === 0 || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {open.map(run => (
          <Text key={run.dir}>
            harness {run.slug}: {run.stage}
            {run.total > 0 ? ` · ${run.passed}/${run.total} passed${run.failed ? `, ${run.failed} failed` : ''}` : ''}
          </Text>
        ))}
      </Box>
    )
  })

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
      $.ui.toast(`skill: ${e.skill}`)
      $.ui.status(`skill: ${e.skill}`)
    }
    return result
  }).catch(($, e, next) => next(e))

  // Subagent model guard: no model means the parent's (expensive) model. toast | deny | off (D3).
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    if (e.tool !== 'Agent' || e.model || e.subagent_type === 'fork' || mode === 'off') return next(e)
    if (mode === 'deny') return { deny: MODEL_DENY }
    if ((await $.session.surfaces()).length > 0) $.ui.toast(MODEL_DENY.replace('mods: ', 'mods: no model on this Agent call. '), { timeoutMs: 6000 })
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
    if (/\bgit\s+push\b|patch-(harness|teams)\.mjs/.test(cmd) && (await $.session.surfaces()).length > 0) {
      const answer = await $.ui.ask(`Run this? ${cmd.slice(0, 120)}`, ['Run', 'Cancel'])
      if (answer !== 'Run') return { deny: 'mods: the person declined the push / version bump.' }
    }

    // README/KOR pair: a staged README.md without its KOR.md.
    if (/\bgit\s+commit\b/.test(cmd)) {
      const staged = await $.process.run(['git', 'diff', '--cached', '--name-only'])
      const files = new Set(staged.stdout.split('\n').filter(Boolean))
      const lonely = [...files].filter(f => f.endsWith('/README.md') && !files.has(f.replace(/README\.md$/, 'KOR.md')))
      if (lonely.length) $.ui.toast(`README without KOR: ${lonely.join(', ')}`, { timeoutMs: 8000 })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // Turn-end check: headless claude -p children of this session still alive (D2).
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if ((await $.session.surfaces()).length === 0) return r
    const me = await $.process.run(['sh', '-c', 'echo $PPID'])
    const ps = await $.process.run(['ps', '-A', '-o', 'pid=,ppid=,command='])
    const engine = Number(me.stdout.trim())
    const n = Number.isInteger(engine) && engine > 0 ? countClaudeP(ps.stdout, engine) : 0
    $.ui.status(n > 0 ? `${n} claude -p child(ren) running` : undefined)
    return r
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    stopTick?.()
    return next(e)
  })
}
