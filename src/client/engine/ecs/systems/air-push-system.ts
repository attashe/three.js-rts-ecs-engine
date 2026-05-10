import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import {
    BoxCollider,
    Behaviour,
    MoveAlongPath,
    MovementState,
    PlayerControlled,
    Position,
    RigidBody,
    Rotation,
    Sleeping,
    StaticRenderable,
    Velocity,
} from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog } from '../world'
import type { GameWorld } from '../world'
import { MovementStateId } from '../movement-state'

export interface AirPushOptions {
    /** Half-angle of the cone in radians. Default ≈ 58° (Math.PI * 0.32). */
    halfAngle?: number
    /** Maximum reach of the cone in world units. Default 5.5. */
    range?: number
    /** Outward push speed at the apex (point-blank). Falls off linearly to
     *  `minSpeedFactor * baseSpeed` at the cone's edge. Default 18. */
    baseSpeed?: number
    /** Floor on the proximity falloff so far-edge hits still feel alive. */
    minSpeedFactor?: number
    /** Extra upward kick added at the apex; falls off with proximity. Default 5.5. */
    verticalLift?: number
    /** Seconds an AI path follower waits before repathing after being shoved. */
    actorRecoveryDelay?: number
    actionId?: ActionId
    canUse?: (world: Parameters<System['update']>[0], player: number) => boolean
    /** UI hint callback. Combat-log entry is always pushed regardless. */
    notify?: (message: string) => void
}

/**
 * Air Push: a horizontal cone-of-effect spell anchored at the player's chest.
 * On `KeyG`, every entity inside the cone with a `Velocity` (or a sleeping
 * `RigidBody`) gets a radial impulse outward from the player. Sleeping bodies
 * are woken and de-registered from the obstacle registry so they fly free
 * before re-settling. Path-following actors are briefly interrupted, otherwise
 * their movement controller would overwrite the impulse later in the same
 * fixed step. Static props (no `Velocity`, no `RigidBody`) are intentionally
 * untouched — Air Push is for "physical objects", not scenery.
 *
 * The cone is checked in the XZ plane only, with a separate 3D range gate, so
 * stones above or below the player at close range still get caught (matching
 * a real gust of wind rather than a laser).
 */
export function createAirPushSystem(actions: ActionMap, opts: AirPushOptions = {}): System {
    const halfAngle = opts.halfAngle ?? Math.PI * 0.32
    const range = opts.range ?? 5.5
    const baseSpeed = opts.baseSpeed ?? 18
    const minSpeedFactor = opts.minSpeedFactor ?? 0.4
    const verticalLift = opts.verticalLift ?? 5.5
    const actorRecoveryDelay = opts.actorRecoveryDelay ?? 0.55
    const actionId = opts.actionId ?? 'spell.airPush'
    const cosHalfAngle = Math.cos(halfAngle)
    const rangeSq = range * range

    return {
        fixed: true,
        order: FixedOrder.input + 30,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return
            const player = players[0]
            if (opts.canUse && !opts.canUse(world, player)) return
            if (!actions.consumePressed(actionId, player)) return

            const px = Position.x[player]
            // Anchor the cone at chest height so a stone at the player's feet
            // gets a slight upward component from the radial push.
            const py = Position.y[player] + 1.0
            const pz = Position.z[player]
            const yaw = Rotation.y[player]
            const fx = Math.sin(yaw)
            const fz = Math.cos(yaw)

            const candidates = query(world, [Position, BoxCollider])
            let pushed = 0

            for (let i = 0; i < candidates.length; i++) {
                const eid = candidates[i]
                if (eid === player) continue
                if (hasComponent(world, eid, PlayerControlled)) continue

                const sleeping = hasComponent(world, eid, Sleeping)
                const hadVelocity = hasComponent(world, eid, Velocity)
                if (!sleeping && !hadVelocity) continue

                // Body centre (Y depends on collider anchor).
                const isCenterAnchored = hasComponent(world, eid, RigidBody) &&
                    RigidBody.centerAnchored[eid] === 1
                const bx = Position.x[eid]
                const by = isCenterAnchored
                    ? Position.y[eid]
                    : Position.y[eid] + BoxCollider.y[eid]
                const bz = Position.z[eid]

                const dx = bx - px
                const dy = by - py
                const dz = bz - pz
                const distSq = dx * dx + dy * dy + dz * dz
                if (distSq > rangeSq) continue
                const dist = Math.sqrt(distSq)
                if (dist < 0.001) continue

                // Cone test in the XZ plane.
                const horizDist = Math.sqrt(dx * dx + dz * dz)
                if (horizDist < 0.0001) continue
                const dirX = dx / horizDist
                const dirZ = dz / horizDist
                const forwardDot = dirX * fx + dirZ * fz
                if (forwardDot < cosHalfAngle) continue

                const proximity = Math.max(0, 1 - dist / range)
                const speed = baseSpeed * (minSpeedFactor + (1 - minSpeedFactor) * proximity)
                const radialX = dx / dist
                const radialY = dy / dist
                const radialZ = dz / dist

                if (sleeping) {
                    wakeSleepingBody(world, eid)
                }
                if (!hasComponent(world, eid, Velocity)) {
                    addComponent(world, eid, Velocity)
                    Velocity.x[eid] = 0
                    Velocity.y[eid] = 0
                    Velocity.z[eid] = 0
                }

                Velocity.x[eid] += radialX * speed
                // Combine the (small) outward Y component with an explicit lift
                // so a body at exactly the player's centre still pops up.
                Velocity.y[eid] += Math.max(0, radialY) * speed * 0.5 + verticalLift * proximity
                Velocity.z[eid] += radialZ * speed
                interruptPathFollower(world, eid, actorRecoveryDelay)
                pushed++
            }

            const message = pushed > 0
                ? `Air Push! ${pushed} object${pushed === 1 ? '' : 's'} sent flying.`
                : 'Air Push! (nothing in range)'
            pushGameLog(world, { type: 'combat', message, eid: player })
            opts.notify?.(message)
        },
    }
}

function interruptPathFollower(world: GameWorld, eid: number, recoveryDelay: number): void {
    if (hasComponent(world, eid, MoveAlongPath)) {
        removeComponent(world, eid, MoveAlongPath)
        world.pathByEid.delete(eid)
    }
    if (hasComponent(world, eid, Behaviour)) {
        Behaviour.nextRepathAt[eid] = Math.max(Behaviour.nextRepathAt[eid], recoveryDelay)
        const blackboard = world.behaviourByEid.get(eid)
        if (blackboard) blackboard.pathGoal = null
    }
    if (hasComponent(world, eid, MovementState)) {
        MovementState.value[eid] = MovementStateId.Airborne
    }
}

function wakeSleepingBody(world: GameWorld, eid: number): void {
    removeComponent(world, eid, Sleeping)
    if (hasComponent(world, eid, StaticRenderable)) removeComponent(world, eid, StaticRenderable)
    world.obstacles.remove(eid)
    if (hasComponent(world, eid, RigidBody)) {
        RigidBody.sleepTimer[eid] = 0
    }
}
