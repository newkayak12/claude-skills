declare module 'claude-code' {
  interface PluginState {
    trophy: {
      active: boolean
      turnMatched: string[]
      turnFired: string[]
      tab: 'trophies' | 'triggers'
    }
  }
}
