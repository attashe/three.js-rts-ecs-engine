import { Group } from 'three'
import { addComponent, addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    BoxCollider,
    MovingObject,
    Pickup,
    PickupValue,
    Position,
    Renderable,
    RigidBody,
    Rotation,
    Velocity,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { createArrow, createStone } from './assets'

export const MovingObjectKind = {
    Arrow: 1,
    Stone: 2,
} as const

export interface StoneSpawnOptions {
    /** Visual + collider radius (sphere half-extent on every axis). */
    radius?: number
    /** Inertial mass. Default: scales with radius² so a 2× stone is ~4× as heavy. */
    mass?: number
    /** 0..1 bounce on Y-block. */
    restitution?: number
    /** Per-second damping rate on horizontal velocity while grounded. */
    linearDamping?: number
    /** Squared total-speed threshold below which the sleep timer ticks. */
    sleepThresholdSq?: number
    /** Seconds-below-threshold required to settle into a static obstacle. */
    sleepDelay?: number
    /** Damage = mass × inboundSpeed × scale × 0.5. */
    impactDamageScale?: number
    /** Engine-gravity multiplier. */
    gravityScale?: number
    /** Per-body terminal-fall override. */
    maxFallSpeed?: number
    /** Sphere-core colour. */
    color?: number
    /** Surface-chip colour. */
    chipColor?: number
}

export interface StoneFallSpawnerConfig {
    position: { x: number; y: number; z: number }
    velocity: { x: number; y: number; z: number }
    interval: number
    jitter?: number
    /** Per-spawner stone variant. Defaults to STONE_TIER.stone. */
    options?: StoneSpawnOptions
}

const DEFAULT_STONE: Required<StoneSpawnOptions> = {
    radius: 0.28,
    mass: 8,
    restitution: 0.18,
    linearDamping: 1.25,
    sleepThresholdSq: 0.018,
    sleepDelay: 0.55,
    impactDamageScale: 0.6,
    gravityScale: 0.75,
    maxFallSpeed: 28,
    color: 0x6f7479,
    chipColor: 0x5a6065,
}

/** Pre-set stone variants. Use as-is or spread + override:
 *
 *  ```ts
 *  spawnFallingStone(world, pos, vel, { ...STONE_TIER.boulder, color: 0x804030 })
 *  ```
 *
 *  Mass values are tuned for gameplay (radius² rather than radius³ — keeps
 *  the boulder dangerous without one-shotting the player). */
export const STONE_TIER: Record<string, StoneSpawnOptions> = {
    pebble:  { radius: 0.14, mass: 2,  restitution: 0.32, linearDamping: 1.6, impactDamageScale: 0.5,  sleepDelay: 0.4,  color: 0x7a8088 },
    cobble:  { radius: 0.20, mass: 4,  restitution: 0.24, linearDamping: 1.4, impactDamageScale: 0.55, sleepDelay: 0.5,  color: 0x707680 },
    stone:   { radius: 0.28, mass: 8,  restitution: 0.18, linearDamping: 1.25, impactDamageScale: 0.6,  sleepDelay: 0.55, color: 0x6f7479 },
    rock:    { radius: 0.36, mass: 14, restitution: 0.13, linearDamping: 1.1, impactDamageScale: 0.55, sleepDelay: 0.7,  color: 0x646970 },
    boulder: { radius: 0.48, mass: 24, restitution: 0.08, linearDamping: 0.9, impactDamageScale: 0.4,  sleepDelay: 0.9,  color: 0x55595e },
}

function resolveStoneCfg(opts: StoneSpawnOptions = {}): Required<StoneSpawnOptions> {
    const radius = opts.radius ?? DEFAULT_STONE.radius
    const mass = opts.mass ?? Math.max(0.5, (radius / DEFAULT_STONE.radius) ** 2 * DEFAULT_STONE.mass)
    return {
        ...DEFAULT_STONE,
        ...opts,
        radius,
        mass,
    }
}

const ARROW_HALF_X = 0.06
const ARROW_HALF_Y = 0.04
const ARROW_HALF_Z = 0.06
const ARROW_MASS = 0.4
const ARROW_LINEAR_DAMPING = 4.5
const ARROW_SLEEP_THRESHOLD_SQ = 0.16
const ARROW_SLEEP_DELAY = 0.06
// Arrows already animate to a stop quickly via damping; no impact damage in v1
// (gameplay damage will come from a separate hit-on-flight check, not from
// landing impact).
const ARROW_IMPACT_DAMAGE_SCALE = 0

export function spawnArrowProjectile(
    world: GameWorld,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
    owner?: number,
): number {
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Velocity, BoxCollider, RigidBody, MovingObject])
    Position.x[eid] = position.x
    Position.y[eid] = position.y
    Position.z[eid] = position.z
    Velocity.x[eid] = velocity.x
    Velocity.y[eid] = velocity.y
    Velocity.z[eid] = velocity.z
    BoxCollider.x[eid] = ARROW_HALF_X
    BoxCollider.y[eid] = ARROW_HALF_Y
    BoxCollider.z[eid] = ARROW_HALF_Z

    RigidBody.mass[eid] = ARROW_MASS
    RigidBody.restitution[eid] = 0
    RigidBody.linearDamping[eid] = ARROW_LINEAR_DAMPING
    RigidBody.gravityScale[eid] = 1
    RigidBody.maxFallSpeed[eid] = 0
    RigidBody.sleepThresholdSq[eid] = ARROW_SLEEP_THRESHOLD_SQ
    RigidBody.sleepDelay[eid] = ARROW_SLEEP_DELAY
    RigidBody.sleepTimer[eid] = 0
    RigidBody.impactDamageScale[eid] = ARROW_IMPACT_DAMAGE_SCALE
    RigidBody.rollOnGround[eid] = 0

    MovingObject.kind[eid] = MovingObjectKind.Arrow
    MovingObject.age[eid] = 0
    if (owner !== undefined) world.projectileOwnerByEid.set(eid, owner)

    const obj = createArrow()
    obj.scale.setScalar(0.9)
    world.object3DByEid.set(eid, obj)
    addComponent(world, eid, Renderable)
    return eid
}

