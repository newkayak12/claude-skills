import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

const tab = atom({ plugin: 'session', key: 'tab' } as const, 'retro' as 'retro' | 'orphans')
const band = atom({ plugin: 'session', key: 'band' } as const, false)

export const register: Register = on => {
  // Non-interactive sessions (every `claude -p`) get no command and no UI.
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
}
