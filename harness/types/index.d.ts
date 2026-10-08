export type Decision = { ts: number; session_id?: string; tool: string; target: string; decision: 'allow' | 'deny'; reason: string }
export type OpenRun = { slug: string; stage: string; passed: number; failed: number; total: number }
export type OpenRuns = { harness: OpenRun[]; graph: OpenRun[] }

declare module 'claude-code' {
  interface PluginState {
    harness: {
      last: Decision | null
      armed: boolean
      patterns: string[]
      windowHours: number
      runs: OpenRuns
    }
  }
}
