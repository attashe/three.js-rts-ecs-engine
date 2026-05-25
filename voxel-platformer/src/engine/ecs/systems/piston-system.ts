import { hasComponent, query } from 'bitecs'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { AIR } from '../../voxel/palette'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import { isCollidable } from '../../voxel/palette'
import { BoxCollider, PlayerControlled, Position, Velocity } from '../components'
import type { GameWorld, PistonMechanism, VoxelCoord } from '../world'
import type { System } from './system'
import { FixedOrder } from './orders'

const MIN_PLATFORM_SUPPORT_OVERLAP = 0.12
const VERTICAL_CONTACT_EPS = 0.03

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
export interface PistonSystemOptions {
    /** Fires immediately after a successful flip (teleport) or arrival
     *  at the destination cell (physical). Use this to trigger audio /
     *  particles / score events. `position` is the world-space centre
     *  of the cell the piston is *now* occupying. */
    onFlip?: (piston: PistonMechanism, position: { x: number; y: number; z: number }) => void
}

export function createPistonSystem(chunks: ChunkManager, opts: PistonSystemOptions = {}): System {
    let simTime = 0
    const onFlip = opts.onFlip
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
            // Track players already pushed by a physical piston this tick.
            // Without this guard, a player straddling N adjacent pistons of
            // a co-moving platform gets the full delta applied N times —
            // they fly up faster than the platform and then snap back when
            // they fall out of rider tolerance, producing visible flicker.
            // First-piston-to-push wins; subsequent pistons see the eid in
            // this set and skip.
            const pushedThisTick = new Set<number>()
            for (const piston of world.pistons) {
                if (piston.motion === 'physical') {
                    const arrived = updatePhysicalPiston(chunks, world, piston, simTime, dt, pushedThisTick)
                    if (arrived && onFlip) onFlip(piston, occupiedCellCentre(piston))
                    continue
                }
                if (simTime < piston.nextFlipAt) continue
                if (tryFlipPiston(chunks, world, piston, vacating)) {
                    // Monotonic schedule. += delay (not simTime+delay)
                    // is what keeps multiple pistons synced when one of
                    // them flipped a tick or two late.
                    piston.nextFlipAt += piston.delay
                    if (onFlip) onFlip(piston, occupiedCellCentre(piston))
                }
                // On blocked, leave nextFlipAt in the past — we'll retry
                // every tick until the obstruction clears. Once it does,
                // the += above snaps the schedule back onto the grid.
            }
        },
    }
}

function occupiedCellCentre(piston: PistonMechanism): { x: number; y: number; z: number } {
    const cell = piston.occupied === 'from' ? piston.from : piston.to
    return { x: cell.x + 0.5, y: cell.y + 0.5, z: cell.z + 0.5 }
}

