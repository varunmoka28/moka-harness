export type HandOff = {
  id: number
  kind: 'file' | 'connector'
  /** The file name, or the connector's server name. */
  title: string
  /** The file's folder, or `connector result · <tool>`. */
  where: string
  /** Estimated tokens of the original, and of what Claude got. */
  before: number
  after: number
  /** Estimated dollars the small model's request cost; 0 while it runs. */
  cost: number
  model: string
  startedAt: number
  seconds: number
  status: 'running' | 'done' | 'whole'
  /** Why it went through whole, when it did. */
  reason: string
  notes: string
  detailPath: string
  fullPath: string
}

export type Totals = { count: number; before: number; after: number; cost: number }

declare module 'claude-code' {
  interface PluginState {
    'input-router': { handoffs: HandOff[]; totals: Totals; shown: number[] }
  }
}
