import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  addCommit, addDeny, addFile, addStep, emptyLedger, endTurn, fmtMs, isEmpty, leftSomething, parseNumstat, statOf, stepSpan, summarize,
} from './ledger.ts'
import type { Ledger, Summary } from './ledger.ts'
import { checkKill } from './kill.ts'
import type { Verdict } from './kill.ts'
import { ancestorsOf, fmtAge, matchOrphans, parsePs, PS_ARGV } from './procs.ts'
import type { Row } from './procs.ts'
import { costText, statusLine } from './status.ts'
import { isFresh, fmtAgo, recapKey } from './recap.ts'
import type { Recap } from './recap.ts'
import { appendLog, dayOf, parseTask, TASK_KEY, TASK_LOG_KEY, taskStatus, todayLines } from './timer.ts'
import type { Done, Task } from './timer.ts'
import { DENIALS_KEY, register as registerGuard } from './guard.tsx'
import { register as registerMemo } from './memo.tsx'
import { register as registerHint } from './hint.ts'
import { RECAP_PANE, register as registerCompact } from './compact.tsx'

const tab = atom({ plugin: 'session', key: 'tab' } as const, 'retro' as 'retro' | 'orphans')
const band = atom({ plugin: 'session', key: 'band' } as const, false)
const ledger = atom({ plugin: 'session', key: 'ledger' } as const, emptyLedger())

const statsAtom = atom({ plugin: 'session', key: 'stats' } as const, {} as Record<string, string>)

const lastAtom = atom({ plugin: 'session', key: 'last' } as const, null as Summary | null)
// The project's last recap, when it is under 7 days old: the band offers it once per start.
const recapAtom = atom({ plugin: 'session', key: 'recap' } as const, null as { ts: number } | null)

const PANE = 'session'
const LAST_KEY = 'session.last'

async function openPane($: any) {
  await refreshStats($)
  await pollOrphans($)
  await $.ui.open({ id: PANE, title: 'Session' })
}

// One `git diff --numstat` for the touched files, never in a draw. No git or a slow one: keep what was there.
async function refreshStats($: any) {
  try {
    const files = (await read($, ledger)).files
    if (files.length === 0) return
    const r = await $.process.run(['git', 'diff', '--numstat', '--', ...files], { timeoutMs: 5000 })
    if (r.exitCode === 0) await update($, statsAtom, () => parseNumstat(r.stdout))
  } catch {}
}

const orphansAtom = atom({ plugin: 'session', key: 'orphans' } as const, [] as Row[])
const engineAtom = atom({ plugin: 'session', key: 'engine' } as const, 0)

// Windows has no `ps -o lstart`: the OS-process section is hidden and no process is run for it.
const isWindows = async ($: any) => {
  try {
    return (await $.env.get('OS')) === 'Windows_NT'
  } catch {
    return false
  }
}

// The engine pid is the parent of `sh -c 'echo $PPID'`; asked once, kept in state.
async function engineOf($: any): Promise<number> {
  let pid = await read($, engineAtom)
  if (pid > 0) return pid
  const r = await $.process.run(['sh', '-c', 'echo $PPID'], { timeoutMs: 3000 })
  pid = Number(String(r.stdout).trim())
  if (!Number.isInteger(pid) || pid <= 0) return 0
  await update($, engineAtom, () => pid)
  return pid
}

// One ps pass at turn end and pane open, never in a draw. Failure keeps the previous list.
async function pollOrphans($: any) {
  try {
    if (await isWindows($)) return await update($, orphansAtom, () => [])
    const engine = await engineOf($)
    if (engine === 0) return
    const ps = await $.process.run([...PS_ARGV], { timeoutMs: 5000 })
    if (ps.exitCode !== 0) return
    await update($, orphansAtom, () => matchOrphans(parsePs(ps.stdout), engine))
  } catch {}
}

// A fresh ps and the verdict on `seen` against it. The cached rows are never trusted.
async function judge($: any, seen: Row): Promise<Verdict> {
  if (await isWindows($)) return { ok: false, reason: 'stopping is off on Windows' }
  const engine = await engineOf($)
  const ps = await $.process.run([...PS_ARGV], { timeoutMs: 5000 })
  if (ps.exitCode !== 0) return { ok: false, reason: 'could not read the process table' }
  const rows = parsePs(ps.stdout)
  return checkKill(seen, rows, engine, ancestorsOf(rows, engine))
}

