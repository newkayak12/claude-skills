import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { ageHint, clean, facts, MAX_NOTES, noteLines, parse, refusal, render, USAGE } from './memo-logic.ts'
import type { Note } from './memo-logic.ts'

const PANE = 'memo'
const FOOTER = '/memo add <text> · /memo rm <n> · /memo clear · Esc, q or /memo closes'
const GLOBAL = 'memo.global'
const projectKey = (root: string) => `memo.project:${root}`

// armed: true until the block went to the model in this conversation; /compact, /clear and every write set it again.
// sentAt: epoch ms of that send, 0 before the first one.
const armed = atom({ plugin: 'session', key: 'memo' } as const, { armed: true, sentAt: 0 })

async function load($: any): Promise<{ g: Note[]; p: Note[]; root: string }> {
  const root = (await $.session.root()) as string
  return { g: clean(await $.store.get(GLOBAL)), p: clean(await $.store.get(projectKey(root))), root }
}

const save = async ($: any, key: string, notes: Note[]) => {
  await $.store.set(key, notes)
  await update($, armed, prev => ({ ...prev, armed: true }))
}

export const register: Register = (on, _options) => {
  on('command.run', { command: 'memo' }, async ($, e) => {
    try {
      const cmd = parse(e.args)
      if (cmd.op === 'usage') return { text: USAGE }
      const { g, p, root } = await load($)
      const now = (await $.clock.now()) as number
      const note = 'Applies from the next prompt.'
      if (cmd.op === 'pane' || cmd.op === 'list') {
        const surfaces = (await $.session.surfaces()) as unknown[]
        if (surfaces.length > 0) {
          // bare /memo on an open pane closes it
          if (cmd.op === 'pane' && ((await $.ui.panes()) as { id: string }[]).some(p => p.id === PANE)) {
            await $.ui.close({ id: PANE })
            return { text: 'Memo pane closed.' }
          }
          await $.ui.open({ id: PANE, title: 'Memo', focus: true, closeOnEscape: true })
          return { text: 'Memo pane opened.' }
        }
        if (g.length + p.length === 0) return { text: USAGE }
        const f = facts(g, p, now)
        const all = [...f.v.g, ...f.v.p]
        const lines = noteLines(f.v.g, f.v.p).map((l, i) => {
          const h = ageHint(all[i]!, now)
          return `${i + 1}. ${l}${h ? `  (${h})` : ''}`
        })
        return { text: [...lines, f.count, f.cut].filter(Boolean).join('\n') }
      }
      if (cmd.op === 'add') {
        const why = refusal(g, p, cmd.text)
        if (why) {
          try {
            $.ui.toast(`memo: ${why}`, { timeoutMs: 6000 })
          } catch {}
          return { text: why }
        }
        const entry = { text: cmd.text, ts: now }
        if (cmd.global) await save($, GLOBAL, [...g, entry])
        else await save($, projectKey(root), [...p, entry])
        return { text: `Note added (${cmd.global ? 'global' : 'project'}). ${g.length + p.length + 1}/${MAX_NOTES}. ${note}` }
      }
      if (cmd.op === 'rm') {
        const all = [...g.map(n => ({ n, key: GLOBAL })), ...p.map(n => ({ n, key: projectKey(root) }))]
        const hit = all[cmd.n - 1]
        if (!hit) return { text: `No note ${cmd.n}. ${USAGE}` }
        const rest = all.filter(x => x !== hit && x.key === hit.key).map(x => x.n)
        await save($, hit.key, rest)
        return { text: `Note ${cmd.n} removed. ${note}` }
      }
      if (cmd.op !== 'clear') return { text: USAGE }
      await save($, cmd.global ? GLOBAL : projectKey(root), [])
      return { text: `Cleared ${cmd.global ? 'global' : 'project'} notes. ${note}` }
    } catch {
      return { text: 'memo: the note store could not be read or written; nothing changed' }
    }
  }).catch(($, e, next) => next(e))

  // The block rides once per conversation; a bad store leaves the prompt untouched.
  on('prompt.submit', async ($, e, next) => {
    try {
      if (!(await read($, armed)).armed) return next(e)
      const { g, p } = await load($)
      const block = render(g, p)
      if (!block) return next(e)
      const sentAt = (await $.clock.now()) as number
      await update($, armed, prev => ({ ...prev, armed: false, sentAt }))
      return next({ ...e, context: [...(e.context ?? []), block] })
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))

  // A new context window (after /compact or /clear) has lost the block; resume and startup have not.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'compact' || e.source === 'clear') await update($, armed, prev => ({ ...prev, armed: true }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    let g: Note[] = []
    let p: Note[] = []
    try {
      ;({ g, p } = await load($))
    } catch {}
    const now = (await $.clock.now()) as number
    const f = facts(g, p, now, (await read($, armed)).sentAt)
    const lines = noteLines(f.v.g, f.v.p)
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="claude" gap={1}>
          <Text key="title" bold>memo</Text>
          <Button key="close" role="dismiss" label="close [q]" hotkey="q" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {lines.length === 0 && <Text dimColor>{USAGE}</Text>}
        {lines.length > 0 && <Text key="s" dimColor wrap="truncate-end">{f.summary}</Text>}
        {lines.length > 0 && <Text key="h" bold wrap="truncate-end">{render(g, p).split('\n')[0]}</Text>}
        {lines.map((l, i) => <Text key={`n-${i}`} wrap="truncate-end">{l}</Text>)}
        {f.rows.map(r => (
          <Box key={`m-${r.n}`} gap={1}>
            <Text dimColor>{r.meta}</Text>
            {r.stale && <Text color="warning" wrap="truncate-end">{r.hint}</Text>}
          </Box>
        ))}
        {f.cut !== '' && <Text color="warning" wrap="truncate-end">{f.cut}</Text>}
        {lines.length > 0 && <Text dimColor wrap="truncate-end">{FOOTER}</Text>}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
