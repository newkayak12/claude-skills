declare module 'claude-code' {
  interface PluginState {
    diag: {
      active: boolean
      // last `plugin:skill` of this marketplace used or typed this session; '' when none
      lastSkill: string
      // failures recorded since the pane was last opened, and the newest one's title; band only
      unseen: number
      lastTitle: string
    }
    // trophy's consent, read-only here; identical to trophy's own declaration.
    trophy: {
      consent: 'unasked' | 'yes' | 'no'
      consentVersion: number
    }
  }
}
