import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import { BoxCollider, ClimbingLadder, Grounded, PlayerControlled, Position, RidingCart, Velocity } from '../../engine/ecs/components'
import { FixedOrder } from '../../engine/ecs/systems/orders'
import type { System } from '../../engine/ecs/systems/system'
import type { GameWorld } from '../../engine/ecs/world'
import type { ActionMap } from '../../engine/input/actions'
import type { ChunkManager } from '../../engine/voxel/chunk-manager'
import { isLadderBlock } from '../../engine/voxel/palette'
import { aabbFromFoot, isGrounded, voxelAABBOverlap, type AABB } from '../../engine/voxel/voxel-collide'
import { GameAction } from '../actions'
import type { InteractionProviderTarget } from '../interaction-system'

export interface LadderSystemOptions {
    actions: ActionMap
    climbSpeed?: number
}

interface LadderStack {
    x: number
    z: number
    centerX: number
    centerZ: number
    bottomY: number
    topY: number
    topCellY: number
}

const DEFAULT_CLIMB_SPEED = 2.8
const LADDER_INTERACTION_RADIUS = 1.35
const LADDER_SEARCH_VERTICAL_PAD = 1
const LADDER_EPS = 1e-4

const tmpAabb: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }

export function createLadderSystem(chunks: ChunkManager, opts: LadderSystemOptions): System {
    const climbSpeed = Math.max(0.1, opts.climbSpeed ?? DEFAULT_CLIMB_SPEED)
    return {
        name: 'ladders',
        fixed: true,
        order: FixedOrder.input + 5,
        update(world, dt) {
            const players = query(world, [PlayerControlled, ClimbingLadder, Position, Velocity, BoxCollider])
            for (let i = 0; i < players.length; i++) {
                updateClimber(world, chunks, opts.actions, players[i]!, dt, climbSpeed)
            }
        },
    }
}

export function nearestLadderInteractionTarget(
    world: GameWorld,
    player: { eid: number; x: number; y: number; z: number },
    chunks: ChunkManager,
): InteractionProviderTarget | null {
    if (hasComponent(world, player.eid, ClimbingLadder)) {
        return {
            id: `ladder:${player.eid}:drop`,
            prompt: 'Drop from ladder',
            anchor: {
                x: ClimbingLadder.centerX[player.eid],
                y: Position.y[player.eid] + 1.1,
                z: ClimbingLadder.centerZ[player.eid],
            },
            distanceSq: 0,
            interact(activeWorld) {
                detachFromLadder(activeWorld, player.eid)
            },
        }
    }
    if (hasComponent(world, player.eid, RidingCart)) return null

    const stack = nearestLadderStack(world, player, chunks)
    if (!stack) return null
    return {
        id: `ladder:${stack.x},${stack.bottomY},${stack.z}:${stack.topCellY}`,
        prompt: 'Climb ladder',
        anchor: {
            x: stack.centerX,
            y: Math.min(stack.topY, Math.max(stack.bottomY, player.y)) + 0.75,
            z: stack.centerZ,
        },
        distanceSq: distanceSqToStack(player, stack),
        interact(activeWorld, activePlayer) {
            attachToLadder(activeWorld, activePlayer.eid, stack)
        },
    }
}

export function attachToLadder(world: GameWorld, player: number, stack: LadderStack): void {
    if (hasComponent(world, player, RidingCart)) return
    addComponent(world, player, ClimbingLadder)
    ClimbingLadder.centerX[player] = stack.centerX
    ClimbingLadder.centerZ[player] = stack.centerZ
    ClimbingLadder.bottomY[player] = stack.bottomY
    ClimbingLadder.topY[player] = stack.topY
    Position.x[player] = stack.centerX
    Position.y[player] = clamp(Position.y[player], stack.bottomY, stack.topY)
    Position.z[player] = stack.centerZ
    zeroVelocity(player)
    if (hasComponent(world, player, Grounded)) removeComponent(world, player, Grounded)
}

export function detachFromLadder(world: GameWorld, player: number): void {
    if (!hasComponent(world, player, ClimbingLadder)) return
    removeComponent(world, player, ClimbingLadder)
    zeroVelocity(player)
    if (hasComponent(world, player, Grounded)) removeComponent(world, player, Grounded)
}

function updateClimber(
    world: GameWorld,
    chunks: ChunkManager,
    actions: ActionMap,
    player: number,
    dt: number,
    climbSpeed: number,
): void {
    const centerX = ClimbingLadder.centerX[player]
    const centerZ = ClimbingLadder.centerZ[player]
    const bottomY = ClimbingLadder.bottomY[player]
    const topY = ClimbingLadder.topY[player]
    const ladderX = Math.floor(centerX)
    const ladderZ = Math.floor(centerZ)
    if (!ladderColumnStillExists(chunks, ladderX, ladderZ, bottomY, topY)) {
        detachFromLadder(world, player)
        return
    }

    const forward = actions.isHeld(GameAction.MoveForward)
    const backward = actions.isHeld(GameAction.MoveBackward)
    const input = forward === backward ? 0 : forward ? 1 : -1

    Position.x[player] = centerX
    Position.z[player] = centerZ
    zeroVelocity(player)

    if (input === 0) {
        Position.y[player] = clamp(Position.y[player], bottomY, topY)
        return
    }

    const nextY = clamp(Position.y[player] + input * climbSpeed * dt, bottomY, topY)
    Position.y[player] = nextY

    if (input > 0 && nextY >= topY - LADDER_EPS) {
        detachAtEndpoint(world, chunks, player, 'top')
    } else if (input < 0 && nextY <= bottomY + LADDER_EPS) {
        detachAtEndpoint(world, chunks, player, 'bottom')
    }
}

