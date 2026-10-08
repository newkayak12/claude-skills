import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

import { addCommit, addDeny, addFile, addStep, emptyLedger, endTurn } from './ledger.ts'
import type { Ledger } from './ledger.ts'

const tab = atom({ plugin: 'session', key: 'tab' } as const, 'retro' as 'retro' | 'orphans')
const band = atom({ plugin: 'session', key: 'band' } as const, false)
const ledger = atom({ plugin: 'session', key: 'ledger' } as const, emptyLedger())

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
    if (e.agentId === undefined) await track($, endTurn)
    return next(e)
  }).catch(($, e, next) => next(e))
}
