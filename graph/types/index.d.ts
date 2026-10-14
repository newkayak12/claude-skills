// the parts of a broker run file (.harness-run/broker/runs/<runId>.json) the mod reads
export type GraphNode = {
  node_id: string
  stage: string
  deps: string[]
  after?: string[]
  state: string
  attempt: number
  subgoal_id?: string | null
  final?: boolean
  result?: { stage_ok?: boolean; reason?: string; match_pct?: number } | null
  vendor?: string | null
  executor?: string | null
  model?: string | null
  feedback?: string | null
  started_at?: number
  finished_at?: number
}
export type GraphRun = {
  run_id: string
  request: string
  routing_blocked?: boolean
  max_retries?: number
  spec?: { goal?: string; subgoals?: { id: string; title?: string }[] } | null
  nodes: GraphNode[]
}
// what the tick keeps: the newest run, or that its file is too large to read
export type Snap = { run: GraphRun | null; big: boolean; mtimeMs: number; size: number; live: boolean }

declare module 'claude-code' {
  interface PluginState {
    graph: {
      snap: Snap | null
      view: 'flow' | 'detail'
      lang: 'en' | 'ko'
      // the run outcome this mod publishes for trophy: labels only, never an id (same type in teams and harness)
      outcome: { system: 'graph' | 'teams' | 'harness'; outcome: 'pass' | 'reject' | 'fail'; at: number } | null
    }
  }
}
