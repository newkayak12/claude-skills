import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  addCommit, addDeny, addFile, addStep, emptyLedger, endTurn, fmtMs, isEmpty, parseNumstat, statOf, stepSpan, summarize,
} from './ledger.ts'
import type { Ledger, Summary } from './ledger.ts'
import { checkKill } from './kill.ts'
import type { Verdict } from './kill.ts'
import { ancestorsOf, fmtAge, matchOrphans, parsePs, PS_ARGV } from './procs.ts'
import type { Row } from './procs.ts'

const tab = atom({ plugin: 'session', key: 'tab' } as const, 'retro' as 'retro' | 'orphans')
const band = atom({ plugin: 'session', key: 'band' } as const, false)
const ledger = atom({ plugin: 'session', key: 'ledger' } as const, emptyLedger())

const statsAtom = atom({ plugin: 'session', key: 'stats' } as const, {} as Record<string, string>)

const lastAtom = atom({ plugin: 'session', key: 'last' } as const, null as Summary | null)

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

// The ledger never changes what the engine returns: any failure while recording is swallowed.
const track = async ($: any, change: (l: Ledger) => Ledger) => {
  try {
    await update($, ledger, change)
  } catch {}
}

export const register: Register = on => {
  // Non-interactive sessions (every `claude -p`) get no command and no UI; the ledger still runs below.
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)
    // First start of the session: defaults. A later start (hot reload) keeps what is there.
    await update($, tab, t => t ?? 'retro')
    await update($, band, b => b ?? false)
    try {
      const stored = (await $.store.get(LAST_KEY)) as Summary | undefined
      await update($, lastAtom, () => stored ?? null)
      await update($, band, () => stored !== undefined)
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

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await track($, endTurn)
      if ((await $.session.surfaces()).length > 0) {
        await refreshStats($)
        await pollOrphans($)
        // Same line `mods` wrote (feature 8) so the move is invisible; 7b removes the mods side.
        const n = (await read($, orphansAtom)).length
        $.ui.status(n > 0 ? `⧗ ${n} claude -p child(ren) running` : undefined)
      }
    }
    return next(e)
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
        const day = new Date((await $.clock.now()) as number).toISOString().slice(0, 10)
        await $.store.set(LAST_KEY, summarize(l, day))
        await update($, ledger, () => emptyLedger())
        await update($, statsAtom, () => ({}))
      }
    } catch {}
    return next(e)
  }).catch(($, e, next) => next(e))

  // One row above the prompt on the first start after a session that left something.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, band))) return next(e)
    const last = await read($, lastAtom)
    if (!last) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderDimColor paddingX={1} gap={1}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">
              {`last session: ${last.files} files, ${last.commits} commits, ${last.denied} denied, longest gap ${fmtMs(last.longestMs)}`}
            </Text>
          </Box>
          <Box flexShrink={0} gap={1}>
            <Button
              key="retro"
              label="[Retro]"
              onPress={async () => {
                await update($, tab, () => 'retro')
                await openPane($)
              }}
            />
            <Button
              key="dismiss"
              label="[dismiss]"
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
      const rows = (await isWindows($)) ? [] : await read($, orphansAtom)
      const now = (await $.clock.now()) as number
      return (
        <Box flexDirection="column">
          {header}
          <Text bold color="claude">{`claude -p children (${rows.length})`}</Text>
          {rows.length === 0 && <Text dimColor>○ none</Text>}
          {rows.map(r => (
            <Box key={`o-${r.pid}`} gap={1}>
              <Text color="warning">●</Text>
              <Text>{String(r.pid)}</Text>
              <Box flexShrink={1}><Text wrap="truncate-end">{r.cmd}</Text></Box>
              <Text dimColor>{fmtAge(r.start, now)}</Text>
              <Button key={`stop-${r.pid}`} label="[stop]" onPress={() => stopOrphan($, r)} />
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
