export type Assumption = {
  id: number
  text: string
  basis: string
  affects: string
  at: number
  agent: string | null
  status: 'open' | 'replaced' | 'flagged'
  replacedBy: number | null
}

export type Undone = {
  id: number
  text: string
  source: 'said' | 'code' | 'checker'
  at: number
  status: 'open' | 'sent' | 'cleared'
}

// A SendFeedback call kept in the desk instead of raising the engine's card
export type Draft = { title: string; input: Record<string, unknown> }

export type Slice ={ name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }

export type AgentRow = {
  id: string
  label: string
  type: string
  model: string | null
  startedAt: number
  endedAt: number | null
  lastSeenAt: number
  isSpawned: boolean
  tools: number
  tokensRead: number
  tokensOut: number
  hasFailed: boolean
}

export type Stats = {
  openedAt: number
  now: number
  tools: number
  fails: number
  tokens: number
  tokensOut: number
  costUsd: number | null
  turns: number
  model: string | null
  ctxTokens: number | null
  ctxPercent: number | null
  ctxWindow: number | null
  slices: Slice[]
  stamps: number[]
  assumptions: Assumption[]
  nextNote: number
  agents: AgentRow[]
  lastMainAt: number
  ttlMs: number
  needsMeasure: boolean
  undone: Undone[]
  nextUndone: number
  lastPrompt: string
  turnTools: number
  isChecking: boolean
  tickError: string
}

// Another Claude session on this machine, from Claude Code's session registry plus the session-peers note;
// `folder` is the last path segment of its working directory when that is not this session's root
export type PeerRow = { id: string; label: string; status: 'working' | 'waiting' | 'done'; tab?: string; via: string[]; folder?: string; self: boolean; tokens: number | null }

declare module 'claude-code' {
  interface PluginState {
    'terminal-desk': { stats: Stats; isHidden: boolean; isDeskOpen: boolean; peers: PeerRow[]; drafts: Draft[] }
  }
}
