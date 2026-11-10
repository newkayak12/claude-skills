#!/usr/bin/env node
// agents: hand the other CLI a question (read only) or a task (--act). Used by use-codex and use-claude.
//
//   node ask.mjs --to codex|claude --prompt-file <brief.md> [--cwd <dir>] [--model <m>] [--act]
//                [--attach <path,path>] [--timeout <seconds, default 600>] [--dry-run]
//
// Prints one JSON line: {to, mode, model, cwd, seconds, exit, answer} or {error}. By default the child
// runs read only (codex: --sandbox read-only; claude: Read/Grep/Glob only, everything else denied).
// --act bypasses permissions instead (codex: --dangerously-bypass-approvals-and-sandbox; claude:
// --permission-mode bypassPermissions), so the child edits files and runs commands in --cwd; the
// result then adds `changed` (git status lines that appeared or changed) and `head_moved`.
// Either way the child keeps no session, loads no MCP server, and carries SECOND_OPINION_DEPTH so it
// never hands work on to a third (no codex ↔ claude loops).
// --dry-run prints {to, mode, command, stdin_from} without running anything.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DEPTH_ENV = 'SECOND_OPINION_DEPTH'
const READ_TOOLS = ['Read', 'Grep', 'Glob']
const DENY_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent']
const KILL_GRACE_MS = 5000
const SANDBOX_DOWN = /bwrap:|sandbox helper failed|Operation not permitted.*(loopback|namespace)/i

export function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') out.dryRun = true
    else if (a === '--act') out.act = true
    else if (a.startsWith('--')) out[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]
  }
  return out
}

// The command line for one call. `last` is where codex writes its final message.
export function command(to, { cwd, model, last, act = false }) {
  if (to === 'codex') {
    // no MCP servers: their tools run outside the shell sandbox
    const perm = act ? ['--dangerously-bypass-approvals-and-sandbox'] : ['--sandbox', 'read-only']
    return ['codex', 'exec', ...perm, '--skip-git-repo-check', '--ephemeral',
      '-c', 'mcp_servers={}', '-C', cwd, '-o', last, ...(model ? ['-m', model] : []), '-']
  }
  if (to === 'claude' && act) {
    // every tool, no prompt; user settings and their hooks (a repo's write rules) stay loaded
    return ['claude', '-p', '--output-format', 'json', '--no-session-persistence',
      '--permission-mode', 'bypassPermissions', '--strict-mcp-config',
      ...(model ? ['--model', model] : [])]
  }
  if (to === 'claude') {
    // dontAsk already denies every tool not allowed; the explicit deny list and no MCP servers say
    // it twice, so a settings file that allows more cannot widen it. User settings stay loaded:
    // their hooks are guards (a repo's write rules), and dropping them would make the child freer.
    return ['claude', '-p', '--output-format', 'json', '--no-session-persistence',
      '--tools', READ_TOOLS.join(','), '--permission-mode', 'dontAsk',
      '--allowedTools', READ_TOOLS.join(','),
      '--disallowedTools', DENY_TOOLS.join(','), '--strict-mcp-config',
      ...(model ? ['--model', model] : [])]
  }
  throw new Error(`--to must be codex or claude, not ${JSON.stringify(to)}`)
}

// claude -p --output-format json prints one object; its `result` is the answer.
export function claudeAnswer(stdout) {
  const line = stdout.trim().split('\n').reverse().find(l => l.trim().startsWith('{'))
  if (!line) return { answer: stdout.trim() }
  let o
  try { o = JSON.parse(line) } catch { return { answer: '', isError: true, model: undefined, raw: stdout.trim().slice(-400) } }
  return { answer: String(o.result ?? '').trim(), isError: o.is_error === true, model: o.model }
}

function onPath(bin, env) {
  return spawnSync('/bin/sh', ['-c', 'command -v "$1"', '_', bin], { encoding: 'utf8', env }).status === 0
}

// What the working tree looks like: git status lines and HEAD, or null outside a git repo.
export function treeState(cwd) {
  // -z: paths unquoted (Korean names stay readable); a rename's old path follows as its own field
  const st = spawnSync('git', ['status', '--porcelain=v1', '-z', '-uall'], { cwd, encoding: 'utf8' })
  if (st.status !== 0) return null
  const head = spawnSync('git', ['rev-parse', '-q', '--verify', 'HEAD'], { cwd, encoding: 'utf8' }).stdout.trim()
  const files = {}
  const fields = st.stdout.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const l = fields[i]
    if (!l) continue
    if (/^[RC]/.test(l)) i++
    const h = spawnSync('git', ['hash-object', '--', l.slice(3)], { cwd, encoding: 'utf8' }).stdout.trim()
    files[l] = h
  }
  return { head, files }
}

// Lines that appeared, or whose file content changed, between two treeStates.
export function changes(before, after) {
  if (!before || !after) return { changed: null, head_moved: null }
  const changed = Object.keys(after.files).filter(l => before.files[l] !== after.files[l])
  return { changed, head_moved: before.head !== after.head }
}

// Any value at all means this process is already a second opinion: a number, or anything else.
export const nested = env => String(env[DEPTH_ENV] ?? '').trim() !== '' && String(env[DEPTH_ENV]).trim() !== '0'

