import { query, removeComponent } from 'bitecs'
import { Attackable, Faction, Health, PlayerControlled, Position, Rotation } from '../components'
import { areEnemies } from '../factions'
import type { ActionId, ActionMap } from '../../input/actions'
import type { System } from './system'
import { FixedOrder } from './orders'
import { pushGameLog } from '../world'

export interface MeleeCombatOptions {
    range?: number
    arcRadians?: number
    damage?: number
    notify?: (message: string) => void
    actionId?: ActionId
}

export function createMeleeCombatSystem(actions: ActionMap, opts: MeleeCombatOptions = {}): System {
    const range = opts.range ?? 1.35
    const arc = opts.arcRadians ?? Math.PI * 0.65
    const damage = opts.damage ?? 25
    const actionId = opts.actionId ?? 'attack.primary'
    const cosHalfArc = Math.cos(arc * 0.5)

    return {
        fixed: true,
        order: FixedOrder.input,
        update(world) {
            const players = query(world, [PlayerControlled, Position])
            if (players.length === 0) return
            const player = players[0]
            if (!actions.consumePressed(actionId, player)) return

            const px = Position.x[player]
            const pz = Position.z[player]
            const yaw = Rotation.y[player] ?? 0
            const forwardX = Math.sin(yaw)
            const forwardZ = Math.cos(yaw)

            const targets = query(world, [Attackable, Position, Health, Faction])
            let best = -1
            let bestDistSq = Infinity
            for (let i = 0; i < targets.length; i++) {
                const eid = targets[i]
                if (!areEnemies(Faction.id[player], Faction.id[eid])) continue

                const dx = Position.x[eid] - px
                const dz = Position.z[eid] - pz
                const distSq = dx * dx + dz * dz
                if (distSq > range * range || distSq >= bestDistSq) continue

                const dist = Math.sqrt(distSq)
                if (dist > 0.0001) {
                    const dot = (dx / dist) * forwardX + (dz / dist) * forwardZ
                    if (dot < cosHalfArc) continue
                }

                best = eid
                bestDistSq = distSq
            }

            if (best < 0) {
                const message = 'Your swing hits only air.'
                pushGameLog(world, { type: 'combat', message, eid: player })
                opts.notify?.(message)
                return
            }

            Health.current[best] = Math.max(0, Health.current[best] - damage)
            const name = world.interactionByEid.get(best)?.label ?? 'Target'
            if (Health.current[best] <= 0) {
                removeComponent(world, best, Attackable)
                const message = `${name} is defeated.`
                pushGameLog(world, { type: 'combat', message, eid: best })
                opts.notify?.(message)
            } else {
                const message = `${name} takes ${damage} damage.`
                pushGameLog(world, { type: 'combat', message, eid: best })
                opts.notify?.(message)
            }
        },
    }
}
