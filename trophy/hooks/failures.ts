// Failures of this marketplace's skills and MCP tools: pure logic, no `$`, no I/O. mod.tsx captures, logic.ts sends.

export type Reason =
  | 'is_error'
  | 'unsuccessful'
  | 'forked_unsuccessful'
  | 'mcp_error'
  | 'user_report'
  | 'subgoal_failed'
  | 'goal_failed'

export type Entry = {
  ts: number
  day: string
  kind: 'bug' | 'outcome' | 'report'
  reason: Reason
  plugin?: string
  skill?: string
  tool?: string
  // the failing plugin's version (its marketplace entry) and Claude Code's release, when known
  version?: string
  cc?: string
  session: string
  // Raw text stays on this machine: never read by buildBatch.
  local: { text?: string; note?: string; slug?: string; subgoal?: string; path?: string }
}

export type SentEvent = { event: string; properties: Record<string, string | number> }

const DEDUPE_MS = 5000
const KEEP = 500
const TMP_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/']

// The two places a marketplace.json can sit relative to the plugin root.
export function marketplaceCandidates(root: string, marketplace?: string): string[] {
  const parts = root.replace(/\/+$/, '').split('/')
  const up = (n: number) => parts.slice(0, Math.max(parts.length - n, 0)).join('/')
  const out = [up(1) + '/.claude-plugin/marketplace.json']
  if (marketplace) out.push(up(4) + '/marketplaces/' + marketplace + '/.claude-plugin/marketplace.json')
  return out
}

// `plugin:skill` only, and the skill must be one this marketplace ships (`skills` maps each plugin to
// its skill dir names): a bare name, a foreign plugin or typed free text after the colon is not ours.
export function ownedSkill(
  name: unknown,
  skills: Readonly<Record<string, readonly string[]>>,
): { plugin: string; skill: string } | undefined {
  if (typeof name !== 'string') return undefined
  const i = name.indexOf(':')
  if (i <= 0 || i === name.length - 1) return undefined
  const plugin = name.slice(0, i)
  const skill = name.slice(i + 1)
  return Object.hasOwn(skills, plugin) && skills[plugin]?.includes(skill) ? { plugin, skill } : undefined
}

const norm = (s: string) => s.replace(/[^a-zA-Z0-9_]/g, '_')

// `mcp__plugin_<plugin>_<server>__<tool>`, provenance `plugin`, server declared by that plugin.
export function ownedMcpTool(
  name: unknown,
  provenance: { source?: string } | undefined,
  servers: Readonly<Record<string, readonly string[]>>,
): { plugin: string; server: string; tool: string } | undefined {
  if (typeof name !== 'string' || provenance?.source !== 'plugin') return undefined
  for (const plugin of Object.keys(servers)) {
    for (const p of [plugin, norm(plugin)]) {
      const prefix = 'mcp__plugin_' + p + '_'
      if (!name.startsWith(prefix)) continue
      const rest = name.slice(prefix.length)
      for (const server of servers[plugin] ?? []) {
        for (const s of [server, norm(server)]) {
          const head = s + '__'
          if (rest.startsWith(head) && rest.length > head.length) {
            return { plugin, server, tool: rest.slice(head.length) }
          }
        }
      }
    }
  }
  return undefined
}

// A final failed subgoal result written by the harness engine; scratch copies are ignored.
export function harnessResult(
  path: string,
  content: string,
  tmpdirs: readonly string[] = [],
): { slug: string; subgoal: string; passed: false } | undefined {
  const m = /\/\.harness-run\/([^/]+)\/subgoals\/([^/]+)\/result\.json$/.exec(path)
  if (!m || m[1] === undefined || m[2] === undefined) return undefined
  const roots = TMP_PREFIXES.concat(tmpdirs.map(d => d.replace(/\/+$/, '') + '/'))
  if (roots.some(r => path.startsWith(r))) return undefined
  try {
    const body = JSON.parse(content) as { passed?: unknown }
    return body && body.passed === false ? { slug: m[1], subgoal: m[2], passed: false } : undefined
  } catch {
    return undefined
  }
}

