// `state` is the daemon's final state on a daemon_done line (complete, partial, blocked, ...)
export type TeamsEvent = { ts: number; task_id: string; kind: string; text: string; state?: string; package?: string; attempt?: number }

// `view.mjs --once --format status`: the one-line status of this cwd
// a question waiting on one interactive session (lib/view-asks.mjs asksFor); `via` is 'send' once the driver's message arrived
export type AskNotice = { task_id: string; key: string; who: string; question: string; since: number | null; via: 'send' | 'poll' }
export type StatusInfo = { line: string; waiting: number; latest?: string | null; asks?: AskNotice[] }

// `view.mjs --once --format summary` task part (teams/scripts/lib/view-summary.mjs)
export type Mark = 'done' | 'running' | 'pending' | 'failed'
export type SummaryTask = {
  key: string
  slug: string | null
  title: string
  state: string
  day: number
  done: number
  total: number
  now: { kind: string; subject: string | null; detail: string | null }
  you: { count: number; items: string[]; cards?: { key: string; title: string; question: string; who: string; since: number | null }[] }
  stages: { key: string; state: Mark }[]
  work: { title: string; kind: string; id: string | null; state: Mark; filed_by: string | null; reason: string | null }[]
  cost: { usd: number; turns: number }
  log: { time: string; kind: string; subject: string | null }[]
}

// `view.mjs --once --format summary` floor part (teams/scripts/lib/view-floor.mjs): per listed task
export type WorkState = 'acting' | 'idle' | 'you' | 'done' | 'stalled'
// one STORY's recorded numbers (view-summary.mjs metrics()): attempt n of max, the last judge score against the threshold
// and why, spend with the retries' spend apart, wall time; null on an item with no STORY behind it (an S task)
export type StoryMetrics = {
  attempt: number | null; max_attempts: number | null
  judge: { score: number; threshold: number | null; reason: string | null } | null
  cost_usd: number | null; retry_cost_usd: number | null; wall_ms: number | null; out_of_retries: boolean | null
}
export type SummaryItem = {
  key: string; title: string; state: WorkState | 'failed'; doing: string; icon: string; word: string; word_key: string; last_verdict: string | null
  cost_usd: number | null; cost_estimated: boolean; try: number | null; max: number | null
  live: boolean; elapsed_ms: number | null; run_file: string | null; owner_key: string
  metrics?: StoryMetrics | null
}
// icon, word, word_key: node's one state -> mark (view-floor.mjs markOf); word_key is '' for a live word, else the state to localize
export type SummaryWorker = { id: string; state: WorkState; doing: string; icon: string; word: string; word_key: string }
export type Handoff = { time: string; from: string; what: string; to: string }
export type SummaryTaskEntry = SummaryTask & {
  task_id: string; created_at: number | null
  live: boolean; age_ms: number | null // age_ms: stalled tasks only, under 24 h
  items: SummaryItem[]; workers: SummaryWorker[]; handoffs: Handoff[]
  // an S task's harness run (slug, moved lately); null for a package EPIC
  harness: { slug: string | null; moving: boolean } | null
}
// `task` (the running task, or --task) stays as before; `tasks` is live newest-created first, then stalled
export type SummaryOutput = { status: StatusInfo; tasks: SummaryTaskEntry[]; task: SummaryTask | null }

// the pane's tabs, in key order
export type PaneView = 'dash' | 'floor' | 'stories' | 'decisions' | 'log' | 'report'

// `view.mjs --once --format teams` dash part (teams/scripts/lib/view-dashboard.mjs): the Dashboard tab
export type DashStage = { n: number; key: string; label: string; state: Mark }
export type DashLane = { key: string; label: string; count: number; cards: { title: string; kind: string; failed: boolean; reason: string | null }[]; more: number }
// the run's task-level numbers (view-dashboard.mjs runOf); budget is null when the task sets none
export type RunNumbers = {
  budget: { limit_usd: number; spent_usd: number } | null
  drivers: { live: number | null; cap: number | null; stalled: { id: string | null; minutes: number }[] }
  denials: number; out_of_retries: string[]; defects: { filed: number; dropped: number }; scoped_out: number
}
export type DashModel = {
  key: string; title: string; state: string; pct: number; now: string
  stages: DashStage[]; packages: { title: string; state: Mark }[]; lanes: DashLane[]
  tiles: { key: string; label: string; value: string; sub: string; alert?: boolean }[]
  activity: { time: string; kind: string; subject: string | null }[]
  waiting: { who: string; title: string; question: string }[]
  run?: RunNumbers | null
  at: number
}
export type Dash = { model: DashModel; svg: string; alt: string }

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
      view: PaneView
      // every listed EPIC (live first, then stalled), as the last tick saw them, and the ids of the tick before
      tasks: SummaryTaskEntry[]
      taskIds: string[]
      // the EPIC the pane shows (task_id); null until the first list arrives
      epic: string | null
      // the STORYs tab: the row `g` opens and `j`/`k` move, an index into every listed task's rows
      row: number
      // the pane Input's text, as the host holds it; '' after a handled key (a typed `/command` stays until Enter)
      typed: string
      // the Floor spinner frame, advanced every ~800 ms while a worker acts
      frame: number
      teams: TeamsView | null
      // the Dashboard tab: node's model and the Svg desktop, mobile and vscode draw
      dash: Dash | null
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
