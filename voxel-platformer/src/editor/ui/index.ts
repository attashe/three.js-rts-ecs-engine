import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import type { GameWorld } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'
import type { CommandStack } from '../history'
import { injectCss } from './common'
import { createTabBar } from './tabs'
import { buildEditTab } from './edit-tab'
import { buildLevelTab } from './level-tab'
import { buildHelpTab } from './help-tab'
import { buildSoundTab } from './sound-tab'
import { buildWeatherTab } from './weather-tab'

export interface MountEditorPanelOptions {
    world: GameWorld
    chunks: ChunkManager
    editorState: EditorState
    /** Undo / redo stack — `New` / `Load` invalidate it. */
    history: CommandStack
}

/**
 * Editor panel — a top-right dock with three tabs:
 *  - **Edit** — camera + working-plane controls, palette, mode toolbar,
 *    and a contextual settings panel for the active placement mode. This
 *    is the only tab that swaps its body in response to state changes.
 *  - **Sound** — spatial sound sources and local sound zones.
 *  - **Visual FX** — local particle/light effect zones.
 *  - **Level** — name + save / load / playtest.
 *  - **Help** — keyboard / mouse cheatsheet.
 *
 * Camera/plane controls live with the editing surface (not behind a
 * separate tab) because the user changes the working plane Y constantly
 * while editing.
 *
 * Each tab is lazily built on first activation, so the panel stays cheap
 * even as features grow. The active tab's `refresh` runs on a 250 ms
 * interval to pick up state changes driven from outside the panel
 * (Z/X shortcuts mutate `workingPlaneY`, V toggles `viewMode`,
 * etc.).
 */
export function mountEditorPanel(opts: MountEditorPanelOptions): { dispose: () => void } {
    injectCss()

    const bar = createTabBar([
        { id: 'edit', label: 'Edit', build: () => buildEditTab(opts) },
        { id: 'sound', label: 'Sound', build: () => buildSoundTab(opts) },
        { id: 'weather', label: 'Visual FX', build: () => buildWeatherTab(opts) },
        { id: 'level', label: 'Level', build: () => buildLevelTab(opts) },
        { id: 'help', label: 'Help', build: () => buildHelpTab() },
    ], 'edit')

    document.body.appendChild(bar.element)

    const interval = window.setInterval(() => bar.refreshActive(), 250)

    return {
        dispose() {
            window.clearInterval(interval)
            bar.element.remove()
        },
    }
}