function updatePhysicalPiston(
    chunks: ChunkManager,
    world: GameWorld,
    piston: PistonMechanism,
    simTime: number,
    dt: number,
    pushedThisTick: Set<number>,
): boolean {
    if (piston.eid < 0) return false
    if (piston.moving === 0) {
        updatePhysicalPistonObstacle(world, chunks, piston)
        if (simTime < piston.nextFlipAt) return false
        if (!tryStartPhysicalMove(chunks, world, piston, simTime)) return false
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

    // Non-collidable blocks (cloud, water) can't push or carry the player
    // — they pass right through. Skip the push check; movement always succeeds.
    const blockIsCollidable = isCollidable(chunks.palette, piston.block)
    if (
        blockIsCollidable &&
        piston.characterPolicy === 'push' &&
        !tryPushPlayersWithPhysicalBlock(chunks, world, piston, oldPos, nextPos, delta, simTime, dt, pushedThisTick)
    ) {
        Position.x[piston.eid] = oldPos.x
        Position.y[piston.eid] = oldPos.y
        Position.z[piston.eid] = oldPos.z
        updatePhysicalPistonObstacle(world, chunks, piston)
        return false
    }

    piston.moveT = nextT
    let arrived = false
    if (nextT >= 1) {
        piston.occupied = piston.moveFrom === 'from' ? 'to' : 'from'
        piston.moving = 0
        piston.moveT = 0
        const end = piston.occupied === 'from' ? piston.from : piston.to
        Position.x[piston.eid] = end.x + 0.5
        Position.y[piston.eid] = end.y
        Position.z[piston.eid] = end.z + 0.5
        arrived = true
    }
    updatePhysicalPistonObstacle(world, chunks, piston)
    return arrived
}

function tryStartPhysicalMove(
    chunks: ChunkManager,
    world: GameWorld,
    piston: PistonMechanism,
    simTime: number,
): boolean {
    const target = piston.occupied === 'from' ? piston.to : piston.from
    if (chunks.getVoxel(target.x, target.y, target.z) !== AIR) return false
    // 'block' policy only refuses to flip when the player physically can't
    // share the cell with the block. Non-collidable pistons (cloud) move
    // through the player freely, so don't gate the move on overlap.
    const blockIsCollidable = isCollidable(chunks.palette, piston.block)
    if (blockIsCollidable && piston.characterPolicy === 'block' && voxelCellOverlapsPlayer(world, target)) return false
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

function updatePhysicalPistonObstacle(world: GameWorld, chunks: ChunkManager, piston: PistonMechanism): void {
    if (piston.eid < 0) return
    // Non-collidable blocks (cloud, water, …) move and render but don't
    // sit in the obstacle registry — physics sweeps walk straight through
    // them just like they walk through the corresponding voxel cells.
    if (!isCollidable(chunks.palette, piston.block)) {
        world.obstacles.remove(piston.eid)
        return
    }
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
    simTime: number,
    dt: number,
    pushedThisTick: Set<number>,
): boolean {
    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return true
    const players = query(world, [Position, BoxCollider, PlayerControlled])
    if (players.length === 0) return true

    const oldBlock = physicalBlockAabb(oldPos)
    const nextBlock = physicalBlockAabb(nextPos)
    const coMovingObstacles = coMovingPhysicalPistonEids(chunks, world, piston, delta, simTime, dt)
    const contactByPlayer = new Map<number, PhysicalPistonContact>()
    const playerBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const movedBox: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    const verticalMove = delta.y !== 0 && delta.x === 0 && delta.z === 0
    for (let i = 0; i < players.length; i++) {
        const eid = players[i]!
        // Already moved by another piston this tick — skip so a player
        // straddling a co-moving platform doesn't get the same delta
        // applied multiple times.
        if (pushedThisTick.has(eid)) continue
        aabbFromFoot(
            { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
            { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] },
            playerBox,
        )
        const rider = playerRidesPhysicalBlock(eid, oldBlock)
        const overlapping = aabbOverlap(playerBox, nextBlock)
        if (!rider && !overlapping) continue

        const contact = resolvePhysicalPistonContact(eid, playerBox, oldBlock, nextBlock, delta, rider, verticalMove)
        if (contact === null) continue

        const dest = contact.dest
        aabbFromFoot(dest, { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] }, movedBox)
        if (voxelAABBOverlapExcept(chunks, movedBox, new Set()) || world.obstacles.intersectsExcept(movedBox, coMovingObstacles)) {
            if (contact.crushOnBlocked) world.deathSignal ??= 'crushed-by-piston'
            return false
        }
        contactByPlayer.set(eid, contact)
    }

    for (const [eid, contact] of contactByPlayer) {
        Position.x[eid] = contact.dest.x
        Position.y[eid] = contact.dest.y
        Position.z[eid] = contact.dest.z
        if (!contact.preserveVelocity && hasComponent(world, eid, Velocity)) {
            Velocity.x[eid] = 0
            Velocity.y[eid] = Math.max(0, Velocity.y[eid])
            Velocity.z[eid] = 0
        }
        // Claim this player so subsequent co-moving pistons skip them.
        // Side-graze contacts also claim, because the player was just
        // teleported sideways — a second piston pushing them again would
        // double the displacement.
        pushedThisTick.add(eid)
    }
    return true
}

function coMovingPhysicalPistonEids(
    chunks: ChunkManager,
    world: GameWorld,
    active: PistonMechanism,
    delta: { x: number; y: number; z: number },
    simTime: number,
    dt: number,
): ReadonlySet<number> {
    const ignored = new Set<number>([active.eid])
    for (const piston of world.pistons) {
        if (piston === active) continue
        if (piston.motion !== 'physical' || piston.eid < 0) continue
        if (!isCollidable(chunks.palette, piston.block)) continue
        const otherDelta = physicalPistonDeltaForTick(chunks, world, piston, simTime, dt)
        if (!otherDelta) continue
        if (sameDelta(delta, otherDelta)) ignored.add(piston.eid)
    }
    return ignored
}

function physicalPistonDeltaForTick(
    chunks: ChunkManager,
    world: GameWorld,
    piston: PistonMechanism,
    simTime: number,
    dt: number,
): { x: number; y: number; z: number } | null {
    if (piston.eid < 0) return null
    let moveFrom = piston.moveFrom
    let moveT = piston.moveT
    if (piston.moving === 0) {
        if (simTime < piston.nextFlipAt) return null
        const target = piston.occupied === 'from' ? piston.to : piston.from
        if (chunks.getVoxel(target.x, target.y, target.z) !== AIR) return null
        if (isCollidable(chunks.palette, piston.block) &&
            piston.characterPolicy === 'block' &&
            voxelCellOverlapsPlayer(world, target)) return null
        moveFrom = piston.occupied
        moveT = 0
    }

    const from = moveFrom === 'from' ? piston.from : piston.to
    const to = moveFrom === 'from' ? piston.to : piston.from
    const oldPos = {
        x: Position.x[piston.eid],
        y: Position.y[piston.eid],
        z: Position.z[piston.eid],
    }
    const nextT = Math.min(1, moveT + dt / piston.travelTime)
    const nextPos = physicalPistonPosition(from, to, nextT)
    return {
        x: nextPos.x - oldPos.x,
        y: nextPos.y - oldPos.y,
        z: nextPos.z - oldPos.z,
    }
}

function sameDelta(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
    const eps = 1e-6
    return Math.abs(a.x - b.x) <= eps &&
        Math.abs(a.y - b.y) <= eps &&
        Math.abs(a.z - b.z) <= eps
}

interface PhysicalPistonContact {
    dest: { x: number; y: number; z: number }
    crushOnBlocked: boolean
    /** When true, the apply step should NOT zero the player's velocity.
     *  Set for side-graze pushes — the player is merely being nudged out
     *  of the way, so their own movement / gravity must keep going. The
     *  rider / vertical-approach / horizontal-shove cases set this false
     *  because the platform is actively carrying them. */
    preserveVelocity: boolean
}

function resolvePhysicalPistonContact(
    eid: number,
    playerBox: AABB,
    oldBlock: AABB,
    block: AABB,
    delta: { x: number; y: number; z: number },
    rider: boolean,
    verticalMove: boolean,
): PhysicalPistonContact | null {
    if (rider) {
        return {
            dest: {
                x: Position.x[eid] + delta.x,
                y: Position.y[eid] + delta.y,
                z: Position.z[eid] + delta.z,
            },
            crushOnBlocked: delta.y < 0,
            preserveVelocity: false,
        }
    }

    if (!verticalMove) {
        return {
            dest: {
                x: Position.x[eid] + delta.x,
                y: Position.y[eid] + delta.y,
                z: Position.z[eid] + delta.z,
            },
            crushOnBlocked: delta.y < 0,
            preserveVelocity: false,
        }
    }

    if (pistonApproachesPlayerVertically(eid, playerBox, oldBlock, block, delta.y)) {
        return {
            dest: {
                x: Position.x[eid],
                y: Position.y[eid] + delta.y,
                z: Position.z[eid],
            },
            crushOnBlocked: delta.y < 0,
            preserveVelocity: false,
        }
    }

    // When the player is walking across a multi-block vertical platform,
    // neighbouring blocks can have a tiny horizontal overlap with the feet.
    // On ascent the neighbour's next AABB overlaps the lower part of the
    // player, but this is still a top-surface graze, not a side collision.
    // Ignore it so the actual support block can carry the player this tick.
    if (playerFeetNearTopOfBlock(eid, oldBlock)) return null

    const sidePush = smallestHorizontalSeparation(playerBox, block)
    if (!sidePush) return null
    return {
        dest: {
            x: Position.x[eid] + sidePush.x,
            y: Position.y[eid],
            z: Position.z[eid] + sidePush.z,
        },
        crushOnBlocked: false,
        preserveVelocity: true,
    }
}

function pistonApproachesPlayerVertically(
    eid: number,
    playerBox: AABB,
    oldBlock: AABB,
    nextBlock: AABB,
    deltaY: number,
): boolean {
    if (!playerCenterInsideHorizontalFootprint(eid, nextBlock)) return false
    if (deltaY > 0) return oldBlock.maxY <= playerBox.minY + VERTICAL_CONTACT_EPS
    if (deltaY < 0) return oldBlock.minY >= playerBox.maxY - VERTICAL_CONTACT_EPS
    return false
}

function playerCenterInsideHorizontalFootprint(eid: number, block: AABB): boolean {
    return Position.x[eid] > block.minX && Position.x[eid] < block.maxX &&
        Position.z[eid] > block.minZ && Position.z[eid] < block.maxZ
}

function playerFeetNearTopOfBlock(eid: number, block: AABB): boolean {
    const dy = Position.y[eid] - block.maxY
    return dy >= -0.02 && dy <= 0.1
}

function playerRidesPhysicalBlock(eid: number, block: AABB): boolean {
    if (!playerFeetNearTopOfBlock(eid, block)) return false
    const playerBox: AABB = {
        minX: Position.x[eid] - BoxCollider.x[eid],
        maxX: Position.x[eid] + BoxCollider.x[eid],
        minY: Position.y[eid],
        maxY: Position.y[eid] + BoxCollider.y[eid] * 2,
        minZ: Position.z[eid] - BoxCollider.z[eid],
        maxZ: Position.z[eid] + BoxCollider.z[eid],
    }
    return hasSubstantialHorizontalOverlap(playerBox, block, MIN_PLATFORM_SUPPORT_OVERLAP)
}

function hasSubstantialHorizontalOverlap(a: AABB, b: AABB, minOverlap: number): boolean {
    const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
    const overlapZ = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ)
    return overlapX >= minOverlap && overlapZ >= minOverlap
}