// One pid per press, SIGTERM only: judge, ask with the full command, judge again, then the signal.
// A refusal toasts the reason and sends nothing; a pid that is already gone just clears its row.
async function stopOrphan($: any, seen: Row) {
  const say = (text: string) => void $.ui.toast(text, { timeoutMs: 6000 })
  const refuse = async (v: Extract<Verdict, { ok: false }>) => {
    if (v.gone) await update($, orphansAtom, rows => rows.filter(r => r.pid !== seen.pid))
    say(`not stopped: ${v.reason}`)
  }
  try {
    const before = await judge($, seen)
    if (!before.ok) return await refuse(before)
    const answer = await $.ui.ask(`Stop pid ${seen.pid}?\n${seen.cmd}`, ['Stop', 'Cancel']).catch(() => undefined)
    if (answer !== 'Stop') return
    const after = await judge($, seen)
    if (!after.ok) return await refuse(after)
    const r = await $.process.run(['kill', '-TERM', String(after.pid)], { timeoutMs: 5000 })
    // exit 1 with "No such process" means it ended on its own: that is success
    if (r.exitCode !== 0 && !/no such process/i.test(String(r.stderr))) say(`not stopped: ${String(r.stderr).trim().slice(0, 120)}`)
    await pollOrphans($)
  } catch {
    say('not stopped: something went wrong, nothing was sent')
  }
}

// The running /task, read from the store each time: a reload or another window sees the same task.
const runningTask = async ($: any): Promise<Task | undefined> => {
  try {
    return ((await $.store.get(TASK_KEY)) as Task | undefined) ?? undefined
  } catch {
    return undefined
  }
}

const paintTask = async ($: any) => {
  $.ui.status(statusLine({ task: taskStatus(await runningTask($), (await $.clock.now()) as number) }))
}

// Repaints the elapsed minutes while a task runs; one loop per load (a reload drops the old one).
let isTicking = false
const tick = async ($: any) => {
  if (isTicking) return
  isTicking = true
  try {
    while (await runningTask($)) {
      await $.clock.sleep(60_000)
      await paintTask($)
    }
  } finally {
    isTicking = false
  }
}

// One toast per load when the session's cost first reaches the /config budget.
let isBudgetToasted = false

// The ledger never changes what the engine returns: any failure while recording is swallowed.
const track = async ($: any, change: (l: Ledger) => Ledger) => {
  try {
    await update($, ledger, change)
  } catch {}
}

