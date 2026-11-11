// `state` is the daemon's final state on a daemon_done line (complete, partial, blocked, ...)
// run, node and the *_key / next_vars fields are the engine's words as keys (view-events.mjs): the mod looks the key up in STRINGS and
// draws the key as received when it is unknown; reason, next_step and severity belong to a failed node_finish (absent on an old-shape line)
export type TeamsEvent = {
  ts: number; task_id: string; kind: string; text: string; state?: string; package?: string; attempt?: number
  run?: string; node?: string; reason?: string; reason_key?: string
  next_step?: string | null; next_key?: string | null; next_vars?: Record<string, string | number> | null; severity?: string
}

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
  worktree?: string | null // set when the task runs in a linked worktree of this repo
  state: string
  day: number
  done: number
  total: number
  now: { kind: string; subject: string | null; detail: string | null }
  // stage 'ask' marks a card that holds a question for this session (answer mode); any other stage is a card waiting on a person
  you: { count: number; items: string[]; cards?: { key: string; title: string; question: string; who: string; since: number | null; stage?: string | null }[] }
  stages: { key: string; state: Mark }[]
  work: { title: string; kind: string; id: string | null; state: Mark; filed_by: string | null; reason: string | null; reason_key?: string }[]
  // the running stage's countable work as keys and numbers, never words; absent when nothing is countable.
  // sg only on a size-S fallback run with a goal spec; stage_key only while its now.json is fresh
  progress?: { key: 'build' | 'qa'; done: number; total: number } | { key: 'sg'; k: number; n: number; stage_key?: string }
  // usd is the one spend figure; estimated only when a running session has no result yet; post_stop_usd only after a budget stop
  cost: { usd: number; turns: number; estimated?: boolean; post_stop_usd?: number }
  log: { time: string; kind: string; subject: string | null }[]
  metrics?: SummaryMetrics
}
// the numbers of view-summary.mjs metrics() the pane reads: per STORY progress and agents, the machine-wide drivers (load only when
// the engine sends it), the spend and wall time per Phase, the STORYs out of retries
export type SummaryMetrics = {
  drivers?: { live: number | null; cap: number | null; load?: number | null }
  stories?: { id: string; progress?: { done: number; total: number } | null; agents?: number | null }[]
  stages?: { stage: string; cost_usd: number; retry_cost_usd: number; wall_ms: number }[]
  out_of_retries?: string[]
}
// view-floor.mjs phaseCounts: the workers of one Phase by state; decisions only when the engine sends the Phase's count
export type PhaseCount = { key: string; workers: number; acting: number; you: number; stalled: number; idle: number; done: number; decisions?: number }

