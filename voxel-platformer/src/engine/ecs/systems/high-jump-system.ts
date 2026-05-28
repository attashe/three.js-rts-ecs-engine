import { hasComponent, query, removeComponent } from 'bitecs'
import { BoxCollider, Grounded, PlayerControlled, Position, Velocity } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushLog } from '../world'
import type { ChunkManager } from '../../voxel/chunk-manager'
import { aabbFromFoot, type AABB } from '../../voxel/voxel-collide'
import { movementEnvironmentForAABB } from '../../voxel/movement-effects'

export interface HighJumpOptions {
    actionId?: ActionId
    jumpVelocity?: number
    /** Optional voxel world query for non-physical movement effects such as water. */
    chunks?: ChunkManager
    /** Fires the frame the high jump fires successfully (after the
     *  movement-environment and grounded gates pass). Used to play the
     *  spell-whoosh cue. */
    onHighJump?: (eid: number) => void
}

/**
 * High Jump: a strong upward impulse on the player while grounded. Useful for
 * reaching platforms a normal jump can't clear. Refuses to fire mid-air so it
 * isn't a free double-jump.
 *
 * The parent engine gated this on PlayerResources mana cost; the platformer
 * foundation has no resource layer, so the action map cooldown alone gates
 * use frequency.
 */
export function createHighJumpSystem(actions: ActionMap, opts: HighJumpOptions = {}): System {
    const actionId = opts.actionId ?? 'spell.highJump'
    const jumpVelocityOverride = opts.jumpVelocity
    const chunks = opts.chunks
    const onHighJump = opts.onHighJump
    const playerAabb: AABB = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }

    return {
        fixed: true,
        order: FixedOrder.input + 10,
        update(world) {
            const players = query(world, [PlayerControlled, Position, Velocity, BoxCollider])
            if (players.length === 0) return

            const player = players[0]!
            if (!actions.consumePressed(actionId, player)) return
            if (!world.playerSettings.abilities.highJump) {
                pushLog(world, 'High Jump is disabled.')
                return
            }

            if (chunks) {
                aabbFromFoot(
                    { x: Position.x[player], y: Position.y[player], z: Position.z[player] },
                    { x: BoxCollider.x[player], y: BoxCollider.y[player], z: BoxCollider.z[player] },
                    playerAabb,
                )
                if (movementEnvironmentForAABB(chunks, playerAabb).jumpDisabled) {
                    pushLog(world, 'High Jump is disabled here.')
                    return
                }
            }

            if (!hasComponent(world, player, Grounded)) {
                pushLog(world, 'High Jump needs solid ground.')
                return
            }

            const jumpVelocity = jumpVelocityOverride ?? world.playerSettings.highJumpVelocity
            Velocity.y[player] = Math.max(Velocity.y[player], jumpVelocity)
            removeComponent(world, player, Grounded)
            pushLog(world, 'High Jump!')
            onHighJump?.(player)
        },
    }
}
