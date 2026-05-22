import { GridHelper, type Scene } from 'three'
import type { Input } from '../../engine/input/input'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { System } from '../../engine/ecs/systems/system'
import { RenderOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'

const GRID_EXTENT = 40        // world units (cells) per side
const GRID_DIVISIONS = 40
const UNLOCKED_COLOUR = 0x4a7385
const LOCKED_COLOUR = 0xffd166

/**
 * Renders the working-plane grid and processes the editing hotkeys:
 *   - X / Z — raise / lower the working plane (Shift = ×4).
 *   - V — toggle iso ↔ top-down view.
 *   - L — toggle the cursor-locks-to-plane flag.
 *
 * Mutates `editorState.workingPlaneY` / `viewMode` / `planeLock` and
 * re-centres the grid on the camera target each frame so the plane is
 * always visible near the area you're editing.
 *
 * The grid colour brightens when `editorState.planeLock` is on — a quick
 * visual confirmation that clicks will now snap to the plane Y.
 */
export function createWorkingPlaneSystem(scene: Scene, input: Input, iso: IsometricCamera, editorState: EditorState): System {
    let helper = makeHelper(editorState.planeLock)
    let lastLock = editorState.planeLock

    return {
        order: RenderOrder.debug + 4,
        init(world) {
            scene.add(helper)
            helper.position.set(0, editorState.workingPlaneY, 0)
            void world
        },
        update(world) {
            if (handleKeyboardNudge(input, editorState)) {
                pushLog(world as GameWorld, `Working plane Y → ${editorState.workingPlaneY}`)
            }
            if (input.consumeKeyPressed('KeyV')) {
                editorState.viewMode = editorState.viewMode === 'iso' ? 'top-down' : 'iso'
                pushLog(world as GameWorld, `View → ${editorState.viewMode}`)
            }
            if (input.consumeKeyPressed('KeyL')) {
                editorState.planeLock = !editorState.planeLock
                pushLog(world as GameWorld, `Plane lock → ${editorState.planeLock ? 'on' : 'off'}`)
            }
            if (editorState.planeLock !== lastLock) {
                scene.remove(helper)
                helper = makeHelper(editorState.planeLock)
                scene.add(helper)
                lastLock = editorState.planeLock
            }
            // Recentre the grid on the camera focus so it stays in view when
            // the user pans far from the origin.
            const cx = Math.floor(iso.target.x)
            const cz = Math.floor(iso.target.z)
            helper.position.set(cx, editorState.workingPlaneY, cz)
        },
        dispose() {
            scene.remove(helper)
            helper.geometry.dispose()
            const mat = helper.material
            if (Array.isArray(mat)) for (const m of mat) m.dispose()
            else mat.dispose()
        },
    }
}

function makeHelper(locked: boolean): GridHelper {
    const colour = locked ? LOCKED_COLOUR : UNLOCKED_COLOUR
    const helper = new GridHelper(GRID_EXTENT, GRID_DIVISIONS, colour, colour)
    helper.name = 'EditorWorkingPlane'
    const mat = helper.material
    if (!Array.isArray(mat)) {
        mat.transparent = true
        mat.opacity = locked ? 0.5 : 0.25
        mat.depthWrite = false
    }
    helper.renderOrder = 997
    return helper
}

function handleKeyboardNudge(input: Input, state: EditorState): boolean {
    const shift = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight')
    const step = shift ? 4 : 1
    if (input.consumeKeyPressed('KeyX')) {
        state.workingPlaneY += step
        return true
    }
    if (input.consumeKeyPressed('KeyZ')) {
        state.workingPlaneY -= step
        return true
    }
    return false
}
