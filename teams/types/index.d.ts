export type TeamsEvent = { ts: number; task_id: string; kind: string; text: string }

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
  you: { count: number; items: string[] }
  stages: { key: string; state: Mark }[]
  work: { title: string; kind: string; id: string | null; state: Mark; filed_by: string | null; reason: string | null }[]
  cost: { usd: number; turns: number }
  log: { time: string; kind: string; subject: string | null }[]
}

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
      view: 'summary' | 'work' | 'log' | 'report'
      report: { task_id: string; payload: ReportPayload } | null
      lang: 'en' | 'ko'
    }
  }
}
