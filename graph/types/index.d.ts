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
}
export type GraphRun = {
  run_id: string
  request: string
  routing_blocked?: boolean
  spec?: { goal?: string; subgoals?: { id: string; title?: string }[] } | null
  nodes: GraphNode[]
}
// what the tick keeps: the newest run, or that its file is too large to read
export type Snap = { run: GraphRun | null; big: boolean; mtimeMs: number; size: number; live: boolean }

declare module 'claude-code' {
  interface PluginState {
    graph: {
      snap: Snap | null
      view: 'flow' | 'nodes'
      lang: 'en' | 'ko'
    }
  }
}
