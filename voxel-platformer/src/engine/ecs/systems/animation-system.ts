// Render-frame system that drives per-entity AnimationControllers from movement.
//
// It reads gameplay signals (Velocity, Grounded, HorizontalBlocked,
// MovementState), maps them to graph params via the pure `computeLocomotionParams`
// (so the thresholds live in graph-defaults, not here), ticks the controller's
// state machine + mixer, and mirrors the result into the Animated component for
// the debug overlay. Runs at RenderOrder.animation (after renderSync positions
// the root, before worldRender draws it).

import { hasComponent, observe, onRemove, query } from 'bitecs'
import { Animated, Grounded, HorizontalBlocked, MovementState, Rotation, Velocity } from '../components'
import { computeLocomotionParams } from '../../anim/core'
import type { Object3D } from 'three'
import type { GameWorld } from '../world'
import type { System } from './system'
import { RenderOrder } from './orders'

// How quickly the visual model turns to face its travel direction (exp smoothing).
const FACE_TURN_RATE = 14
const FACE_MOVE_MIN_SPEED = 0.6

export function createAnimationSystem(): System {
    let unsubscribeRemove: (() => void) | null = null
    let activeWorld: GameWorld | null = null

    return {
        name: 'animation',
        order: RenderOrder.animation,
        init(world) {
            activeWorld = world
            // Tear down a controller when its entity drops the Animated tag.
            unsubscribeRemove = observe(world, onRemove(Animated), (eid) => {
                world.animControllerByEid.get(eid)?.dispose()
                world.animControllerByEid.delete(eid)
                world.equipmentByEid.delete(eid)
            })
        },

        update(world, dt) {
            const eids = query(world, [Animated, Velocity])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]!
                const controller = world.animControllerByEid.get(eid)
                if (!controller) continue

                const speedXZ = Math.hypot(Velocity.x[eid]!, Velocity.z[eid]!)
                controller.setParams(computeLocomotionParams({
                    speedXZ,
                    vy: Velocity.y[eid]!,
                    grounded: hasComponent(world, eid, Grounded),
                    blocked: hasComponent(world, eid, HorizontalBlocked),
                    movementState: MovementState.value[eid]!,
                }))
                controller.setLocomotionSpeed(speedXZ)
                controller.update(dt)

                // Turn the visual model toward its travel direction while moving
                // (the entity's Rotation.y stays on the aim/look direction, so
                // gameplay aiming is unaffected). This keeps the walk cycle
                // aligned with motion instead of moonwalking when the player
                // strafes or backs up relative to where they're looking.
                faceTravelDirection(controller.root, eid, speedXZ, dt)

                Animated.currentState[eid] = controller.currentStateIndex
                Animated.prevState[eid] = controller.previousStateIndex
                Animated.blendAlpha[eid] = controller.machine.blendAlpha
                Animated.time[eid] = controller.machine.timeInCurrentState
            }
            world.metrics.setGauge('animation.controllers', world.animControllerByEid.size)
        },

        dispose() {
            unsubscribeRemove?.()
            if (activeWorld) {
                for (const controller of activeWorld.animControllerByEid.values()) controller.dispose()
                activeWorld.animControllerByEid.clear()
                activeWorld.equipmentByEid.clear()
            }
            activeWorld = null
        },
    }
}

/** Smoothly turn `model.rotation.y` toward the entity's travel direction (in the
 *  entity root's local frame) while moving, easing back to the look direction
 *  when idle. `Velocity` is world-space; the root already carries Rotation.y, so
 *  the model's local yaw is `travelYaw - lookYaw`. */
function faceTravelDirection(model: Object3D, eid: number, speedXZ: number, dt: number): void {
    const target = speedXZ > FACE_MOVE_MIN_SPEED
        ? wrapAngle(Math.atan2(Velocity.x[eid]!, Velocity.z[eid]!) - Rotation.y[eid]!)
        : 0
    const t = 1 - Math.exp(-FACE_TURN_RATE * dt)
    model.rotation.y += wrapAngle(target - model.rotation.y) * t
}

function wrapAngle(a: number): number {
    return Math.atan2(Math.sin(a), Math.cos(a))
}
