export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number }

// One model, from one source, in one loop of a run. `usd` is null when the model has no dated price.
export type Line = {
  model: string
  plugin: string
  agentId?: string
  requests: number
  // Requests that reported no usage: no response arrived, or the call reports none.
  unreported: number
  usage: Usage
  usd: number | null
}

// A run is one main turn. `seen` holds the keys of the requests already counted.
export type Run = {
  id: string
  task: string
  startedAt: number
  endedAt?: number
  reason?: string
  // Retry notices the engine showed for this run's requests.
  retries: number
  lines: Line[]
  seen: string[]
}

export type Rec = {
  model: string | null
  confidence: number | null
  why: string
  routed: boolean
  jevUsd: number | null
}

export type Agent = {
  id: string
  // The run it was spawned in, kept after that run's turn ends.
  runId: string
  type: string
  task: string
  model: string | null
  plugin: string
  status: string
  lastAction: string
  startedAt: number
  // Last request or tool call; a running agent silent for 10 minutes is ended.
  activeAt?: number
  endedAt?: number
  parentId?: string
  background: boolean
  rec?: Rec
}

export type Ledger = { runs: Run[]; agents: Agent[] }

declare module 'claude-code' {
  interface PluginState {
    'run-ledger': { ledger: Ledger; detail: string | null; tick: number }
  }
}