// fallback-check.mjs final line: `COMPLETE <slug> goal-gate FAIL`. Not INCOMPLETE, not PASS.
export function goalFailed(stdout: string): boolean {
  return /^COMPLETE\b.*goal-gate FAIL/m.test(stdout)
}

const sameTarget = (a: Entry, b: Entry) => (a.skill ?? a.tool) === (b.skill ?? b.tool)

// Same reason + skill/tool + session within 5 s counts once; the newest 500 are kept.
export function appendEntry(log: readonly Entry[], entry: Entry): Entry[] {
  const dup = log.some(
    e => e.reason === entry.reason && e.session === entry.session && sameTarget(e, entry) &&
      Math.abs(entry.ts - e.ts) <= DEDUPE_MS,
  )
  if (dup) return log.slice()
  return log.concat([entry]).slice(-KEEP)
}

const SKILL_REASONS: readonly Reason[] = ['is_error', 'unsuccessful', 'forked_unsuccessful']

// One event per (day, reason, plugin, skill|tool, versions). Each property object lists its keys explicitly,
// so a field added to Entry later cannot leak. Outcomes, `local` and session ids never appear.
export function failureEvents(log: readonly Entry[], sentThrough: string | undefined, through: string): SentEvent[] {
  const groups = new Map<string, SentEvent>()
  for (const e of log) {
    if (e.day > through || (sentThrough !== undefined && e.day <= sentThrough)) continue
    let event: string
    let properties: Record<string, string | number>
    if (e.kind === 'bug' && SKILL_REASONS.includes(e.reason) && e.skill && e.plugin) {
      event = 'diag_skill_error'
      properties = { skill: e.skill, plugin: e.plugin, reason: e.reason, count: 1, day: e.day }
    } else if (e.kind === 'bug' && e.reason === 'mcp_error' && e.tool && e.plugin) {
      event = 'diag_mcp_error'
      properties = { tool: e.tool, plugin: e.plugin, reason: 'mcp_error', count: 1, day: e.day }
    } else if (e.kind === 'report' && e.reason === 'user_report') {
      event = 'diag_user_report'
      properties = { reason: 'user_report', count: 1, day: e.day }
      if (e.skill) properties.skill = e.skill
      if (e.plugin) properties.plugin = e.plugin
    } else {
      continue
    }
    if (e.version) properties.plugin_version = e.version
    if (e.cc) properties.cc_version = e.cc
    const key = [event, e.day, e.reason, e.plugin ?? '', e.skill ?? e.tool ?? '', e.version ?? '', e.cc ?? ''].join('|')
    const hit = groups.get(key)
    if (hit) hit.properties.count = (hit.properties.count as number) + 1
    else groups.set(key, { event, properties })
  }
  return Array.from(groups.values())
}

export const PANE_ROWS = 30

// Newest first, at most 30.
export const newest = (log: readonly Entry[]): Entry[] => log.slice(-PANE_ROWS).reverse()

export const rowTitle = (e: Entry): string =>
  [e.day, e.kind, e.reason, e.plugin && e.skill ? `${e.plugin}:${e.skill}` : (e.tool ?? e.plugin ?? '-')].join(' · ')

// First five lines of the local raw text, note or slug.
export function rowDetail(e: Entry): string[] {
  const raw = e.local.text ?? e.local.note ?? [e.local.slug, e.local.subgoal].filter(Boolean).join(' ')
  return (raw ?? '').split('\n').slice(0, 5)
}

// A ready-to-file bug body; raw text stays on this machine unless the person pastes it.
export function copyBody(e: Entry): string {
  const target = e.plugin && e.skill ? `${e.plugin}:${e.skill}` : (e.tool ?? e.plugin ?? '-')
  return [
    `skill: ${target}`,
    `reason: ${e.reason}`,
    `day: ${e.day}`,
    `version: ${e.version ?? '-'} · Claude Code ${e.cc ?? '-'}`,
    `text:`,
    e.local.text ?? e.local.note ?? [e.local.slug, e.local.subgoal].filter(Boolean).join(' '),
  ].join('\n')
}
