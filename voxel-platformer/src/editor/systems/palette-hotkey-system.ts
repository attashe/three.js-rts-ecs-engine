import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { AIR } from '../../engine/voxel/palette'
import type { Input } from '../../engine/input/input'
import { makeRay, screenToWorldRay } from '../../engine/input/pointer'
import type { IsometricCamera } from '../../engine/render/isometric-camera'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld } from '../../engine/ecs/world'
import { voxelRaycast } from '../../engine/voxel/voxel-raycast'
import type { EditorState } from '../editor-state'

const MAX_RAY = 60

export function createPaletteHotkeySystem(
    chunks: ChunkManager,
    input: Input,
    iso: IsometricCamera,
    editorState: EditorState,
): System {
    const ray = makeRay()
    return {
        fixed: true,
        order: FixedOrder.input - 5,
        update(world) {
            for (let i = 1; i <= 9; i++) {
                if (!input.consumeKeyPressed(`Digit${i}`)) continue
                if (!chunks.palette.entries[i]) return
                editorState.activeBlock = i
                pushLog(world as GameWorld, `Block → ${chunks.palette.entries[i]!.name}`)
                return
            }

            if (!input.consumeKeyPressed('KeyB')) return
            const pointer = input.getPointer()
            if (!pointer) return
            screenToWorldRay(pointer.x, pointer.y, iso.camera, ray)
            const hit = voxelRaycast(chunks, ray.origin, ray.direction, MAX_RAY)
            if (!hit) return
            const block = chunks.getVoxel(hit.voxel.x, hit.voxel.y, hit.voxel.z)
            if (block === AIR || !chunks.palette.entries[block]) return
            editorState.activeBlock = block
            pushLog(world as GameWorld, `Picked block → ${chunks.palette.entries[block]!.name}`)
        },
    }
}
