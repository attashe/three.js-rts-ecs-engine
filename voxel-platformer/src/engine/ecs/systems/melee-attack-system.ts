// Player melee: on the Attack action, alternate thrust/wide-swing animations
// and enqueue a timed attack. Damage is resolved by melee-combat-system during
// the authored active window.

import { hasComponent, query } from 'bitecs'
import { Grounded, PlayerControlled, Position, Rotation, Stunned } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import { isStaffEquipmentKind } from '../../../game/anim/equipment-types'
import type { System } from './system'
import { FixedOrder } from './orders'
import { hasActiveMeleeAttack, startMeleeAttack } from '../melee-combat'
import {
    cloneMeleeAttackDef,
    MELEE_ATTACK_DEFS,
    type MeleeAttackDef,
    type MeleeAttackId,
} from '../melee-types'

export interface MeleeAttackOptions {
    actionId?: ActionId
    /** Reach in world units (XZ). */
    range?: number
    /** Half-arc cosine threshold (`dot(forward, toTarget) ≥ this`). */
    arcCos?: number
    damage?: number
    /** Gate the swing (e.g. only when the melee weapon is drawn). */
    canUse?: (world: Parameters<System['update']>[0], player: number) => boolean
}

export function createMeleeAttackSystem(actions: ActionMap, opts: MeleeAttackOptions = {}): System {
    const actionId = opts.actionId ?? 'weapon.attack'
    const baseRange = opts.range ?? 1.8
    const baseArcCos = opts.arcCos ?? 0.35
    const damage = opts.damage ?? 1
    const thrust = playerAttackDef('player-thrust', baseRange + 0.5, Math.max(baseArcCos, 0.6), damage)
    const swing = playerAttackDef('player-swing', baseRange, 0, damage)
    const staffSlam = playerAttackDef('staff-slam', baseRange + 0.85, 0.25, damage)
    let nextWideSwing = false

    return {
        fixed: true,
        order: FixedOrder.input + 25,
        update(world, dt) {
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return
            const player = players[0]!
            if (opts.canUse && !opts.canUse(world, player)) return
            if (hasComponent(world, player, Stunned)) return
            if (!hasComponent(world, player, Grounded)) return
            if (hasActiveMeleeAttack(world, { kind: 'player', eid: player })) return
            const controller = world.animControllerByEid.get(player)
            if (controller && isMeleeAnimationBusy(controller.machine.currentStateId)) return
            if (!actions.consumePressed(actionId, player)) return

            const useStaff = activeLoadoutUsesStaff(world)
            const useWideSwing = !useStaff && nextWideSwing
            const def = useStaff ? staffSlam : useWideSwing ? swing : thrust
            if (!startMeleeAttack(world, { kind: 'player', eid: player }, def)) return
            controller?.machine.setParam(useStaff ? 'staffAttack' : useWideSwing ? 'attackWide' : 'attack', 1)
            if (!useStaff) nextWideSwing = !nextWideSwing
        },
    }
}

function isMeleeAnimationBusy(stateId: string): boolean {
    return stateId === 'attack' || stateId === 'attackWide' || stateId === 'staffAttack' || stateId === 'hammerAttack' || stateId === 'shoot' || stateId === 'shieldBlock'
}

function activeLoadoutUsesStaff(world: Parameters<System['update']>[0]): boolean {
    const loadout = world.playerSettings.equipment[world.weaponStance]
    return isStaffEquipmentKind(loadout.handR) || isStaffEquipmentKind(loadout.handL)
}

function playerAttackDef(id: MeleeAttackId, range: number, arcCos: number, damage: number): MeleeAttackDef {
    const def = cloneMeleeAttackDef(MELEE_ATTACK_DEFS[id])
    def.damage = damage
    if (def.shape.kind === 'wedge') {
        def.shape.range = range
        def.shape.arcRadians = Math.acos(Math.max(-1, Math.min(1, arcCos))) * 2
    }
    return def
}