function detachAtEndpoint(world: GameWorld, chunks: ChunkManager, player: number, endpoint: 'top' | 'bottom'): void {
    const safe = findEndpointDismount(world, chunks, player, endpoint)
    if (safe) {
        Position.x[player] = safe.x
        Position.y[player] = safe.y
        Position.z[player] = safe.z
    }
    detachFromLadder(world, player)
}

function findEndpointDismount(
    world: GameWorld,
    chunks: ChunkManager,
    player: number,
    endpoint: 'top' | 'bottom',
): { x: number; y: number; z: number } | null {
    const y = endpoint === 'top' ? ClimbingLadder.topY[player] : ClimbingLadder.bottomY[player]
    const centerX = ClimbingLadder.centerX[player]
    const centerZ = ClimbingLadder.centerZ[player]
    const half = colliderHalf(player)
    const candidates = [
        { x: centerX, y, z: centerZ },
        { x: centerX + 1, y, z: centerZ },
        { x: centerX - 1, y, z: centerZ },
        { x: centerX, y, z: centerZ + 1 },
        { x: centerX, y, z: centerZ - 1 },
    ]
    for (const candidate of candidates) {
        if (!isSafeStandingPosition(world, chunks, player, candidate, half)) continue
        return candidate
    }
    return null
}

function nearestLadderStack(
    world: GameWorld,
    player: { eid: number; x: number; y: number; z: number },
    chunks: ChunkManager,
): LadderStack | null {
    const radius = LADDER_INTERACTION_RADIUS
    const x0 = Math.floor(player.x - radius)
    const x1 = Math.floor(player.x + radius)
    const z0 = Math.floor(player.z - radius)
    const z1 = Math.floor(player.z + radius)
    const halfY = hasComponent(world, player.eid, BoxCollider) ? BoxCollider.y[player.eid] : 0.9
    const y0 = Math.floor(player.y - LADDER_SEARCH_VERTICAL_PAD)
    const y1 = Math.floor(player.y + halfY * 2 + LADDER_SEARCH_VERTICAL_PAD)
    const half = colliderHalf(player.eid)
    const seen = new Set<string>()
    let best: LadderStack | null = null
    let bestD2 = Infinity
    for (let z = z0; z <= z1; z++) {
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                if (!isLadderCell(chunks, x, y, z)) continue
                const stack = ladderStackAt(chunks, x, y, z)
                if (!stack) continue
                const key = `${stack.x},${stack.bottomY},${stack.z},${stack.topCellY}`
                if (seen.has(key)) continue
                seen.add(key)
                const d2 = distanceSqToStack(player, stack)
                if (d2 > radius * radius || d2 >= bestD2) continue
                if (!isSafeAttachPosition(world, chunks, player.eid, stack, half)) continue
                best = stack
                bestD2 = d2
            }
        }
    }
    return best
}

function ladderStackAt(chunks: ChunkManager, x: number, y: number, z: number): LadderStack | null {
    if (!isLadderCell(chunks, x, y, z)) return null
    let bottom = y
    while (isLadderCell(chunks, x, bottom - 1, z)) bottom--
    let top = y
    while (isLadderCell(chunks, x, top + 1, z)) top++
    return {
        x,
        z,
        centerX: x + 0.5,
        centerZ: z + 0.5,
        bottomY: bottom,
        topY: top + 1,
        topCellY: top,
    }
}

function ladderColumnStillExists(chunks: ChunkManager, x: number, z: number, bottomY: number, topY: number): boolean {
  const y0 = Math.floor(bottomY)
  const y1 = Math.floor(topY - LADDER_EPS)
  for (let y = y0; y <= y1; y++) {
    if (!isLadderCell(chunks, x, y, z)) return false
  }
  return true
}

function isLadderCell(chunks: ChunkManager, x: number, y: number, z: number): boolean {
    return isLadderBlock(chunks.palette, chunks.getVoxel(x, y, z))
}

function distanceSqToStack(
    player: { x: number; y: number; z: number },
    stack: LadderStack,
): number {
    const dyPoint = clamp(player.y, stack.bottomY, stack.topY)
    const dx = player.x - stack.centerX
    const dy = player.y - dyPoint
    const dz = player.z - stack.centerZ
    return dx * dx + dy * dy + dz * dz
}

function isSafeAttachPosition(
    world: GameWorld,
    chunks: ChunkManager,
    player: number,
    stack: LadderStack,
    half: { x: number; y: number; z: number },
): boolean {
    const pos = {
        x: stack.centerX,
        y: clamp(Position.y[player], stack.bottomY, stack.topY),
        z: stack.centerZ,
    }
    aabbFromFoot(pos, half, tmpAabb)
    if (voxelAABBOverlap(chunks, tmpAabb)) return false
    return !world.obstacles.intersects(tmpAabb, player)
}

function isSafeStandingPosition(
    world: GameWorld,
    chunks: ChunkManager,
    player: number,
    pos: { x: number; y: number; z: number },
    half: { x: number; y: number; z: number },
): boolean {
    aabbFromFoot(pos, half, tmpAabb)
    if (voxelAABBOverlap(chunks, tmpAabb)) return false
    if (world.obstacles.intersects(tmpAabb, player)) return false
    return isGrounded(chunks, pos, half, 0.12, world.obstacles, player)
}

function colliderHalf(player: number): { x: number; y: number; z: number } {
    return {
        x: BoxCollider.x[player] || 0.34,
        y: BoxCollider.y[player] || 0.9,
        z: BoxCollider.z[player] || 0.34,
    }
}

function zeroVelocity(eid: number): void {
    Velocity.x[eid] = 0
    Velocity.y[eid] = 0
    Velocity.z[eid] = 0
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
}

export type { LadderStack }
