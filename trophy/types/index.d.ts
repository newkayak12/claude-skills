declare module 'claude-code' {
  interface PluginState {
    trophy: {
      active: boolean
      turnMatched: string[]
      turnFired: string[]
      turnTyped: boolean
      tab: 'trophies' | 'triggers'
    }
  }
}
