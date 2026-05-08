import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import type { ChunkManager } from '../../voxel'
import { isPathSurface } from '../../voxel'
import {
    BoxCollider,
    Grounded,
    HorizontalBlocked,
    MovingObject,
    PhysicalObstacle,
    Position,
    Rotation,
    Velocity,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import {
    MovingObjectKind,
    spawnFallingStone,
    turnArrowIntoPickup,
    type StoneFallSpawnerConfig,
} from '../../../game/moving-objects'

const ARROW_MIN_SETTLE_AGE = 0.18
const ARROW_REST_SECONDS = 0.06
const STONE_RADIUS = 0.28
const STONE_VISUAL_RADIUS = 0.28
const STONE_DIAMETER = STONE_VISUAL_RADIUS * 2
const STONE_REST_SECONDS = 0.75
const STONE_GRAVITY = 18
const STONE_MAX_FALL_SPEED = 28
const STONE_GROUND_EPSILON = 0.03

export function createMovingObjectSystem(chunks: ChunkManager): System {
    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world, dt) {
            const eids = query(world, [MovingObject, Position])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                MovingObject.age[eid] += dt

                const kind = MovingObject.kind[eid]
                if (kind === MovingObjectKind.Arrow) {
                    updateArrow(world, eid, dt)
                } else if (kind === MovingObjectKind.Stone) {
                    updateStone(chunks, world, eid, dt)
                }
            }
            resolveMovingStoneCollisions(world)
            resolveMovingStoneCollisions(world)
            resolveMovingStoneCollisions(world)
        },
    }
}

export interface FallingStoneSpawnerOptions {
    maxMovingStones?: number
}

export function createFallingStoneSpawnerSystem(
    spawners: StoneFallSpawnerConfig[],
    opts: FallingStoneSpawnerOptions = {},
): System {
    const maxMovingStones = opts.maxMovingStones ?? 8
    const timers = spawners.map(() => 0)

    return {
        fixed: true,
        order: FixedOrder.ai,
        update(world, dt) {
            if (spawners.length === 0) return
            const movingStones = countMovingStones(world)
            if (movingStones >= maxMovingStones) return

            for (let i = 0; i < spawners.length; i++) {
                timers[i] -= dt
                if (timers[i] > 0) continue

                const spawner = spawners[i]
                const jitter = spawner.jitter ?? 0
                const offset = jitter > 0 ? pseudoJitter(performance.now() + i * 97) * jitter : 0
                spawnFallingStone(
                    world,
                    { x: spawner.position.x, y: spawner.position.y, z: spawner.position.z + offset },
                    spawner.velocity,
                )
                timers[i] = spawner.interval
            }
        },
    }
}

function updateArrow(world: Parameters<System['update']>[0], eid: number, dt: number): void {
    if (!hasComponent(world, eid, Velocity)) return
    orientArrow(eid)

    const speedSq = velocitySpeedSq(eid)
    const shouldSettle = MovingObject.age[eid] > ARROW_MIN_SETTLE_AGE &&
        (hasComponent(world, eid, Grounded) || hasComponent(world, eid, HorizontalBlocked) || speedSq < 0.04)
    MovingObject.restTime[eid] = shouldSettle ? MovingObject.restTime[eid] + dt : 0
    if (MovingObject.restTime[eid] < ARROW_REST_SECONDS) return

    Velocity.x[eid] = 0
    Velocity.y[eid] = 0
    Velocity.z[eid] = 0
    removeComponent(world, eid, Velocity)
    removeComponent(world, eid, BoxCollider)
    if (hasComponent(world, eid, Grounded)) removeComponent(world, eid, Grounded)
    if (hasComponent(world, eid, HorizontalBlocked)) removeComponent(world, eid, HorizontalBlocked)
    turnArrowIntoPickup(world, eid)
    removeComponent(world, eid, MovingObject)
}

