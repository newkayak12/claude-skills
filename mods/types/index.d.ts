export type HarnessRun = {
  dir: string
  slug: string
  stage: 'plan' | 'setgoal' | 'critique' | 'implement' | 'goal-gate' | 'report'
  passed: number
  failed: number
  total: number
}

declare module 'claude-code' {
  interface PluginState {
    mods: { runs: HarnessRun[] }
  }
}
