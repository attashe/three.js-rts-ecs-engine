import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import {
    BoxCollider,
    Grounded,
    HorizontalBlocked,
    MovingObject,
    Pickup,
    PickupValue,
    Position,
    RigidBody,
    Rotation,
    Sleeping,
    StaticRenderable,
    Velocity,
} from '../components'
import type { System } from './system'
import { FixedOrder } from './orders'
import { PickupKind } from './pickup-system'
import {
    MovingObjectKind,
    spawnFallingStone,
    stoneOptionsForConfig,
    type StoneFallSpawnerConfig,
} from '../../../game/moving-objects'
import type { GameWorld, StoneSpawnerRuntime } from '../world'
import { despawnEntity } from '../entity'

const ARROW_MIN_SETTLE_AGE = 0.18
const ARROW_REST_SECONDS = 0.06
/** Magic bolts that hit nothing fizzle out after this many seconds. */
const BOLT_MAX_AGE = 2.5
/** Electric orbs bounce around for a while, then dissipate. */
const ORB_MAX_AGE = 5

/**
 * Lifecycle for in-flight `MovingObject`s. Physics (gravity, swept-AABB,
 * sleep) is owned by physics-system. This system only handles the gameplay-
 * level transitions:
 *
 *  - Arrows are oriented to face their velocity vector while flying, and
 *    embedded in place as a static visual once they sit still. Useful later
 *    for remote item activation: the arrow's Object3D stays in the scene and
 *    its Position/Rotation are frozen.
 *  - Stones are integrated entirely by physics-system (RigidBody-driven). All
 *    we do here is age the MovingObject tag so the stone's age field stays
 *    accurate for any consumers that care.
 */