export function spawnFallingStone(
    world: GameWorld,
    /** Foot-anchored spawn position (i.e. where the stone's bottom should be).
     *  Stored internally as `Position.y = foot + radius` since stones are
     *  centre-anchored. */
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
    options: StoneSpawnOptions = {},
): number {
    const cfg = resolveStoneCfg(options)
    const eid = createEntity(world)
    addComponents(world, eid, [Position, Rotation, Velocity, BoxCollider, RigidBody, MovingObject])
    Position.x[eid] = position.x
    Position.y[eid] = position.y + cfg.radius
    Position.z[eid] = position.z
    Velocity.x[eid] = velocity.x
    Velocity.y[eid] = velocity.y
    Velocity.z[eid] = velocity.z
    Rotation.y[eid] = Math.atan2(velocity.x, velocity.z)

    BoxCollider.x[eid] = cfg.radius
    BoxCollider.y[eid] = cfg.radius
    BoxCollider.z[eid] = cfg.radius

    RigidBody.mass[eid] = cfg.mass
    RigidBody.restitution[eid] = cfg.restitution
    RigidBody.linearDamping[eid] = cfg.linearDamping
    RigidBody.gravityScale[eid] = cfg.gravityScale
    RigidBody.maxFallSpeed[eid] = cfg.maxFallSpeed
    RigidBody.sleepThresholdSq[eid] = cfg.sleepThresholdSq
    RigidBody.sleepDelay[eid] = cfg.sleepDelay
    RigidBody.sleepTimer[eid] = 0
    RigidBody.impactDamageScale[eid] = cfg.impactDamageScale
    RigidBody.rollOnGround[eid] = 1
    RigidBody.centerAnchored[eid] = 1

    MovingObject.kind[eid] = MovingObjectKind.Stone
    MovingObject.age[eid] = 0

    world.object3DByEid.set(eid, createStone({
        scale: cfg.radius / DEFAULT_STONE.radius,
        color: cfg.color,
        chipColor: cfg.chipColor,
    }))
    addComponent(world, eid, Renderable)
    return eid
}

export function turnArrowIntoPickup(world: GameWorld, eid: number): void {
    world.projectileOwnerByEid.delete(eid)
    addComponents(world, eid, [Pickup, PickupValue])
    PickupValue.kind[eid] = 3
    PickupValue.amount[eid] = 1
    world.pickupByEid.set(eid, {
        label: 'Arrow',
        message: 'Picked up an arrow.',
    })

    const obj = world.object3DByEid.get(eid)
    if (obj instanceof Group) {
        obj.name = 'DroppedArrow'
        obj.scale.setScalar(0.82)
    }
}
