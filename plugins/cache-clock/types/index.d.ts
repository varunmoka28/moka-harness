// When the main conversation last finished a turn, how big it was then, and
// what percent of that turn's input was served from the cache
export type Last = { at: number; tokens: number | null; hit: number | null }

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': { last: Last | null }
  }
}
