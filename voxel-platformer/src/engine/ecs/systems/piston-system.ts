import { hasComponent, query } from 'bitecs'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { AIR } from '../../voxel/palette'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import { isCollidable } from '../../voxel/palette'
import { BoxCollider, PlayerControlled, Position, Velocity } from '../components'
import type { GameWorld, PistonMechanism, VoxelCoord } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'

/**
 * Drives every PistonMechanism in `world.pistons`. Each piston has an
 * *absolute* schedule (`nextFlipAt`) — when sim-time crosses it we attempt a
 * flip. On success we do `nextFlipAt += delay`, which keeps the schedule
 * aligned to a global grid: any group of pistons sharing the same delay
 * stays in lock-step, even when individual flips occasionally fail and
 * retry a tick later.
 *
 *  - `characterPolicy: 'block'` — refuse to flip while a character is
 *    standing in the target cell (good for hazards / locked-doors).
 *  - `characterPolicy: 'push'` — nudge the character along the flip
 *    direction. For *upward / horizontal* pistons a failed push (player
 *    would land in a wall) refuses the flip. For *downward* pistons a
 *    failed push signals death and the flip proceeds — the piston crushed
 *    the player against the floor.
 *
 * Voxel writes use the chunk manager's bulk-edit so the renderer only
 * remeshes once per flip.
 */
export function createPistonSystem(chunks: ChunkManager): System {
    let simTime = 0
    return {
        fixed: true,
        order: FixedOrder.mechanisms,
        update(world, dt) {
            simTime += dt
            // Pre-pass: collect every source cell that will go to AIR this
            // tick. Used by the wall check so a rider on a multi-piston
            // platform doesn't read its *neighbour* piston's still-solid
            // source as a wall it'd be crushed against. Without this, a
            // 2×3 elevator descending one cell falsely triggers crush
            // death on its rider — each piston's wall check sees the
            // other five sources as solid.
            const vacating = new Set<string>()
            for (const piston of world.pistons) {
                if (piston.motion === 'physical') continue
                if (simTime < piston.nextFlipAt) continue
                const src = piston.occupied === 'from' ? piston.from : piston.to
                vacating.add(cellKey(src.x, src.y, src.z))
            }
            for (const piston of world.pistons) {
                if (piston.motion === 'physical') {
                    updatePhysicalPiston(chunks, world, piston, simTime, dt)
                    continue
                }
                if (simTime < piston.nextFlipAt) continue
                if (tryFlipPiston(chunks, world, piston, vacating)) {
                    // Monotonic schedule. += delay (not simTime+delay)
                    // is what keeps multiple pistons synced when one of
                    // them flipped a tick or two late.
                    piston.nextFlipAt += piston.delay
                }
                // On blocked, leave nextFlipAt in the past — we'll retry
                // every tick until the obstruction clears. Once it does,
                // the += above snaps the schedule back onto the grid.
            }
        },
    }
}

function updatePhysicalPiston(
    chunks: ChunkManager,
    world: GameWorld,
    piston: PistonMechanism,
    simTime: number,
    dt: number,
): void {
    if (piston.eid < 0) return
    if (piston.moving === 0) {
        updatePhysicalPistonObstacle(world, piston)
        if (simTime < piston.nextFlipAt) return
        if (!tryStartPhysicalMove(chunks, world, piston, simTime)) return
    }

    const from = piston.moveFrom === 'from' ? piston.from : piston.to
    const to = piston.moveFrom === 'from' ? piston.to : piston.from
    const oldPos = {
        x: Position.x[piston.eid],
        y: Position.y[piston.eid],
        z: Position.z[piston.eid],
    }
    const nextT = Math.min(1, piston.moveT + dt / piston.travelTime)
    const nextPos = physicalPistonPosition(from, to, nextT)
    const delta = {
        x: nextPos.x - oldPos.x,
        y: nextPos.y - oldPos.y,
        z: nextPos.z - oldPos.z,
    }

    world.obstacles.remove(piston.eid)
    Position.x[piston.eid] = nextPos.x
    Position.y[piston.eid] = nextPos.y
    Position.z[piston.eid] = nextPos.z

    if (
        piston.characterPolicy === 'push' &&
        !tryPushPlayersWithPhysicalBlock(chunks, world, piston, oldPos, nextPos, delta)
    ) {
        Position.x[piston.eid] = oldPos.x
        Position.y[piston.eid] = oldPos.y
        Position.z[piston.eid] = oldPos.z
        updatePhysicalPistonObstacle(world, piston)
        return
    }

    piston.moveT = nextT
    if (nextT >= 1) {
        piston.occupied = piston.moveFrom === 'from' ? 'to' : 'from'
        piston.moving = 0
        piston.moveT = 0
        const end = piston.occupied === 'from' ? piston.from : piston.to
        Position.x[piston.eid] = end.x + 0.5
        Position.y[piston.eid] = end.y
        Position.z[piston.eid] = end.z + 0.5
    }
    updatePhysicalPistonObstacle(world, piston)
}

