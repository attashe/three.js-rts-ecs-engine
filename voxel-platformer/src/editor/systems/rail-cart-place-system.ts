import type { Input } from '../../engine/input/input'
import type { System } from '../../engine/ecs/systems/system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import { pushLog, type GameWorld, type RailCartConfig, type VoxelCoord } from '../../engine/ecs/world'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isRailBlock } from '../../engine/voxel/palette'
import type { EditorState } from '../editor-state'

const REMOVE_RADIUS = 1.75

export function createRailCartPlaceSystem(
    input: Input,
    chunks: ChunkManager,
    editorState: EditorState,
): System {
    let idCounter = 0

    return {
        fixed: true,
        order: FixedOrder.input + 14,
        update(world) {
            if (editorState.mode !== 'place-rail-cart') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0 || !editorState.cursor) return
            for (const click of clicks) {
                if (click.button === 2) removeNearestCart(world as GameWorld, editorState)
                else if (click.button === 0) placeCart(world as GameWorld, chunks, editorState, nextId())
            }
        },
    }

    function nextId(): string {
        const used = new Set(editorState.railCarts.map((cart) => cart.id))
        for (;;) {
            idCounter += 1
            const candidate = `rail-cart-${idCounter}`
            if (!used.has(candidate)) return candidate
        }
    }
}

function placeCart(world: GameWorld, chunks: ChunkManager, state: EditorState, id: string): void {
    const cursor = state.cursor
    if (!cursor) return
    if (!isRailBlock(chunks.palette, chunks.getVoxel(cursor.x, cursor.y, cursor.z))) {
        pushLog(world, 'Rail cart needs a rail block.')
        return
    }
    const cart: RailCartConfig = {
        id,
        railCell: { ...cursor },
        front: state.railCartFacing,
        speed: Math.max(0.1, state.railCartSpeed),
        interactionRadius: Math.max(0.25, state.railCartInteractionRadius),
        enabled: state.railCartEnabled,
    }
    state.railCarts.push(cart)
    state.selectedRailCartId = cart.id
    pushLog(world, `Rail cart "${cart.id}" placed.`)
}

function removeNearestCart(world: GameWorld, state: EditorState): void {
    const idx = nearestCartIndex(state.railCarts, state.cursor)
    if (idx < 0) return
    const [removed] = state.railCarts.splice(idx, 1)
    if (removed?.id === state.selectedRailCartId) state.selectedRailCartId = null
    if (removed) pushLog(world, `Removed rail cart "${removed.id}".`)
}

function nearestCartIndex(carts: readonly RailCartConfig[], cursor: VoxelCoord | null): number {
    if (!cursor) return -1
    let bestIndex = -1
    let bestDistSq = REMOVE_RADIUS * REMOVE_RADIUS
    const ax = cursor.x + 0.5
    const ay = cursor.y
    const az = cursor.z + 0.5
    for (let i = 0; i < carts.length; i++) {
        const cart = carts[i]!
        const dx = cart.railCell.x + 0.5 - ax
        const dy = cart.railCell.y - ay
        const dz = cart.railCell.z + 0.5 - az
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < bestDistSq) {
            bestDistSq = d2
            bestIndex = i
        }
    }
    return bestIndex
}
