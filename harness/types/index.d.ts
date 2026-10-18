export type Decision = { ts: number; session_id?: string; tool: string; target: string; decision: 'allow' | 'deny'; reason: string }
export type StageKey = 'plan' | 'setgoal' | 'critique' | 'implement' | 'gate' | 'report'
export type StageMark = 'done' | 'running' | 'pending' | 'failed'
// a QualityGate verdict, subgoals/<id>/gate-<n>.json
export type RunGate = { n: number; pass: boolean; reason: string }
export type RunSub = { id: string; title: string; state: StageMark; reason: string; tries: number; gates: RunGate[]; stalled: boolean }
// the current run of .harness-run/<run>/, as the mod reads it
export type RunInfo = {
  slug: string
  title: string
  live: boolean
  finished: boolean
  stages: { key: StageKey; state: StageMark }[]
  subs: RunSub[]
  done: number
  total: number
  now: { kind: 'implement' | 'test' | 'gate' | 'retry' | 'stage' | 'done'; id?: string; title?: string; attempt?: number; stage?: StageKey }
  match: number | null
  pass: boolean | null
  // 02-critique.json: sound (null: no file) and why it was not
  critique: { sound: boolean | null; reason: string }
  goalReason: string // 04-goal-gate.json reason
  lastMs: number // mtime of the run's newest file
}

// One row of `node engine/fallback-check.mjs --list --json` (P1's contract; status.ts normalizeRow reads it
// tolerantly). The row keys: slug, dir, stage, round, waiting, stalled, now, started_at,
// max_critique_rounds, severity, rounds, passed, failed, total.
export type RowStage = 'plan' | 'setgoal' | 'critique' | 'implement' | 'gate' | 'report'
export type Severity = { blocker: number; major: number; minor: number; nit: number }
export type RowWaiting = { who: 'you' | 'vendor'; what: string }
// now.json as the engine writes it; every field but stage may be null
export type RowNow = {
  stage: string | null
  doing: string | null
  round: number | null
  last_step: string | null
  next: string | null
  waiting: RowWaiting | null
  cost_usd: number | null
  at: string | null
  since: string | null
}
export type RowProblem = { severity: keyof Severity; text: string }
// one critique round, oldest first; sound null when its file held no verdict
export type RowRound = { round: number; sound: boolean | null; problems: RowProblem[] }
export type HarnessRow = {
  slug: string
  stage: RowStage
  round: number | null
  waiting: RowWaiting | null
  stalled: boolean
  now: RowNow | null
  started_at: string | null
  max_critique_rounds: number
  severity: Severity
  rounds: RowRound[]
  passed: number
  failed: number
  total: number
}
export type PaneTab = 'now' | 'flow' | 'findings' | 'rules'

declare module 'claude-code' {
  interface PluginState {
    harness: {
      last: Decision | null
      armed: boolean
      patterns: string[]
      windowHours: number
      // the files of the run the Flow and Gate rules tabs show (null: none read)
      run: RunInfo | null
      broken: boolean
      lang: 'en' | 'ko'
      // open harness runs from `--list --json`: the last good list, kept when a read fails
      rows: HarnessRow[]
      // the run the pane shows, by slug (null: opening order decides)
      selected: string | null
      // per slug, how many rejects (rejected critique rounds + failed subgoals) the person had seen
      looked: Record<string, number>
      // spinner frame counter, advanced only while a run acts and a pane or band is shown
      tick: number
      paneTab: PaneTab
      // the demo fixture the pane and band draw (`/harness-status demo`); null: the live runs
      demo: 'minimal' | 'full' | 'parallel' | 'narrow' | null
      // the run outcome this mod publishes for trophy: labels only, never an id (same type in graph and teams)
      outcome: { system: 'graph' | 'teams' | 'harness'; outcome: 'pass' | 'reject' | 'fail'; at: number } | null
    }
  }
}
