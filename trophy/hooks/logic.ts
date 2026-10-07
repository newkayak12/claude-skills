// Pure functions of the trophy module: no `$`, no store, no clock.

export type Use = { skill: string; plugin: string; day: string; session: string; ts: number }

export type Rule =
  | { kind: 'first_use'; plugin: string }
  | { kind: 'collect'; count: number; plugin?: string }
  | { kind: 'combo'; sequence: string[] }
  | { kind: 'streak'; days: number }
  | { kind: 'repeat'; skill: string; count: number }

export type Achievement = {
  id: string
  title: string
  description: string
  hidden?: true
  rule: Rule
}

export type TriggerEntry = { skill: string; plugin: string; phrases: string[] }

export const MAX_USES = 5000
const DUPLICATE_MS = 5000

export const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10)

// `plugin:skill` of this marketplace stays; a bare name maps through the index (two owners: kept bare, no plugin).
export function resolveSkill(name: string, index: readonly TriggerEntry[]): { skill: string; plugin: string } | null {
  if (name.includes(':')) {
    return index.some(t => t.skill === name) ? { skill: name, plugin: name.split(':')[0]! } : null
  }
  const owners = index.filter(t => t.skill.endsWith(`:${name}`))
  if (owners.length === 0) return null
  if (owners.length === 1) return { skill: owners[0]!.skill, plugin: owners[0]!.plugin }
  return { skill: name, plugin: '' }
}

// The Skill tool, skill.prompt and the typed command all report one use: same skill, same session, within 5 s is one.
export function recordUse(uses: readonly Use[], skill: string, now: number, session: string): Use[] {
  const last = uses[uses.length - 1]
  if (last && last.skill === skill && last.session === session && now - last.ts < DUPLICATE_MS) return [...uses]
  const plugin = skill.includes(':') ? skill.split(':')[0]! : ''
  return [...uses, { skill, plugin, day: dayOf(now), session, ts: now }].slice(-MAX_USES)
}
