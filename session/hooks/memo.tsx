import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { ageHint, clean, MAX_NOTES, MAX_TOTAL, noteLines, parse, refusal, render, tokens, USAGE, visible } from './memo-logic.ts'
import type { Note } from './memo-logic.ts'

const PANE = 'memo'
const GLOBAL = 'memo.global'
const projectKey = (root: string) => `memo.project:${root}`

// True until the block went to the model in this conversation; /compact, /clear and every write set it again.
const armed = atom({ plugin: 'session', key: 'memo' } as const, { armed: true })

async function load($: any): Promise<{ g: Note[]; p: Note[]; root: string }> {
  const root = (await $.session.root()) as string
  return { g: clean(await $.store.get(GLOBAL)), p: clean(await $.store.get(projectKey(root))), root }
}

const save = async ($: any, key: string, notes: Note[]) => {
  await $.store.set(key, notes)
  await update($, armed, () => ({ armed: true }))
}

// Everything the pane and /memo list show beyond the block itself: counts, truncation, age hints.
function facts(g: Note[], p: Note[], now: number) {
  const v = visible(g, p)
  const shown = [...v.g, ...v.p]
  const chars = shown.reduce((n, x) => n + x.text.length, 0)
  const hints = shown.map((n, i) => ({ i: i + 1, hint: ageHint(n, now), tok: tokens(n) })).filter(h => h.hint)
  return {
    v,
    count: `${shown.length}/${MAX_NOTES} notes · ${chars}/${MAX_TOTAL} chars · ~${shown.reduce((n, x) => n + tokens(x), 0)} tok`,
    cut: v.cut ? 'truncated: the store is over its caps; only whole notes up to the caps are used' : '',
    hints: hints.map(h => `note ${h.i}: ${h.hint}`),
  }
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
        if (cmd.op === 'pane' && surfaces.length > 0) {
          await $.ui.open({ id: PANE, title: 'Memo' })
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
      await update($, armed, () => ({ armed: false }))
      return next({ ...e, context: [...(e.context ?? []), block] })
    } catch {
      return next(e)
    }
  }).catch(($, e, next) => next(e))

  // A new context window (after /compact or /clear) has lost the block; resume and startup have not.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'compact' || e.source === 'clear') await update($, armed, () => ({ armed: true }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    let g: Note[] = []
    let p: Note[] = []
    try {
      ;({ g, p } = await load($))
    } catch {}
    const now = (await $.clock.now()) as number
    const f = facts(g, p, now)
    const lines = noteLines(f.v.g, f.v.p)
    return (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="claude" gap={1}>
          <Text key="title" bold>memo</Text>
        </Box>
        {lines.length === 0 && <Text dimColor>{USAGE}</Text>}
        {lines.length > 0 && <Text key="h" bold>{render(g, p).split('\n')[0]}</Text>}
        {lines.map((l, i) => <Text key={`n-${i}`}>{l}</Text>)}
        {lines.length > 0 && <Text dimColor>{f.count}</Text>}
        {f.cut !== '' && <Text color="warning">{f.cut}</Text>}
        {f.hints.map(h => <Text key={h} dimColor>{h}</Text>)}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
