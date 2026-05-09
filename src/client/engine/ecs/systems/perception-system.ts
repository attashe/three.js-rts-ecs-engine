import { hasComponent, query } from 'bitecs'
import { Behaviour, Health, Position } from '../components'
import {
    findNearestEnemy,
    getBehaviourProfile,
    setBehaviourTarget,
} from '../behaviour'
import type { System } from './system'
import { FixedOrder } from './orders'

/**
 * Writes perception facts (current target, last-seen position) into the AI
 * blackboard so `behaviour-system` can decide transitions from cached state
 * instead of running full visibility queries during state handlers.
 *
 * Radius + faction only — no line of sight, no FOV, no hearing yet. The doc's
 * §"Perception Model" lists those as later upgrades; the structure here is
 * what they slot into when needed.
 */
export function createPerceptionSystem(): System {
    return {
        fixed: true,
        order: FixedOrder.perception,
        update(world) {
            const eids = query(world, [Behaviour, Position])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]
                if (hasComponent(world, eid, Health) && Health.current[eid] <= 0) {
                    setBehaviourTarget(world, eid, null)
                    continue
                }

                const profile = getBehaviourProfile(Behaviour.profileId[eid])
                if (!profile || profile.sightRadius <= 0) {
                    setBehaviourTarget(world, eid, null)
                    continue
                }

                const target = findNearestEnemy(world, eid, profile.sightRadius)
                setBehaviourTarget(world, eid, target)

                const blackboard = world.behaviourByEid.get(eid)
                if (blackboard && target !== null) {
                    blackboard.targetLastSeenPosition = {
                        x: Position.x[target],
                        y: Position.y[target],
                        z: Position.z[target],
                    }
                }
            }
        },
    }
}
