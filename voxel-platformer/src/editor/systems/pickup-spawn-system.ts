import { addComponent, addComponents } from 'bitecs'
import type { GameWorld } from '../../engine/ecs/world'
import { pushLog } from '../../engine/ecs/world'
import {
    Position,
    Renderable,
    Rotation,
    StaticRenderable,
} from '../../engine/ecs/components'
import { createEntity, despawnEntity } from '../../engine/ecs/entity'
import { PickupKind } from '../../engine/ecs/systems/pickup-system'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import type { System } from '../../engine/ecs/systems/system'
import type { Input } from '../../engine/input/input'
import { createCoinPile, mergeGroupByMaterial } from '../../game/assets'
import type { EditorState } from '../editor-state'

/**
 * Place pickup metadata entries (and matching preview meshes) when the
 * editor is in `spawn-pickup` mode and the user clicks. Right-click in
 * pickup mode removes the nearest pickup within ~1 voxel of the cursor —
 * cheaper than a full select-then-delete flow for v0.
 *
 * The preview entities have Position + Rotation + Renderable +
 * StaticRenderable; no Pickup tag, so they don't activate any pickup
 * collection logic. They're purely visual placeholders that round-trip
 * through `editorState.pickups`.
 */
export function createPickupSpawnSystem(input: Input, editorState: EditorState): System {
    return {
        fixed: true,
        // After voxel-paint-system so we don't double-process the same click;
        // voxel-paint-system bails when mode is spawn-pickup.
        order: FixedOrder.input + 5,
        update(world) {
            if (editorState.mode !== 'spawn-pickup') return
            const clicks = input.consumeClicks()
            if (clicks.length === 0) return
            if (!editorState.cursor) return

            for (const click of clicks) {
                if (click.button === 2) {
                    removeNearestPickup(world, editorState)
                } else {
                    placePickup(world, editorState)
                }
            }
        },
    }
}

function placePickup(world: GameWorld, editorState: EditorState): void {
    const cursor = editorState.cursor
    if (!cursor) return
    // Place at the centre of the targeted cell's floor.
    const position = { x: cursor.x + 0.5, y: cursor.y, z: cursor.z + 0.5 }
    const eid = spawnPickupPreview(world, editorState.pickupKind, position)
    editorState.pickups.push({
        position,
        kind: editorState.pickupKind,
        amount: editorState.pickupAmount,
        eid,
    })
    pushLog(world, `Placed pickup (${editorState.pickupAmount}).`)
}

function removeNearestPickup(world: GameWorld, editorState: EditorState): void {
    const cursor = editorState.cursor
    if (!cursor) return
    const cx = cursor.x + 0.5
    const cy = cursor.y
    const cz = cursor.z + 0.5
    let bestIndex = -1
    let bestDistSq = 1.5 * 1.5
    for (let i = 0; i < editorState.pickups.length; i++) {
        const p = editorState.pickups[i]!
        const dx = p.position.x - cx
        const dy = p.position.y - cy
        const dz = p.position.z - cz
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < bestDistSq) {
            bestDistSq = d2
            bestIndex = i
        }
    }
    if (bestIndex < 0) return
    const [removed] = editorState.pickups.splice(bestIndex, 1)
    if (removed && removed.eid >= 0) despawnEntity(world, removed.eid)
    pushLog(world, 'Removed pickup.')
}

/** Spawn a visual placeholder for a pickup. Returns the new eid. */
export function spawnPickupPreview(
    world: GameWorld,
    kind: number,
    position: { x: number; y: number; z: number },
): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, StaticRenderable])
    Position.x[eid] = position.x
    Position.y[eid] = position.y
    Position.z[eid] = position.z
    // For now only Gold is supported; the visual is the coin pile asset.
    void kind
    world.object3DByEid.set(eid, mergeGroupByMaterial(createCoinPile()))
    addComponent(world, eid, Renderable)
    return eid
}

void PickupKind  // re-exported via editor-state for consumers; keep the import live
