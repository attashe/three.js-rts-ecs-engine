import { addComponent, addComponents } from 'bitecs'
import type { GameWorld } from '../engine/ecs/world'
import {
    BoxCollider,
    MovingObject,
    Position,
    Renderable,
    RigidBody,
    Rotation,
    Velocity,
} from '../engine/ecs/components'
import { createEntity } from '../engine/ecs/entity'
import { createArrow, createStone, mergeGroupByMaterial } from './assets'

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
    /** Engine-gravity multiplier. */
    gravityScale?: number
    /** Per-body terminal-fall override. */
    maxFallSpeed?: number
    /** Sphere-core colour. */
    color?: number
    /** Surface-chip colour. */
    chipColor?: number
}

export const STONE_TIER_IDS = ['pebble', 'cobble', 'stone', 'rock', 'boulder'] as const
export type StoneTierId = typeof STONE_TIER_IDS[number]
export const DEFAULT_STONE_TIER: StoneTierId = 'stone'
export const DEFAULT_STONE_RADIUS = 0.28

export interface StoneConfigBase {
    /** Named gameplay/visual preset. Defaults to `stone`. */
    tier?: StoneTierId
    /** Radius override in world units. Stored as "size" in the editor UI. */
    size?: number
    /** Low-level physics/visual overrides. Applied after the tier, before size. */
    options?: StoneSpawnOptions
}

export interface StonePlacementConfig extends StoneConfigBase {
    /** Stable script/editor id. Direct stones without an id still spawn, but
     *  scripts cannot address them individually. */
    id?: string
    /** Foot-anchored spawn position. Runtime stores stone Position.y at centre. */
    position: { x: number; y: number; z: number }
    /** Initial velocity. Defaults to still. */
    velocity?: { x: number; y: number; z: number }
    /** Starts live by default. Scripts can opt to spawn disabled stones later. */
    enabled?: boolean
}

export interface StoneFallSpawnerConfig {
    /** Stable script/editor id. Missing ids remain runtime-only for old saves. */
    id?: string
    /** Runtime gate. Default true. */
    enabled?: boolean
    position: { x: number; y: number; z: number }
    velocity: { x: number; y: number; z: number }
    /** Seconds between automatic emissions. */
    interval: number
    /** Initial wait before the first automatic emission. Default 0. */
    delay?: number
    /** Per-spawner cap on active, non-sleeping stones spawned by this emitter. */
    maxLive?: number
    jitter?: number
    /** Named gameplay/visual preset. Defaults to `stone`. */
    tier?: StoneTierId
    /** Radius override in world units. Stored as "size" in the editor UI. */
    size?: number
    /** Per-spawner stone variant. Defaults to `stone`. */
    options?: StoneSpawnOptions
}

const DEFAULT_STONE: Required<StoneSpawnOptions> = {
    radius: DEFAULT_STONE_RADIUS,
    mass: 8,
    restitution: 0.18,
    linearDamping: 1.25,
    sleepThresholdSq: 0.018,
    sleepDelay: 0.55,
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
 *  Mass values are tuned for gameplay (radius² rather than radius³). */
export const STONE_TIER: Record<StoneTierId, StoneSpawnOptions> = {
    pebble:  { radius: 0.14, mass: 2,  restitution: 0.32, linearDamping: 1.6, sleepDelay: 0.4,  color: 0x7a8088 },
    cobble:  { radius: 0.20, mass: 4,  restitution: 0.24, linearDamping: 1.4, sleepDelay: 0.5,  color: 0x707680 },
    stone:   { radius: DEFAULT_STONE_RADIUS, mass: 8,  restitution: 0.18, linearDamping: 1.25, sleepDelay: 0.55, color: 0x6f7479 },
    rock:    { radius: 0.36, mass: 14, restitution: 0.13, linearDamping: 1.1, sleepDelay: 0.7,  color: 0x646970 },
    boulder: { radius: 0.48, mass: 24, restitution: 0.08, linearDamping: 0.9, sleepDelay: 0.9,  color: 0x55595e },
}

export function stoneOptionsForConfig(config: StoneConfigBase | undefined): StoneSpawnOptions {
    const tier = config?.tier && isStoneTierId(config.tier) ? config.tier : DEFAULT_STONE_TIER
    const options: StoneSpawnOptions = {
        ...STONE_TIER[tier],
        ...(config?.options ?? {}),
    }
    const size = config?.size
    if (Number.isFinite(size) && (size ?? 0) > 0) {
        options.radius = size
    }
    return options
}

export function stoneRadiusForConfig(config: StoneConfigBase | undefined): number {
    return resolveStoneCfg(stoneOptionsForConfig(config)).radius
}

export function isStoneTierId(value: string): value is StoneTierId {
    return (STONE_TIER_IDS as readonly string[]).includes(value)
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

export function spawnArrowProjectile(
    world: GameWorld,
    position: { x: number; y: number; z: number },
    velocity: { x: number; y: number; z: number },
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
    RigidBody.rollOnGround[eid] = 0

    MovingObject.kind[eid] = MovingObjectKind.Arrow
    MovingObject.age[eid] = 0

    const obj = mergeGroupByMaterial(createArrow())
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
    RigidBody.rollOnGround[eid] = 1
    RigidBody.centerAnchored[eid] = 1

    MovingObject.kind[eid] = MovingObjectKind.Stone
    MovingObject.age[eid] = 0

    world.object3DByEid.set(eid, mergeGroupByMaterial(createStone({
        scale: cfg.radius / DEFAULT_STONE.radius,
        color: cfg.color,
        chipColor: cfg.chipColor,
    })))
    addComponent(world, eid, Renderable)
    return eid
}
