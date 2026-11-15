// The other herdr tabs and their state, one line, or null when there are none
export type Tabs = string | null

declare module 'claude-code' {
  interface PluginState {
    'agent-board': { tabs: Tabs }
  }
}
