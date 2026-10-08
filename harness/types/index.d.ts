export type Decision = { ts: number; session_id?: string; tool: string; target: string; decision: 'allow' | 'deny'; reason: string }

export type StageKey = 'plan' | 'setgoal' | 'critique' | 'implement' | 'gate' | 'report'
export type StageMark = 'done' | 'running' | 'pending' | 'failed'
export type RunSub = { id: string; title: string; state: StageMark; reason: string; tries: number }
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
}

declare module 'claude-code' {
  interface PluginState {
    harness: {
      last: Decision | null
      armed: boolean
      patterns: string[]
      windowHours: number
      run: RunInfo | null
      broken: boolean
      view: 'auto' | 'run' | 'units' | 'gate'
      lang: 'en' | 'ko'
    }
  }
}
