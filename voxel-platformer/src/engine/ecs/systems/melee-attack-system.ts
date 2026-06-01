// Player melee: on the Attack action, alternate a thrust and wide-swing
// animation, then apply a short forward-arc hit to nearby NPCs (light combat —
// NPCs are 1–2 HP; a lethal hit flags them to play `die` and despawn, handled by
// npc-render).

import { hasComponent, query } from 'bitecs'
import { Grounded, PlayerControlled, Position, Rotation } from '../components'
import type { ActionId, ActionMap } from '../../input/actions'
import { damageNpc, type NpcRuntimeState } from '../../../game/npcs/npc-types'
import { isStaffEquipmentKind } from '../../../game/anim/equipment-types'
import { debugHitboxesEnabled, pushDebugHitbox } from '../debug-hitboxes'
import type { System } from './system'
import { FixedOrder } from './orders'

/** Per-attack reach + arc. Thrust is a forward lunge (long, narrow, single
 *  target); swing is a wide cleave (shorter, hits everything in front). */
interface MeleeHitbox {
    range: number
    /** `dot(forward, toTarget) ≥ arcCos` to be in the wedge. */
    arcCos: number
    /** Thrust commits to the single nearest target; swing cleaves all in arc. */
    cleave: boolean
}

// Vertical band (relative to the player's feet) a melee hit can reach, so you
// can't tag NPCs on a ledge far above or in a pit below.
const MELEE_REACH_ABOVE = 2.2
const MELEE_REACH_BELOW = 1.2

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
    // Thrust: lunge a bit further on a tight wedge, commit to one target.
    const thrust: MeleeHitbox = { range: baseRange + 0.5, arcCos: Math.max(baseArcCos, 0.6), cleave: false }
    // Swing: a wide frontal arc (90° each side — the front hemisphere, never
    // behind the player) at base reach, cleaving everything in front.
    const swing: MeleeHitbox = { range: baseRange, arcCos: 0, cleave: true }
    // Staff bonk: longer reach and a forgiving frontal cone; the animation
    // drives the weighted spike forward/down, so gameplay should read as a
    // committed heavy hit.
    const staffSlam: MeleeHitbox = { range: baseRange + 0.85, arcCos: 0.25, cleave: true }
    let nextWideSwing = false
    let meleeLockSeconds = 0

    return {
        fixed: true,
        order: FixedOrder.input + 25,
        update(world, dt) {
            meleeLockSeconds = Math.max(0, meleeLockSeconds - dt)
            const players = query(world, [PlayerControlled, Position, Rotation])
            if (players.length === 0) return
            const player = players[0]!
            if (opts.canUse && !opts.canUse(world, player)) return
            if (!hasComponent(world, player, Grounded)) return
            const controller = world.animControllerByEid.get(player)
            if (meleeLockSeconds > 0) return
            if (controller && isMeleeAnimationBusy(controller.machine.currentStateId)) return
            if (!actions.consumePressed(actionId, player)) return

            const useStaff = activeLoadoutUsesStaff(world)
            const useWideSwing = !useStaff && nextWideSwing
            controller?.machine.setParam(useStaff ? 'staffAttack' : useWideSwing ? 'attackWide' : 'attack', 1)
            if (!useStaff) nextWideSwing = !nextWideSwing
            meleeLockSeconds = useStaff ? 0.64 : useWideSwing ? 0.56 : 0.44

            // Forward-arc hit against live NPCs, shaped by which attack played.
            const box = useStaff ? staffSlam : useWideSwing ? swing : thrust
            const yaw = Rotation.y[player]!
            const fx = Math.sin(yaw)
            const fz = Math.cos(yaw)
            const px = Position.x[player]!
            const py = Position.y[player]!
            const pz = Position.z[player]!
            if (debugHitboxesEnabled()) {
                pushDebugHitbox(world, {
                    kind: 'wedge',
                    ttl: Math.min(0.32, meleeLockSeconds),
                    color: useStaff ? [0.88, 0.48, 1.0] : useWideSwing ? [1.0, 0.58, 0.18] : [1.0, 0.28, 0.22],
                    origin: { x: px, y: py, z: pz },
                    yaw,
                    range: box.range,
                    arcRadians: Math.acos(box.arcCos) * 2,
                    minY: -MELEE_REACH_BELOW,
                    maxY: MELEE_REACH_ABOVE,
                })
            }
            let nearest: NpcRuntimeState | null = null
            let nearestDist = Infinity
            for (const npc of world.npcRuntimeById.values()) {
                if (npc.dying) continue
                const dx = npc.position.x - px
                const dz = npc.position.z - pz
                const dist = Math.hypot(dx, dz)
                if (dist > box.range || dist < 1e-3) continue
                if ((fx * dx + fz * dz) / dist < box.arcCos) continue
                const dy = npc.position.y - py
                if (dy > MELEE_REACH_ABOVE || dy < -MELEE_REACH_BELOW) continue
                if (box.cleave) {
                    damageNpc(npc, damage)
                } else if (dist < nearestDist) {
                    nearestDist = dist
                    nearest = npc
                }
            }
            if (!box.cleave && nearest) damageNpc(nearest, damage)
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
