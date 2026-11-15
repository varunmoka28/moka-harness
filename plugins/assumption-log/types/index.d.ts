export type Assumption = {
  id: number
  text: string
  basis: string
  affects: string
  at: number
  isSubagent: boolean
  status: 'open' | 'replaced' | 'flagged'
  replacedBy: number | null
}

export type Log = { notes: Assumption[]; next: number }

declare module 'claude-code' {
  interface PluginState {
    'assumption-log': { log: Log }
  }
}
