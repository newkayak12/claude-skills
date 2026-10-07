import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TeamsEvent } from '../types'

const cursor = atom({ plugin: 'teams', key: 'cursor' } as const, 0)
const status = atom({ plugin: 'teams', key: 'status' } as const, '')
const waiting = atom({ plugin: 'teams', key: 'waiting' } as const, 0)
const events = atom({ plugin: 'teams', key: 'events' } as const, [] as TeamsEvent[])
const watch = atom({ plugin: 'teams', key: 'watch' } as const, [] as string[])

const asRecord = (v: unknown): Record<string, unknown> | undefined =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined

// task_id of a tm_open/tm_run result: structuredContent first, then JSON in content[0].text
function taskIdOf(r: { result?: unknown; text?: unknown }): string | undefined {
  const res = asRecord(r.result)
  const fromStructured = asRecord(res?.structuredContent)?.task_id
  if (typeof fromStructured === 'string' && fromStructured !== '') return fromStructured
  const content = res?.content
  const first = Array.isArray(content) ? asRecord(content[0])?.text : r.text
  if (typeof first !== 'string') return undefined
  try {
    const id = asRecord(JSON.parse(first))?.task_id
    return typeof id === 'string' && id !== '' ? id : undefined
  } catch {
    return undefined
  }
}

const TICK_MS = 3000
const MAX_EVENTS = 200

export const register: Register = on => {
  let isRunning = false

  on('session.start', async ($, e, next) => {
    if ((await $.session.surfaces()).length === 0) return next(e)

    const VIEW = `${$.plugin.root}/scripts/view.mjs`

    async function tick() {
      if (isRunning) return
      isRunning = true
      try {
        const cwd = await $.session.cwd()
        const since = await read($, cursor)

        const ev = await $.process.run([
          'node', VIEW, '--once', '--format', 'events', '--since', String(since), '--cwd', cwd,
        ])
        if (ev.exitCode === 0) {
          const fresh: TeamsEvent[] = []
          for (const line of ev.stdout.split('\n')) {
            if (!line.trim()) continue
            try {
              const one = JSON.parse(line) as TeamsEvent
              if (one.ts > since) fresh.push(one)
            } catch {
              // a torn line: skip it
            }
          }
          if (fresh.length > 0) {
            for (const one of fresh) $.ui.toast(one.text)
            const latest = Math.max(...fresh.map(one => one.ts))
            await update($, cursor, () => latest)
            await update($, events, list => [...list, ...fresh].slice(-MAX_EVENTS))
          }
        }

        const st = await $.process.run(['node', VIEW, '--once', '--format', 'status', '--cwd', cwd])
        if (st.exitCode === 0) {
          const parsed = JSON.parse(st.stdout) as { line: string; waiting: number }
          $.ui.status(parsed.line === '' ? undefined : parsed.line)
          await update($, status, () => parsed.line)
          await update($, waiting, () => parsed.waiting)
        }
      } catch {
        // a failed run or unreadable output leaves the last status as it was
      } finally {
        isRunning = false
      }
    }

    await $.command.register({
      name: 'teams-live',
      description: 'Teams runs of this session: status line and toasts are on',
    })
    // events older than this session's start are not toasted
    const now = await $.clock.now()
    await update($, cursor, since => (since === 0 ? now : since))
    $.clock.every(TICK_MS, tick)

    return next(e)
  })

  on('command.run', { command: 'teams-live' }, async () => ({
    text: 'teams-live: the status line and toasts report teams runs of this session.',
  }))

  // react only: the result goes back unchanged; interactive sessions only
  on('tool.call', { tool: /__(tm_open|tm_run)$/ }, async ($, e, next) => {
    const r = await next(e)
    if ((await $.session.surfaces()).length === 0) return r
    if (r.deny !== undefined) return r
    const id = taskIdOf(r)
    if (id !== undefined) await update($, watch, list => (list.includes(id) ? list : [...list, id]))
    return r
  }).catch(($, e, next) => next(e))

  // guard: runs headless too
  on('tool.call', { tool: /__team_status$/ }, ($, e, next) => {
    const args = e as unknown as { full?: unknown; node_id?: unknown }
    if (args.full === true && !args.node_id) {
      return { deny: 'team_status full:true dumps every node; pass node_id or read detail_path (teams:orchestrate NEVER rule)' }
    }
    return next(e)
  }).catch(($, e, next) => next(e))
}