function tryStartPhysicalMove(
    chunks: ChunkManager,
    world: GameWorld,
    piston: PistonMechanism,
    simTime: number,
): boolean {
    const target = piston.occupied === 'from' ? piston.to : piston.from
    if (chunks.getVoxel(target.x, target.y, target.z) !== AIR) return false
    if (piston.characterPolicy === 'block' && voxelCellOverlapsPlayer(world, target)) return false
    piston.moving = 1
    piston.moveT = 0
    piston.moveFrom = piston.occupied
    piston.nextFlipAt = simTime + piston.travelTime + piston.delay
    return true
}

function physicalPistonPosition(from: VoxelCoord, to: VoxelCoord, t: number): { x: number; y: number; z: number } {
    return {
        x: from.x + 0.5 + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: from.z + 0.5 + (to.z - from.z) * t,
    }
}

function updatePhysicalPistonObstacle(world: GameWorld, piston: PistonMechanism): void {
    if (piston.eid < 0) return
    const aabb = physicalBlockAabb({
        x: Position.x[piston.eid],
        y: Position.y[piston.eid],
        z: Position.z[piston.eid],
    })
    world.obstacles.add(piston.eid, aabb)
}

function physicalBlockAabb(pos: { x: number; y: number; z: number }): AABB {
    return {
        minX: pos.x - 0.5,
        minY: pos.y,
        minZ: pos.z - 0.5,
        maxX: pos.x + 0.5,
        maxY: pos.y + 1,
        maxZ: pos.z + 0.5,
    }
}

function tryPushPlayersWithPhysicalBlock(
    chunks: ChunkManager,
    world: GameWorld,
    piston: PistonMechanism,
    oldPos: { x: number; y: number; z: number },
    nextPos: { x: number; y: number; z: number },
    delta: { x: number; y: number; z: number },
): boolean {
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return true
    const players = query(world, [Position, BoxCollider, PlayerControlled])
    if (players.length === 0) return true

    const oldBlock = physicalBlockAabb(oldPos)
    const nextBlock = physicalBlockAabb(nextPos)
    const nextByPlayer = new Map<number, { x: number; y: number; z: number }>()
    const playerBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const movedBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    for (let i = 0; i < players.length; i++) {
        const eid = players[i]!
        aabbFromFoot(
            { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
            { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] },
            playerBox,
        )
        const rider = playerRidesPhysicalBlock(eid, oldBlock)
        const overlapping = aabbOverlap(playerBox, nextBlock)
        if (!rider && !overlapping) continue

        const dest = {
            x: Position.x[eid] + delta.x,
            y: Position.y[eid] + delta.y,
            z: Position.z[eid] + delta.z,
        }
        aabbFromFoot(dest, { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] }, movedBox)
        if (voxelAABBOverlapExcept(chunks, movedBox, new Set()) || world.obstacles.intersects(movedBox, piston.eid)) {
            if (delta.y < 0) world.deathSignal ??= 'crushed-by-piston'
            return false
        }
        nextByPlayer.set(eid, dest)
    }

    for (const [eid, dest] of nextByPlayer) {
        Position.x[eid] = dest.x
        Position.y[eid] = dest.y
        Position.z[eid] = dest.z
        if (hasComponent(world, eid, Velocity)) {
            Velocity.x[eid] = 0
            Velocity.y[eid] = Math.max(0, Velocity.y[eid])
            Velocity.z[eid] = 0
        }
    }
    return true
}

function playerRidesPhysicalBlock(eid: number, block: AABB): boolean {
    const dy = Position.y[eid] - block.maxY
    if (dy < -0.02 || dy > 0.1) return false
    if (Position.x[eid] + BoxCollider.x[eid] <= block.minX) return false
    if (Position.x[eid] - BoxCollider.x[eid] >= block.maxX) return false
    if (Position.z[eid] + BoxCollider.z[eid] <= block.minZ) return false
    if (Position.z[eid] - BoxCollider.z[eid] >= block.maxZ) return false
    return true
}

function cellKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`
}

function tryFlipPiston(chunks: ChunkManager, world: GameWorld, piston: PistonMechanism, vacating: Set<string>): boolean {
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
    if (piston.characterPolicy === 'push') {
        const result = tryPushAffectedPlayers(chunks, world, source, target, direction, vacating)
        if (!result.ok) {
            // Downward piston crushed a rider/occupant against a wall —
            // kill the player and let the flip proceed. For non-downward
            // pistons keep the old "refuse the flip" trap behaviour.
            if (direction.y < 0 && result.crushed.length > 0) {
                world.deathSignal ??= 'crushed-by-piston'
            } else {
                return false
            }
        }
    }

    chunks.applyBulk([
        { ...source, value: AIR },
        { ...target, value: piston.block },
    ])
    piston.occupied = piston.occupied === 'from' ? 'to' : 'from'
    return true
}

interface PushResult {
    /** True if every affected player could be displaced safely. */
    ok: boolean
    /** Players whose displacement was blocked — used by the caller to
     *  decide whether to refuse the flip or kill the player (downward
     *  piston crush case). */
    crushed: number[]
}

/**
 * Pushes every player affected by the flip. Two groups are affected:
 *
 *  1. Players whose AABB overlaps the *target* cell — they're in the way of
 *     the incoming block and would be crushed otherwise.
 *  2. Players whose feet sit on top of the *source* cell — they're riders.
 *     Without this branch, an upward elevator with a tall travel distance
 *     would leave the rider standing in mid-air as the block teleports up,
 *     and they'd just fall back to the ground.
 *
 * Both groups are displaced by the full `direction` delta so riders land
 * cleanly on top of the new block position in a single step. If any pushed
 * player would land in a wall the function returns `ok: false` with the
 * crushed players listed — the caller decides what to do (refuse vs kill).
 */
function tryPushAffectedPlayers(
    chunks: ChunkManager,
    world: GameWorld,
    source: VoxelCoord,
    target: VoxelCoord,
    direction: VoxelCoord,
    vacating: Set<string>,
): PushResult {
    const targetOccupants = overlappingPlayers(world, target)
    const riders = ridersOnTopOfCell(world, source)
    if (targetOccupants.length === 0 && riders.length === 0) return { ok: true, crushed: [] }

    const affected = new Set<number>(targetOccupants)
    for (const eid of riders) affected.add(eid)

    const next = new Map<number, { x: number; y: number; z: number }>()
    const tmp: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const crushed: number[] = []
    for (const eid of affected) {
        const dest = {
            x: Position.x[eid] + direction.x,
            y: Position.y[eid] + direction.y,
            z: Position.z[eid] + direction.z,
        }
        aabbFromFoot(dest, { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] }, tmp)
        // Every source cell of a piston flipping this tick will become
        // air — exclude them all from the wall check so a rider on a
        // multi-cell platform doesn't read sibling pistons' source blocks
        // (still solid at the moment of the check) as walls.
        if (voxelAABBOverlapExcept(chunks, tmp, vacating)) {
            crushed.push(eid)
            continue
        }
        next.set(eid, dest)
    }

    if (crushed.length > 0) return { ok: false, crushed }

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
    return { ok: true, crushed: [] }
}

/** Players whose feet sit on the top face of `cell` and whose XZ AABB
 *  overlaps it. Tolerance in Y is small — we want actual contact, not a
 *  player who's mid-air above the block. */
function ridersOnTopOfCell(world: GameWorld, cell: VoxelCoord): number[] {
    const eids = query(world, [Position, BoxCollider, PlayerControlled])
    const out: number[] = []
    const topY = cell.y + 1
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]!
        const dy = Position.y[eid] - topY
        if (dy < -0.02 || dy > 0.1) continue
        if (Position.x[eid] + BoxCollider.x[eid] <= cell.x) continue
        if (Position.x[eid] - BoxCollider.x[eid] >= cell.x + 1) continue
        if (Position.z[eid] + BoxCollider.z[eid] <= cell.z) continue
        if (Position.z[eid] - BoxCollider.z[eid] >= cell.z + 1) continue
        out.push(eid)
    }
    return out
}

/** Like voxelAABBOverlap but skips any cell whose key is in `ignored`.
 *  Used by the piston push check so cells that will become air this tick
 *  (every source of a flipping piston) don't count as walls a rider would
 *  land in. */
function voxelAABBOverlapExcept(chunks: ChunkManager, aabb: AABB, ignored: Set<string>): boolean {
    const eps = 1e-6
    const x0 = Math.floor(aabb.minX)
    const y0 = Math.floor(aabb.minY)
    const z0 = Math.floor(aabb.minZ)
    const x1 = Math.floor(aabb.maxX - eps)
    const y1 = Math.floor(aabb.maxY - eps)
    const z1 = Math.floor(aabb.maxZ - eps)
    const palette = chunks.palette
    for (let y = y0; y <= y1; y++) {
        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                if (ignored.has(cellKey(x, y, z))) continue
                if (isCollidable(palette, chunks.getVoxel(x, y, z))) return true
            }
        }
    }
    return false
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

function aabbOverlap(a: AABB, b: AABB): boolean {
    return a.maxX > b.minX && a.minX < b.maxX &&
        a.maxY > b.minY && a.minY < b.maxY &&
        a.maxZ > b.minZ && a.minZ < b.maxZ
}
