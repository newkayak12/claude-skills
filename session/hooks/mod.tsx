import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  addCommit, addDeny, addFile, addStep, emptyLedger, endTurn, fmtMs, parseNumstat, statOf, stepSpan,
} from './ledger.ts'
import type { Ledger } from './ledger.ts'

const tab = atom({ plugin: 'session', key: 'tab' } as const, 'retro' as 'retro' | 'orphans')
const band = atom({ plugin: 'session', key: 'band' } as const, false)
const ledger = atom({ plugin: 'session', key: 'ledger' } as const, emptyLedger())

const statsAtom = atom({ plugin: 'session', key: 'stats' } as const, {} as Record<string, string>)

const PANE = 'session'

// One `git diff --numstat` for the touched files, never in a draw. No git or a slow one: keep what was there.
async function refreshStats($: any) {
  try {
    const files = (await read($, ledger)).files
    if (files.length === 0) return
    const r = await $.process.run(['git', 'diff', '--numstat', '--', ...files], { timeoutMs: 5000 })
    if (r.exitCode === 0) await update($, statsAtom, () => parseNumstat(r.stdout))
  } catch {}
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
      if ((await $.session.surfaces()).length > 0) await refreshStats($)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The pane opens only from its command.
  on('command.run', { command: 'session' }, async $ => {
    await refreshStats($)
    await $.ui.open({ id: PANE, title: 'Session' })
    return { text: 'Session pane opened.' }
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
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>○ none</Text>
        </Box>
      )
    }
    const l = await read($, ledger)
    const stats = await read($, statsAtom)
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
