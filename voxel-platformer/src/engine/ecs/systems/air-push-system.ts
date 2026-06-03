import { addComponent, hasComponent, query, removeComponent } from 'bitecs'
import {
    BoxCollider,
    ClimbingLadder,
    MovementState,
    PlayerControlled,
    Position,
    RigidBody,
    RidingCart,
    Rotation,
    Sleeping,
    StaticRenderable,
    Velocity,
} from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushLog, type GameWorld } from '../world'
import { MovementStateId } from '../movement-state'
import { AIR_PUSH_MANA_COST, spendMana } from '../../../game/mana'

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
    actionId?: ActionId
    /** Called when a valid Air Push cast is performed, even if no bodies
     *  are caught by the cone. */
    onAirPush?: (pushed: number) => void
}

/**
 * Air Push: a horizontal cone-of-effect spell anchored at the player's chest.
 * On bind (KeyG by default), every entity inside the cone with a `Velocity`
 * (or a sleeping `RigidBody`) gets a radial impulse outward from the player.
 * Sleeping bodies are woken and de-registered from the obstacle registry so
 * they fly free before re-settling. Static props (no `Velocity`, no
 * `RigidBody`) are intentionally untouched — Air Push is for physical objects,
 * not scenery.
 *
 * The cone is checked in the XZ plane only, with a separate 3D range gate, so
 * stones above or below the player at close range still get caught (matching
 * a real gust of wind rather than a laser).
 *
 * Costs player mana after the ability gate passes. Static props remain
 * untouched; Air Push is for physical objects, not scenery.
 */
export function createAirPushSystem(actions: ActionMap, opts: AirPushOptions = {}): System {
    const halfAngle = opts.halfAngle ?? Math.PI * 0.32
    const rangeOverride = opts.range
    const baseSpeedOverride = opts.baseSpeed
    const minSpeedFactor = opts.minSpeedFactor ?? 0.4
    const verticalLiftOverride = opts.verticalLift
    const actionId = opts.actionId ?? 'spell.airPush'
    const cosHalfAngle = Math.cos(halfAngle)

    return {
        fixed: true,
        order: FixedOrder.input + 30,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return
            const player = players[0]
            if (!actions.consumePressed(actionId, player)) return
            if (hasComponent(world, player, RidingCart) || hasComponent(world, player, ClimbingLadder)) return
            if (!world.playerSettings.abilities.airPush) {
                pushLog(world, 'Air Push is disabled.')
                return
            }
            if (!spendMana(player, AIR_PUSH_MANA_COST)) {
                pushLog(world, 'Not enough mana.')
                return
            }

            const range = rangeOverride ?? world.playerSettings.airPushRange
            const baseSpeed = baseSpeedOverride ?? world.playerSettings.airPushPower
            const verticalLift = verticalLiftOverride ?? world.playerSettings.airPushLift
            const rangeSq = range * range

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
                const eid = candidates[i]!
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
                if (hasComponent(world, eid, MovementState)) {
                    MovementState.value[eid] = MovementStateId.Airborne
                }
                pushed++
            }
            pushLog(world, pushed > 0
                ? `Air Push! ${pushed} object${pushed === 1 ? '' : 's'} sent flying.`
                : 'Air Push! (nothing in range)')
            opts.onAirPush?.(pushed)
        },
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
