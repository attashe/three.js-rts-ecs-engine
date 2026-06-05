import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import type { EditorState } from '../editor-state'

/**
 * Click-to-set player spawn in the editor. Active only when
 * `editorState.mode === 'place-spawn'`. Stores the cursor cell as the spawn,
 * centred on the cell so the player's standing AABB sits inside the voxel
 * column. Spawn Y is the cursor Y, which (in place-spawn mode) is the empty
 * cell on top of the clicked surface — so the player lands standing on it.
 */
export function createSpawnPlaceSystem(input: Input, editorState: EditorState): System {
    return {
        fixed: true,
        // After the other input-consuming editor systems; each guards on
        // `editorState.mode` so only one runs per click.
        order: FixedOrder.input + 8,
        update(world) {
            if (editorState.mode !== 'place-spawn') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0) return
            if (!editorState.cursor) return

            // Only LMB sets spawn — RMB is reserved for future "clear spawn"
            // behaviour if we ever need it. For now ignore RMB.
            for (const click of clicks) {
                if (click.button !== 0) continue
                const cell = editorState.cursor
                editorState.spawn = {
                    x: cell.x + 0.5,
                    y: cell.y,
                    z: cell.z + 0.5,
                }
                pushLog(world as GameWorld, `Spawn set to (${editorState.spawn.x.toFixed(1)}, ${editorState.spawn.y}, ${editorState.spawn.z.toFixed(1)})`)
                break
            }
        },
    }
}