export async function ask(opts, env = process.env) {
  const to = opts.to
  if (!['codex', 'claude'].includes(to)) return { error: `--to must be codex or claude, not ${JSON.stringify(to)}` }
  if (nested(env)) {
    return { error: `refused: this run is already a second opinion (${DEPTH_ENV}=${env[DEPTH_ENV]}); it does not ask a third` }
  }
  if (!opts.promptFile || !existsSync(opts.promptFile)) return { error: '--prompt-file <brief.md> is required and must exist' }
  let brief
  try { brief = readFileSync(opts.promptFile, 'utf8') } catch (e) { return { error: `--prompt-file cannot be read: ${e.message}` } }
  // --attach a,b: the files' text goes into the brief, so the other model needs no tool to read
  // them — the way through when its sandbox cannot start (codex under a restricted user namespace).
  const attach = String(opts.attach || '').split(',').map(s => s.trim()).filter(Boolean)
  for (const p of attach) {
    const full = resolve(opts.cwd || '.', p)
    let text
    try { text = readFileSync(full, 'utf8') } catch (e) { return { error: `--attach ${p} cannot be read: ${e.message}` } }
    brief += `\n\n----- ${p} -----\n${text.split('\n').map((l, i) => `${String(i + 1).padStart(4)}  ${l}`).join('\n')}\n`
  }
  const cwd = resolve(opts.cwd || '.')
  const work = mkdtempSync(join(tmpdir(), 'second-opinion-'))
  const last = join(work, 'last.md')
  const act = opts.act === true
  const mode = act ? 'act' : 'read'
  const argv = command(to, { cwd, model: opts.model, last, act })
  if (opts.dryRun) { rmSync(work, { recursive: true, force: true }); return { to, mode, command: argv, stdin_from: opts.promptFile } }
  if (!onPath(argv[0], env)) {
    rmSync(work, { recursive: true, force: true })
    return { error: `${argv[0]} is not on PATH: install it (${to === 'codex' ? 'npm i -g @openai/codex' : 'npm i -g @anthropic-ai/claude-code'}) and sign in once` }
  }
  const timeout = Number(opts.timeout || 600) * 1000
  const before = act ? treeState(cwd) : null
  const started = Date.now()
  const r = await new Promise(done => {
    // its own process group, so a timeout stops the CLI and everything it started
    const child = spawn(argv[0], argv.slice(1), { cwd, detached: true, env: { ...env, [DEPTH_ENV]: '1' } })
    let stdout = '', stderr = '', timedOut = false, settled = false
    // after a timeout the group's SIGKILL stays scheduled even when the leader exits first, so a
    // descendant that ignored SIGTERM does not outlive the call
    const finish = v => { if (!settled) { settled = true; clearTimeout(timer); if (!timedOut) clearTimeout(hard); done(v) } }
    const group = sig => { try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch { /* gone */ } } }
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    let hard
    const timer = setTimeout(() => {
      timedOut = true
      group('SIGTERM')
      hard = setTimeout(() => { group('SIGKILL'); finish({ code: -1, stdout, stderr, timedOut }) }, KILL_GRACE_MS)
    }, timeout)
    child.on('close', code => finish({ code, stdout, stderr, timedOut }))
    child.on('error', e => finish({ code: -1, stdout, stderr: String(e), timedOut }))
    child.stdin.on('error', () => { /* the child exited before reading the brief: its exit says why */ })
    child.stdin.end(brief)
  })
  const seconds = Math.round((Date.now() - started) / 100) / 10
  // in act mode every exit, a failed or timed-out one included, says what the child left behind
  const touched = act ? changes(before, treeState(cwd)) : {}
  try {
    if (r.timedOut) return { to, mode, cwd, seconds, ...touched, error: `no answer within ${timeout / 1000}s` }
    let answer = ''
    let model = opts.model || null
    if (to === 'codex') answer = existsSync(last) ? readFileSync(last, 'utf8').trim() : r.stdout.trim()
    else {
      const c = claudeAnswer(r.stdout)
      answer = c.answer
      model = c.model || model
      if (c.isError) return { to, mode, cwd, seconds, exit: r.code, ...touched, error: answer || c.raw || r.stderr.trim().slice(-400) }
    }
    if (r.code !== 0 || !answer) {
      return { to, mode, cwd, seconds, exit: r.code, ...touched, error: (r.stderr.trim() || r.stdout.trim()).slice(-400) || 'empty answer' }
    }
    // codex exits 0 with a polite "I could not read the files" when its sandbox never started
    if (to === 'codex' && !act && !attach.length && SANDBOX_DOWN.test(`${answer}\n${r.stderr}`)) {
      return { to, mode, cwd, seconds, exit: r.code, sandbox_down: true,
        error: 'codex could not start its sandbox here (bwrap; unprivileged user namespaces are restricted), so it read nothing. Run again with --attach <the files> so it needs no tool.' }
    }
    return { to, mode, model, cwd, seconds, exit: r.code, attached: attach, ...touched, answer }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const out = await ask(parseArgs(process.argv.slice(2)))
  console.log(JSON.stringify(out))
  process.exitCode = out.error ? 1 : 0
}
