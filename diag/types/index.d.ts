declare module 'claude-code' {
  interface PluginState {
    diag: {
      active: boolean
    }
    // trophy's consent, read-only here; identical to trophy's own declaration.
    trophy: {
      consent: 'unasked' | 'yes' | 'no'
      consentVersion: number
    }
  }
}
