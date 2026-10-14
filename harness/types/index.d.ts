export type Decision = { ts: number; session_id?: string; tool: string; target: string; decision: 'allow' | 'deny'; reason: string }
export type OpenRun = { slug: string; stage: string; passed: number; failed: number; total: number }
export type OpenRuns = { harness: OpenRun[]; graph: OpenRun[] }

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

declare module 'claude-code' {
  interface PluginState {
    harness: {
      last: Decision | null
      armed: boolean
      patterns: string[]
      windowHours: number
      runs: OpenRuns
      run: RunInfo | null
      broken: boolean
      view: 'auto' | 'flow' | 'detail'
      lang: 'en' | 'ko'
      // the run outcome this mod publishes for trophy: labels only, never an id (same type in graph and teams)
      outcome: { system: 'graph' | 'teams' | 'harness'; outcome: 'pass' | 'reject' | 'fail'; at: number } | null
    }
  }
}
