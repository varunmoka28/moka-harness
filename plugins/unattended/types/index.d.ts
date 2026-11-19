// Whether this session runs with nobody at the keyboard
export type On = boolean
// Whether refused questions go to the task file for the orchestrator instead of Claude picking
export type Route = boolean

declare module 'claude-code' {
  interface PluginState {
    unattended: { on: On; route: Route }
  }
}
