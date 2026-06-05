import { hasComponent, query } from 'bitecs'
import { BoxCollider, PlayerControlled, Position } from '../components'
import { isDead } from '../combat'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushLog, type DeathReason, type GameWorld } from '../world'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { movementEnvironmentForAABB } from '../../voxel/movement-effects'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import type { BlockContactHazard } from '../../voxel/palette'

export interface PlayerDeathSystemOptions {
    /** Players below this world-Y are considered to have fallen off the
     *  level and die. Default `-2` — below most demo / playtest terrain. */
    voidY?: number
    /** Optional voxel world query for lethal non-physical blocks such as lava. */
    chunks?: ChunkManager
    onDeath?: (reason: DeathReason) => void
}

/**
 * Watches every player entity for terminal conditions:
 *  - Falling below `voidY` (off the world).
 *  - Overlapping lethal non-physical block contact hazards.
 *
 * Sets `world.deathSignal` so `restart-system` can reload the level on the
 * render side. Bails out once the signal is set so the level doesn't churn
 * extra log lines while waiting for the reload.
 */
export function createPlayerDeathSystem(opts: PlayerDeathSystemOptions = {}): System {
    const voidY = opts.voidY ?? -2
    const chunks = opts.chunks
    const playerAabb: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
    return {
        fixed: true,
        // After physics so we read the position physics resolved to this
        // tick (avoids signalling death from the pre-physics y).
        order: FixedOrder.postPhysics,
        update(world) {
            if ((world as GameWorld).deathSignal) return
            const eids = query(world, [Position, PlayerControlled])
            for (let i = 0; i < eids.length; i++) {
                const eid = eids[i]!
                if (Position.y[eid] < voidY) {
                    signalDeath(world as GameWorld, 'fell-into-void', 'You fell into the void.', opts.onDeath)
                    return
                }

                if (isDead(world as GameWorld, eid)) {
                    signalDeath(world as GameWorld, 'slain', 'You were slain.', opts.onDeath)
                    return
                }

                if (chunks && hasComponent(world, eid, BoxCollider)) {
                    aabbFromFoot(
                        { x: Position.x[eid], y: Position.y[eid], z: Position.z[eid] },
                        { x: BoxCollider.x[eid], y: BoxCollider.y[eid], z: BoxCollider.z[eid] },
                        playerAabb,
                    )
                    const hazard = movementEnvironmentForAABB(chunks, playerAabb).contactHazard
                    const reason = deathReasonForHazard(hazard)
                    if (reason) {
                        signalDeath(world as GameWorld, reason, deathLogForReason(reason), opts.onDeath)
                        return
                    }
                }
            }
        },
    }
}

function deathReasonForHazard(hazard: BlockContactHazard | null): DeathReason | null {
    switch (hazard) {
        case 'lava': return 'burned-by-lava'
        default: return null
    }
}

function deathLogForReason(reason: DeathReason): string {
    switch (reason) {
        case 'burned-by-lava': return 'You touched lava.'
        case 'fell-into-void': return 'You fell into the void.'
        default: return 'You died.'
    }
}

function signalDeath(
    world: GameWorld,
    reason: DeathReason,
    message: string,
    onDeath: ((reason: DeathReason) => void) | undefined,
): void {
    world.deathSignal = reason
    pushLog(world, message)
    onDeath?.(reason)
}
