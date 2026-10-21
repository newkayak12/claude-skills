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
  last_step?: string | null
}
// who opened a run for a task: the EPIC key (S) or the STORY key (L); absent on a standalone run
export type GraphOwner = { task_id?: string; key: string }
export type GraphRun = {
  run_id: string
  request: string
  owner?: GraphOwner | null
  created_at?: number
  cost_usd?: number | null
  routing_blocked?: boolean
  max_retries?: number
  spec?: { goal?: string; subgoals?: { id: string; title?: string }[] } | null
  nodes: GraphNode[]
}
// what the tick keeps: the newest run, or that its file is too large to read
export type Snap = { run: GraphRun | null; big: boolean; mtimeMs: number; size: number; live: boolean }

// one node of a `broker.mjs runs --list/--show --json` row (missing values null)
export type GraphRowNode = {
  node_id: string
  stage: string
  subgoal_id: string | null
  state: string
  attempt: number | null
  agent: string | null
  started_at: number | null
  finished_at: number | null
  reason: string | null
  feedback: string | null
  last_step: string | null
}
// one run of the readout; created_at keeps the string 'unknown' for a legacy run file
export type GraphRow = {
  id8: string
  state: string
  owner: GraphOwner | null
  created_at: string
  cost_usd: number | null
  running: { node_id: string; last_step: string | null } | null
  run_id: string
  file: string
  request: string
  max_retries: number | null
  last_change: string
  last_change_ms: number
  age_ms: number
  open: boolean
  stalled: boolean
  routing_blocked: boolean
  unavailable_vendors: Record<string, unknown>
  subgoals: { id: string; title: string }[]
  last_step: string | null
  acting: boolean
  rejects: number
  nodes: GraphRowNode[]
}
// a run opened by `/graph-status open <file> <owner-key>`: not in the band or the [ ] list
export type OpenedRun = { file: string; owner: string; row: GraphRow | null }

declare module 'claude-code' {
  interface PluginState {
    graph: {
      snap: Snap | null
      view: 'flow' | 'detail'
      lang: 'en' | 'ko'
      // open runs from `runs --list --json`: the last good list, kept when a read fails
      rows: GraphRow[]
      // the run the pane shows, by run_id (null: opening order decides)
      selected: string | null
      // per run_id, how many rejects the person had seen
      looked: Record<string, number>
      // the run opened by path (null: none)
      opened: OpenedRun | null
      // spinner frame counter, advanced only while a run acts and a pane or band is shown
      spin: number
      // the run outcome this mod publishes for trophy: labels only, never an id (same type in teams and harness)
      outcome: { system: 'graph' | 'teams' | 'harness'; outcome: 'pass' | 'reject' | 'fail'; at: number } | null
    }
  }
}
