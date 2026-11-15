export type Status = 'working' | 'waiting' | 'done'

// One file per session: ~/.claude/session-peers/<folder key>/<session id>.json
export type Peer = {
  id: string
  label: string
  status: Status
  seen: number
  ended?: boolean
  headless?: boolean // a `claude -p` (hook-spawned observers): counted for edits, kept out of the band
  edits: Record<string, number>
  tab?: string // herdr tab id (HERDR_TAB_ID), so a click on the row can focus that tab
}
