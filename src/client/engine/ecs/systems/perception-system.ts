import { hasComponent, query } from 'bitecs'
import { Behaviour, Faction, Health, Position } from '../components'
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
            const targets = createTargetIndex(world)
            const localCandidates: number[] = []
            let candidateChecks = 0
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

                localCandidates.length = 0
                targets.queryInto(Position.x[eid], Position.z[eid], profile.sightRadius, localCandidates)
                candidateChecks += localCandidates.length
                const target = findNearestEnemy(world, eid, profile.sightRadius, localCandidates)
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
            world.metrics.setGauge('perception.actors', eids.length)
            world.metrics.setGauge('perception.checks', candidateChecks)
        },
    }
}

const TARGET_CELL_SIZE = 4

class TargetIndex {
    private readonly buckets = new Map<string, number[]>()

    insert(eid: number): void {
        const key = cellKey(Position.x[eid], Position.z[eid])
        const bucket = this.buckets.get(key)
        if (bucket) bucket.push(eid)
        else this.buckets.set(key, [eid])
    }

    queryInto(x: number, z: number, radius: number, result: number[]): void {
        const minX = Math.floor((x - radius) / TARGET_CELL_SIZE)
        const maxX = Math.floor((x + radius) / TARGET_CELL_SIZE)
        const minZ = Math.floor((z - radius) / TARGET_CELL_SIZE)
        const maxZ = Math.floor((z + radius) / TARGET_CELL_SIZE)
        for (let cz = minZ; cz <= maxZ; cz++) {
            for (let cx = minX; cx <= maxX; cx++) {
                const bucket = this.buckets.get(`${cx},${cz}`)
                if (!bucket) continue
                for (let i = 0; i < bucket.length; i++) result.push(bucket[i]!)
            }
        }
    }
}

function createTargetIndex(world: Parameters<System['update']>[0]): TargetIndex {
    const index = new TargetIndex()
    const targets = query(world, [Position, Faction, Health])
    for (let i = 0; i < targets.length; i++) {
        const eid = targets[i]
        if (Health.current[eid] > 0) index.insert(eid)
    }
    world.metrics.setGauge('perception.targets', targets.length)
    return index
}

function cellKey(x: number, z: number): string {
    return `${Math.floor(x / TARGET_CELL_SIZE)},${Math.floor(z / TARGET_CELL_SIZE)}`
}
