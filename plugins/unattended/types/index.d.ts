// Whether this session runs with nobody at the keyboard
export type On = boolean

declare module 'claude-code' {
  interface PluginState {
    unattended: { on: On }
  }
}
