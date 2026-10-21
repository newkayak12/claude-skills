// `state` is the daemon's final state on a daemon_done line (complete, partial, blocked, ...)
export type TeamsEvent = { ts: number; task_id: string; kind: string; text: string; state?: string; package?: string; attempt?: number }

// `view.mjs --once --format status`: the one-line status of this cwd
export type StatusInfo = { line: string; waiting: number; latest?: string | null }

// `view.mjs --once --format summary` task part (teams/scripts/lib/view-summary.mjs)
export type Mark = 'done' | 'running' | 'pending' | 'failed'
export type SummaryTask = {
  key: string
  title: string
  state: string
  day: number
  done: number
  total: number
  now: { kind: string; subject: string | null; detail: string | null }
  you: { count: number; items: string[]; cards?: { key: string; title: string; question: string }[] }
  stages: { key: string; state: Mark }[]
  work: { title: string; kind: string; id: string | null; state: Mark; filed_by: string | null; reason: string | null }[]
  cost: { usd: number; turns: number }
  log: { time: string; kind: string; subject: string | null }[]
}

// `view.mjs --once --format summary` floor part (teams/scripts/lib/view-floor.mjs): per listed task
export type WorkState = 'acting' | 'idle' | 'you' | 'done' | 'stalled'
export type SummaryItem = {
  key: string; title: string; state: WorkState | 'failed'; doing: string; last_verdict: string | null
  cost_usd: number | null; cost_estimated: boolean; try: number | null; max: number | null
  live: boolean; elapsed_ms: number | null; run_file: string | null; owner_key: string
}
export type SummaryWorker = { id: string; state: WorkState; doing: string }
export type Handoff = { time: string; from: string; what: string; to: string }
export type SummaryTaskEntry = SummaryTask & {
  task_id: string; created_at: number | null
  live: boolean; age_ms: number | null // age_ms: stalled tasks only, under 24 h
  items: SummaryItem[]; workers: SummaryWorker[]; handoffs: Handoff[]
}
// `task` (the running task, or --task) stays as before; `tasks` is live newest-created first, then stalled
export type SummaryOutput = { status: StatusInfo; tasks: SummaryTaskEntry[]; task: SummaryTask | null }

// `view.mjs --once --format teams` teams part (teams/scripts/lib/view-status.mjs teamsView)
export type NowLine = { team: string; key: string; node: string; agent: string | null; elapsed_ms: number | null }
export type TeamsView = {
  now: NowLine[]
  teams: { team: string; cards: { id: string; key: string; title: string; state: string | null; mark: Mark; now: { node: string; agent: string | null; elapsed_ms: number | null } | null }[] }[]
}

// `view.mjs --once --format decisions --task <id> [--card <id>]` (view-status.mjs decisionsView)
export type Decision = {
  ts: number | null; time: string | null; card: string | null; node: string | null; kind: string
  actor?: string | null; verdict?: string | null; score?: number | null; reason?: string | null; text?: string | null
  blocking?: string[]; problems?: string[]; gaps?: string[]; title?: string; evidence?: string | null; filed_by?: string | null
}
export type DecisionsPayload = { card: string | null; entries: Decision[] }

// `view.mjs --once --format report --task <id>` (teams/scripts/lib/view-report.mjs)
export type ReportPayload = {
  task_id: string
  verdict: 'finished' | 'blocked' | 'running'
  failed: number
  needs: { items: string[]; more: number }
  path: string
  report: { text: string; truncated: boolean; more_lines: number; mtime: number } | null
  retro: object | null
}

declare module 'claude-code' {
  interface PluginState {
    teams: {
      cursor: number
      watch: string[]
      status: StatusInfo | null
      summary: SummaryTask | null
      view: 'teams' | 'decisions' | 'log' | 'report'
      teams: TeamsView | null
      // the Decisions tab: fetched for one task, and one card when one was picked
      decisions: { task_id: string; card: string | null; payload: DecisionsPayload } | null
      selected: string | null
      report: { task_id: string; payload: ReportPayload } | null
      cardReport: { task_id: string; payload: ReportPayload } | null
      ended: Record<string, 'card' | 'seen' | 'dismissed'>
      lang: 'en' | 'ko'
      // the run outcome this mod publishes for trophy: labels only, never an id (same type in graph and harness)
      outcome: { system: 'graph' | 'teams' | 'harness'; outcome: 'pass' | 'reject' | 'fail'; at: number } | null
    }
  }
}