function smallestHorizontalSeparation(a: AABB, b: AABB): { x: number; z: number } | null {
    const pushLeft = b.minX - a.maxX
    const pushRight = b.maxX - a.minX
    const pushBack = b.minZ - a.maxZ
    const pushForward = b.maxZ - a.minZ
    const candidates = [
        { x: pushLeft, z: 0, amount: Math.abs(pushLeft) },
        { x: pushRight, z: 0, amount: Math.abs(pushRight) },
        { x: 0, z: pushBack, amount: Math.abs(pushBack) },
        { x: 0, z: pushForward, amount: Math.abs(pushForward) },
    ].filter((push) => push.amount > 0)
    if (candidates.length === 0) return null
    candidates.sort((aPush, bPush) => aPush.amount - bPush.amount)
    const best = candidates[0]!
    return { x: best.x, z: best.z }
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
    // Non-collidable teleport blocks (cloud/water) pass through players,
    // so 'block' policy + 'push' policy are both no-ops for them — let
    // the flip happen regardless of overlap.
    const blockIsCollidable = isCollidable(chunks.palette, piston.block)
    if (blockIsCollidable && piston.characterPolicy === 'block' && voxelCellOverlapsPlayer(world, target)) return false
    if (blockIsCollidable && piston.characterPolicy === 'push') {
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
