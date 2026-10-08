// Plans 08 and 09 extend `session` by adding optional keys here; they never edit these.
declare module 'claude-code' {
  interface PluginState {
    session: {
      ledger: {
        files: string[]
        commits: { hash: string; subject: string }[]
        denied: { tool: string; reason: string }[]
        // tool.call timestamps (ms); 0 separates turns
        steps: number[]
      }
      // claude -p children below the engine, as of the last poll
      orphans: { pid: number; ppid: number; start: string; cmd: string }[]
      tab: 'retro' | 'orphans'
      // engine pid, 0 until looked up
      engine: number
      // the next-start retro band is showing
      band: boolean
      // per-file '+a -d' from git diff --numstat, keyed by touched path
      stats: Record<string, string>
      // the summary the last session left, read at start; null when none
      // denied calls kept by the guard, newest last (cap 200); the store key session.denials is the source
      guard: {
        denials: {
          id: string; ts: number; tool: string; call: string; reason: string
          source: 'guard' | 'native' | 'declined'; nativeRule?: string; agentId?: string
        }[]
      }
      // id of the denial whose rule text the pane shows, '' when none
      guardCopy: string
      last: { day: string; files: number; commits: number; denied: number; longestMs: number; fileList: string[] } | null
    }
  }
}
