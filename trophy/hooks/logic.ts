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

const distinct = (uses: readonly Use[], plugin?: string) =>
  new Set(uses.filter(u => plugin === undefined || u.plugin === plugin).map(u => u.skill)).size

// How many of a combo's skills appear in order inside one session; the best session counts.
function comboSteps(uses: readonly Use[], sequence: readonly string[]) {
  const sessions = new Map<string, Use[]>()
  for (const u of uses) sessions.set(u.session, [...(sessions.get(u.session) ?? []), u])
  let best = 0
  for (const list of sessions.values()) {
    let step = 0
    for (const u of [...list].sort((a, b) => a.ts - b.ts)) if (u.skill === sequence[step]) step += 1
    best = Math.max(best, step)
  }
  return best
}

function longestStreak(uses: readonly Use[]) {
  const days = [...new Set(uses.map(u => Date.parse(u.day) / 86_400_000))].sort((a, b) => a - b)
  let best = 0
  let run = 0
  days.forEach((d, i) => {
    run = i > 0 && d - days[i - 1]! === 1 ? run + 1 : 1
    best = Math.max(best, run)
  })
  return best
}

// [have, need] for one achievement; the pane draws it and evaluate compares it.
export function progress(uses: readonly Use[], { rule }: Achievement): [number, number] {
  switch (rule.kind) {
    case 'first_use':
      return [uses.some(u => u.plugin === rule.plugin) ? 1 : 0, 1]
    case 'collect':
      return [Math.min(distinct(uses, rule.plugin), rule.count), rule.count]
    case 'combo':
      return [comboSteps(uses, rule.sequence), rule.sequence.length]
    case 'streak':
      return [Math.min(longestStreak(uses), rule.days), rule.days]
    case 'repeat':
      return [Math.min(uses.filter(u => u.skill === rule.skill).length, rule.count), rule.count]
  }
}

// Ids newly met: never one already unlocked.
export function evaluate(uses: readonly Use[], catalog: readonly Achievement[], unlocked: Readonly<Record<string, string>>) {
  return catalog
    .filter(a => unlocked[a.id] === undefined)
    .filter(a => {
      const [have, need] = progress(uses, a)
      return have >= need
    })
    .map(a => a.id)
}
