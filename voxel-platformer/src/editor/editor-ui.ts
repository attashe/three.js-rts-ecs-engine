// Re-export the editor panel from its modular implementation. The actual
// builders live under `./ui/`; this file stays as the public entry point so
// existing imports (`./editor/editor-ui`) keep working.
export { mountEditorPanel } from './ui'
export type { MountEditorPanelOptions } from './ui'
