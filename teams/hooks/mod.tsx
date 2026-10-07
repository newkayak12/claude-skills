import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TeamsEvent } from '../types'

const cursor = atom({ plugin: 'teams', key: 'cursor' } as const, 0)
const status = atom({ plugin: 'teams', key: 'status' } as const, '')
const waiting = atom({ plugin: 'teams', key: 'waiting' } as const, 0)
const events = atom({ plugin: 'teams', key: 'events' } as const, [] as TeamsEvent[])
const watch = atom({ plugin: 'teams', key: 'watch' } as const, [] as string[])
const view = atom({ plugin: 'teams', key: 'view' } as const, 'tickets' as 'tickets' | 'pipeline' | 'events')

const board = atom({ plugin: 'teams', key: 'board' } as const, '')

const PANE = 'teams-live'
const NO_RUN = 'No teams run in this session.'

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

// the pane text for the last watched task; the tick and a pane button write it, the render only reads it
async function refreshBoard($: EngineInterface) {
  const kind = await read($, view)
  const id = (await read($, watch)).at(-1)
  if (id === undefined || kind === 'events') return
  try {
    const out = await $.process.run(['node', `${$.plugin.root}/scripts/view.mjs`, '--once', '--task', id, '--view', kind])
    await update($, board, () => (out.exitCode === 0 ? out.stdout : `teams view failed (exit ${out.exitCode})`))
  } catch {
    await update($, board, () => 'teams view failed')
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

        // the pane text is produced here, only while the pane is open
        if ((await $.ui.panes()).some(p => p.id === PANE)) await refreshBoard($)
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

  // asked for by the person: the pane seats at any width
  on('command.run', { command: 'teams-live' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Teams' })
    return { text: 'teams-live: pane opened; the status line and toasts report teams runs of this session.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const kind = await read($, view)
    const list = await read($, watch)
    const id = list[list.length - 1]
    let body = NO_RUN
    if (id !== undefined) {
      if (kind === 'events') {
        const lines = (await read($, events)).filter(one => one.task_id === id).slice(-20).map(one => one.text)
        body = lines.length > 0 ? lines.join('\n') : 'No events yet.'
      } else {
        body = (await read($, board)) || 'Loading...'
      }
    }
    return (
      <Box flexDirection="column">
        <Box>
          {(['tickets', 'pipeline', 'events'] as const).map(one => (
            <Button key={one} label={`[${one}]`} onPress={async () => {
              await update($, view, () => one)
              await refreshBoard($)
            }} />
          ))}
        </Box>
        <Text>{body}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const line = await read($, status)
    if (line === '' || e.props.hasSurvey) return next(e)
    const n = await read($, waiting)
    const { Box, Button, Text } = $.ui.resolve(e)
    const open = () => $.ui.open({ id: PANE, title: 'Teams' })
    return (
      <Box>
        <Text dimColor wrap="truncate-end">{line} </Text>
        <Button key="board" label="[board]" onPress={open} />
        {n > 0 && <Button key="inbox" label={`[inbox ${n}]`} onPress={open} />}
      </Box>
    )
  })

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
