import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import {
    BoxCollider,
    Grounded,
    HorizontalBlocked,
    MovingObject,
    RigidBody,
    Rotation,
    Sleeping,
    StaticRenderable,
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

/**
 * Lifecycle for in-flight `MovingObject`s. Physics (gravity, swept-AABB,
 * sleep, impact) is owned by physics-system. This system only handles the
 * gameplay-level transitions:
 *
 *  - Arrows are oriented to face their velocity vector while flying, and
 *    converted into pickups once they sit still.
 *  - Stones are integrated entirely by physics-system (RigidBody-driven). All
 *    we do here is age the MovingObject tag so the stone's age field stays
 *    accurate for any consumers that care.
 */
export function createMovingObjectSystem(): System {
    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world, dt) {
            const eids = query(world, [MovingObject])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                MovingObject.age[eid] += dt

                if (MovingObject.kind[eid] === MovingObjectKind.Arrow) {
                    updateArrow(world, eid, dt)
                }
            }
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
                    spawner.options,
                )
                timers[i] = spawner.interval
            }
        },
    }
}

function updateArrow(
    world: Parameters<System['update']>[0],
    eid: number,
    dt: number,
): void {
    // Physics sleeps the arrow once it stops; we then convert it to a pickup
    // and undo all dynamic-body bookkeeping.
    if (hasComponent(world, eid, Sleeping)) {
        convertArrowToPickup(world, eid)
        return
    }

    if (!hasComponent(world, eid, Velocity)) return
    orientArrow(eid)

    // Early-settle hook: arrows have an aggressive sleep delay (0.06 s) on the
    // RigidBody, but if the arrow is wedged horizontally before it goes still
    // we drop the sleep timer onto it so physics finalises the sleep next tick.
    if (
        MovingObject.age[eid] > ARROW_MIN_SETTLE_AGE &&
        hasComponent(world, eid, RigidBody) &&
        hasComponent(world, eid, HorizontalBlocked)
    ) {
        RigidBody.sleepTimer[eid] = Math.max(RigidBody.sleepTimer[eid], ARROW_REST_SECONDS)
    }
    void dt
}

function convertArrowToPickup(
    world: Parameters<System['update']>[0],
    eid: number,
): void {
    if (hasComponent(world, eid, Velocity)) removeComponent(world, eid, Velocity)
    if (hasComponent(world, eid, BoxCollider)) removeComponent(world, eid, BoxCollider)
    if (hasComponent(world, eid, Grounded)) removeComponent(world, eid, Grounded)
    if (hasComponent(world, eid, HorizontalBlocked)) removeComponent(world, eid, HorizontalBlocked)
    if (hasComponent(world, eid, RigidBody)) removeComponent(world, eid, RigidBody)
    if (hasComponent(world, eid, Sleeping)) {
        removeComponent(world, eid, Sleeping)
        world.obstacles.remove(eid)
    }
    turnArrowIntoPickup(world, eid)
    addComponent(world, eid, StaticRenderable)
    removeComponent(world, eid, MovingObject)
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

function countMovingStones(world: Parameters<System['update']>[0]): number {
    const eids = query(world, [MovingObject])
    let count = 0
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]
        if (
            MovingObject.kind[eid] === MovingObjectKind.Stone &&
            hasComponent(world, eid, Velocity) &&
            !hasComponent(world, eid, Sleeping)
        ) {
            count++
        }
    }
    return count
}

function pseudoJitter(seed: number): number {
    const x = Math.sin(seed * 12.9898) * 43758.5453
    return (x - Math.floor(x)) * 2 - 1
}