// One hooks module per plugin on this build: the guard registers its hooks from here.
export const register: Register = (on, options) => {

  // Non-interactive sessions (every `claude -p`) get no command and no UI; the ledger still runs below.
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)
    // The guard's log comes back from the store; its command is registered here, as a module may hook an event once.
    try {
      const kept = ((await $.store.get(DENIALS_KEY)) as never[] | undefined) ?? []
      await update($, { plugin: 'session', key: 'guard' } as const, () => ({ denials: kept }))
    } catch {}
    await $.command.register({ name: 'memo', description: 'Pin notes the model reads in every conversation of this project' })
    await $.command.register({ name: 'session-denials', description: 'Calls the guard or the permission rules denied this session' })
    await $.command.register({ name: 'smart-compact', description: 'Set the context % at which the session is recapped and compacted (/smart-compact 60)' })
    await $.command.register({ name: 'handoff', description: 'Recap this session now and keep it for the next start; /handoff <session> also sends it there' })
    await $.command.register({ name: 'recap', description: "Print this project's last recap (smart-compact or /handoff)" })
    await $.command.register({ name: 'lessons', description: 'Corrections collected from recaps; /lessons clear empties them' })
    await $.command.register({ name: 'task', description: 'Time a task: /task <name> starts, /task done stops, /task log shows today' })
    try {
      const r = (await $.store.get(recapKey(await $.session.root()))) as Recap | undefined
      const fresh = isFresh(r, (await $.clock.now()) as number) ? { ts: r!.ts } : null
      await update($, recapAtom, () => fresh)
    } catch {
      await update($, recapAtom, () => null)
    }
    if (await runningTask($)) {
      await paintTask($)
      void tick($).catch(() => {})
    }
    // First start of the session: defaults. A later start (hot reload) keeps what is there.
    await update($, tab, t => t ?? 'retro')
    await update($, band, b => b ?? false)
    try {
      const stored = (await $.store.get(LAST_KEY)) as Summary | undefined
      // Shown once: the key goes as soon as it is read; lastAtom keeps it for /session retro.
      if (stored !== undefined) {
        await update($, lastAtom, () => stored)
        await update($, band, () => true)
        await $.store.delete(LAST_KEY)
      } else {
        await update($, band, () => false)
      }
    } catch {
      await update($, band, () => false)
    }
    await $.command.register({
      name: 'session',
      description: 'What this session left behind: files, commits, denied calls; stray claude -p children',
    })
    return next(e)
  }).catch(($, e, next) => next(e))

  // Every tool call: stamp it for step timing, record edits and commits, count a deny from beneath.
  on('tool.call', async ($, e, next) => {
    let at = 0
    try {
      at = (await $.clock.now()) as number
    } catch {}
    const result = await next(e)
    const r = result as { deny?: string; isError?: boolean; result?: { stdout?: string } }
    await track($, l => {
      let out = at > 0 ? addStep(l, at) : l
      if (r.deny !== undefined) return addDeny(out, e.tool, String(r.deny))
      if (e.tool === 'Edit' || e.tool === 'Write') out = addFile(out, e.file_path)
      else if (e.tool === 'NotebookEdit') out = addFile(out, e.notebook_path)
      else if (e.tool === 'Bash') out = addCommit(out, e.command, r.result?.stdout ?? '', !r.isError)
      return out
    })
    return result
  }).catch(($, e, next) => next(e))

  // Registered after the ledger, so the ledger wraps the guard and counts its denials too.
  registerGuard(on, options)
  registerMemo(on, options)
  registerCompact(on, options)
  registerHint(on, options)

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await track($, endTurn)
      if ((await $.session.surfaces()).length > 0) {
        await refreshStats($)
        await pollOrphans($)
        // Count of claude -p children below this session, as of this turn end.
        const n = (await read($, orphansAtom)).length
        const usage = await $.session.usage().catch(() => undefined)
        const cost = costText(usage?.cost?.usd, usage?.rateLimits ?? [])
        $.ui.status(statusLine({ orphans: n, cost, task: taskStatus(await runningTask($), (await $.clock.now()) as number) }))
        const budget = Number(options.cost_budget_usd ?? 0)
        if (budget > 0 && !isBudgetToasted && (usage?.cost?.usd ?? 0) >= budget) {
          isBudgetToasted = true
          $.ui.toast(`session cost $${usage!.cost!.usd.toFixed(2)} reached the $${budget} budget`)
        }
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'task' }, async ($, e) => {
    const cmd = parseTask(e.args)
    const now = (await $.clock.now()) as number
    const t = await runningTask($)
    if (cmd.op === 'show') return { text: t ? taskStatus(t, now) : 'No task running. /task <name> starts one.' }
    if (cmd.op === 'log') {
      const log = ((await $.store.get(TASK_LOG_KEY)) as Done[] | undefined) ?? []
      const lines = todayLines(log, dayOf(now))
      return { text: lines.length > 0 ? lines.join('\n') : 'No finished task today.' }
    }
    let text = ''
    if (t) {
      const log = ((await $.store.get(TASK_LOG_KEY)) as Done[] | undefined) ?? []
      await $.store.set(TASK_LOG_KEY, appendLog(log, { name: t.name, ms: now - t.start, day: dayOf(t.start) }))
      await $.store.delete(TASK_KEY)
      text = `done: ${taskStatus(t, now).slice(2)}`
    }
    if (cmd.op === 'start') {
      await $.store.set(TASK_KEY, { name: cmd.name, start: now })
      text = [text, `started: ${cmd.name}`].filter(Boolean).join('\n')
      void tick($).catch(() => {})
    }
    await paintTask($)
    return { text: text || 'No task running.' }
  }).catch(($, e, next) => next(e))

  // The pane opens only from its command.
  on('command.run', { command: 'session' }, async ($, e) => {
    if (e.args.trim() === 'retro') await update($, tab, () => 'retro')
    await openPane($)
    return { text: 'Session pane opened.' }
  }).catch(($, e, next) => next(e))

  // Save the summary, then reset in place: /clear ends a session with no new session.start.
  // No UI here and no git or ps: the terminal may be gone and the time is short. Headless runs too.
  on('session.end', async ($, e, next) => {
    try {
      const l = await read($, ledger)
      if (!isEmpty(l)) {
        if (leftSomething(l)) {
          const day = new Date((await $.clock.now()) as number).toISOString().slice(0, 10)
          await $.store.set(LAST_KEY, summarize(l, day))
        }
        await update($, ledger, () => emptyLedger())
        await update($, statsAtom, () => ({}))
      }
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  // One row above the prompt on the first start after a session that left something.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const last = (await read($, band)) ? await read($, lastAtom) : null
    const recap = await read($, recapAtom)
    if (!last && !recap) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = (await $.clock.now()) as number
    return (
      <Box flexDirection="column">
        {recap && (
          <Box borderStyle="round" borderDimColor paddingX={1} gap={1}>
            <Box flexShrink={1}>
              <Text wrap="truncate-end">{`last recap of this project, ${fmtAgo(now - recap.ts)}`}</Text>
            </Box>
            <Box flexShrink={0} gap={1}>
              <Button key="recap" label="Recap" onPress={async () => { await $.ui.open({ id: RECAP_PANE, title: 'Recap' }) }} />
              <Button key="recap-dismiss" label="dismiss" onPress={async () => { await update($, recapAtom, () => null) }} />
            </Box>
          </Box>
        )}
        {last && (
        <Box borderStyle="round" borderDimColor paddingX={1} gap={1}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              {`last session: ${last.files} files, ${last.commits} commits, ${last.denied} denied, longest gap ${fmtMs(last.longestMs)}`}
            </Text>
          </Box>
          <Box flexShrink={0} gap={1}>
            <Button
              key="retro"
              label="Retro"
              onPress={async () => {
                await update($, tab, () => 'retro')
                await openPane($)
              }}
            />
            <Button
              key="dismiss"
              label="dismiss"
              onPress={async () => {
                await update($, band, () => false)
                await update($, lastAtom, () => null)
                try {
                  await $.store.delete(LAST_KEY)
                } catch {}
              }}
            />
          </Box>
        </Box>
        )}
        {await next(e)}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, tab)
    const header = (
      <Box borderStyle="round" borderColor="claude" gap={1}>
        <Text key="title" bold>session</Text>
        <Button
          key="tab-retro"
          label="Retro [1]"
          hotkey="1"
          variant={current === 'retro' ? 'primary' : undefined}
          onPress={() => update($, tab, () => 'retro')}
        />
        <Button
          key="tab-orphans"
          label="Orphans [2]"
          hotkey="2"
          variant={current === 'orphans' ? 'primary' : undefined}
          onPress={() => update($, tab, () => 'orphans')}
        />
      </Box>
    )
    if (current === 'orphans') {
      if (await isWindows($)) {
        return (
          <Box flexDirection="column">
            {header}
            <Text dimColor>process list is off on Windows</Text>
            <Text dimColor>background shells and subagents: see /tasks</Text>
          </Box>
        )
      }
      const rows = await read($, orphansAtom)
      const now = (await $.clock.now()) as number
      return (
        <Box flexDirection="column">
          {header}
          <Text bold color="claude">{`claude -p children (${rows.length})`}</Text>
          {rows.length === 0 && <Text dimColor>○ none</Text>}
          {rows.map(r => (
            <Box key={`o-${r.pid}`} gap={1}>
              <Text color="warning">●</Text>
              <Box flexShrink={0}><Text>{String(r.pid)}</Text></Box>
              <Box flexShrink={1}><Text wrap="truncate-end">{r.cmd}</Text></Box>
              <Box flexShrink={0}><Text dimColor>{fmtAge(r.start, now)}</Text></Box>
              <Button key={`stop-${r.pid}`} label="stop" onPress={() => stopOrphan($, r)} />
            </Box>
          ))}
          <Text dimColor>background shells and subagents: see /tasks</Text>
        </Box>
      )
    }
    const l = await read($, ledger)
    const stats = await read($, statsAtom)
    const last = await read($, lastAtom)
    // Nothing yet this session: show what the previous one left, as `/session retro` promises.
    if (isEmpty(l) && last) {
      return (
        <Box flexDirection="column">
          {header}
          <Text bold color="claude">{`last session  ${last.day}`}</Text>
          <Text bold color="claude">{`files (${last.files})`}</Text>
          {last.fileList.map(f => <Text key={`f-${f}`} wrap="truncate-start">{`· ${f}`}</Text>)}
          <Text>{`${last.commits} commits · ${last.denied} denied · longest gap ${fmtMs(last.longestMs)}`}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {header}
        <Text bold color="claude">{`files (${l.files.length})`}</Text>
        {l.files.length === 0 && <Text dimColor>○ none</Text>}
        {l.files.map(f => (
          <Text key={`f-${f}`} wrap="truncate-start">{`· ${f}${statOf(stats, f) ? `  ${statOf(stats, f)}` : ''}`}</Text>
        ))}
        <Text bold color="claude">{`commits (${l.commits.length})`}</Text>
        {l.commits.length === 0 && <Text dimColor>○ none</Text>}
        {l.commits.map(c => (
          <Box key={`c-${c.hash}`} gap={1}>
            <Text color="success">✔</Text>
            <Text wrap="truncate-end">{`${c.hash} ${c.subject}`}</Text>
          </Box>
        ))}
        <Text bold color="claude">{`denied (${l.denied.length})`}</Text>
        {l.denied.length === 0 && <Text dimColor>○ none</Text>}
        {l.denied.map((d, i) => (
          <Box key={`d-${i}`} gap={1}>
            <Text color="error">✘</Text>
            <Text wrap="truncate-end">{`${d.tool}  ${d.reason}`}</Text>
          </Box>
        ))}
        <Text bold color="claude">{`longest gap  ${fmtMs(stepSpan(l.steps))}`}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
