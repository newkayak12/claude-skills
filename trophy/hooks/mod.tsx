import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { achievements } from '../data/achievements.ts'
import { triggers } from '../data/triggers.ts'
import {
  achievementRow,
  addTurn,
  closeTurn,
  dayOf,
  evaluate,
  matchTriggers,
  recordUse,
  resolveSkill,
  sumDays,
  triggerLists,
} from './logic.ts'
import type { DayCounts, Use } from './logic.ts'

const active = atom({ plugin: 'trophy', key: 'active' } as const, false)
const turnMatched = atom({ plugin: 'trophy', key: 'turnMatched' } as const, [] as string[])
const turnFired = atom({ plugin: 'trophy', key: 'turnFired' } as const, [] as string[])
const turnTyped = atom({ plugin: 'trophy', key: 'turnTyped' } as const, false)
const tab = atom({ plugin: 'trophy', key: 'tab' } as const, 'trophies' as 'trophies' | 'triggers')

const PANE = 'trophy'

// Records one skill use; always called before `next`, so a throw here falls to the hook's `.catch`.
async function note($: EngineInterface, name: string) {
  if (!(await read($, active))) return
  const hit = resolveSkill(name, triggers)
  if (!hit) return
  const uses = ((await $.store.get('trophy.uses')) ?? []) as Use[]
  const now = await $.clock.now()
  const recorded = recordUse(uses, hit.skill, now, await $.session.id())
  await $.store.set('trophy.uses', recorded)
  await update($, turnFired, list => [...list, hit.skill])

  const unlocked = ((await $.store.get('trophy.unlocked')) ?? {}) as Record<string, string>
  const fresh = evaluate(recorded, achievements, unlocked)
  if (fresh.length === 0) return
  await $.store.set('trophy.unlocked', { ...unlocked, ...Object.fromEntries(fresh.map(id => [id, dayOf(now)])) })
  for (const a of achievements.filter(a => fresh.includes(a.id))) $.ui.toast(`🏆 ${a.title} — ${a.description}`)
}

export const register: Register = on => {
  // Non-interactive sessions (every `claude -p`, so every teams/graph adapter) stay idle.
  on('session.start', async ($, e, next) => {
    if (!e.isInteractive) return next(e)

    await update($, active, () => true)
    if ((await $.store.get('trophy.installId')) === undefined) {
      await $.store.set('trophy.installId', crypto.randomUUID())
    }
    await $.command.register({
      name: 'achievements',
      description: 'Show your skill achievements',
    })
    await $.command.register({
      name: 'trophy-telemetry',
      description: 'Anonymous usage counts: on, off or status',
      argumentHint: 'on|off|status',
    })

    return next(e)
  }).catch(($, e, next) => next(e))

  // skill.prompt is skipped for user-tier hooks under some organizations' policy (00-spike-findings),
  // so the Skill tool and the typed command report the same uses.
  on('skill.prompt', async ($, e, next) => {
    await note($, e.skill)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    await note($, e.skill)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.UserPromptExpansion', async ($, e, next) => {
    if (e.expansion_type === 'slash_command') await note($, e.command_name)
    return next(e)
  }).catch(($, e, next) => next(e))

  // A prompt's trigger phrases are matched on the way in and judged against the skills that fired when the turn ends.
  on('prompt.submit', async ($, e, next) => {
    if (await read($, active)) {
      await update($, turnMatched, () => matchTriggers(e.text, triggers))
      await update($, turnFired, () => [])
      await update($, turnTyped, () => e.text.trimStart().startsWith('/'))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if ((await read($, active)) && e.agentId === undefined && !(await read($, turnTyped))) {
      const turn = closeTurn(await read($, turnMatched), await read($, turnFired))
      await update($, turnMatched, () => [])
      await update($, turnFired, () => [])
      if (turn.hit.length + turn.miss.length + turn.unmatched.length > 0) {
        const counts = ((await $.store.get('trophy.triggers')) ?? {}) as DayCounts
        await $.store.set('trophy.triggers', addTurn(counts, dayOf(await $.clock.now()), turn))
      }
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The pane opens only from its command.
  on('command.run', { command: 'achievements' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Achievements' })
    return { text: 'Achievements pane opened.' }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const current = await read($, tab)
    const unlocked = ((await $.store.get('trophy.unlocked')) ?? {}) as Record<string, string>
    const header = (
      <Box>
        <Text key="count" bold>
          {Object.keys(unlocked).length} / {achievements.length} 해금{' '}
        </Text>
        <Button key="tab-trophies" label="업적" onPress={() => update($, tab, () => 'trophies')} />
        <Button key="tab-triggers" label="트리거" onPress={() => update($, tab, () => 'triggers')} />
      </Box>
    )

    if (current === 'triggers') {
      const counts = ((await $.store.get('trophy.triggers')) ?? {}) as DayCounts
      const lists = triggerLists(sumDays(counts, dayOf(await $.clock.now()), 7), triggers)
      const never = lists.never.slice(0, 5).join(', ')
      return (
        <Box flexDirection="column">
          {header}
          <Text bold>가장 많이 맞은 스킬 (7일)</Text>
          {lists.hit.map(([skill, n]) => (
            <Text>{skill} · {n}</Text>
          ))}
          <Text bold>가장 많이 놓친 스킬 (트리거 문구는 있었는데 안 쓴)</Text>
          {lists.miss.map(([skill, n]) => (
            <Text>{skill} · {n}</Text>
          ))}
          <Text bold>한 번도 안 쓴 스킬 ({lists.never.length})</Text>
          <Text dimColor>{never}</Text>
        </Box>
      )
    }

    const uses = ((await $.store.get('trophy.uses')) ?? []) as Use[]
    return (
      <Box flexDirection="column">
        {header}
        {achievements.map(a => (
          <Text key={`row-${a.id}`}>{achievementRow(a, uses, unlocked[a.id])}</Text>
        ))}
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