function updateStone(chunks: ChunkManager, world: Parameters<System['update']>[0], eid: number, dt: number): void {
    if (!hasComponent(world, eid, Velocity)) return

    Velocity.y[eid] = Math.max(-STONE_MAX_FALL_SPEED, Velocity.y[eid] - STONE_GRAVITY * dt)
    Position.x[eid] += Velocity.x[eid] * dt
    Position.y[eid] += Velocity.y[eid] * dt
    Position.z[eid] += Velocity.z[eid] * dt

    const groundY = terrainHeightBelow(chunks, Position.x[eid], Position.z[eid], Position.y[eid])
    const onGround = groundY !== null && Position.y[eid] <= groundY + STONE_VISUAL_RADIUS + STONE_GROUND_EPSILON
    if (onGround) {
        Position.y[eid] = groundY + STONE_VISUAL_RADIUS
        if (Velocity.y[eid] < -4) {
            Velocity.y[eid] = -Velocity.y[eid] * 0.18
        } else {
            Velocity.y[eid] = 0
        }
        applyDownhillDrift(chunks, eid, dt)
        Velocity.x[eid] *= Math.exp(-1.25 * dt)
        Velocity.z[eid] *= Math.exp(-1.25 * dt)
    }

    Rotation.x[eid] += Velocity.z[eid] * dt * 1.8
    Rotation.z[eid] -= Velocity.x[eid] * dt * 1.8

    const slow = Math.hypot(Velocity.x[eid], Velocity.z[eid]) < 0.12 && Math.abs(Velocity.y[eid]) < 0.08
    MovingObject.restTime[eid] = onGround && slow
        ? MovingObject.restTime[eid] + dt
        : 0
    if (MovingObject.restTime[eid] < STONE_REST_SECONDS) return

    Velocity.x[eid] = 0
    Velocity.y[eid] = 0
    Velocity.z[eid] = 0
    removeComponent(world, eid, Velocity)
    addComponent(world, eid, BoxCollider)
    BoxCollider.x[eid] = STONE_RADIUS
    Position.y[eid] = Math.max(0, Position.y[eid] - STONE_VISUAL_RADIUS)
    BoxCollider.y[eid] = 0.28
    BoxCollider.z[eid] = STONE_RADIUS
    if (hasComponent(world, eid, HorizontalBlocked)) removeComponent(world, eid, HorizontalBlocked)
    addComponent(world, eid, PhysicalObstacle)
    removeComponent(world, eid, MovingObject)
}

function resolveMovingStoneCollisions(world: Parameters<System['update']>[0]): void {
    const moving = query(world, [MovingObject, Position, Velocity])
        .filter((eid) => MovingObject.kind[eid] === MovingObjectKind.Stone)

    for (let i = 0; i < moving.length; i++) {
        const a = moving[i]
        for (let j = i + 1; j < moving.length; j++) {
            separateMovingStones(a, moving[j])
        }
    }

    const settled = query(world, [PhysicalObstacle, Position, BoxCollider])
    for (let i = 0; i < moving.length; i++) {
        const stone = moving[i]
        for (let j = 0; j < settled.length; j++) {
            separateMovingFromSettledStone(stone, settled[j])
        }
    }
}

function separateMovingStones(a: number, b: number): void {
    const dy = Position.y[b] - Position.y[a]
    if (Math.abs(dy) > STONE_DIAMETER * 1.15) return

    let dx = Position.x[b] - Position.x[a]
    let dz = Position.z[b] - Position.z[a]
    let distSq = dx * dx + dz * dz
    if (distSq < 0.0001) {
        dx = ((a * 17 + b * 31) % 2) === 0 ? 1 : -1
        dz = ((a * 29 + b * 11) % 2) === 0 ? 0.25 : -0.25
        distSq = dx * dx + dz * dz
    }

    const minDist = STONE_RADIUS * 2
    if (distSq >= minDist * minDist) return

    if (Math.abs(dy) > STONE_VISUAL_RADIUS * 0.65) {
        const upper = dy > 0 ? b : a
        const lower = dy > 0 ? a : b
        const targetY = Position.y[lower] + STONE_DIAMETER
        if (Position.y[upper] < targetY) {
            Position.y[upper] = targetY
            if (Velocity.y[upper] < 0) Velocity.y[upper] = 0
        }
        const horizontalNudge = (minDist - Math.sqrt(distSq)) * 0.18
        const dist = Math.sqrt(distSq)
        const nx = dx / dist
        const nz = dz / dist
        Position.x[upper] += (upper === b ? nx : -nx) * horizontalNudge
        Position.z[upper] += (upper === b ? nz : -nz) * horizontalNudge
        Velocity.x[upper] *= 0.72
        Velocity.z[upper] *= 0.72
        return
    }

    const dist = Math.sqrt(distSq)
    const nx = dx / dist
    const nz = dz / dist
    const push = (minDist - dist) * 0.5
    Position.x[a] -= nx * push
    Position.z[a] -= nz * push
    Position.x[b] += nx * push
    Position.z[b] += nz * push

    const rel = (Velocity.x[a] - Velocity.x[b]) * nx + (Velocity.z[a] - Velocity.z[b]) * nz
    if (rel <= 0) return
    const impulse = rel * 0.55
    Velocity.x[a] -= nx * impulse
    Velocity.z[a] -= nz * impulse
    Velocity.x[b] += nx * impulse
    Velocity.z[b] += nz * impulse
}

