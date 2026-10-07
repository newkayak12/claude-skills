export type TeamsEvent = { ts: number; task_id: string; kind: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    teams: {
      cursor: number
      watch: string[]
      cwdTask: string | null
      status: string
      waiting: number
      view: 'tickets' | 'pipeline' | 'events'
      events: TeamsEvent[]
      board: string
    }
  }
}
