// Render-frame system that drives per-entity AnimationControllers from movement.
//
// It reads gameplay signals (Velocity, Grounded, HorizontalBlocked,
// MovementState), maps them to graph params via the pure `computeLocomotionParams`
// (so the thresholds live in graph-defaults, not here), ticks the controller's
// state machine + mixer, and mirrors the result into the Animated component for
// the debug overlay. Runs at RenderOrder.animation (after renderSync positions
// the root, before worldRender draws it).

import { hasComponent, observe, onRemove, query } from 'bitecs'
import { Animated, Grounded, HorizontalBlocked, MovementState, Velocity } from '../components'
import { computeLocomotionParams } from '../../anim/core'
import type { GameWorld } from '../world'
import type { System } from './system'
import { RenderOrder } from './orders'

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
                controller.update(dt)

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