function separateMovingFromSettledStone(stone: number, settled: number): void {
    const settledCenterY = Position.y[settled] + STONE_VISUAL_RADIUS
    const dy = Position.y[stone] - settledCenterY
    if (Math.abs(dy) > STONE_DIAMETER * 1.15) return

    let dx = Position.x[stone] - Position.x[settled]
    let dz = Position.z[stone] - Position.z[settled]
    let distSq = dx * dx + dz * dz
    if (distSq < 0.0001) {
        dx = (stone % 2) === 0 ? 1 : -1
        dz = 0.2
        distSq = dx * dx + dz * dz
    }

    const minDist = STONE_RADIUS + Math.max(BoxCollider.x[settled], BoxCollider.z[settled])
    if (distSq >= minDist * minDist) return

    if (dy > STONE_VISUAL_RADIUS * 0.45) {
        Position.y[stone] = Math.max(Position.y[stone], settledCenterY + STONE_DIAMETER)
        if (Velocity.y[stone] < 0) Velocity.y[stone] = 0
        Velocity.x[stone] *= 0.74
        Velocity.z[stone] *= 0.74
        return
    }

    const dist = Math.sqrt(distSq)
    const nx = dx / dist
    const nz = dz / dist
    const push = minDist - dist
    Position.x[stone] += nx * push
    Position.z[stone] += nz * push

    const into = Velocity.x[stone] * -nx + Velocity.z[stone] * -nz
    if (into > 0) {
        Velocity.x[stone] += nx * into * 1.25
        Velocity.z[stone] += nz * into * 1.25
    }
}

function orientArrow(eid: number): void {
    const vx = Velocity.x[eid]
    const vy = Velocity.y[eid]
    const vz = Velocity.z[eid]
    const horiz = Math.hypot(vx, vz)
    if (horiz < 0.001 && Math.abs(vy) < 0.001) return
    Rotation.y[eid] = Math.atan2(-vz, vx)
    Rotation.z[eid] = Math.atan2(vy, horiz)
}

function applyDownhillDrift(chunks: ChunkManager, eid: number, dt: number): void {
    const x = Math.floor(Position.x[eid])
    const y = Math.floor(Position.y[eid])
    const z = Math.floor(Position.z[eid])
    const here = surfaceY(chunks, x, z, y)
    if (here === null) return

    let bestDx = 0
    let bestDz = 0
    let bestDrop = 0
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
    for (const [dx, dz] of neighbors) {
        const ny = surfaceY(chunks, x + dx, z + dz, here)
        if (ny === null) continue
        const drop = here - ny
        if (drop > bestDrop) {
            bestDrop = drop
            bestDx = dx
            bestDz = dz
        }
    }
    if (bestDrop <= 0) return
    const accel = Math.min(10, 3.8 + bestDrop * 2.2)
    Velocity.x[eid] += bestDx * accel * dt
    Velocity.z[eid] += bestDz * accel * dt
}

function terrainHeightBelow(chunks: ChunkManager, x: number, z: number, fromY: number): number | null {
    const vx = Math.floor(x)
    const vz = Math.floor(z)
    const start = Math.ceil(fromY)
    for (let y = start; y >= start - 16; y--) {
        if (isPathSurface(chunks.palette, chunks.getVoxel(vx, y - 1, vz))) return y
    }
    return null
}

function surfaceY(chunks: ChunkManager, x: number, z: number, fromY: number): number | null {
    for (let offset = 0; offset <= 2; offset++) {
        const down = fromY - offset
        if (isPathSurface(chunks.palette, chunks.getVoxel(x, down - 1, z))) return down
        const up = fromY + offset
        if (offset > 0 && isPathSurface(chunks.palette, chunks.getVoxel(x, up - 1, z))) return up
    }
    return null
}

function velocitySpeedSq(eid: number): number {
    return Velocity.x[eid] * Velocity.x[eid] + Velocity.y[eid] * Velocity.y[eid] + Velocity.z[eid] * Velocity.z[eid]
}

function countMovingStones(world: Parameters<System['update']>[0]): number {
    const eids = query(world, [MovingObject])
    let count = 0
    for (let i = 0; i < eids.length; i++) {
        if (MovingObject.kind[eids[i]] === MovingObjectKind.Stone) count++
    }
    return count
}

function pseudoJitter(seed: number): number {
    const x = Math.sin(seed * 12.9898) * 43758.5453
    return (x - Math.floor(x)) * 2 - 1
}
