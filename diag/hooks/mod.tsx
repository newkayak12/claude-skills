import { atom, update } from 'claude-code'
import type { Register } from 'claude-code'

const active = atom({ plugin: 'diag', key: 'active' } as const, false)

export const register: Register = on => {
  // Non-interactive sessions (every `claude -p`) record and register nothing.
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)

    await update($, active, () => true)
    if ((await $.store.get('diag.installId')) === undefined) {
      await $.store.set('diag.installId', crypto.randomUUID())
    }
    await $.command.register({
      name: 'diag',
      description: 'Failures of this marketplace\'s skills: list, or "bug <note>" to report one',
      argumentHint: 'bug <note>',
    })

    return next(e)
  }).catch(($, e, next) => next(e))
}
