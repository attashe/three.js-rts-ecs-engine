import { hasComponent, query } from 'bitecs'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { AIR } from '../../voxel/palette'
import { aabbFromFoot, voxelAABBOverlap, type AABB } from '../../voxel/voxel-collide'
import { BoxCollider, PlayerControlled, Position, Velocity } from '../components'
import type { GameWorld, PistonMechanism, VoxelCoord } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'

/**
 * Drives every PistonMechanism in `world.pistons`. Each piston runs a single
 * countdown; on flip it tries to teleport its block between `from` and `to`.
 *
 *  - `characterPolicy: 'block'` — refuse to flip while a character is
 *    standing in the target cell (good for hazards / locked-doors).
 *  - `characterPolicy: 'push'` — nudge the character one cell along the flip
 *    direction. Falls back to refusing the flip if the nudged position
 *    would overlap a wall.
 *
 * Voxel writes use the chunk manager's bulk-edit so the renderer only
 * remeshes once per flip.
 */
export function createPistonSystem(chunks: ChunkManager): System {
    return {
        fixed: true,
        order: FixedOrder.mechanisms,
        update(world, dt) {
            for (const piston of world.pistons) {
                piston.timer -= dt
                if (piston.timer > 0) continue
                const moved = tryFlipPiston(chunks, world, piston)
                // If the flip was blocked, retry sooner so the platform doesn't
                // sit dead for a full interval after a single missed slot.
                piston.timer = moved ? piston.interval : Math.min(0.25, piston.interval)
            }
        },
    }
}

function tryFlipPiston(chunks: ChunkManager, world: GameWorld, piston: PistonMechanism): boolean {
    const source = piston.occupied === 'from' ? piston.from : piston.to
    const target = piston.occupied === 'from' ? piston.to : piston.from
    // Full delta vector, not just a sign. A 2-cell-tall elevator pushing by
    // only +1 leaves the rider embedded in the freshly-placed block until
    // physics resolves it next frame — visible jitter. Pushing by the full
    // delta lands the rider on top of the block in a single step.
    const direction: VoxelCoord = {
        x: target.x - source.x,
        y: target.y - source.y,
        z: target.z - source.z,
    }

    if (chunks.getVoxel(target.x, target.y, target.z) !== AIR) return false
    if (piston.characterPolicy === 'block' && voxelCellOverlapsPlayer(world, target)) return false
    if (piston.characterPolicy === 'push' && !tryPushPlayersFromCell(chunks, world, target, direction)) {
        return false
    }

    chunks.applyBulk([
        { ...source, value: AIR },
        { ...target, value: piston.block },
    ])
    piston.occupied = piston.occupied === 'from' ? 'to' : 'from'
    return true
}

function tryPushPlayersFromCell(
    chunks: ChunkManager,
    world: GameWorld,
    cell: VoxelCoord,
    direction: VoxelCoord,
): boolean {
    const occupants = overlappingPlayers(world, cell)
    if (occupants.length === 0) return true

    const next = new Map<number, { x: number; y: number; z: number }>()
    const tmp: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    for (const eid of occupants) {
        const dest = {
            x: Position.x[eid] + direction.x,
            y: Position.y[eid] + direction.y,
            z: Position.z[eid] + direction.z,
        }
        aabbFromFoot(dest, { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] }, tmp)
        // Don't push into a wall — better to refuse the whole flip.
        if (voxelAABBOverlap(chunks, tmp)) return false
        next.set(eid, dest)
    }

    for (const [eid, dest] of next) {
        Position.x[eid] = dest.x
        Position.y[eid] = dest.y
        Position.z[eid] = dest.z
        if (hasComponent(world, eid, Velocity)) {
            Velocity.x[eid] = 0
            // Preserve any upward intent so a player getting carried up by an
            // ascending platform doesn't lose their high-jump arc.
            Velocity.y[eid] = Math.max(0, Velocity.y[eid])
            Velocity.z[eid] = 0
        }
    }
    return true
}

function voxelCellOverlapsPlayer(world: GameWorld, pos: VoxelCoord): boolean {
    const eids = query(world, [Position, BoxCollider, PlayerControlled])
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]!
        if (playerOverlapsVoxelCell(eid, pos)) return true
    }
    return false
}

function overlappingPlayers(world: GameWorld, cell: VoxelCoord): number[] {
    const eids = query(world, [Position, BoxCollider, PlayerControlled])
    const out: number[] = []
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]!
        if (playerOverlapsVoxelCell(eid, cell)) out.push(eid)
    }
    return out
}

function playerOverlapsVoxelCell(eid: number, pos: VoxelCoord): boolean {
    return Position.x[eid] + BoxCollider.x[eid] > pos.x &&
        Position.x[eid] - BoxCollider.x[eid] < pos.x + 1 &&
        Position.y[eid] < pos.y + 1 &&
        Position.y[eid] + BoxCollider.y[eid] * 2 > pos.y &&
        Position.z[eid] + BoxCollider.z[eid] > pos.z &&
        Position.z[eid] - BoxCollider.z[eid] < pos.z + 1
}