// `view.mjs --once --format summary` floor part (teams/scripts/lib/view-floor.mjs): per listed task
export type WorkState = 'acting' | 'idle' | 'you' | 'done' | 'stalled'
// one STORY's recorded numbers (view-summary.mjs metrics()): attempt n of max, the last judge score against the threshold
// and why, spend with the retries' spend apart, wall time; null on an item with no STORY behind it (an S task)
export type StoryMetrics = {
  attempt: number | null; max_attempts: number | null
  // gap: the judge's first accept gap when it rejected at or above the threshold, else null
  // verdict (accept|reject|null) and attempt: the attempt the judge scored, older than `attempt` while a retry runs
  judge: { score: number; threshold: number | null; reason: string | null; gap: string | null; verdict?: string | null; attempt?: number | null } | null
  cost_usd: number | null; retry_cost_usd: number | null; wall_ms: number | null; out_of_retries: boolean | null
}
export type SummaryItem = {
  key: string; title: string; state: WorkState | 'failed'; doing: string; icon: string; word: string; word_key: string; last_verdict: string | null
  cost_usd: number | null; cost_estimated: boolean; try: number | null; max: number | null
  live: boolean; elapsed_ms: number | null; run_file: string | null; owner_key: string
  metrics?: StoryMetrics | null
}
// icon, word, word_key: node's one state -> mark (view-floor.mjs markOf); word_key is '' for a live Floor worker's word, else the
// state to localize; it is never '' on a STORY item (a fixed word per row, `doing` stays a field)
export type SummaryWorker = { id: string; state: WorkState; doing: string; icon: string; word: string; word_key: string
  minutes?: number // only when state is 'stalled': whole minutes silent; absent otherwise
  // an acting or waiting worker's node (its stage), role word and ms in it, each only when the engine recorded it
  node?: string; role?: string; elapsed_ms?: number
}
// what_key/from_key/to_key name a STRINGS entry for the English beside them; what_vars fill its placeholders
export type Handoff = {
  time: string; from: string; what: string; to: string
  what_key?: string; what_vars?: Record<string, string | number>; from_key?: string; to_key?: string
  // Phase hand-offs only, as recorded: the card, a verdict's score and reason, where the verdict sends the card
  story?: string; score?: number; reason?: string; to_role?: string
}
export type SummaryTaskEntry = SummaryTask & {
  task_id: string; created_at: number | null
  live: boolean; age_ms: number | null // age_ms: stalled tasks only, under 24 h
  items: SummaryItem[]; workers: SummaryWorker[]; handoffs: Handoff[]; phases?: PhaseCount[]
  // an S task's harness run (slug, moved lately); null for a package EPIC
  harness: { slug: string | null; moving: boolean } | null
}
// `task` (the running task, or --task) stays as before; `tasks` is live newest-created first, then stalled
export type SummaryOutput = { status: StatusInfo; tasks: SummaryTaskEntry[]; task: SummaryTask | null }

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
  // sub_key/sub_vars and now_key/now_subject: optional keys for the English beside them; today's node does not emit them
  // and the mod derives the word from tile.key + sub and from the task's now
  tiles: { key: string; label: string; value: string; sub: string; alert?: boolean; sub_key?: string; sub_vars?: Record<string, string | number> }[]
  now_key?: string; now_subject?: string | null
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
  // entries: each item with the engine's key beside its text (view-status.mjs needsEntries), same order as items
  needs: { items: string[]; more: number; entries?: { text: string; name?: string; reason?: string; reason_key?: string; reason_vars?: Record<string, string | number> }[] }
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
      // every listed EPIC (live first, then stalled), as the last tick saw them, and the ids of the tick before
      tasks: SummaryTaskEntry[]
      taskIds: string[]
      // the EPIC the pane shows (task_id); null until the first list arrives
      epic: string | null
      // the pane Input's text, as the host holds it; '' after a handled key (a typed `/command` stays until Enter)
      typed: string
      // the Floor spinner frame, advanced every ~800 ms while a worker acts
      frame: number
      teams: TeamsView | null
      // the teams call's dash part, stored as the tick receives it (no page draws it now)
      dash: Dash | null
      report: { task_id: string; payload: ReportPayload } | null
      cardReport: { task_id: string; payload: ReportPayload } | null
      ended: Record<string, 'card' | 'seen' | 'dismissed'>
      // the page stack (pane.ts Page): which page the pane shows, and the selected row id per level; the answer draft is not kept
      page: { name: 'HOME' | 'FLOOR' | 'PHASE' | 'STORY' | 'LOG' | 'STORY_REPORT' | 'EPIC_REPORT' | 'ANSWER'; epic: string | null; story: string | null; phase: number | null }
      pageSel: Record<string, string>
      // the page ANSWER was opened from, the first line shown per level, and the dim hint after `n` found no flag
      pageFrom: { name: 'HOME' | 'FLOOR' | 'PHASE' | 'STORY' | 'LOG' | 'STORY_REPORT' | 'EPIC_REPORT' | 'ANSWER'; epic: string | null; story: string | null; phase: number | null } | null
      pageScroll: Record<string, number>
      flagHint: boolean
      draftHint: boolean
      // a redraw counter for answer mode; its draft (typed answers, the card's questions, the last refusal) is never kept here
      answerRev: number
      // what the open page reads beyond the listing, each keyed to the EPIC (and STORY) it was fetched for
      decisions: { task_id: string; payload: DecisionsPayload } | null
      storyData: { task_id: string; story: string; payload: import('../hooks/teams-draw').StoryPayload } | null
      storyDoc: { task_id: string; story: string; payload: import('../hooks/teams-draw').StoryReport } | null
      // ended EPICs shown unfolded on HOME, by EPIC id; kept across a closed and reopened pane
      unfolded: Record<string, boolean>
      lang: 'en' | 'ko'
      // set once the person pressed l or the Button
      langChosen: boolean
      // the run outcome this mod publishes for trophy: labels only, never an id (same type in graph and harness)
      outcome: { system: 'graph' | 'teams' | 'harness'; outcome: 'pass' | 'reject' | 'fail'; at: number } | null
    }
  }
}