export function createMovingObjectSystem(): System {
    return {
        fixed: true,
        order: FixedOrder.postPhysics,
        update(world, dt) {
            // Snapshot: updateArrow embeds (removes MovingObject) and bolts can
            // despawn mid-loop, both of which mutate the live query array.
            const eids = [...query(world, [MovingObject])]
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]!
                MovingObject.age[eid] += dt

                if (MovingObject.kind[eid] === MovingObjectKind.Arrow) {
                    updateArrow(world, eid, dt)
                } else if (MovingObject.kind[eid] === MovingObjectKind.MagicBolt) {
                    if (MovingObject.age[eid] >= BOLT_MAX_AGE) {
                        despawnEntity(world, eid)
                    } else if (hasComponent(world, eid, Velocity)) {
                        // Kinematic flight — bolts have no RigidBody, so we
                        // advance them straight here (arrow-hit owns collision).
                        Position.x[eid] += Velocity.x[eid] * dt
                        Position.y[eid] += Velocity.y[eid] * dt
                        Position.z[eid] += Velocity.z[eid] * dt
                    }
                } else if (MovingObject.kind[eid] === MovingObjectKind.ElectricOrb) {
                    // Orbs are physics bodies (gravity + bounce); just retire
                    // them once they've caromed long enough.
                    if (MovingObject.age[eid] >= ORB_MAX_AGE) despawnEntity(world, eid)
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
    const states = spawners.map((spawner, index) => createSpawnerState(spawner, index))
    let activeWorld: GameWorld | null = null

    return {
        fixed: true,
        // Spawners run early in the fixed phase so the new stone gets its full
        // first physics step on the same tick it spawns.
        order: FixedOrder.input + 10,
        init(world) {
            activeWorld = world
            for (const state of states) {
                if (!state.config.id) continue
                activeWorld.stoneSpawnersById.set(state.config.id, state.controller)
            }
        },
        update(world, dt) {
            if (states.length === 0) return
            let movingStones = countMovingStones(world)
            if (movingStones >= maxMovingStones) return

            for (const state of states) {
                if (!state.enabled) continue
                state.timer -= dt
                if (state.timer > 0) continue
                const spawned = spawnFromState(world, state, 1, maxMovingStones - movingStones)
                movingStones += spawned
                state.timer = safeInterval(state.config.interval)
                if (movingStones >= maxMovingStones) return
            }
        },
        dispose() {
            if (!activeWorld) return
            for (const state of states) {
                const id = state.config.id
                if (id && activeWorld.stoneSpawnersById.get(id) === state.controller) {
                    activeWorld.stoneSpawnersById.delete(id)
                }
            }
            activeWorld = null
        },
    }

    function createSpawnerState(config: StoneFallSpawnerConfig, index: number): SpawnerState {
        const state: SpawnerState = {
            config,
            index,
            enabled: config.enabled !== false,
            timer: safeDelay(config.delay),
            spawned: new Set<number>(),
            controller: undefined as unknown as StoneSpawnerRuntime,
        }
        state.controller = {
            id: config.id ?? `stone-spawner-${index + 1}`,
            setEnabled(enabled) {
                state.enabled = !!enabled
            },
            isEnabled() {
                return state.enabled
            },
            trigger(count) {
                if (!activeWorld || !state.enabled) return 0
                const globalBudget = Math.max(0, maxMovingStones - countMovingStones(activeWorld))
                return spawnFromState(activeWorld, state, safeTriggerCount(count), globalBudget)
            },
        }
        return state
    }
}

interface SpawnerState {
    config: StoneFallSpawnerConfig
    index: number
    enabled: boolean
    timer: number
    spawned: Set<number>
    controller: StoneSpawnerRuntime
}

function spawnFromState(
    world: GameWorld,
    state: SpawnerState,
    requested: number,
    globalBudget: number,
): number {
    pruneSpawnerStones(world, state)
    const maxLive = safeMaxLive(state.config.maxLive)
    const spawnerBudget = maxLive === Infinity ? requested : Math.max(0, maxLive - state.spawned.size)
    const count = Math.min(requested, spawnerBudget, Math.max(0, globalBudget))
    let spawned = 0
    for (let i = 0; i < count; i++) {
        const spawner = state.config
        const jitter = spawner.jitter ?? 0
        const offset = jitter > 0 ? pseudoJitter(performance.now() + state.index * 97 + i * 31) * jitter : 0
        const eid = spawnFallingStone(
            world,
            { x: spawner.position.x, y: spawner.position.y, z: spawner.position.z + offset },
            spawner.velocity,
            stoneOptionsForConfig(spawner),
        )
        state.spawned.add(eid)
        spawned++
    }
    return spawned
}

function pruneSpawnerStones(world: GameWorld, state: SpawnerState): void {
    for (const eid of [...state.spawned]) {
        if (!isActiveMovingStone(world, eid)) state.spawned.delete(eid)
    }
}

function safeDelay(value: number | undefined): number {
    return Number.isFinite(value) && (value ?? 0) > 0 ? value! : 0
}

function safeInterval(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 1
}

function safeMaxLive(value: number | undefined): number {
    return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value!) : Infinity
}

function safeTriggerCount(value: number | undefined): number {
    return Number.isFinite(value) && (value ?? 0) > 0 ? Math.min(32, Math.floor(value!)) : 1
}

function updateArrow(
    world: GameWorld,
    eid: number,
    dt: number,
): void {
    // Physics sleeps the arrow once it stops; we then freeze it as a static
    // visual embedded in whatever it hit.
    if (hasComponent(world, eid, Sleeping)) {
        embedArrow(world, eid)
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

/**
 * Freeze an in-flight arrow into a static, collectable visual: strip its
 * physics components, flag it static so render-sync stops touching it, and turn
 * it into an arrow pickup. Shared by the normal "stuck in a wall" sleep path
 * and the arrow-hit system's "stuck in a body" path.
 */
export function embedArrow(
    world: GameWorld,
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
    // Flag the visual as static so render-sync stops syncing its transform
    // every frame. The arrow remains in `world.object3DByEid` and in the
    // scene as a frozen mesh embedded in the surface.
    if (!hasComponent(world, eid, StaticRenderable)) addComponent(world, eid, StaticRenderable)
    // Make the embedded arrow collectable — pickup-system will pick it up
    // when the player walks close enough.
    if (!hasComponent(world, eid, Pickup)) addComponent(world, eid, Pickup)
    if (!hasComponent(world, eid, PickupValue)) addComponent(world, eid, PickupValue)
    PickupValue.kind[eid] = PickupKind.Arrow
    PickupValue.amount[eid] = 1
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

function countMovingStones(world: GameWorld): number {
    const eids = query(world, [MovingObject])
    let count = 0
    for (let i = 0; i < eids.length; i++) {
        const eid = eids[i]
        if (isActiveMovingStone(world, eid)) count++
    }
    return count
}

function isActiveMovingStone(world: GameWorld, eid: number): boolean {
    return hasComponent(world, eid, MovingObject) &&
        MovingObject.kind[eid] === MovingObjectKind.Stone &&
        hasComponent(world, eid, Velocity) &&
        !hasComponent(world, eid, Sleeping)
}

function pseudoJitter(seed: number): number {
    const x = Math.sin(seed * 12.9898) * 43758.5453
    return (x - Math.floor(x)) * 2 - 1
}
